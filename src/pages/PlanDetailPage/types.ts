// Shared types for PlanDetailPage module.
import type { ActivityMeta } from '@/types/plan';

/** Firestore plan document — minimal typed shape for type-safe component props.
 *  Fields are optional because the document structure varies (legacy vs enriched plans). */
export interface PlanDocument {
  uid?: string;
  guestEmail?: string;
  accessToken?: string;
  isPublic?: boolean;
  edited?: boolean;
  lastEditedAt?: number;
  pricing?: Record<string, unknown>;
  input?: {
    language?: string;
    area?: string;
    /** 투어 시작일 (YYYY-MM-DD). **Inclusive** — plan.days[0].date === startDate.
     *  endDate 필드 없음 (tourDays = days.length 로 계산). */
    startDate?: string;
    adults?: number;
    pax?: number;
    specialRequest?: string;
    hotel_address?: string;
    arrival_airport?: string;
    departure_airport?: string;
    /** 2026-05-08: zone-only 사용자 (호텔 미정 + zone 만 선택) 의 zone 키 / 대표 주소.
     *  LodgingBookend 라벨 fallback 체인에서 사용. 신규 plan 만 채워짐 — legacy
     *  plan 은 undefined 라 자동으로 다음 fallback. */
    recommended_zone?: string | null;
    recommended_zone_address?: string | null;
    [key: string]: unknown;
  };
  itinerary?: {
    tour_title?: string;
    t_money_recommended_load?: number;
    days?: PlanDay[];
    arrival_guide?: ArrivalGuideBlock;
    departure_guide?: DepartureGuideBlock;
    daily_budget_summary?: BudgetRow[];
    /** Sprint 2 후속: 동선 5km 내 top-rated 맛집 — backend `pickRecommendedRestaurantsByStyle` 산출.
     *  Legacy plans: array. New plans (2026-05-05+): per-style map { general, vegan?, halal? }. */
    recommended_restaurants?: RecommendedRestaurant[] | RecommendedRestaurantsByStyle;
    /** B9-20 (2026-05-09 round 4): wantAccom=true 시 Gemini 가 채우는 호텔 추천.
     *  필드명은 비결정적 — name/hotel_name, area/neighborhood, why/reason, booking_tip/tip 등.
     *  AccommodationRecommendation 컴포넌트에서 fallback 체인으로 추출. */
    accommodation?: Record<string, unknown>;
    [key: string]: unknown;
  };
  customerSupport?: Record<string, unknown>;
  accommodation?: Record<string, unknown>;
  budgetSummary?: Record<string, unknown>;
  [key: string]: unknown;
}

/** B9-39 (2026-05-09): 다도시 plan 의 도시 간 이동 (KTX/SRT/항공/버스).
 *  Gemini 가 1차로 채우고 RouteAgent 가 fallback. legacy plan 은 undefined.
 *  PDF-issue-2 (2026-05-14): from_station/to_station + lodging_to_station/station_to_lodging 추가
 *  — RouteAgent 가 city-change day 의 hotel→station + station→new_hotel bookend
 *  segment 계산. UI 가 LodgingBookend 로 표시. */
export interface IntercityTransitSegment {
  mode?: string;
  from_city?: string;
  to_city?: string;
  from_city_display?: string;
  to_city_display?: string;
  /** KTX/SRT/Air 정거장 (예: "부산역", "김해국제공항"). PDF-issue-2 2026-05-14 추가. */
  from_station?: string | null;
  to_station?: string | null;
  /** intercity 전 bookend transit (이전 day 호텔 → from_station). RouteAgent attach. */
  lodging_to_station?: TransitSegment | null;
  /** intercity 후 bookend transit (to_station → 새 day 호텔). RouteAgent attach. */
  station_to_lodging?: TransitSegment | null;
  est_min?: number;
  est_fare_krw?: number;
  /** B7 (P308 2026-05-30): P291~P308 사이 schema 오명명으로 저장된 plan 의 legacy 필드.
   *  frontend 가 mode/est_min/est_fare_krw 우선, 부재 시 이 3개로 폴백. */
  method?: string;
  duration_min?: number;
  cost_krw?: number;
  recommended_depart?: string;
  arrival_at?: string;
  instruction?: string;
  booking_url?: string;
  [key: string]: unknown;
}

export interface PlanDay {
  day?: number;
  date?: string;
  theme?: string;
  stops?: PlanStop[];
  /** Lodging bookend transits (2026-05-08): 숙소→첫 stop / 마지막 stop→숙소.
   *  RouteAgent 가 호텔/zone anchor 좌표가 있을 때만 채움. UI는 Day 첫/끝에
   *  "🏨 숙소 출발/복귀" 카드를 렌더. legacy 플랜은 undefined → 자연스럽게 미노출. */
  lodging_to_first?: TransitSegment | null;
  last_to_lodging?: TransitSegment | null;
  /** B9-39 (2026-05-09): 다도시 plan 시 이 day 가 속한 도시. legacy = undefined. */
  city?: string;
  /** B9-39 (2026-05-09): 직전 day 와 도시가 다르면 채워짐. 그 day 첫 stop 보다
   *  앞에 "🚄 KTX 부산→서울" 카드로 렌더. */
  intercity_transit?: IntercityTransitSegment | null;
  /** PR-E SAFETY (2026-06-02): 트레킹/러닝 활동 블록 난이도·위험·부적합 메타 (FEATURE_ACTIVITY_BLOCKS ON 시). */
  activity_meta?: ActivityMeta | null;
  [key: string]: unknown;
}

export interface PlanStop {
  name?: string;
  name_ko?: string;
  name_en?: string;
  display_name?: string;
  address?: string;
  start_time?: string;
  stay_min?: number;
  category?: string;
  entry_fee_krw?: number;
  entry_fee_note?: string;
  tip?: string;
  tip_en?: string;
  // P-Quality (2026-04-24): Gemini explains why this stop fits THIS user's
  // input (e.g. "spice=hot이라 신당동 떡볶이"). Optional — old plans don't have it.
  personalization_reasoning?: string;
  order?: number;
  naverMapUrl?: string;
  lat?: number;
  lng?: number;
  reservation_required?: boolean;
  reservation_phone?: string;
  reservation_note?: string;
  reservation_url?: string;
  accessibility_note?: string;
  local_tag?: string;
  verified?: boolean;
  /** Google Places photo_reference — /api/place-photo?ref=... 로 thumbnail (Sprint 1 Step 3) */
  photo_ref?: string;
  // Gemini가 문자열 배열 ["한우 갈비탕"] 또는 객체 배열 둘 다 반환.
  // 렌더 전에 normalizeRecommendedItem로 통일할 것.
  recommended_items?: (string | { name: string; price_krw?: number; note?: string })[];
  transit_from_prev?: TransitSegment;
  travelFromPrev?: { transitOptions?: { publicTransit?: Record<string, any> } };
  _userAdded?: boolean;
  [key: string]: unknown;
}

export interface TransitSegment {
  method?: string;
  est_min?: number;
  est_fare_krw?: number;
  source?: string;
  step_by_step?: string[];
  _stale?: boolean;
  [key: string]: unknown;
}

export interface ArrivalGuideBlock {
  airport?: string;
  steps?: { step: number; title: string; description?: string; est_min?: number }[];
  [key: string]: unknown;
}

/** Per-style buckets — backend `pickRecommendedRestaurantsByStyle` 출력. */
export interface RecommendedRestaurantsByStyle {
  general: RecommendedRestaurant[];
  vegan?: RecommendedRestaurant[];
  halal?: RecommendedRestaurant[];
  // Future tags (halal-friendly etc.) added explicitly when DB gains them.
  [key: string]: RecommendedRestaurant[] | undefined;
}

/** "꼭 가보면 좋은 곳" — backend pickRecommendedRestaurants 출력 형식. */
export interface RecommendedRestaurant {
  name: string;
  nameEn?: string;
  address?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  reviewCount?: number;
  cuisine?: string;
  cuisineKo?: string;
  priceLabel?: string;
  priceLabelKo?: string;
  placeId?: string;
  googleMapsUrl?: string;
  dong?: string;
  dongEn?: string;
  district?: string;
  /** Distance km from the nearest plan stop. */
  nearestStopKm?: number;
  /** 2026-05-11 (B-3): 다도시 plan 시 backend 가 부착하는 도시 키 ('seoul'|'busan' 등).
   *  단도시 plan 은 undefined → UI 가 단일 grid 로 렌더 (regression 0). */
  region?: string;
}

export interface BudgetRow {
  day?: number;
  transport_krw?: number;
  entry_fees_krw?: number;
  meals_krw?: number;
  total_krw?: number;
  [key: string]: unknown;
}

/** Departure guide block structure returned by AI planner. */
export interface DepartureGuideBlock {
  airport?: string;
  to_airport?: {
    method?: string;
    instruction?: string;
    duration_min?: number;
    cost_krw?: number;
  };
  luggage_storage?: { available?: boolean; location?: string };
  tax_refund?: { location?: string; threshold_krw?: number };
  last_minute_shopping?: string;
  // RouteAgent attaches a TransitFromPrev-shaped ODsay route here so the
  // departure UI can reuse the TransitArrow component for hotel→airport.
  // Loosely typed (Record) so DepartureGuide.tsx can cast to TransitFromPrev.
  route_to_airport?: Record<string, unknown>;
  [key: string]: unknown;
}

export type SetPlanFn = (updater: (prev: PlanDocument | null) => PlanDocument | null) => void;

/** Utility type for planDetail dict — loosened to unblock build.
 *  TODO: define strict interface when all planDetail keys are stabilized. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PlanDetailDict = Record<string, any>;

/** Helper to extract planDetail dict from translations object. */
export function getPlanDetailDict(t: unknown): PlanDetailDict {
  return ((t as Record<string, unknown>).planDetail as PlanDetailDict) || {};
}

/** Helper to extract planDetail.ui dict from translations object. */
export function getPlanDetailUI(t: unknown): Record<string, string> {
  const pd = (t as Record<string, unknown>).planDetail as Record<string, unknown> | undefined;
  return (pd?.ui as Record<string, string>) || {};
}
