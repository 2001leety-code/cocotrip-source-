import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Korea Editorial Concierge foundation. Imported BEFORE index.css on purpose:
// these are token *definitions*, so legacy page-scoped rules in index.css keep
// winning on the pages they still own. Never move it after index.css.
// Docs: docs/DESIGN-EDITORIAL-CONCIERGE.md
import './styles/editorial.css'
import './index.css'
import App from './App.tsx'
import { initGA } from './lib/analytics'
import { bootPostHog } from './lib/posthog'
import { hasAnalyticsConsent, onConsentChange } from './lib/consent'
import { initSentry } from './lib/sentry'
import { startPrerenderReadySignal } from './lib/prerenderReady.mjs'

// D1: activate shadcn .dark tokens before React mount (avoids FOUC).
// Done here (not index.html class="dark") to avoid PDF_KOREAN_FONT lint
// false-positive on index.html (html2canvas comment trigger).
document.documentElement.classList.add('dark');

// PWA 실행 구분 (2026-07-05): 같은 origin 에 앱이 2개(코코트립 '/' · MOOD '/mood').
// 이번 실행이 어느 앱으로 켜졌는지 = 첫 진입 경로. SPA 라우팅으로 바뀌기 전에 1회 기록
// (PwaInstallButton 이 "이 앱으로 실행 중인가" 판정에 사용 — 앱 전환 착시/설치버튼 숨김 버그 방지).
try {
  if (!sessionStorage.getItem('pwa_launch_path')) {
    sessionStorage.setItem('pwa_launch_path', window.location.pathname);
  }
} catch { /* sessionStorage 차단 환경 — 버튼이 현재 경로로 폴백 */ }

// 2026-06-01: 정제 퍼플·핑크 전역 스코프 (아직 전환 안 된 페이지 — planner/tours/charter/plandetail).
// OFF=현재 그대로. 홈·공용 셸은 2026-08-10 Editorial Concierge 로 넘어가 이 플래그와 무관하다.
const REFINED_LEGACY = import.meta.env.VITE_FEATURE_REFINED_UI === 'true'
  || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('refined'));
if (REFINED_LEGACY) {
  document.documentElement.classList.add('refined');
  // Fraunces 세리프는 .refined-* 스코프에서만 쓰인다. 플래그 OFF 인데도 매 로드마다
  // 받아오던 외부 폰트 요청을 여기서 없앤다(main.tsx 주입 유지 — index.html 을 건드리면
  // PDF_KOREAN_FONT lint false-positive). display=swap.
  const frauncesLink = document.createElement('link');
  frauncesLink.rel = 'stylesheet';
  frauncesLink.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,ital,wght@9..144,0,500;9..144,0,600;9..144,1,500;9..144,1,600&display=swap';
  document.head.appendChild(frauncesLink);
}

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

// ── 분석 도구 초기화 — **쿠키 동의 후에만** (2026-07-30) ──
// 🔴 이전에는 여기서 무조건 켰다. 쿠키 배너는 localStorage 에 값만 쓰고 아무것도
//   막지 않아서, 사용자가 "닫기" 를 눌러도 GA4·PostHog 가 계속 돌았다.
//   배너에 "동의하면" 이라 써 놓고 실제로는 선택 전부터 추적하고 있었던 것이다.
// 수락하면 그 시점에 켠다(배너가 setConsent 로 알린다).
function startAnalytics() {
  initGA();          // VITE_GA_MEASUREMENT_ID 없으면 no-op
  bootPostHog();     // VITE_POSTHOG_KEY 없으면 no-op (SDK dynamic import)
}
if (hasAnalyticsConsent()) {
  startAnalytics();
} else {
  const stopWatching = onConsentChange((state) => {
    if (state !== 'accepted') return;
    stopWatching();
    startAnalytics();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 프리렌더(빌드후 puppeteer) 캡처 신호.
//
// 🔴 2026-08-23 이전에는 `setTimeout(signal, 2500)` 한 줄이었다. 2.5초는 "다 됐다" 의
//    증거가 아니라 짐작이고, 청크가 늦거나 실패한 라우트는 **빈 껍데기가 정적 HTML 로
//    구워져 배포**됐다 — 아무 에러 없이. 지금은 화면 내용으로 판정한다(본문·canonical·
//    robots, 가이드 상세는 본문 도착 + Article 스키마까지). 규칙 원본과 이유는
//    src/lib/prerenderReady.mjs, 산출물 감사는 scripts/audit-prerender-artifacts.mjs.
//
// PRERENDER 빌드에서만 돈다 — 일반 prod 번들에서는 `__PRERENDER_BUILD__` 가 false 라
// 이 블록이 통째로 사라진다(손님 브라우저는 폴링하지 않는다).
if (__PRERENDER_BUILD__ && typeof window !== 'undefined') {
  startPrerenderReadySignal(document);
}
