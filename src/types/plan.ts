/**
 * CocoTrip AI Planner — Plan Types
 * Phase 3: 언어 중립 스키마
 * 
 * name       : 항상 한국어 (네이버맵/카카오맵 검색용)
 * display_name: 사용자 언어 (UI 표시용)
 * tip        : 사용자 언어 (언어 suffix 제거)
 */

export interface Stop {
  order: number;
  start_time: string;

  /** 항상 한국어 장소명 — 네이버맵 검색에 사용 */
  name: string;
  /** 사용자 언어로 된 표시 이름 — UI/PDF에 사용 */
  display_name: string;

  category: 'culture' | 'food' | 'shopping' | 'nature' | 'landmark' | 'kpop' | 'cafe' | string;
  address?: string;
  address_en?: string;
  stay_min: number;
  entry_fee_krw: number;
  entry_fee_note?: string;
  reservation_required?: boolean;
  reservation_note?: string;
  reservation_url?: string;
  reservation_phone?: string;
  accessibility_note?: string;

  /** 사용자 언어로 된 팁 — "_en" suffix 제거 */
  tip?: string;
  /** 사용자 언어로 된 상세 설명 (optional) */
  description?: string;

  recommended_items?: RecommendedItem[];

  /** 검증된 DB에서 가져왔는지 여부 */
  verified?: boolean;

  // RouteAgent fields
  lat?: number;
  lng?: number;
  naverMapUrl?: string;
  transit_from_prev?: TransitFromPrev | null;
  travelFromPrev?: any;

  // Editor + RouteAgent metadata
  _userAdded?: boolean;
  _geocoded?: boolean;
}

export interface RecommendedItem {
  name: string;
  price_krw: number;
  note?: string;
}

export interface TransitFromPrev {
  method: 'subway' | 'taxi' | 'walk' | 'bus' | 'car';
  instruction?: string;
  instruction_en?: string;
  step_by_step?: string[];
  est_min?: number;
  est_fare_krw?: number;
  source?: 'odsay' | 'naver' | 'gemini' | 'naver_fallback' | 'downgrade';
  from_label?: string;
  _downgraded_from?: string;
  _odsay_failed?: boolean;
  _stale?: boolean;
}

export interface Day {
  day: number;
  date: string;
  theme: string;
  stops: Stop[];
}

export interface ArrivalGuide {
  airport: string;
  steps: any[];
}

export interface DepartureGuide {
  airport: string;
  recommended_departure_time?: string;
  latest_leave_hotel?: string;
  luggage_storage?: any;
  to_airport?: any;
  tax_refund?: any;
  last_minute_shopping?: string;
}

export interface DailyBudgetSummary {
  day: number;
  transport_krw: number;
  entry_fees_krw: number;
  meals_krw: number;
  activities_krw: number;
  shopping_estimate_krw?: number;
  total_krw: number;
}

export interface Plan {
  tour_title: string;
  vehicle: 'staria_8' | 'sprinter' | 'large_bus';
  base_price_krw: number;
  arrival_guide?: ArrivalGuide;
  days: Day[];
  departure_guide?: DepartureGuide;
  daily_budget_summary: DailyBudgetSummary[];
  t_money_recommended_load?: number;
}
