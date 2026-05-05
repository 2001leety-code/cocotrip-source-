/**
 * api/_shared/sentry.js — 서버사이드 Sentry 경량 래퍼
 *
 * 목적: backend의 모든 unhandled error를 Sentry로 보내되, 다음 조건을 만족.
 *   1. @sentry/node 설치 안 돼 있어도 빌드/실행 깨지면 안 됨 → dynamic import
 *   2. SENTRY_DSN env 없으면 no-op → 로컬·테스트 환경 무영향
 *   3. cold start 비용 최소화 → init은 첫 호출 시 lazy + 한 번만
 *
 * 활성화 절차 (운영자):
 *   1. `npm i @sentry/node`
 *   2. Vercel env: SENTRY_DSN = "https://xxx@xxx.ingest.sentry.io/xxx"
 *   3. Redeploy
 *
 * 사용 예:
 *   import { wrapHandler, captureError } from './_shared/sentry.js';
 *
 *   // 패턴 A: 핸들러 전체 감싸기
 *   export default wrapHandler(async (req, res) => { ... });
 *
 *   // 패턴 B: catch 블록에서 명시적으로
 *   try { ... } catch (e) { await captureError(e, { route: 'foo' }); throw e; }
 */

let initState = 'pending'; // 'pending' | 'active' | 'disabled'
let SentryRef = null;

async function ensureInit() {
  if (initState !== 'pending') return SentryRef;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    initState = 'disabled';
    return null;
  }

  try {
    const mod = await import('@sentry/node');
    mod.init({
      dsn,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      // 2026-05-05: PR #237/#241 로 backend 12 endpoint 통합 후 1주 모니터 완료.
      // 5% 샘플링 활성화 — performance trace + error correlation 가능. 비용 미미.
      // 운영자가 SENTRY_TRACES_SAMPLE_RATE env 로 동적 조정 가능.
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.05'),
      // PII는 보내지 않음. user 정보는 명시적으로 setUser 호출 시에만.
      sendDefaultPii: false,
    });
    SentryRef = mod;
    initState = 'active';
  } catch (e) {
    // @sentry/node 미설치 → 영구 disable. 로그는 한 번만.
    initState = 'disabled';
    console.warn('[sentry] @sentry/node not installed — error capture disabled');
  }

  return SentryRef;
}

/**
 * 명시적 error capture. context는 Sentry tags + extra로 부착.
 * 실패는 무시 (Sentry 자체 장애가 본 흐름을 막지 못하도록).
 */
export async function captureError(err, context) {
  try {
    const Sentry = await ensureInit();
    if (!Sentry) return;
    Sentry.withScope((scope) => {
      if (context && typeof context === 'object') {
        for (const [k, v] of Object.entries(context)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            scope.setTag(k, String(v));
          } else {
            scope.setExtra(k, v);
          }
        }
      }
      Sentry.captureException(err);
    });
  } catch (sentryErr) {
    console.warn('[sentry] capture failed:', sentryErr.message);
  }
}

/**
 * Vercel handler wrapper. 핸들러가 throw하면 Sentry로 전송 + 500 응답.
 * 이미 응답을 보낸 경우(res.headersSent)는 응답을 다시 안 보냄.
 */
export function wrapHandler(handler) {
  return async function wrapped(req, res) {
    try {
      return await handler(req, res);
    } catch (err) {
      const route = (req && req.url ? req.url.split('?')[0] : 'unknown');
      await captureError(err, {
        route,
        method: (req && req.method) || 'unknown',
      });
      console.error(`[handler:${route}] uncaught:`, err && err.stack ? err.stack : err);
      if (res && !res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'Internal Server Error', code: 'INTERNAL_ERROR' }));
      }
    }
  };
}
