/**
 * Sentry Error Tracking — CocoTrip
 *
 * Centralized Sentry configuration.
 * DSN is read from VITE_SENTRY_DSN env var.
 * If not set, Sentry is silently disabled.
 */
import * as Sentry from '@sentry/react';

export function initSentry() {
  if (!import.meta.env.PROD || !import.meta.env.VITE_SENTRY_DSN) return;

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
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
}

export { Sentry };
