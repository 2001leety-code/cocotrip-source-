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
  travelFromPrev?: TransitFromPrev | null;
  /** Google Places photo_reference — /api/place-photo?ref=... 로 이미지 fetch (Sprint 1 Step 3) */
  photo_ref?: string;

  // Editor + RouteAgent metadata
  _userAdded?: boolean;
  _geocoded?: boolean;
}

/**
 * Gemini는 recommended_items를 (a) 문자열 배열 `["한우 갈비탕"]`
 * (b) 객체 배열 `[{ name, price_krw?, note? }]` 두 형태로 반환함.
 * 렌더러는 반드시 normalizeRecommendedItem으로 통일 후 사용.
 */
export type RecommendedItem =
  | string
  | {
      name: string;
      price_krw?: number;
      note?: string;
    };

/** Gemini 응답의 recommended_items 항목을 일관된 객체 shape으로 정규화 */
export function normalizeRecommendedItem(raw: unknown): {
  name: string;
  price_krw?: number;
  note?: string;
} {
  if (typeof raw === 'string') return { name: raw };
  if (raw && typeof raw === 'object' && 'name' in raw) {
    const r = raw as { name?: unknown; price_krw?: unknown; note?: unknown };
    return {
      name: typeof r.name === 'string' ? r.name : String(r.name || ''),
      price_krw: typeof r.price_krw === 'number' ? r.price_krw : undefined,
      note: typeof r.note === 'string' ? r.note : undefined,
    };
  }
  return { name: raw === null || raw === undefined ? '' : String(raw) };
}

/** Compact subway station metadata from ODsay subwayStationInfo */
export interface SubwayStationInfo {
  stationName?: string;
  // lineKoJa / lineKoZh are populated by /api/translate-plan for ja/zh users.
  transferLines?: { lineKo: string; lineEn: string; lineKoJa?: string; lineKoZh?: string; stationID?: number }[];
  address?: string | null;
  phone?: string | null;
  lostCenterPhone?: string | null;
  hasElevator?: boolean;
  hasWheelchairLift?: boolean;
  hasRestroom?: boolean;
}

/** First / last train times per direction, from Seoul Open Data API */
export interface SubwayTrainTimes {
  first?: string | null;      // "05:35" — first departure
  last?: string | null;        // "00:46 (+1)" — last departure (formatted with next-day marker)
  firstDest?: string | null;   // Direction label (terminus)
  lastDest?: string | null;
}
export interface SubwayTimetable {
  up?: SubwayTrainTimes | null;    // INOUT_TAG=1
  down?: SubwayTrainTimes | null;  // INOUT_TAG=2
}

/** One step of a multi-modal transit route — matches parseSubPath() in api/_odsay_helper.js */
export interface TransitStepDetail {
  mode: 'subway' | 'bus' | 'walk';
  description?: string;
  duration?: number;
  // subway
  line?: string;
  lineKo?: string;                    // Normalized Korean, e.g. "2호선"
  lineEn?: string;                    // Localized line name, e.g. "Line 2"
  subwayCode?: number;
  fromStationID?: number | null;
  toStationID?: number | null;
  fromStationInfo?: SubwayStationInfo;
  toStationInfo?: SubwayStationInfo;
  fromTimetable?: SubwayTimetable;     // First/last train at the boarding station
  from?: string;
  fromRoman?: string | null;          // Romanized station name for non-ko UIs
  to?: string;
  toRoman?: string | null;
  way?: string | null;
  wayRoman?: string | null;
  fromExit?: string | null;
  toExit?: string | null;
  fromExitCoord?: { x: number; y: number } | null;
  toExitCoord?: { x: number; y: number } | null;
  stationCount?: number;
  intervalMin?: number | null;
  passStops?: string[];
  // bus
  busNo?: string;
  busType?: string;
  fromArs?: string | null;
  toArs?: string | null;
  fromCoord?: { x: number; y: number } | null;
  toCoord?: { x: number; y: number } | null;
  // walk
  distance?: number;
  // ja/zh translations populated by /api/translate-plan (Hanja form for CJK readers).
  // Optional — falls back to romanization (lineEn/fromRoman) when missing.
  lineJa?: string;
  lineZh?: string;
  fromJa?: string;
  fromZh?: string;
  toJa?: string;
  toZh?: string;
  wayJa?: string;
  wayZh?: string;
  busTypeJa?: string;
  busTypeZh?: string;
}

export interface TransitFromPrev {
  method: 'subway' | 'taxi' | 'walk' | 'bus' | 'car' | 'subway+bus';
  instruction?: string;
  instruction_en?: string;
  step_by_step?: string[];
  steps_detail?: TransitStepDetail[];
  transfers?: number;
  total_walk_m?: number;
  first_station?: string | null;
  last_station?: string | null;
  est_min?: number;
  est_fare_krw?: number;
  source?: 'odsay' | 'tmap' | 'naver' | 'gemini' | 'naver_fallback' | 'downgrade' | 'blind_25_no_coords' | 'cache';
  from_label?: string;
  _downgraded_from?: string;
  _odsay_failed?: boolean;
  _stale?: boolean;
}

/**
 * 다도시 plan 의 도시 간 이동 (B9-39, 2026-05-09).
 *
 * 사용자 신고 시뮬레이션: 부산 입국 → 1-2일 부산 → 3-5일 서울 → 서울 출국.
 * Day 2 마지막 stop → Day 3 첫 stop 사이에 KTX 이동이 있어야 하지만 plan 에 명시
 * 안 됨 → "사용자가 추측해야 함" 사용자 불만.
 *
 * Gemini 가 채우는 것이 1차 (Day.intercity_transit). RouteAgent 는 fallback —
 * Day.city 가 이전 Day 와 다르고 Gemini 가 안 채웠을 때만 default mode/fare 셋.
 *
 * UI: DayTimeline 이 day stops 위 + lodging_to_first 위에 별도 "🚄 도시 간 이동"
 * 카드를 렌더 (fromCity → toCity, 시간/요금/예약 링크).
 */
export interface IntercityTransit {
  /** "KTX" | "SRT" | "Air" | "Bus" | "ITX" — display label 자체가 mode 역할. */
  mode: string;
  /** 한국어 도시명 (백엔드 매칭 + 표시 fallback). */
  from_city: string;
  to_city: string;
  /** 사용자 언어 도시명 (UI 표시 우선). 없으면 from_city/to_city 사용. */
  from_city_display?: string;
  to_city_display?: string;
  /** 추정 소요 시간 (분). KTX 부산-서울 ≈ 165분. */
  est_min: number;
  /** 추정 1인 요금 (KRW). KTX 부산-서울 ≈ 59,800. */
  est_fare_krw: number;
  /** "08:30" — 권장 출발 시각 (도시 간 첫 차량 시각 기준). */
  recommended_depart: string;
  /** "11:30" — Day 의 stops[0].start_time 보다 빠르거나 같아야 함. */
  arrival_at: string;
  /** 4-lang 안내 문구 (한 줄). 사용자 언어로. */
  instruction?: string;
  /** 예약 링크 (KTX = letskorail, SRT = srail, Air = trip.com 등). */
  booking_url?: string;
}

/**
 * 활동 블록(트레킹/러닝) 안전 메타 — buildActivityMeta(api/_ai_core/blockMode.js) 출력.
 * SAFETY-CRITICAL: 난이도/위험/부적합 대상 표기 의무 (외국인 사고 예방).
 */
export interface ActivityMeta {
  activity_type: 'trekking' | 'running_route';
  difficulty?: string;
  elevation_gain_m?: number;
  distance_km?: number;
  estimated_duration_min?: number;
  hazards?: string[];
  recommended_gear?: string[];
  unsuitable_for?: string[];
  requires_advance_booking?: boolean;
}

export interface Day {
  day: number;
  date: string;
  theme: string;
  stops: Stop[];
  /** RouteAgent: 숙소 → 첫 stop 이동 (Phase 2.5). 호텔/zone anchor 좌표가
   *  있을 때만 채워짐. UI는 이 데이터로 첫 stop 위에 "🏨 숙소 출발 N분" 표시.
   *  stops[0].transit_from_prev로도 같은 데이터가 들어가지만, 일부 legacy 플랜
   *  호환을 위해 day 레벨에도 별도 보존. */
  lodging_to_first?: TransitFromPrev | null;
  /** RouteAgent: 마지막 stop → 숙소 복귀 이동 (2026-05-08 신규). 호텔/zone anchor
   *  좌표가 있을 때만 채워짐. UI는 마지막 stop 아래 "🏨 숙소 복귀 N분" 표시. */
  last_to_lodging?: TransitFromPrev | null;
  /** B9-39 (2026-05-09): 다도시 plan 시 이 day 가 속한 도시.
   *  'Seoul' / 'Busan' / 'Jeju' 등. legacy plan 은 undefined → regions[0] / 'Seoul'
   *  fallback. UI 는 Day 헤더에 "Day 3 — Seoul" 형태로 표시. */
  city?: string;
  /** B9-39 (2026-05-09): 이 day 의 시작이 직전 day 와 다른 도시면 채워짐.
   *  Gemini 가 1차로 채우고 RouteAgent 가 fallback. legacy plan 은 undefined. */
  intercity_transit?: IntercityTransit | null;
  /** PR-E SAFETY (2026-06-02): 트레킹/러닝 활동 블록 day 의 난이도·위험·부적합 메타.
   *  block_mode 가 활동 블록 선택(FEATURE_ACTIVITY_BLOCKS ON) 시만 채워짐.
   *  flag OFF / city_day day = undefined → UI falsy guard (미렌더, byte-identical). */
  activity_meta?: ActivityMeta | null;
}

export interface ArrivalStep {
  step: number;
  instruction: string;
  details?: string;
  fare_krw?: number;
  est_min?: number;
}

export interface ArrivalGuide {
  airport: string;
  steps: ArrivalStep[];
}

export interface LuggageStorage {
  location?: string;
  fee_krw?: number;
  note?: string;
}

export interface ToAirport {
  method?: string;
  instruction?: string;
  est_min?: number;
  est_fare_krw?: number;
}

export interface TaxRefund {
  eligible?: boolean;
  min_purchase_krw?: number;
  note?: string;
}

export interface DepartureGuide {
  airport: string;
  recommended_departure_time?: string;
  latest_leave_hotel?: string;
  luggage_storage?: LuggageStorage;
  to_airport?: ToAirport;
  tax_refund?: TaxRefund;
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
