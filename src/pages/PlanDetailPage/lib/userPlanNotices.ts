/** 사용자에게 노출할 quality_warning kind 화이트리스트. */
export const USER_VISIBLE_KINDS: Record<string, string> = {
  arrival_guide_self_healed: 'arrivalGuideSelfHealed',
  lodging_bookend_self_healed: 'lodgingBookendSelfHealed',
  cross_city_lodging_corrected: 'crossCityLodgingCorrected',
  arrival_airport_overridden: 'arrivalAirportOverridden',
  departure_airport_overridden: 'departureAirportOverridden',
  dietary_coverage_low: 'dietaryCoverageLow',
  daily_budget_self_healed: 'dailyBudgetSelfHealed',
  no_meal_stops: 'noMealStops',
};

type StopLike = { category?: unknown };
type DayLike = { stops?: StopLike[] | null };

/**
 * 2026-10-26: 2일 이상 여행인데 일정 전체에 식사 stop 이 0 (도착 휴식일 + 출국 11:00 전 조식 면제가 겹친 짧은 여행) →
 *   손님 안내 1건. 저장 데이터가 아니라 화면에서 판정(옛 플랜에도 동작). 그 외에는 빈 배열.
 */
export function noMealStopsNotices(itinerary: { days?: DayLike[] | null } | null | undefined): Array<{ kind: string; severity: string }> {
  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
  if (days.length < 2) return [];
  const hasMeal = days.some((d) => (Array.isArray(d?.stops) ? d.stops : []).some((s) => s?.category === 'food'));
  return hasMeal ? [] : [{ kind: 'no_meal_stops', severity: 'low' }];
}
