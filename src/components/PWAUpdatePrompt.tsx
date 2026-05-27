// PWA 업데이트 토스트 — 새 버전 service worker가 배포되면 사용자에게 즉시 알림.
// vite-plugin-pwa의 registerType: 'autoUpdate'와 함께 작동:
//   - autoUpdate: 새 SW가 자동 활성화되지만, 페이지 reload 전엔 새 코드 적용 안 됨
//   - 이 컴포넌트가 needRefresh 감지 → 사용자에게 토스트 → 클릭 시 reload
// 별도 Toaster 의존성 없이 자체 UI (sonner 미사용 — 글로벌 Toaster 없음).
//
// P235: /my-plans/* 경로에서 needRefresh 감지 시 dismiss 없이 자동 업데이트 적용.
// 운영자 plan 1b850044 처럼 결제 후 plan 화면에서 구 JS 가 서빙되면 Firestore
// permission-denied → "플랜을 찾을 수 없습니다" 오표시. /my-plans 에서는 X 버튼 숨김.
//
// Usage: <App> 어디에든 한 번만 mount. CommandPaletteProvider 안쪽 권장.
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useLanguage } from '@/hooks/useLanguage';
import { useLocation } from 'react-router-dom';
import { RefreshCw, X } from 'lucide-react';

export function PWAUpdatePrompt() {
  const { t } = useLanguage();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(false);

  // P235: /my-plans/* 경로 = plan 상세 — SW 스테일 캐시가 결제한 plan 을 가림.
  // 이 경로에서는 dismiss 버튼 없이 자동 업데이트 강제 (X 버튼 숨김 + 5분 재표시 없음).
  const isOnPlanPage = location.pathname.startsWith('/my-plans/');

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      // Diagnostics — 개발 중 SW 등록 확인용
      if (r) console.log('[PWA] SW registered:', r.scope);
    },
    onRegisterError(error) {
      console.warn('[PWA] SW register failed:', error);
    },
  });

  // P235: /my-plans 에서 needRefresh 감지 시 즉시 자동 업데이트 (dismiss 없음).
  // 비교: 레스토랑에서 메뉴판(JS)이 바뀌었는데 웨이터가 구 메뉴판 가져오면 주문 오류 —
  // 결제 후 plan 화면에서는 최신 메뉴판이 반드시 있어야 함.
  useEffect(() => {
    if (needRefresh && isOnPlanPage) {
      console.log('[PWA P235] plan page + needRefresh → auto-update');
      updateServiceWorker(true);
    }
  }, [needRefresh, isOnPlanPage, updateServiceWorker]);

  // dismissed 후 5분 뒤 자동 재표시 (사용자가 X 누른 경우 — plan 페이지 외)
  useEffect(() => {
    if (!dismissed) return;
    const timer = setTimeout(() => setDismissed(false), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [dismissed]);

  // plan 페이지에서는 auto-update 후 reload 되므로 토스트 렌더 불필요.
  if (!needRefresh || dismissed || isOnPlanPage) return null;

  const message = (t.pwa as { updateAvailable?: string })?.updateAvailable
    || '새 버전이 있습니다';
  const refreshLabel = (t.pwa as { refresh?: string })?.refresh || '새로고침';

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[10000] w-[calc(100%-32px)] max-w-md px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)', // 모바일 bottom nav 위
        background: 'linear-gradient(135deg, rgba(124,92,252,0.95) 0%, rgba(234,83,126,0.95) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        animation: 'fadeIn 0.3s ease-out',
      }}
      role="status"
      aria-live="polite"
    >
      <RefreshCw className="w-4 h-4 text-white shrink-0" aria-hidden="true" />
      <span className="flex-1 text-sm font-medium text-white truncate">
        {message}
      </span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="shrink-0 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-colors"
      >
        {refreshLabel}
      </button>
      <button
        onClick={() => { setNeedRefresh(false); setDismissed(true); }}
        className="shrink-0 p-1 rounded-md hover:bg-white/15 text-white/85 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
