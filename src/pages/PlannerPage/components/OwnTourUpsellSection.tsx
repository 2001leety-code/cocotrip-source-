// PR-A: 자사 투어 업셀 섹션
// 플래그 VITE_FEATURE_OWN_TOUR_UPSELL=true 일 때만 렌더링.
// OFF(미설정) = 이 컴포넌트가 null 반환 → prod 현재 동작 100% byte-identical.
import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TourCard } from '@/components/tours/TourCard';
import { getMatchedOwnTours } from '@/data/tours';
import type { PlannerResponse, PlannerDict } from '../types';
import type { Language } from '@/i18n';

const FLAG_ON = import.meta.env.VITE_FEATURE_OWN_TOUR_UPSELL === 'true';

interface OwnTourUpsellSectionProps {
  result: PlannerResponse;
  p: PlannerDict;
  lang: string;
}

export function OwnTourUpsellSection({ result, p, lang }: OwnTourUpsellSectionProps) {
  // 플래그 OFF → 아무것도 렌더링하지 않음 (현재 prod 동작 보존)
  if (!FLAG_ON) return null;

  const allPlaceNames = result.itinerary.flatMap(d =>
    d.places.map(pl => pl.name || '')
  ).filter(Boolean);

  const region = result.meta.regions[0] || '';
  const matched = getMatchedOwnTours(allPlaceNames, region);

  // 매칭 0 → 아무것도 노출 안 함
  if (matched.length === 0) return null;

  const language = (lang as Language) || 'en';

  const sectionTitle: Record<string, string> = {
    ko: p.own_tour_upsell_title || '코코트립 자체 투어',
    en: p.own_tour_upsell_title || 'CocoTrip Exclusive Tours',
    ja: p.own_tour_upsell_title || 'CocoTrip 自社ツアー',
    zh: p.own_tour_upsell_title || 'CocoTrip 自营旅游',
  };

  const sectionDesc: Record<string, string> = {
    ko: p.own_tour_upsell_desc || '이 일정과 매칭된 프라이빗 투어 — 직접 예약으로 중간 수수료 없음',
    en: p.own_tour_upsell_desc || 'Private tours matched to your itinerary — book direct, no middleman fee',
    ja: p.own_tour_upsell_desc || 'このプランにマッチした自社プライベートツアー — 直接予約で手数料なし',
    zh: p.own_tour_upsell_desc || '与行程匹配的自营私人旅游 — 直接预订，无中间商费用',
  };

  const viewAllLabel: Record<string, string> = {
    ko: p.own_tour_upsell_view_all || '전체 투어 보기 →',
    en: p.own_tour_upsell_view_all || 'View all tours →',
    ja: p.own_tour_upsell_view_all || 'すべてのツアーを見る →',
    zh: p.own_tour_upsell_view_all || '查看全部旅游 →',
  };

  const title = sectionTitle[language] || sectionTitle.en;
  const desc = sectionDesc[language] || sectionDesc.en;
  const viewAll = viewAllLabel[language] || viewAllLabel.en;

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3 mt-3 sm:rounded-2xl sm:p-5 sm:mt-6">
      <div className="flex items-start justify-between mb-1">
        <p className="text-xs font-semibold text-white/55 uppercase tracking-widest flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          {title}
        </p>
        <Link
          to="/tours"
          className="text-[10px] text-purple-400/80 hover:text-purple-300 transition-colors shrink-0 ml-2"
        >
          {viewAll}
        </Link>
      </div>
      <p className="text-[11px] text-white/45 mb-4 leading-relaxed">{desc}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {matched.slice(0, 2).map(tour => (
          <TourCard key={tour.id} tour={tour} language={language} />
        ))}
      </div>
    </div>
  );
}
