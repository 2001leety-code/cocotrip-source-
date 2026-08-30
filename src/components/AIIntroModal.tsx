/**
 * AIIntroModal — 플래너 첫 진입 시 1회 노출되는 사용 흐름 안내 모달.
 *
 * 트리거: localStorage `COCO_AI_INTRO_SEEN_v1` 미존재 시 페이지 마운트 직후 자동 노출
 * 위치:   PlannerPage 에 마운트
 * 닫기:   "시작하기" 버튼, 배경 클릭, X 버튼, Esc → 항상 flag 저장 (1회 노출 정책)
 *
 * 2026-08-10 (Korea Editorial Concierge phase 2):
 *   - 다크 그라데이션 카드 → 종이 위 오버레이. 세 단계는 보라 테두리 박스 3개가 아니라
 *     번호가 붙은 하이라인 목록이다 — 순서 자체가 정보이므로 <ol> 로 바뀌었다.
 *   - 문구가 기계를 앞세우고 있었다("Welcome to the AI Travel Planner",
 *     "2. AI builds your itinerary"). 손님이 사는 것은 조건을 넣으면 나오는
 *     실행 가능한 한국 일정이다 — 문구는 4개 로케일에서 함께 바뀌었다
 *     (src/i18n/locales/*.json 의 planner.aiIntro*). 키 이름은 그대로 둔다:
 *     참조가 20군데 흩어져 있고, 이름을 바꾸는 것은 이 PR 의 근본원인이 아니다.
 *   - Esc 로 닫히지 않았고 포커스가 배경에 남아 있었다. 둘 다 여기서 고친다.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

const STORAGE_KEY = 'COCO_AI_INTRO_SEEN_v1';

export function AIIntroModal() {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  const closeRef = useRef<HTMLButtonElement>(null);

  // i18n — planner 네임스페이스 (4개 언어 모두 키 존재). useLanguage 의 t 는 Translations 타입.
  const p = ((t as unknown) as { planner?: Record<string, string> }).planner || {};

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

  // useCallback 이라 아래 Esc 리스너의 의존성이 매 렌더 바뀌지 않는다(리스너 재등록 방지).
  const handleClose = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch { /* silent */ }
    setOpen(false);
  }, []);

  // Esc 로 닫기 + 열릴 때 포커스를 대화상자 안으로. 키보드 사용자가 배경에 갇히던 문제.
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

  const steps = [
    { title: p.aiIntroStep1Title, body: p.aiIntroStep1Body },
    { title: p.aiIntroStep2Title, body: p.aiIntroStep2Body },
    { title: p.aiIntroStep3Title, body: p.aiIntroStep3Body },
  ];

  return (
    /* Backdrop — ink at low opacity, no blur. A blurred backdrop on paper reads
       as frosted glass, which this system removed. */
    <div
      className="ec-root fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(20, 20, 26, 0.55)' }}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-intro-title"
    >
      <div
        className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-ec-md border border-ec-line bg-ec-raised shadow-ec-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 p-6 pb-4">
          <div className="min-w-0">
            <h2 id="ai-intro-title" className="ec-h3">{p.aiIntroTitle}</h2>
            <p className="ec-body-sm mt-2 text-ec-ink-3">{p.aiIntroSubtitle}</p>
          </div>
          <button
            ref={closeRef}
            onClick={handleClose}
            className="ec-btn ec-btn-quiet ec-btn-sm min-h-[44px] min-w-[44px] shrink-0"
            aria-label="Close"
            type="button"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Three steps — an ordered list, because the order is the content. */}
        <ol className="border-t border-ec-line px-6">
          {steps.map((s, i) => (
            <li key={s.title || i} className="flex gap-4 border-b border-ec-line py-4 last:border-b-0">
              <span className="ec-figure shrink-0 text-[15px] text-ec-brand">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-snug text-ec-ink">{s.title}</p>
                <p className="ec-body-sm mt-1 text-ec-ink-3">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="border-t border-ec-line p-6">
          <button onClick={handleClose} type="button" className="ec-btn ec-btn-primary w-full">
            {p.aiIntroClose}
          </button>
        </div>
      </div>
    </div>
  );
}
