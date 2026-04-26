import type { PlannerDict } from '../types';
// 3-column meal grid -- extracted verbatim from legacy PlannerPage.tsx L387-443.
import { UtensilsCrossed, CreditCard, Clock, Map } from 'lucide-react';
import { MEAL_ICON_MAP } from '../constants';
import type { Meal } from '../types';

export function MealsSection({ meals, p, enriching }: { meals?: Meal[]; p: PlannerDict; enriching?: boolean }) {
  if (!meals?.length) {
    if (!enriching) return null;
    return (
      <div className="mt-6">
        <p className="text-xs font-semibold text-white/55 uppercase tracking-widest mb-3 flex items-center gap-1"><UtensilsCrossed className="w-3.5 h-3.5" /> {p.mealsLabel}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {['breakfast', 'lunch', 'dinner'].map((type) => (
            <div key={type} className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-4 animate-pulse">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xl">{MEAL_ICON_MAP[type] ?? <UtensilsCrossed className="w-5 h-5" />}</span>
                <div className="h-3 bg-white/10 rounded w-12" />
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-white/10 rounded w-28" />
                <div className="h-3 bg-white/6 rounded w-20" />
                <div className="h-3 bg-white/6 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-6">
      <p className="text-xs font-semibold text-white/55 uppercase tracking-widest mb-3 flex items-center gap-1"><UtensilsCrossed className="w-3.5 h-3.5" /> {p.mealsLabel}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {meals.map((meal, i) => {
          const mapUrl = meal.naverMapUrl
            || (meal.address ? `https://map.naver.com/v5/search/${encodeURIComponent(meal.address)}` : null);
          return (
            <div key={i} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="shrink-0">{MEAL_ICON_MAP[meal.type] ?? <UtensilsCrossed className="w-5 h-5" />}</span>
                <span className="text-[11px] text-white/55 uppercase tracking-wider font-semibold">{meal.type}</span>
              </div>
              <p className="text-sm font-bold text-white leading-snug">{meal.restaurantName}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/55">
                <span>{meal.cuisine}</span>
                <span className="inline-flex items-center gap-0.5"><CreditCard className="w-3 h-3" /> {meal.costPerPerson}</span>
                {meal.waitTime && <span className="inline-flex items-center gap-0.5"><Clock className="w-3 h-3" /> {meal.waitTime}</span>}
              </div>
              {meal.tip && <p className="text-xs text-white/55 leading-relaxed flex-1">{meal.tip}</p>}
              {mapUrl && (
                <a href={mapUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#03C75A]/30 bg-[#03C75A]/8 text-[#03C75A] text-xs font-medium hover:bg-[#03C75A]/18 transition-colors mt-auto w-fit">
                  <Map className="w-3 h-3" /> {p.placeNaverMap}
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
