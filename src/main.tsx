import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.tsx'
import { initGA } from './lib/analytics'

// ── Sentry 에러 모니터링 (프로덕션 전용) ──
if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
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

// ── Firestore INTERNAL ASSERTION 에러 전역 억제 ──
// Firebase v12.11.0의 onSnapshot 리스너 충돌 버그 방지
// 이 에러는 비동기 콜백에서 발생하므로 React ErrorBoundary가 잡지 못함
window.addEventListener('error', (e) => {
  if (e.message?.includes('FIRESTORE') && e.message?.includes('INTERNAL ASSERTION FAILED')) {
    e.preventDefault();
    console.warn('[Firestore] Suppressed internal assertion error — safe to ignore');
    return true;
  }
});

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason?.message?.includes('FIRESTORE') && e.reason?.message?.includes('INTERNAL ASSERTION FAILED')) {
    e.preventDefault();
    console.warn('[Firestore] Suppressed unhandled rejection — safe to ignore');
  }
});

// ── GA4 Analytics 초기화 (VITE_GA_MEASUREMENT_ID 없으면 no-op) ──
initGA();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
