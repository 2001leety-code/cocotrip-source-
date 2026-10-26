import { strictHHMMToMin, EARLY_DEPARTURE_NO_BREAKFAST_MIN } from '@/lib/arrivalRestRules.js';

/** 사용자에게 노출할 quality_warning kind 화이트리스트. */
export const USER_VISIBLE_KINDS: Record<string, string> = {
  arrival_guide_self_healed: 'arrivalGuideSelfHealed',
  lodging_bookend_self_healed: 'lodgingBookendSelfHealed',
  cross_city_lodging_corrected: 'crossCityLodgingCorrected',
  arrival_airport_overridden: 'arrivalAirportOverridden',
  departure_airport_overridden: 'departureAirportOverridden',
  dietary_coverage_low: 'dietaryCoverageLow',
  daily_budget_self_healed: 'dailyBudgetSelfHealed',
};

type StopLike = { category?: unknown };
type DayLike = { stops?: StopLike[] | null };

/**
 * 2026-10-26: 2일 이상 여행인데 일정 전체에 식사 stop 이 0 (도착 휴식일 + 출국 11:00 전 조식 면제가 겹친 짧은 여행) →
 *   결과 화면 소개 슬라이드의 접히지 않는 안내(자동 보정 패널과 별개). 저장 데이터가 아니라 화면에서 판정(옛 플랜에도 동작).
 *   원인은 확인될 때만: input.arrival_rest_day === true → 늦은 도착, 저장된 출국 시각 엄격 HH:MM < 11:00 → 이른 출국.
 *   확인 안 되면 원인 없이 "식사 장소 없음" 만.
 */
export function noMealStopsInfo(
  itinerary: { days?: DayLike[] | null } | null | undefined,
  input: { arrival_rest_day?: unknown; departure_time?: unknown; departureTime?: unknown } | null | undefined,
): { show: boolean; lateArrival: boolean; earlyDeparture: boolean } {
  const days = Array.isArray(itinerary?.days) ? itinerary.days : [];
  const none = { show: false, lateArrival: false, earlyDeparture: false };
  if (days.length < 2) return none;
  if (days.some((d) => (Array.isArray(d?.stops) ? d.stops : []).some((s) => s?.category === 'food'))) return none;
  const depMin = strictHHMMToMin(input?.departure_time || input?.departureTime);
  const lateArrival = input?.arrival_rest_day === true;
  const earlyDeparture = depMin !== null && depMin < EARLY_DEPARTURE_NO_BREAKFAST_MIN;
  // 원인은 식사 없는 **모든** 날이 휴식일 Day1 또는 11:00 전 출국일(마지막 날)로 설명될 때만(3일+ 의 중간날, 11:00 이후 출국 등은 설명 불가 → 원인 생략).
  const explained = days.every((_, i) => (i === 0 && lateArrival) || (i === days.length - 1 && earlyDeparture));
  return explained ? { show: true, lateArrival, earlyDeparture } : { show: true, lateArrival: false, earlyDeparture: false };
}
