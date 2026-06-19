/**
 * CharterIntroModal — 차터 페이지 첫 진입 시 1회 노출되는 사용 흐름 + 마감 안내 모달.
 *
 * 트리거: localStorage `COCO_CHARTER_INTRO_SEEN_v1` 미존재 시 페이지 마운트 직후 자동 노출
 * 위치:   CharterNewPage / CharterPage 에 마운트
 * 닫기:   "확인했어요" 버튼, 배경 클릭, X 버튼 → 항상 flag 저장 (1회 노출 정책)
 *
 * 안내 항목:
 *   - 차터 예약 6단계 흐름 요약
 *   - 12시간 이내 출발은 채팅창 사용 (오른쪽 하단 ChatWidget)
 *   - 예약 마감 정책 (12h, 2026-05-08 통일)
 *
 * 디자인은 OnboardingCouponModal / AIIntroModal 과 일관 유지.
 */
import { useState, useEffect } from 'react';
import { Car, MapPin, Clock, MessageCircle, AlertTriangle, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

const STORAGE_KEY = 'COCO_CHARTER_INTRO_SEEN_v1';

export function CharterIntroModal() {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();

  // i18n — charterPage 네임스페이스 (4개 언어 모두 키 존재)
  const c = ((t as unknown) as { charterPage?: Record<string, string> }).charterPage ?? {};

  // 마운트 시 1회 flag 체크 — 없으면 노출
  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        // 모바일(광고 유입 다수)은 첫 진입 강제 모달이 전환 방해 → 데스크탑만 자동 노출.
        const timer = window.setTimeout(() => { if (window.innerWidth >= 768) setOpen(true); }, 350);
        return () => window.clearTimeout(timer);
      }
    } catch { /* SSR / private mode */ }
  }, []);

  function persistSeen() {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch { /* silent */ }
  }

  function handleClose() {
    persistSeen();
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="charter-intro-title"
    >
      <div
        className="relative w-full max-w-md rounded-2xl overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'linear-gradient(135deg, #1a1b2e 0%, #16213e 60%, #0f3460 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-white/60 hover:text-white transition-colors z-10"
          aria-label="Close"
          type="button"
        >
          <X size={20} />
        </button>

        {/* Header */}
        <div className="pt-8 pb-4 px-6 text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full p-3" style={{ background: 'rgba(124,92,252,0.25)' }}>
              <Car className="text-[#a78bfa]" size={32} />
            </div>
          </div>
          <h2 id="charter-intro-title" className="text-white font-bold text-xl leading-tight">
            {c.charterIntroTitle ?? 'How charter booking works'}
          </h2>
          <p className="text-white/60 text-sm mt-1.5">
            {c.charterIntroSubtitle ?? 'Airport transfers, day tours, and multi-day charters in 6 quick steps.'}
          </p>
        </div>

        {/* Steps */}
        <div className="px-6 pb-2 space-y-3">
          {/* Step 1 */}
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <MapPin className="text-[#7c5cfc] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {c.charterIntroStep1Title ?? '1. Choose origin & service'}
              </p>
              <p className="text-white/55 text-xs mt-1 leading-relaxed">
                {c.charterIntroStep1Body ?? 'Pick your departure airport or city, then select the service you need.'}
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <Car className="text-[#7c5cfc] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {c.charterIntroStep2Title ?? '2. Enter dates, passengers & vehicle'}
              </p>
              <p className="text-white/55 text-xs mt-1 leading-relaxed">
                {c.charterIntroStep2Body ?? 'Share your travel dates, party size, luggage count, and preferred vehicle.'}
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <Clock className="text-[#7c5cfc] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {c.charterIntroStep3Title ?? '3. Review the quote and book'}
              </p>
              <p className="text-white/55 text-xs mt-1 leading-relaxed">
                {c.charterIntroStep3Body ?? 'An instant quote appears on screen. Pay via PayPal or request a tailored quote on WhatsApp.'}
              </p>
            </div>
          </div>
        </div>

        {/* Urgent / chat callout — emphasized */}
        <div
          className="mx-6 mt-4 rounded-xl px-4 py-3"
          style={{
            background: 'linear-gradient(135deg, rgba(255,107,157,0.18), rgba(182,104,252,0.18))',
            border: '1px solid rgba(255,107,157,0.45)',
          }}
        >
          <div className="flex items-start gap-2.5">
            <MessageCircle className="text-[#FF6B9D] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {c.charterIntroChatTitle ?? 'Need it urgently? Chat with us instead'}
              </p>
              <p className="text-white/70 text-xs mt-1 leading-relaxed">
                {c.charterIntroChatBody ?? "If you're departing within 12 hours, please skip the wizard and message us via the chat window in the bottom-right corner."}
              </p>
            </div>
          </div>
        </div>

        {/* Booking deadline note */}
        <div className="mx-6 mt-3 flex items-center gap-2 text-[11px] text-amber-300/85">
          <AlertTriangle className="shrink-0" size={14} />
          <span className="leading-snug">
            {c.charterIntroDeadline ?? 'Booking cutoff: 12 hours before departure.'}
          </span>
        </div>

        {/* CTA */}
        <div className="p-6 pt-3">
          <button
            onClick={handleClose}
            type="button"
            className="w-full rounded-xl py-3 font-semibold text-white text-sm transition-opacity hover:opacity-90 active:opacity-75"
            style={{ background: 'linear-gradient(135deg, #7c5cfc, #6d28d9)' }}
          >
            {c.charterIntroClose ?? 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}
