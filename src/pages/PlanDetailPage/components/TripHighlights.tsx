// TripHighlights — 가이드 P4 Trip Overview "Top Highlights" 섹션.
// 실데이터(plan.itinerary.days[].stops)에서만 파생: 이름·개인화 사유.
// 정직 원칙: itinerary 에 rating/must_see 필드 없음 → 별점·리뷰수·'인기 1위' 표기 금지.
import type { Language } from '@/i18n';
import type { PlanDocument, PlanStop } from '../types';

const LABEL: Record<Language, string> = {
  en: 'Top Highlights',
  ko: '핵심 하이라이트',
  ja: 'トップハイライト',
  zh: '精选亮点',
};

function stopName(s: PlanStop): string {
  return s.display_name || s.name || s.name_en || s.name_ko || '';
}

export function TripHighlights({ plan, language }: { plan: PlanDocument; language: Language }) {
  const days = plan.itinerary?.days || [];
  // 날짜별 대표 스팟 1개씩 선정 → 여정 전반 다양성(같은 날 음식점만 몰리는 것 방지).
  // 우선순위: verified > 첫 등장. 최대 4일.
  const rankStop = (s: PlanStop) => (s.verified ? 1 : 0);
  const picks: PlanStop[] = [];
  for (const d of days) {
    const named = (d.stops || []).filter((s) => stopName(s));
    if (named.length === 0) continue;
    const best = [...named].sort((a, b) => rankStop(b) - rankStop(a))[0];
    picks.push(best);
    if (picks.length >= 4) break;
  }

  if (picks.length < 2) return null; // 하이라이트 부족 시 graceful 미노출

  const label = LABEL[language] || LABEL.en;

  return (
    <section className="plan-mobile-summary mx-auto max-w-[430px] px-4 pt-1 pb-2">
      <p className="mb-2 text-[13px] font-black text-[#17163d]">{label}</p>
      <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
        {picks.map((s, i) => (
          <div
            key={i}
            className="w-[136px] shrink-0 overflow-hidden rounded-2xl bg-white shadow-[0_10px_24px_rgba(48,39,118,0.08)]"
            style={{ border: '1px solid rgba(124,92,255,0.14)' }}
          >
            <div
              aria-hidden="true"
              className="flex h-[84px] w-full items-center justify-center bg-[#efeafc]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-lg font-black text-ec-brand shadow-sm">
                {stopName(s).trim().charAt(0)}
              </span>
            </div>
            <div className="p-2.5">
              <p className="line-clamp-1 text-[12px] font-bold text-[#17163d]">{stopName(s)}</p>
              {s.personalization_reasoning && (
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-[#7b719f]">
                  {s.personalization_reasoning}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
