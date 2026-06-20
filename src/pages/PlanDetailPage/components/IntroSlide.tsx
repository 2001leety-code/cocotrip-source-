// Intro slide: plan title, date, stats, arrival guide.
// First slide in the swipe carousel.
import { Calendar, MapPin, Users, CreditCard } from 'lucide-react';
import { ArrivalGuide } from './ArrivalGuide';
import { ShareMiniIcon } from './ShareButton';
import { formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import { BRAND } from '@/lib/design-tokens';
import type { PlanDocument, PlanDay } from '../types';
import { getPlanDetailDict } from '../types';

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

  return (
    <div>
      {/* Title */}
      <div className="text-center mb-8">
        {isTranslating && (
          <div className="inline-flex items-center gap-2 bg-[#7C5CFC]/20 border border-[#7C5CFC]/30 rounded-full px-4 py-1.5 mb-3 text-[14px] text-[#7C5CFC]">
            <div className="w-3 h-3 border border-[#7C5CFC] border-t-transparent rounded-full animate-spin" />
            Translating...
          </div>
        )}
        {!isTranslating && translationError && (
          <div className="inline-flex items-center gap-2 bg-amber-500/15 border border-amber-500/30 rounded-full px-4 py-1.5 mb-3 text-[14px] text-amber-200">
            <span aria-hidden>⚠</span>
            <span>{sw.translationFailedShowingOriginal || 'Translation unavailable — showing original'}</span>
          </div>
        )}
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight bg-clip-text text-transparent" style={{ backgroundImage: BRAND.gradient.primary }}>
          {it.tour_title || sw.introTitle || 'Your Korea Trip'}
        </h1>
        <div className="flex items-center justify-center mt-1">
          <ShareMiniIcon planId={planId} plan={plan} isOwner={isOwner} />
        </div>
        <p className="text-white/55 text-sm mt-2">
          {input.startDate} | {input.adults ? `${input.adults} adults` : `${input.pax} pax`}
          {Number(input.children || 0) > 0 && ` + ${input.children} children`}
          {((plan.pricing as Record<string, any>)?.vehicleLabel || (plan.pricing as Record<string, any>)?.vehicle) && ` | ${(plan.pricing as Record<string, any>)?.vehicleLabel || (plan.pricing as Record<string, any>)?.vehicle}`}
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {[
          { icon: <Calendar className="w-4 h-4" />, label: sw.introDaysLabel || 'Days', value: String(days.length || '-') },
          { icon: <MapPin className="w-4 h-4" />, label: 'Stops', value: String(days.reduce((s: number, d: PlanDay) => s + (d.stops?.length || 0), 0)) },
          { icon: <Users className="w-4 h-4" />, label: 'Pax', value: String(input.adults ? ((input.adults as number) + ((input.children as number) || 0)) : input.pax) },
          { icon: <CreditCard className="w-4 h-4" />, label: 'T-money', value: formatKRW(it.t_money_recommended_load || 0) },
        ].map((item, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 text-center">
            <span className="text-white/55 flex justify-center mb-1">{item.icon}</span>
            <p className="text-[14px] text-white/55">{item.label}</p>
            <p className="text-sm font-bold">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Arrival Guide */}
      {arrival && <ArrivalGuide guide={arrival as any} />}

      {/* batch 9 fix (B9-14, 2026-05-09): swipe hint \uc81c\uac70 \u2014 5/3 batch 1 (PR #211) \uc5d0\uc11c
          \uc2a4\uc640\uc774\ud504 \uae30\ub2a5 \uc790\uccb4\ub97c \uc81c\uac70\ud588\uc73c\ub098 \uc548\ub0b4 \ubb38\uad6c\ub9cc \uc794\uc874. i18n key 'swipeHint' \ub294
          \ud0c0 locale \uc77c\uad00\uc131 \uc704\ud574 \uc794\uc874 (\uc0ac\uc6a9 \uc548 \ud568, harmless). */}
    </div>
  );
}
