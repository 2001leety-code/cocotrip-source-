// Intro slide: plan title, date, stats, arrival guide.
// First slide in the swipe carousel.
import { Calendar, MapPin, Users, CreditCard } from 'lucide-react';
import { ArrivalGuide } from './ArrivalGuide';
import { ShareMiniIcon } from './ShareButton';
import { formatKRW } from '../constants';
import { useLanguage } from '@/hooks/useLanguage';
import { useIsMobile } from '@/hooks/use-mobile';
import type { PlanDocument, PlanDay } from '../types';
import { getPlanDetailDict } from '../types';

interface IntroSlideProps {
  plan: PlanDocument;
  planId: string;
  isTranslating: boolean;
}

export function IntroSlide({ plan, planId, isTranslating }: IntroSlideProps) {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const pd = getPlanDetailDict(t);
  const sw = pd.swipe || {};

  const it = plan.itinerary || {};
  const days = it.days || [];
  const arrival = it.arrival_guide;
  const input = plan.input || {};

  return (
    <div>
      {/* Title */}
      <div className="text-center mb-8">
        {isTranslating && (
          <div className="inline-flex items-center gap-2 bg-[#7C5CFC]/20 border border-[#7C5CFC]/30 rounded-full px-4 py-1.5 mb-3 text-xs text-[#7C5CFC]">
            <div className="w-3 h-3 border border-[#7C5CFC] border-t-transparent rounded-full animate-spin" />
            Translating...
          </div>
        )}
        <h1 className="text-2xl sm:text-3xl font-bold bg-clip-text text-transparent" style={{ backgroundImage: isMobile ? 'linear-gradient(135deg,#B668FC,#FF6B9D)' : 'linear-gradient(135deg,#a78bfa,#ec4899)' }}>
          {it.tour_title || sw.introTitle || 'Your Korea Trip'}
        </h1>
        <div className="flex items-center justify-center mt-1">
          <ShareMiniIcon planId={planId} plan={plan} />
        </div>
        <p className="text-white/40 text-sm mt-2">
          {input.startDate} | {input.adults ? `${input.adults} adults` : `${input.pax} pax`}
          {input.children > 0 && ` + ${input.children} children`}
          {(plan.pricing?.vehicleLabel || plan.pricing?.vehicle) && ` | ${plan.pricing?.vehicleLabel || plan.pricing?.vehicle}`}
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {[
          { icon: <Calendar className="w-4 h-4" />, label: sw.introDaysLabel || 'Days', value: String(days.length || '-') },
          { icon: <MapPin className="w-4 h-4" />, label: 'Stops', value: String(days.reduce((s: number, d: PlanDay) => s + (d.stops?.length || 0), 0)) },
          { icon: <Users className="w-4 h-4" />, label: 'Pax', value: String(input.adults ? (input.adults + (input.children || 0)) : input.pax) },
          { icon: <CreditCard className="w-4 h-4" />, label: 'T-money', value: formatKRW(it.t_money_recommended_load || 0) },
        ].map((item, i) => (
          <div key={i} className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 text-center">
            <span className="text-white/30 flex justify-center mb-1">{item.icon}</span>
            <p className="text-xs text-white/40">{item.label}</p>
            <p className="text-sm font-bold">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Arrival Guide */}
      {arrival && <ArrivalGuide guide={arrival} />}

      {/* Swipe hint */}
      <p className="text-center text-white/20 text-xs mt-6">
        {sw.swipeHint || 'Swipe left/right to navigate'} {'\u2192'}
      </p>
    </div>
  );
}
