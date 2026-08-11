/**
 * OnboardingCouponModal — 회원가입 직후 1회 노출되는 웰컴 쿠폰 안내 모달.
 *
 * 트리거: sessionStorage `COCO_ONBOARDING_COUPONS_JUST_ISSUED` (firebase.js 가 세팅)
 * 위치:   App.tsx GlobalWidgets 에 마운트 → 어느 페이지에 있어도 노출됨
 * 닫기:   "확인" 클릭, 배경 클릭, X, Esc 시 sessionStorage 플래그 제거
 *
 * 2026-08-10 (Korea Editorial Concierge phase 2): 다크 그라데이션 카드 → 종이 위
 *   발급 내역서. 세 혜택은 라벨/값 두 칸이 하이라인으로 갈린 원장으로 읽힌다.
 *   🔴 쿠폰 문구·값·유효기간 키는 한 글자도 바꾸지 않았다 — 이 모달은 실제로
 *   발급되는 것(api onboarding-coupons.js: 3혜택·1년)과 문자 그대로 일치해야 하고,
 *   `tests/unit/promo-truth-p0.test.ts` 가 그 일치를 검사한다. 바뀐 것은 배치와
 *   대비, 그리고 없던 Esc·포커스·dialog 시맨틱뿐이다.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { trackWelcomeCouponModalView } from '@/lib/analytics';

const SESSION_KEY = 'COCO_ONBOARDING_COUPONS_JUST_ISSUED';

export function OnboardingCouponModal() {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  const navigate = useNavigate();
  // P1: 모달 노출 이벤트 1회 가드 (setState updater 는 순수해야 하므로 ref 사용)
  const viewTracked = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // i18n — mypage 네임스페이스 사용 (4개 언어 모두 키 존재)
  const mp = ((t as unknown) as { mypage?: Record<string, string> }).mypage || {};

  // 페이지 마운트 시 + 새로 flag 세팅될 때 감지 (storage event 포함)
  useEffect(() => {
    function checkFlag() {
      try {
        const flag = sessionStorage.getItem(SESSION_KEY);
        if (flag && Number(flag) > 0) {
          // P1 (2026-07-11): 모달 노출 이벤트 — 1회 (GA4 가입혜택 퍼널).
          if (!viewTracked.current) {
            viewTracked.current = true;
            trackWelcomeCouponModalView();
          }
          setOpen(true);
        }
      } catch { /* SSR / 시크릿 모드 */ }
    }

    checkFlag();

    // firebase.js 가 같은 탭에서 setItem 후 바로 checkFlag() 하기 때문에
    // storage 이벤트(cross-tab)보다 setItem 직후 re-render 가 먼저 일어남.
    // 그러나 App level 에서 이 컴포넌트가 이미 마운트됐을 때를 대비해
    // storage 이벤트도 함께 수신.
    window.addEventListener('storage', checkFlag);
    return () => window.removeEventListener('storage', checkFlag);
  }, []);

  // useCallback 이라 아래 Esc 리스너의 의존성이 매 렌더 바뀌지 않는다(리스너 재등록 방지).
  const handleClose = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* silent */ }
    setOpen(false);
  }, []);

  function handleViewCoupons() {
    handleClose();
    navigate('/mypage?tab=coupons');
  }

  // Esc 로 닫기 + 열릴 때 포커스를 대화상자 안으로.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  if (!open) return null;

  // 실발급(onboarding-coupons.js) 3혜택·1년과 반드시 일치 (P0 진실성).
  const gifts = [
    { label: mp.welcomeModalCoupon0 || 'Free AI Plan (1–3 days)', value: 'FREE' },
    { label: mp.welcomeModalCoupon1 || 'Charter 5% OFF', value: '5%' },
    { label: mp.welcomeModalCoupon2 || 'Tour Package 5% OFF', value: '5%' },
  ];

  return (
    /* Backdrop */
    <div
      className="ec-root fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(20, 20, 26, 0.55)' }}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-coupon-title"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-ec-md border border-ec-line bg-ec-raised shadow-ec-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-6 pb-4">
          <div className="min-w-0">
            <h2 id="welcome-coupon-title" className="ec-h3">
              {mp.welcomeModalTitle || 'Welcome to CocoTrip!'}
            </h2>
            <p className="ec-body-sm mt-2 text-ec-ink-3">
              {mp.welcomeModalSubtitle || 'Your sign-up is complete.'}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={handleClose}
            className="ec-btn ec-btn-quiet ec-btn-sm shrink-0"
            aria-label="Close"
            type="button"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <p className="ec-eyebrow px-6">{mp.welcomeModalCouponHeading || '3 welcome gifts issued'}</p>

        {/* 발급 내역 — 라벨과 값이 한 기준선에 정렬된 원장. */}
        <dl className="mt-2 border-t border-ec-line px-6">
          {gifts.map((g) => (
            <div key={g.label} className="flex items-baseline justify-between gap-4 border-b border-ec-line py-3">
              <dt className="min-w-0">
                <span className="block text-[14px] font-semibold text-ec-ink">{g.label}</span>
                <span className="ec-body-sm text-ec-ink-3">{mp.welcomeModalExpiry || 'Valid for 1 year'}</span>
              </dt>
              <dd className="ec-figure shrink-0 text-[15px] text-ec-brand">{g.value}</dd>
            </div>
          ))}
        </dl>

        <p className="ec-body-sm px-6 pt-3 text-ec-ink-3">
          {mp.welcomeModalBody || 'Use the AI plan in the planner, and the coupons at checkout for charter or tour bookings.'}
        </p>

        <div className="mt-4 flex flex-col gap-2 border-t border-ec-line p-6">
          <button onClick={handleViewCoupons} type="button" className="ec-btn ec-btn-primary w-full">
            {mp.welcomeModalCta || 'View My Coupons'}
          </button>
          <button onClick={handleClose} type="button" className="ec-btn ec-btn-quiet w-full">
            {mp.welcomeModalClose || 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}
