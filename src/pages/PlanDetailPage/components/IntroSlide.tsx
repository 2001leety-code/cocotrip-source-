// Intro slide: plan title, date, stats, arrival guide.
// First slide in the swipe carousel.
import { Calendar, MapPin, Users, CreditCard, MessageCircle } from 'lucide-react';
import { ArrivalGuide } from './ArrivalGuide';
import { ShareMiniIcon } from './ShareButton';
import { formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDocument } from '../types';
import { getPlanDetailDict, getPlanDetailUI } from '../types';
import { countVisibleStops } from '../lib/planStats';

// 차량 내부키 → 고객용 라벨 (vehicleLabel[백엔드 humanize] 없을 때만 폴백 — staria_8 같은 raw 키 노출 방지).
const VEHICLE_LABELS: Record<string, string> = {
  staria_8: 'Private Staria Van (up to 7)', staria: 'Private Staria Van',
  sprinter: 'Mercedes Sprinter (8-12)', bus: 'Private Bus', vip: 'VIP Vehicle',
};

interface IntroSlideProps {
  plan: PlanDocument;
  planId: string;
  isTranslating: boolean;
  translationError?: string | null;
  isOwner?: boolean;
}

export function IntroSlide({ plan, planId, isTranslating, translationError, isOwner }: IntroSlideProps) {
  const { t } = useLanguage();
  const pd = getPlanDetailDict(t);
  const sw = pd.swipe || {};
  const ui = getPlanDetailUI(t);

  const it = plan.itinerary || {};
  const days = it.days || [];
  // B9-29 (2026-05-09): arrival_guide 누락/빈 객체 시 통계 카드 아래 빈 placeholder
  // 노출 버그. ArrivalGuide 컴포넌트는 guide.steps / guide.route_to_hotel 둘 다
  // 비어 있어도 헤더 + 빈 토글 영역을 항상 렌더 → 사용자에게 의미 없는 빈 박스.
  // 둘 중 하나라도 실제 데이터가 있을 때만 마운트.
  const arrivalRaw = it.arrival_guide as
    | { steps?: unknown[]; route_to_hotel?: unknown }
    | undefined;
  const hasArrivalContent = !!arrivalRaw && (
    (Array.isArray(arrivalRaw.steps) && arrivalRaw.steps.length > 0) ||
    !!arrivalRaw.route_to_hotel
  );
  const arrival = hasArrivalContent ? arrivalRaw : null;
  const input = plan.input || {};
  const regionNames = ((t as unknown as { planner?: { regionNames?: Record<string, string> } }).planner?.regionNames) || {};
  const regions = Array.isArray((input as Record<string, unknown>).regions)
    ? ((input as Record<string, unknown>).regions as string[])
    : [];
  const localizedRegions = regions.map((region) => {
    const key = String(region || '').trim();
    return regionNames[key.toLowerCase()] || regionNames[key] || key;
  }).filter(Boolean);

  // 2026-06-23 (운영자 #3): pax 누락 시 "undefined pax" / 통계카드 "Pax: undefined" 노출 버그.
  // adults(없으면 pax)를 안전하게 숫자화 — 둘 다 없으면 null → 해당 세그먼트/카드 값 숨김.
  const adultsNum = Number(input.adults);
  const paxRaw = Number(input.pax);
  const childrenNum = Number(input.children || 0);
  const hasAdults = Number.isFinite(adultsNum) && adultsNum > 0;
  const hasPax = Number.isFinite(paxRaw) && paxRaw > 0;
  // 총 인원: adults(+children) 우선, 없으면 pax. 둘 다 없으면 null.
  const paxTotal = hasAdults
    ? adultsNum + (Number.isFinite(childrenNum) ? childrenNum : 0)
    : hasPax
      ? paxRaw
      : null;

  return (
    <div>
      {/* Intro status and quick actions */}
      <div className="mb-8 border-b border-ec-line pb-6">
        {isTranslating && (
          <div className="ec-chip ec-chip-brand mb-3" role="status" aria-live="polite">
            <div className="h-3 w-3 animate-pulse rounded-full bg-ec-brand" aria-hidden />
            {sw.translationInProgress || 'Translating...'}
          </div>
        )}
        {!isTranslating && translationError && (
          <div className="ec-chip mb-3 border-ec-notice text-ec-notice" role="status">
            <span aria-hidden>!</span>
            <span>{sw.translationFailedShowingOriginal || 'Translation unavailable — showing original'}</span>
          </div>
        )}
        <div className="flex items-center">
          <ShareMiniIcon planId={planId} plan={plan} isOwner={isOwner} />
        </div>
        <p className="ec-body-sm mt-3">
          {input.startDate}
          {paxTotal != null ? ` | ${paxTotal} ${ui.planStatTravelers}` : ''}
          {(() => { const pr = plan.pricing as Record<string, any> | undefined; const v = pr?.vehicleLabel || (pr?.vehicle ? (VEHICLE_LABELS[pr.vehicle] || pr.vehicle) : ''); return v ? ` | ${v}` : ''; })()}
        </p>
        {localizedRegions.length > 0 && (
          <p className="mt-1.5 text-[14px] font-semibold tracking-wide text-ec-ink-2">
            {localizedRegions.join('  →  ')}
          </p>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {[
          { icon: <Calendar className="w-4 h-4" />, label: ui.planStatDays || sw.introDaysLabel || 'Days', value: String(days.length || '-') },
          { icon: <MapPin className="w-4 h-4" />, label: ui.planStatStops || 'Stops', value: String(countVisibleStops(days)) },
          // 2026-06-23 (운영자 #3): paxTotal null 시 '-' 폴백 (Days 카드와 동일 패턴) — "undefined" 방지.
          { icon: <Users className="w-4 h-4" />, label: ui.planStatTravelers || 'Travelers', value: paxTotal != null ? String(paxTotal) : '-' },
          { icon: <CreditCard className="w-4 h-4" />, label: 'T-money', value: formatKRW(it.t_money_recommended_load || 0) },
        ].map((item, i) => (
          <div key={i} className="min-w-0 border-y border-ec-line px-2 py-3">
            <span className="mb-1 flex text-ec-brand">{item.icon}</span>
            <p className="truncate text-[12px] text-ec-ink-3">{item.label}</p>
            <p className="ec-figure mt-1 truncate text-[14px]">{item.value}</p>
          </div>
        ))}
      </div>

      {/* 상단 고객 CTA — 공유 제안서에서 바로 맞춤/문의 (전환 동선 앞당김). */}
      <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
        className="ec-btn ec-btn-secondary mb-6 w-full">
        <MessageCircle className="h-5 w-5 text-ec-success" aria-hidden /> {sw.customizeWhatsApp || 'Customize this trip on WhatsApp'}
      </a>

      {/* Arrival Guide */}
      {arrival && <ArrivalGuide guide={arrival as any} />}

      {/* batch 9 fix (B9-14, 2026-05-09): swipe hint \uc81c\uac70 \u2014 5/3 batch 1 (PR #211) \uc5d0\uc11c
          \uc2a4\uc640\uc774\ud504 \uae30\ub2a5 \uc790\uccb4\ub97c \uc81c\uac70\ud588\uc73c\ub098 \uc548\ub0b4 \ubb38\uad6c\ub9cc \uc794\uc874. i18n key 'swipeHint' \ub294
          \ud0c0 locale \uc77c\uad00\uc131 \uc704\ud574 \uc794\uc874 (\uc0ac\uc6a9 \uc548 \ud568, harmless). */}
    </div>
  );
}
