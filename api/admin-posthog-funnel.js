/**
 * Vercel API Route: PostHog Ordered Funnel for AdminAnalytics ConversionFunnel
 * GET /api/admin-posthog-funnel?days=30
 *
 * 5단계 순서형(같은 사람·시간순) 퍼널 (2026-08-24, plan_generated 제거):
 *   wizard_seen -> preview_success -> payment_started(planType=ai-planner-full)
 *     -> payment_completed(planType=ai-planner-full) -> planner_complete
 *
 * 쿼리/정규화/검증 로직은 순수 함수(`./_shared/orderedFunnel.js`)로 분리 —
 * PostHog 없이 단위 테스트 가능. 이 파일은 인증 + fetch + 응답 조립만 한다.
 *
 * 보안:
 *   - Firebase ID token (verifyAdminToken) 필수
 *   - 어드민 이메일만 통과
 *
 * ENV:
 *   POSTHOG_PERSONAL_API_KEY  — PostHog 개인 API 키 (Settings → Personal API Keys)
 *                                ※ project_api_key (이벤트 ingest 용) 와 다름.
 *   POSTHOG_PROJECT_ID        — PostHog 프로젝트 ID (URL에서 확인)
 *   POSTHOG_HOST              — 기본 https://us.posthog.com
 *
 * PostHog 미설정 시 503(POSTHOG_DISABLED). 쿼리 실패/타임아웃 시 500(POSTHOG_QUERY_FAILED).
 * 응답이 기형이거나 순서·단조성 불변식을 어기면 500(FUNNEL_INVALID_<reason>) — 잘못된 수치를
 * 절대 200으로 내보내지 않는다.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { resolvePosthogQueryHost, formatPosthogError } from './_shared/posthog-host.js';
import {
  SEMANTICS_VERSION,
  PLAN_TYPE,
  buildFunnelWindow,
  buildOrderedFunnelSQL,
  buildLatestEventSQL,
  normalizeFunnelCounts,
  normalizeLatestEventAt,
  validateOrderedFunnel,
} from './_shared/orderedFunnel.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

// PR #437 (W-H11): origin allowlist via buildAdminCors — was wildcard '*'.
const CORS_METHODS = 'GET, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

const HOST = resolvePosthogQueryHost(process.env.POSTHOG_HOST);

async function posthogQuery({ apiKey, projectId, sql }) {
  const r = await fetch(`${HOST}/api/projects/${projectId}/query/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(formatPosthogError('ordered-funnel query', r.status, t)); }
  const data = await r.json();
  return Array.isArray(data?.results) ? data.results : [];
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET') return json(req, res, 405, { ok: false, error: 'GET only', code: 'METHOD_NOT_ALLOWED' });

  const auth = await verifyAdminToken(req);
  if (!auth.ok) return json(req, res, auth.status, { ok: false, error: auth.error, code: 'AUTH_FAILED' });

  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!apiKey || !projectId) {
    return json(req, res, 503, {
      ok: false,
      error: 'PostHog 미연결 — Vercel Production의 POSTHOG_PERSONAL_API_KEY와 POSTHOG_PROJECT_ID를 확인하세요.',
      code: 'POSTHOG_DISABLED',
    });
  }

  const url = new URL(req.url, 'http://localhost');
  const { days, windowStart, windowEnd } = buildFunnelWindow(url.searchParams.get('days'));

  try {
    const [countRows, latestRows] = await Promise.all([
      posthogQuery({ apiKey, projectId, sql: buildOrderedFunnelSQL(windowStart, windowEnd, PLAN_TYPE) }),
      posthogQuery({ apiKey, projectId, sql: buildLatestEventSQL(windowStart, windowEnd, PLAN_TYPE) }),
    ]);

    const steps = normalizeFunnelCounts(countRows);
    if (!steps) {
      console.error('[admin-posthog-funnel] malformed PostHog result:', JSON.stringify(countRows));
      return json(req, res, 500, { ok: false, error: 'PostHog returned a malformed funnel result', code: 'FUNNEL_MALFORMED_RESULT' });
    }

    const validation = validateOrderedFunnel(steps);
    if (!validation.ok) {
      console.error('[admin-posthog-funnel] invariant violation:', validation.reason);
      return json(req, res, 500, { ok: false, error: 'Funnel result failed the ordered/monotonic invariant check', code: `FUNNEL_INVALID_${validation.reason}` });
    }

    return json(req, res, 200, {
      ok: true,
      data: {
        semanticsVersion: SEMANTICS_VERSION,
        generatedAt: new Date().toISOString(),
        windowStart,
        windowEnd,
        latestEventAt: normalizeLatestEventAt(latestRows),
        days,
        steps,
      },
    });
  } catch (err) {
    console.error('[admin-posthog-funnel] error:', err);
    return json(req, res, 500, { ok: false, error: err.message, code: 'POSTHOG_QUERY_FAILED' });
  }
}
