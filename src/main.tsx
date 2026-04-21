import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initGA } from './lib/analytics'
import { initSentry } from './lib/sentry'

// ── Sentry 에러 모니터링 (프로덕션 전용) ──
initSentry();

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
