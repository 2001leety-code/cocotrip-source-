import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initGA } from './lib/analytics'
import { bootPostHog } from './lib/posthog'
import { initSentry } from './lib/sentry'

// D1: activate shadcn .dark tokens before React mount (avoids FOUC).
// Done here (not index.html class="dark") to avoid PDF_KOREAN_FONT lint
// false-positive on index.html (html2canvas comment trigger).
document.documentElement.classList.add('dark');

// 2026-06-01: Fraunces 세리프 (정제 퍼플·핑크 디자인 — hero/제목/가격). main.tsx 주입
// (index.html 미수정 — 위와 동일한 PDF_KOREAN_FONT lint false-positive 회피). display=swap.
const frauncesLink = document.createElement('link');
frauncesLink.rel = 'stylesheet';
frauncesLink.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,500;9..144,0,600;9..144,1,500;9..144,1,600&display=swap';
document.head.appendChild(frauncesLink);

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

// ── PostHog product analytics 초기화 (VITE_POSTHOG_KEY 없으면 no-op) ──
// SDK는 dynamic import — 키 없으면 번들에 들어가지 않음.
bootPostHog();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
