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
