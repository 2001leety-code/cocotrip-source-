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
  | 'suwon';

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

/** 4-lang 다국어 필드 (CLAUDE.md C 섹션 — 신 스키마) */
export interface I18nText {
  ko: string;
  en: string;
  ja: string;
  zh: string;
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
  /** 입장료 (KRW). 0 = 무료 */
  entry_fee_krw: number;
  /** 입장료 비고 (예: "20:30 이후 무료") */
  entry_fee_note?: string;
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

/** stop 간 이동 1건 — ODsay Transit API 결과 */
export interface ZoneCourseTransit {
  from_order: number;
  to_order: number;
  mode: ZoneCourseTransitMode;
  /** 이동 시간 (분) */
  duration_min: number;
  /** 거리 (m) */
  distance_m: number;
  /** 비용 (원) — 도보 0, 지하철/버스 ODsay payment, 택시 추정 */
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
  stops: ZoneCourseStop[];
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
