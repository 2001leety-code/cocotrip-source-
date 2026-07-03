// PWA 업데이트 토스트 — 새 빌드가 배포되면 "대기(waiting) SW" 감지 → 사용자에게 알림.
// vite-plugin-pwa registerType: 'prompt' 와 함께 작동:
//   - prompt: 새 SW 는 자동 활성화하지 않고 "대기" 상태로 머묾 (강제 리로드 없음).
//   - 이 컴포넌트가 needRefresh(=대기 SW 실재) 감지 → 토스트 → [새로고침] 클릭 시에만
//     updateServiceWorker → (sw.ts) SKIP_WAITING → 새 SW activate → 플러그인이 자동 reload.
//   - needRefresh 는 "진짜 새 빌드가 대기 중일 때"만 true. 첫 설치/첫 방문에서는 안 뜸
//     (그 경로는 onOfflineReady 이며 본 컴포넌트는 needRefresh 만 사용).
//
// 2026-06-09: 과거 P235 의 /my-plans 강제 자동 업데이트(needRefresh 감지 시 즉시
// updateServiceWorker 호출 = 강제 리로드)는 autoUpdate 시절 "새 SW 즉시 activate →
// cleanupOutdatedCaches 가 옛 청크 삭제 → 현재 세션이 옛 lazy 청크 요청 실패 → 플랜 깨짐"
// 을 막던 장치였음. 그러나 prompt 모드에서는 새 SW 가 대기만 하고 옛 SW 가 옛 청크를
// 일관 서빙하므로 그 문제가 발생하지 않음 → 강제 리로드가 오히려 "결제 직후 plan 화면이
// 갑자기 새로고침"되는 유일한 원인이 되어 제거. 이제 모든 경로에서 "토스트만, 사용자가
// 누를 때만 갱신". (딥서치: vite-plugin-pwa register.ts + workbox cleanupOutdatedCaches 소스 검증.)
//
// Usage: <App> 어디에든 한 번만 mount.
//
// 2026-06-14 (운영자 요청 "앱 들어갈 때마다 새 버전이면 자동 업데이트"):
//   - 앱 진입(콜드 스타트) 직후 감지된 새 버전 = 자동 적용(skipWaiting+reload). 아직 사용자가
//     아무것도 안 한 상태라 강제 리로드해도 잃을 게 없음(URL 보존).
//   - 세션 중(진입 한참 뒤, 작업 중) 감지된 새 버전 = 토스트로 사용자 선택 — #pwa-prompt 의
//     "위저드·결제 화면 갑자기 새로고침" 회귀를 막던 보호 유지. (둘의 경계 = 로드 후 경과시간.)
//
// 2026-07-02: 결제 진행(PayPal iframe 존재/iframe 포커스) 감지 시 콜드 스타트 자동 리로드도 스킵
//   → 토스트(수동 버튼)로 폴백. 결제 중 강제 새로고침 = 진행 중 결제 유실 위험.
import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useLanguage } from '@/hooks/useLanguage';
import { RefreshCw, X } from 'lucide-react';

// 진입 직후 이 시간(ms) 안에 감지된 업데이트 = "콜드 스타트" 로 보고 자동 적용. 이후 = 토스트.
const AUTO_UPDATE_WINDOW_MS = 10_000;
const AUTO_UPDATE_IDLE_MS = 1_200;

// 설치된 PWA(standalone) 실행 여부. PC/모바일 브라우저 탭에선 false.
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const ios = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return mm || ios;
}

function hasFocusedEditable(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
}

// 결제 진행 중 감지 (2026-07-02) — 결제 중 강제 새로고침 = 진행 중 결제 유실 위험이라 자동 리로드 금지.
// hasFocusedEditable 은 iframe 내부(PayPal 버튼/카드 입력)를 못 보므로 iframe 자체를 검사:
//   (a) 포커스가 iframe 에 있음 = 결제 위젯 조작 중일 수 있음
//   (b) PayPal iframe(src/name)이 DOM 에 존재 = 결제 UI 열림(TourBookingDialog/CartCheckout 등)
// (레포에 "결제 다이얼로그 열림" 전역 마커 없음 — window.paypal 은 SDK 로드 여부일 뿐이라 미사용.)
function isPaymentLikelyInProgress(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.activeElement?.tagName === 'IFRAME') return true;
  return !!document.querySelector('iframe[src*="paypal"], iframe[name*="paypal"]');
}

export function PWAUpdatePrompt() {
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState(false);
  // 자동 리로드를 스킵(작업 중/결제 중)한 경우 true → 진입 창 안에서도 토스트(수동 버튼)로 즉시 폴백.
  const [autoSkipped, setAutoSkipped] = useState(false);
  const loadedAtRef = useRef(Date.now());
  const autoUpdatedRef = useRef(false);
  const userInteractedRef = useRef(false);
  // PC 웹(브라우저 탭)에선 업데이트 알림·자동 리로드 불필요(그냥 새로고침) → 설치 앱에서만 노출.
  const standaloneRef = useRef(isStandalone());

  const {
    needRefresh: [needRefresh],
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

  // 사용자가 이미 터치/입력/스크롤을 시작했으면 "작업 중" 으로 보고 자동 리로드 대신 버튼으로 전환.
  // (탭에도 콜드스타트 자동 갱신이 생겼으므로 상호작용 추적은 standalone 여부와 무관하게 켠다)
  useEffect(() => {
    const markInteracted = () => { userInteractedRef.current = true; };
    const opts: AddEventListenerOptions = { passive: true, once: true };
    window.addEventListener('pointerdown', markInteracted, opts);
    window.addEventListener('keydown', markInteracted, opts);
    window.addEventListener('touchstart', markInteracted, opts);
    window.addEventListener('scroll', markInteracted, opts);
    return () => {
      window.removeEventListener('pointerdown', markInteracted);
      window.removeEventListener('keydown', markInteracted);
      window.removeEventListener('touchstart', markInteracted);
      window.removeEventListener('scroll', markInteracted);
    };
  }, []);

  // 앱 진입 직후 새 버전 대기 감지 → 자동 업데이트(작업 전이라 안전). 페이지당 1회.
  // 2026-07-03: 브라우저 탭에도 콜드스타트 조용한 갱신 확장 — prompt 모드에선 탭 사용자가
  // 새로고침해도 옛 SW가 옛 번들을 계속 서빙해 배포 후 영원히 stale(운영자 /admin 멈춤 재현).
  // 토스트 UI는 여전히 설치앱 전용(운영자 결정 2026-06-14 = "탭에 알림 UI 불필요"는 유지).
  // 사용자 작업 중/입력 포커스/결제 진행(PayPal iframe) 중이면 자동 리로드 스킵
  // (결제 중 강제 새로고침 = 결제 유실 위험).
  useEffect(() => {
    if (!needRefresh || autoUpdatedRef.current) return;
    if (Date.now() - loadedAtRef.current >= AUTO_UPDATE_WINDOW_MS) return;
    const timer = window.setTimeout(() => {
      if (userInteractedRef.current || hasFocusedEditable() || isPaymentLikelyInProgress()) {
        setAutoSkipped(true); // 자동 리로드 대신 사용자 선택(토스트의 수동 버튼)으로
        return;
      }
      // 진입 창 재확인(발화 시점) — 백그라운드 스로틀로 타이머가 늦게 발화해도
      // 세션 중 무조건 강제 리로드는 금지(P235 잠금).
      if (Date.now() - loadedAtRef.current < AUTO_UPDATE_WINDOW_MS + AUTO_UPDATE_IDLE_MS) {
        autoUpdatedRef.current = true;
        void updateServiceWorker(true); // skipWaiting + 자동 reload → 최신 버전
      } else {
        // 지연 발화로 자동 창을 놓친 경우 — state 무변화면 마지막 렌더(null)에 멈춰
        // 토스트가 영영 안 뜰 수 있음 → 수동 버튼 폴백으로 전환해 재렌더 유도.
        setAutoSkipped(true);
      }
    }, AUTO_UPDATE_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [needRefresh, updateServiceWorker]);

  // dismissed 후 5분 뒤 자동 재표시 (사용자가 X 누른 경우).
  useEffect(() => {
    if (!dismissed) return;
    const timer = setTimeout(() => setDismissed(false), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [dismissed]);

  // PC/모바일 브라우저 탭에선 토스트 안 띄움(설치 앱에서만). 운영자 요청 2026-06-14.
  if (!standaloneRef.current) return null;
  if (!needRefresh || dismissed) return null;
  // 자동 업데이트 창 안에서는 토스트 대신 위 effect 가 리로드 → 깜빡임 방지로 숨김.
  // 단 자동 리로드를 스킵한 경우(작업 중/결제 중)는 즉시 토스트로 폴백(수동 [새로고침] 버튼).
  if (!autoSkipped && Date.now() - loadedAtRef.current < AUTO_UPDATE_WINDOW_MS) return null;

  const message = (t.pwa as { updateAvailable?: string })?.updateAvailable
    || '새 버전이 있습니다';
  const refreshLabel = (t.pwa as { refresh?: string })?.refresh || '새 버전 업데이트';

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
        onClick={() => setDismissed(true)}
        className="shrink-0 p-1 rounded-md hover:bg-white/15 text-white/85 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
