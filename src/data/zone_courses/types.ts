/**
 * Zone Courses — Foundation Types
 *
 * 사전 큐레이트된 day-block (zone course). 운영자가 동선/시간/장소를 확정하고,
 * AI 플래너는 ID 만 선택 + tweak 한다 (Gemini 부하 1/10 + 검증된 동선 동시 확보).
 *
 * 매 block 은 6 stops 내외 (1 day 전체 또는 morning/afternoon zone).
 * stops 좌표·이동은 Naver Geocoding + ODsay Transit 으로 사전 빌드.
 *
 * 운영 정책:
 *  - source = 'cocotrip_curated' | 'operator_verified' | 'user_validated'
 *  - verified_at + verified_by + last_review_date 필수 (audit trail)
 *  - placeholder = 'verified_lunch' 같은 슬롯은 buildPrompt 가 식이 제약과
 *    매칭하여 _food_index.json 으로 채움
 *
 * 2026-05-21 PR-A schema 확장:
 *  - entry_fee variants (adult/child/senior/toddler/free_with)
 *  - transit base + peak_hour + late_night + rain variants
 *  - block_type 확장 (city_day / trekking / running_route / cycling / guided_tour / dmz_tour)
 *  - trekking_meta + running_meta + waypoints (trek/run 전용)
 */

/** AI 플래너가 지원하는 도시 (P122 multi-city plan 호환) */
export type ZoneCourseCity =
  | 'seoul'
  | 'busan'
  | 'jeju'
  | 'gyeongju'
  | 'jeonju'
  | 'gangneung'
  | 'sokcho'
  | 'andong'
  | 'suwon'
  | 'incheon'
  | 'gangwon'
  // 강원 도시 (Phase E #2, 2026-05-21)
  // gangneung / sokcho 는 기존 존재 — 강원권 region 별도 추가
  // 경상 권역 (Phase E #2, 2026-05-21)
  | 'daegu'
  | 'pohang'
  | 'gyeongsang'
  // 충청 권역 (Phase E #2, 2026-05-21)
  | 'daejeon'
  | 'chungcheong';

/** 코스 강도 — 운영자가 분류 */
export type ZoneCourseIntensity = 'relaxed' | 'standard' | 'packed';

/** zone course 출처 / 검증 단계 */
export type ZoneCourseSource =
  | 'cocotrip_curated'
  | 'operator_verified'
  | 'user_validated';

/** stop 카테고리 — buildPrompt 의 day_theme 에 매핑 */
export type ZoneCourseStopCategory =
  | 'culture'
  | 'food'
  | 'shopping'
  | 'nature'
  | 'lodging'
  | 'transit'
  | 'activity';

/** food placeholder — 식이 제약 매칭용 슬롯 */
export type ZoneCourseFoodPlaceholder =
  | 'verified_lunch'
  | 'verified_dinner'
  | 'verified_cafe'
  | 'verified_breakfast';

/** 식이 옵션 (SAFETY-CRITICAL — CLAUDE.md J 섹션 참조) */
export type ZoneCourseDietary = 'vegan' | 'halal' | 'vegetarian';

/** 운송 수단 */
export type ZoneCourseTransitMode = 'walk' | 'subway' | 'bus' | 'taxi' | 'mixed';

/** transit 데이터 source — 캐시 invalidate 추적용 */
export type ZoneCourseTransitSource = 'odsay_api' | 'manual' | 'cached' | 'mock';

/**
 * Block 종류 확장 (2026-05-21).
 * - city_day: 기존 도심형 day block (기본값, backward compat)
 * - trekking: 등산 / 도보 트레킹 (trekking_meta 필수)
 * - running_route: 러닝 코스 (running_meta 필수)
 * - cycling: 자전거 코스 (향후)
 * - guided_tour: 가이드 동반 정기 투어 (향후)
 * - dmz_tour: 비무장지대 투어 (향후 — 여권 + 사전 예약)
 */
export type BlockType =
  | 'city_day'
  | 'trekking'
  | 'running_route'
  | 'cycling'
  | 'guided_tour'
  | 'dmz_tour';

/** 4-lang 다국어 필드 (CLAUDE.md C 섹션 — 신 스키마) */
export interface I18nText {
  ko: string;
  en: string;
  ja: string;
  zh: string;
}

/**
 * 입장료 variants — 연령/시즌/조건별 차등 (2026-05-21).
 * adult 가 backward compat 의 entry_fee_krw 와 일치해야 함.
 */
export interface EntryFeeVariants {
  /** 만 19+ 성인 (KRW) */
  adult: number;
  /** 만 7-18 청소년 (KRW). 없으면 adult 와 동일하다고 간주 X — 운영자 명시 의무 */
  child?: number;
  /** 만 65+ 시니어 (KRW). 보통 0 또는 50% */
  senior?: number;
  /** 만 7 미만 유아 (KRW). 보통 0 */
  toddler?: number;
  /** 단체 할인 최소 인원 (예: 20명 이상 10% off) */
  group_discount_min_pax?: number;
  /**
   * 무료 조건 (있으면 무료):
   *   - 'hanbok': 한복 착용
   *   - 'cultural_heritage_day': 문화의 날 (매월 마지막 수요일)
   *   - 'first_wednesday': 매월 첫째 수요일
   *   - 'parents_day': 어버이날 65+
   */
  free_with?: string[];
  /** 단체 사전 예약 의무 여부 */
  reservation_required_for_group?: boolean;
  /** 운영자 메모 (시즌별 변동 등) */
  notes?: string;
}

/** stop 1개 (운영자가 사전 입력) */
export interface ZoneCourseStop {
  /** 1-based 순서 (block 내) */
  order: number;
  category: ZoneCourseStopCategory;
  /** 한국어. 네이버맵 검색용 (CLAUDE.md C — `name`) */
  name: string;
  /** 4-lang 표시명 (UI 렌더) */
  name_i18n: I18nText;
  /** 주소 (Naver Geocoding 입력) */
  address: string;
  /** 위도 (Naver Geocoding 출력) */
  lat: number;
  /** 경도 */
  lng: number;
  /** Naver Place ID — UI 의 네이버맵 deep link 용 */
  naver_place_id?: string;
  /** block 시작 후 N분 (cumulative: prev stay_min + transit duration_min) */
  start_time_offset_min: number;
  /** 체류 시간 (분) */
  stay_min: number;
  /** 입장료 (KRW). 0 = 무료. backward compat — adult 와 동기화 의무 */
  entry_fee_krw: number;
  /** 입장료 비고 (예: "20:30 이후 무료") */
  entry_fee_note?: string;
  /**
   * 입장료 variants (2026-05-21). 모든 연령/조건 정보.
   * 누락 시 entry_fee_krw 만 사용 (backward compat).
   */
  entry_fee?: EntryFeeVariants;
  /** 사전 예약 필요 여부 */
  reservation_required: boolean;
  /**
   * 식당 슬롯 placeholder — buildPrompt 가 식이 제약과 매칭해
   * _food_index.json 에서 채운다. name="" 일 때만 의미 있음.
   */
  placeholder?: ZoneCourseFoodPlaceholder;
  /** placeholder 매칭 시 선호 식이 (halal/vegan/vegetarian) */
  preferred_dietary?: ZoneCourseDietary[];
  /** 4-lang 팁 (UI 표시) */
  tips_i18n?: I18nText;
  /** 사진 URL — Firebase Storage resolvePhotoUrl 로 가공 */
  photo_urls?: string[];
}

/**
 * Transit variant — 시간대 / 날씨별 동선 (2026-05-21).
 * base 는 표준 (오프피크 평일), 추가 variants 는 조건부 권장.
 */
export interface TransitVariant {
  mode: ZoneCourseTransitMode;
  /** 이동 시간 (분) */
  duration_min: number;
  /** 거리 (m) */
  distance_m?: number;
  /** 비용 (원) */
  cost_krw: number;
  /** 이 variant 를 우선 권장할 조건 */
  recommend_alternative_in?: ('rain' | 'snow' | 'late_night' | 'peak_rush')[];
  /** 운영자 메모 */
  notes?: string;
}

/** stop 간 이동 1건 — ODsay Transit API 결과 */
export interface ZoneCourseTransit {
  from_order: number;
  to_order: number;
  /** base.mode 와 동기화 의무 (backward compat) */
  mode: ZoneCourseTransitMode;
  /** 이동 시간 (분) — base.duration_min 와 동기화 의무 */
  duration_min: number;
  /** 거리 (m) — base.distance_m 와 동기화 의무 */
  distance_m: number;
  /** 비용 (원) — base.cost_krw 와 동기화 의무 */
  cost_krw: number;
  /** 네이버 길찾기 deep link */
  naver_route_url?: string;
  /** ODsay searchPubTransPathT 의 route id (캐시 invalidate 추적) */
  odsay_route_id?: string;
  source: ZoneCourseTransitSource;
  /** ISO 날짜 (캐시 stale 판단) */
  fetched_at: string;
  /** ODsay API skipped 시 사람 액션 메모 */
  notes?: string;
  /**
   * 표준 이동 (오프피크 평일). 위의 mode/duration_min/distance_m/cost_krw 의 거울.
   * 신규 빌드 시 의무, legacy block 은 미존재 가능 (backward compat).
   */
  base?: TransitVariant;
  /** 출퇴근 시간대 (07-09 / 17-19) */
  peak_hour?: TransitVariant;
  /** 심야 (23-05) — 택시 등 */
  late_night?: TransitVariant;
  /** 우천 시 권장 동선 */
  rain?: TransitVariant;
}

/**
 * 트레킹 메타 (block_type === 'trekking' 일 때 필수).
 * 사용자 매칭 + 안전 안내 + buildPrompt 시각화 데이터.
 */
export interface TrekkingMeta {
  /** 총 거리 (km) — 등정 + 하산 합산 */
  total_distance_km: number;
  /** 누적 고도 (m) */
  elevation_gain_m: number;
  /** 난이도 */
  difficulty: 'easy' | 'moderate' | 'hard' | 'expert';
  /** 트레일 유형 */
  trail_type: 'forest' | 'ridge' | 'coastal' | 'urban' | 'mountain';
  /** 예상 소요 시간 (분) — 식사/휴식 제외 순수 걷기 */
  estimated_duration_min: number;
  /** 출발 지점 고도 (m) */
  starting_elevation_m?: number;
  /** 최고 지점 고도 (m) */
  highest_point_m?: number;
  /** 권장 장비 (예: 'trekking_pole', 'water_2L', 'hat', 'gloves', 'wind_breaker') */
  recommended_gear: string[];
  /** 위험 요소 (예: 'steep_rock_climb', 'iron_railing_section', 'icy_winter') */
  hazards: string[];
  /** 트레일헤드 주소 (Naver Geocoding 입력) */
  trailhead_address: string;
  /** 접근 정보 */
  trailhead_access?: {
    /** 지하철 가이드 */
    subway?: string;
    /** 버스 가이드 */
    bus?: string;
    /** 도심에서 택시 비용 (KRW) */
    taxi_from_city_center_krw?: number;
    /** 주차 가능 여부 */
    parking_available?: boolean;
  };
  /** 권장 시즌 — buildPrompt 가 안전 안내 시 활용 */
  seasons_recommended?: ('spring' | 'summer' | 'autumn' | 'winter')[];
}

/**
 * 러닝 메타 (block_type === 'running_route' 일 때 필수).
 */
export interface RunningMeta {
  /** 총 거리 (km) */
  total_km: number;
  /** 노면 종류 */
  surface_type: 'asphalt' | 'dirt' | 'mixed' | 'track';
  /** 페이스 목표 (운영자 권장치) */
  pace_target?: {
    /** Easy 페이스 (분/km) */
    easy_min_per_km: number;
    /** Tempo 페이스 (분/km) */
    tempo_min_per_km: number;
  };
  /** 누적 고도 (m) — 0 = 평지 */
  elevation_gain_m: number;
  /** 코스 형태 */
  loop_or_out_and_back: 'loop' | 'out_and_back' | 'point_to_point';
  /** 권장 시간대 */
  recommended_time: ('dawn' | 'morning' | 'evening' | 'night')[];
  /** 야간 조명 품질 */
  lighting_quality: 'well_lit' | 'partial' | 'dark';
  /** 난이도 */
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  /** 물 보충 가능 지점 수 (음수대 + 카페 등) */
  water_stations_count?: number;
}

/** day-block 본체 (Firestore zone_courses/{blockId} 에 저장) */
export interface ZoneCourseBlock {
  /**
   * 고유 ID. 패턴: `<CITY>_DAY_<ZONE>_<INTENSITY>` (대문자 + underscore).
   * 예: "SEOUL_DAY_JONGNO_STANDARD"
   */
  id: string;
  city: ZoneCourseCity;
  /** zone 이름 (예: "Jongno", "Gangnam") — UI 카드 라벨 */
  zone: string;
  /** 운영자 한국어 테마 (예: "전통 + 시장 + 카페") */
  theme: string;
  theme_i18n: I18nText;
  intensity: ZoneCourseIntensity;
  /** 예상 총 분 (모든 stop stay_min + transit duration_min 합산) */
  duration_min: number;
  /**
   * Block 종류. 누락 시 default 'city_day' (backward compat).
   * 'trekking' 이면 trekking_meta 필수, 'running_route' 이면 running_meta 필수.
   */
  block_type?: BlockType;
  /** 트레킹 메타 (block_type === 'trekking' 시 필수) */
  trekking_meta?: TrekkingMeta;
  /** 러닝 메타 (block_type === 'running_route' 시 필수) */
  running_meta?: RunningMeta;
  stops: ZoneCourseStop[];
  /**
   * trek/run 전용 waypoints. stops 와 별개 — 시간 변화 없는 보조 지점
   * (전망대 / 물 보충 / 휴게소). UI 가 "지나가는 지점" 으로 렌더.
   * stops 는 가이드의 정차/식사/관광 지점만 포함.
   */
  waypoints?: ZoneCourseStop[];
  /**
   * stop 쌍 간 이동 매트릭스. key 패턴: "1->2", "2->3", ...
   * 연속 stop pair 만 포함 (n-1 개).
   */
  transit_matrix: Record<string, ZoneCourseTransit>;
  /** 어울리는 사용자 그룹 (matching 신호) */
  best_for: string[];
  /** 비추천 그룹 (matching 차단) */
  unsuitable_for: string[];
  /** 지원하는 식이 옵션 (SAFETY-CRITICAL — placeholder 매칭 사전 검증) */
  dietary_options: ZoneCourseDietary[];
  /** 여권 지참 필요 여부 (면세점/박물관 등) */
  passport_required: boolean;
  /** 사전 예약 필요 stop 1개 이상 포함 여부 */
  requires_advance_booking: boolean;
  source: ZoneCourseSource;
  /** ISO 날짜 — 검증 완료 시점 */
  verified_at: string;
  /** 검증자 email */
  verified_by: string;
  /** ISO 날짜 — 마지막 운영자 점검 (월 1회 권장) */
  last_review_date: string;
  /** 검증 필요 사항 / 운영자 액션 (예: "ODsay API key 없어 mock transit") */
  notes?: string;
}
