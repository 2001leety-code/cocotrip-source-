/**
 * Sentry Error Tracking — CocoTrip
 *
 * Centralized Sentry configuration.
 * DSN is read from VITE_SENTRY_DSN env var.
 * If not set, Sentry is silently disabled.
 */
type SentrySdk = typeof import('@sentry/react');

let sentryInitialization: Promise<SentrySdk | null> | null = null;

function loadSentry(dsn: string): Promise<SentrySdk | null> {
  if (!sentryInitialization) {
    sentryInitialization = import('@sentry/react')
      .then((Sentry) => {
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
            return event;
          },
        });
        return Sentry;
      })
      .catch(() => null);
  }
  return sentryInitialization;
}

export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!import.meta.env.PROD || !dsn) return;
  void loadSentry(dsn);
}

/**
 * 컴포넌트 에러 수동 보고용 helper.
 *
 * `initSentry()` 가 미호출되었거나 DSN 미설정인 경우(개발/preview)는 no-op.
 * 초기화가 진행 중이면 SDK 로딩 후 전송한다.
 *
 * 사용처: ErrorBoundary.componentDidCatch, async 핸들러 catch 블록 등
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  void sentryInitialization
    ?.then((Sentry) => Sentry?.captureException(error, context ? { extra: context } : undefined))
    .catch(() => undefined);
}
