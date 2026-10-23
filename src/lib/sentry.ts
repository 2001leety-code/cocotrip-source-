/**
 * Sentry Error Tracking — CocoTrip
 *
 * Centralized Sentry configuration.
 * DSN is read from VITE_SENTRY_DSN env var.
 * If not set, Sentry is silently disabled.
 */
import * as Sentry from '@sentry/react';

let sentryInitializationAttempted = false;
let sentryInitialized = false;

/**
 * 게스트 예약 관리 토큰 제거 (2026-10-23, ②a) — `/booking/manage#t=<token>` 프래그먼트와
 * 요청 본문의 `manageToken` 값이 Sentry 이벤트·breadcrumb 에 남지 않게 한다.
 */
export function scrubManageToken(value: string): string {
  return value
    .replace(/([#&]t=)[^&#\s"']+/g, '$1[redacted]')
    .replace(/("?manageToken"?\s*[:=]\s*"?)[^"&,}\s]+/g, '$1[redacted]');
}

function scrubUnknown(value: unknown): unknown {
  if (typeof value === 'string') return scrubManageToken(value);
  if (Array.isArray(value)) return value.map(scrubUnknown);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === 'manageToken' ? '[redacted]' : scrubUnknown(v);
    }
    return out;
  }
  return value;
}

function scrubBreadcrumb<T extends { message?: string; data?: Record<string, unknown> }>(crumb: T): T {
  if (crumb.message) crumb.message = scrubManageToken(crumb.message);
  if (crumb.data) crumb.data = scrubUnknown(crumb.data) as Record<string, unknown>;
  return crumb;
}

function scrubEvent<T extends { request?: { url?: string; query_string?: unknown; data?: unknown }; breadcrumbs?: { message?: string; data?: Record<string, unknown> }[] }>(event: T): T {
  if (event.request) {
    if (event.request.url) event.request.url = scrubManageToken(event.request.url);
    if (event.request.query_string !== undefined) event.request.query_string = scrubUnknown(event.request.query_string);
    if (event.request.data !== undefined) event.request.data = scrubUnknown(event.request.data);
  }
  if (event.breadcrumbs) event.breadcrumbs.forEach(scrubBreadcrumb);
  return event;
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!import.meta.env.PROD || !dsn) return;
  if (sentryInitializationAttempted) return;
  sentryInitializationAttempted = true;
  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      // Filter noisy errors
      ignoreErrors: [
        'ResizeObserver loop',
        'ChunkLoadError',
      ],
      beforeSend(event, hint) {
        const error = hint.originalException;
        const msg = (error as Error)?.message || '';
        // Firestore 내부 에러 무시
        if (msg.includes('FIRESTORE') || msg.includes('Missing or insufficient permissions')) return null;
        // 네트워크 에러 무시 (사용자 인터넷 문제)
        if (msg.includes('NetworkError') || msg.includes('Failed to fetch') || msg.includes('Load failed')) return null;
        // 개인정보 마스킹
        if (event.user) {
          delete event.user.email;
          delete event.user.ip_address;
        }
        return scrubEvent(event);
      },
      beforeSendTransaction(event) {
        return scrubEvent(event);
      },
      beforeBreadcrumb(crumb) {
        return scrubBreadcrumb(crumb);
      },
    });
    sentryInitialized = true;
  } catch { /* Sentry must not prevent the app from starting */ }
}

/**
 * 컴포넌트 에러 수동 보고용 helper.
 *
 * `initSentry()` 가 미호출되었거나 DSN 미설정인 경우(개발/preview)는 no-op.
 * 초기화에 성공한 뒤 호출하면 즉시 전송한다.
 *
 * 사용처: ErrorBoundary.componentDidCatch, async 핸들러 catch 블록 등
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  // Keep the build-time guards here too, so disabled builds can remove SDK calls.
  if (!sentryInitialized || !import.meta.env.PROD || !import.meta.env.VITE_SENTRY_DSN) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch { /* Reporting must not replace the original error */ }
}
