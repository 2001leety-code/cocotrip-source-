/**
 * AIIntroModal — AI 플래너 페이지 첫 진입 시 1회 노출되는 사용 흐름 안내 모달.
 *
 * 트리거: localStorage `COCO_AI_INTRO_SEEN_v1` 미존재 시 페이지 마운트 직후 자동 노출
 * 위치:   PlannerPage 에 마운트
 * 닫기:   "시작하기" 버튼, 배경 클릭, X 버튼 → 항상 flag 저장 (1회 노출 정책)
 *
 * 디자인은 OnboardingCouponModal 과 일관 유지 (Tailwind, 다크 그라데이션, lucide-react 아이콘).
 */
import { useState, useEffect } from 'react';
import { Sparkles, ListChecks, FileDown, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

const STORAGE_KEY = 'COCO_AI_INTRO_SEEN_v1';

export function AIIntroModal() {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();

  // i18n — planner 네임스페이스 (4개 언어 모두 키 존재). useLanguage 의 t 는 Translations 타입.
  const p = ((t as unknown) as { planner?: Record<string, string> }).planner ?? {};

  // 마운트 시 1회 flag 체크 — 없으면 노출
  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        // 살짝 지연 후 노출 (UX). 모바일(광고 유입 다수)은 첫 진입 강제 모달이 전환을
        // 방해하므로 데스크탑(>=768px)에서만 자동 노출 — 모바일은 위저드가 직접 안내.
        const timer = window.setTimeout(() => { if (window.innerWidth >= 768) setOpen(true); }, 350);
        return () => window.clearTimeout(timer);
      }
    } catch { /* SSR / private mode → 노출 안함이 안전 */ }
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
    /* Backdrop */
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-intro-title"
    >
      {/* Modal card */}
      <div
        className="relative w-full max-w-md rounded-2xl overflow-hidden overflow-y-auto shadow-2xl max-h-[92vh]"
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
              <Sparkles className="text-[#a78bfa]" size={32} />
            </div>
          </div>
          <h2 id="ai-intro-title" className="text-white font-bold text-xl leading-tight">
            {p.aiIntroTitle ?? 'Welcome to the AI Travel Planner'}
          </h2>
          <p className="text-white/60 text-sm mt-1.5">
            {p.aiIntroSubtitle ?? 'Build your custom Korea itinerary in just a few minutes.'}
          </p>
        </div>

        {/* Steps */}
        <div className="px-6 pb-2 space-y-3">
          {/* Step 1 */}
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <ListChecks className="text-[#7c5cfc] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {p.aiIntroStep1Title ?? '1. Tell us about your trip'}
              </p>
              <p className="text-white/55 text-xs mt-1 leading-relaxed">
                {p.aiIntroStep1Body ?? 'Walk through the wizard to share your destinations, dates, group size, and dietary preferences.'}
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <Sparkles className="text-[#7c5cfc] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {p.aiIntroStep2Title ?? '2. AI builds your itinerary'}
              </p>
              <p className="text-white/55 text-xs mt-1 leading-relaxed">
                {p.aiIntroStep2Body ?? 'Gemini AI analyzes routing, restaurants, and transit to propose a tailored plan in under a minute.'}
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(124,92,252,0.3)' }}
          >
            <FileDown className="text-[#7c5cfc] shrink-0 mt-0.5" size={20} />
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-snug">
                {p.aiIntroStep3Title ?? '3. Download & share the PDF'}
              </p>
              <p className="text-white/55 text-xs mt-1 leading-relaxed">
                {p.aiIntroStep3Body || 'After payment, download a polished PDF itinerary in your language and share it with your travel companions.'}
              </p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="p-6 pt-3">
          <button
            onClick={handleClose}
            type="button"
            className="w-full rounded-xl py-3 font-semibold text-white text-sm transition-opacity hover:opacity-90 active:opacity-75"
            style={{ background: 'linear-gradient(135deg, #7c5cfc, #6d28d9)' }}
          >
            {p.aiIntroClose ?? 'Get started'}
          </button>
        </div>
      </div>
    </div>
  );
}
