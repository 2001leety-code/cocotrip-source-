// Trains (KTX/SRT) affiliate banner — Trip.com (batch 9, 2026-05-09).
//
// 노출 조건: PlanDetailPage 의 PreTripSlide.adApplies('train') 가 true 일 때.
// — input.regions 가 2개 이상이고 도시 간 이동이 명확한 경우 (서울↔부산 등) 강한 추천.
// — 1개 도시여도 KTX 일반 검색 fallback 으로 노출 (외국인 KTX 인지도 ↑).
//
// 출발/도착 cityKey 는 buildTrainLink 가 매핑 — Trip.com 인식 도시명으로 변환.
import { Train } from 'lucide-react';
import { buildTrainLink } from '@/config/affiliateLinks';
import { useLanguage } from '@/hooks/useLanguage';

interface TrainsAdProps {
  /** 첫 번째 방문 도시 (lowercase wizard cityKey). */
  fromCityKey?: string;
  /** 두 번째 방문 도시 — 미지정 시 keyword fallback. */
  toCityKey?: string;
}

export function TrainsAd({ fromCityKey, toCityKey }: TrainsAdProps) {
  const { t } = useLanguage();
  const p = (t.planner as unknown as Record<string, string | undefined>) || {};
  const url = buildTrainLink(fromCityKey, toCityKey);

  return (
    <div className="rounded-2xl overflow-hidden border border-cyan-500/25" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.08), rgba(59,130,246,0.05))' }}>
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-cyan-500/20 border border-cyan-500/30">
          <Train className="w-5 h-5 text-cyan-400" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white text-base leading-tight">{p.adTrainTitle || 'Travel Between Cities by KTX/SRT'}</p>
          <p className="text-[14px] text-white/50 mt-0.5">{p.adTrainSub || "Korea's high-speed rail — Seoul to Busan in 2.5h."}</p>
        </div>
      </div>
      <div className="px-5 pb-4">
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[1.02] active:scale-95 min-h-[44px]"
          style={{ background: '#0891B2', boxShadow: '0 4px 16px rgba(8,145,178,0.25)' }}>
          {p.adTrainCta || 'Search Trains on Trip.com'} {'→'}
        </a>
      </div>
      <p className="text-[12px] text-white/55 text-center pb-3 px-5">{p.adAffiliateNote || 'Affiliate link — helps support CocoTrip.'}</p>
    </div>
  );
}
