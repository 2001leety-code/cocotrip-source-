/**
 * OnboardingCouponModal — 회원가입 직후 1회 노출되는 웰컴 쿠폰 안내 모달.
 *
 * 트리거: sessionStorage `COCO_ONBOARDING_COUPONS_JUST_ISSUED` (firebase.js 가 세팅)
 * 위치:   App.tsx GlobalWidgets 에 마운트 → 어느 페이지에 있어도 노출됨
 * 닫기:   "확인" 클릭 또는 배경 클릭 시 sessionStorage 플래그 제거
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gift, Ticket, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

const SESSION_KEY = 'COCO_ONBOARDING_COUPONS_JUST_ISSUED';

export function OnboardingCouponModal() {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  const navigate = useNavigate();

  // i18n — mypage 네임스페이스 사용 (4개 언어 모두 키 존재)
  const mp = ((t as unknown) as { mypage?: Record<string, string> }).mypage ?? {};

  // 페이지 마운트 시 + 새로 flag 세팅될 때 감지 (storage event 포함)
  useEffect(() => {
    function checkFlag() {
      try {
        const flag = sessionStorage.getItem(SESSION_KEY);
        if (flag && Number(flag) > 0) {
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

  function handleClose() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch { /* silent */ }
    setOpen(false);
  }

  function handleViewCoupons() {
    handleClose();
    navigate('/mypage?tab=coupons');
  }

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}
    >
      {/* Modal card */}
      <div
        className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: 'linear-gradient(135deg, #1a1b2e 0%, #16213e 60%, #0f3460 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-white/60 hover:text-white transition-colors z-10"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {/* Header */}
        <div className="pt-8 pb-4 px-6 text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full p-3" style={{ background: 'rgba(124,92,252,0.25)' }}>
              <Gift className="text-[#a78bfa]" size={32} />
            </div>
          </div>
          <h2 className="text-white font-bold text-xl leading-tight">
            {mp.welcomeModalTitle ?? 'Welcome to CocoTrip!'}
          </h2>
          <p className="text-white/60 text-sm mt-1">
            {mp.welcomeModalSubtitle ?? 'Your sign-up is complete.'}
          </p>
        </div>

        {/* Coupon pills */}
        <div className="px-6 pb-2 space-y-2">
          <p className="text-[#a78bfa] font-semibold text-sm text-center mb-3">
            🎟️ {mp.welcomeModalCouponHeading ?? '2 welcome coupons issued'}
          </p>

          {/* Coupon 1 — Charter */}
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <Ticket className="text-[#7c5cfc] shrink-0" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm">
                {mp.welcomeModalCoupon1 ?? 'Charter 5% OFF'}
              </p>
              <p className="text-white/50 text-xs">{mp.welcomeModalExpiry ?? 'Valid for 90 days'}</p>
            </div>
            <span className="text-[#a78bfa] font-bold text-sm shrink-0">5%</span>
          </div>

          {/* Coupon 2 — Tour */}
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <Ticket className="text-[#7c5cfc] shrink-0" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm">
                {mp.welcomeModalCoupon2 ?? 'Tour Package 5% OFF'}
              </p>
              <p className="text-white/50 text-xs">{mp.welcomeModalExpiry ?? 'Valid for 90 days'}</p>
            </div>
            <span className="text-[#a78bfa] font-bold text-sm shrink-0">5%</span>
          </div>
        </div>

        {/* Body text */}
        <p className="text-white/50 text-xs text-center px-6 pt-3 pb-1">
          {mp.welcomeModalBody ?? 'Use them at checkout when booking a charter or tour package.'}
        </p>

        {/* CTA buttons */}
        <div className="p-6 pt-4 flex flex-col gap-2">
          <button
            onClick={handleViewCoupons}
            className="w-full rounded-xl py-3 font-semibold text-white text-sm transition-opacity hover:opacity-90 active:opacity-75"
            style={{ background: 'linear-gradient(135deg, #7c5cfc, #6d28d9)' }}
          >
            {mp.welcomeModalCta ?? 'View My Coupons'}
          </button>
          <button
            onClick={handleClose}
            className="w-full rounded-xl py-2.5 font-medium text-white/60 hover:text-white text-sm transition-colors"
          >
            {mp.welcomeModalClose ?? 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}
