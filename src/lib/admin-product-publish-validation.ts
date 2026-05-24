// ─────────────────────────────────────────────────────────────────────────────
// admin-product-publish-validation.ts — A1-7-3 상품 publish 검증 SSOT
//
// 문제 (pre-fix):
//   AdminProductEditor.handlePublish 가 title.ko / summary.ko / description.ko
//   만 검증. 빈 stops / slots / photos 통과 → 손님에게 빈 카드 노출 (메뉴판/
//   가격표/사진 없이 매장 문 열어버림).
//
// Post-fix (PR #578, 2026-05-24):
//   1. i18n basic (기존 검증 보존) — title.ko / summary.ko / description.ko 필수
//   2. stops >= 2 — 손님이 어디를 가는지 보여줘야 의미있는 투어
//   3. slots >= 1 — 슬롯 없이는 손님이 예약 자체 불가
//   4. photos >= 3 (썸네일 + 갤러리 합산) — 손님이 분위기 판단 불가
//
// A1-7-3 follow-up (이 변경, 2026-05-24 후속):
//   #578 review 4번 발견 5종 nested 검증 갭. count-only 검증으로는 빈 stop
//   2개 / capacity=0 slot / lat 없는 meeting_point 통과. 손님에게 "빈 카드"
//   는 막아도 "잘못된 카드" 는 그대로 노출. 다음 5종 추가:
//     5. stops nested — 각 stop name.ko/en + description.ko/en 빈 값 차단
//     6. slots numeric — capacity ≥ 1 (0 차단), price_modifier_krw 음수 차단
//     7. i18n 4-lang — 외국인 VIP 본질 = en 필수, ja/zh 권장 (warning 만)
//     8. meeting_point — kind 별 필수 필드 (fixed_address lat/lng,
//        hotel_pickup → instructions, multi_zone → zones[])
//     9. cancellation_policy — kind=custom 시 tiers[] 필수
//
// 운영자 의도:
//   - 부족 시 toast 한국어 메시지 + 어느 탭 가야하는지 정확히 안내
//   - thumbnail (legacy string) 과 thumbnail_photo (v3 TourPhoto) 양쪽 인정
//   - images (legacy string[]) 와 photos (v3 TourPhoto[]) 양쪽 합산
//   - 첫 실패에서 즉시 return (운영자 인지부하 축소)
//
// 참조:
//   - A1-7-2 zone-course-publish-validation.ts (helper 패턴)
//   - CLAUDE.md (필드명 폴백 패턴)
//   - PR #578 review 5종 갭 발견
// ─────────────────────────────────────────────────────────────────────────────
import type {
  Tour,
  TourStop,
  TourSlot,
  MeetingPoint,
  CancellationPolicy,
  I18nString,
} from '@/data/tours';

/** publish 검증 결과 — UI 가 toast + 탭 이동에 사용. */
export interface ProductValidationResult {
  ok: boolean;
  reason?:
    | 'missing_i18n'
    | 'insufficient_stops'
    | 'insufficient_slots'
    | 'insufficient_photos'
    | 'stop_nested_missing'
    | 'slot_numeric_invalid'
    | 'i18n_lang_missing'
    | 'meeting_point_invalid'
    | 'cancellation_policy_invalid';
  message?: string;
  /**
   * AdminProductEditor TabKey 와 1:1 매핑:
   *   basic / media / stops / meeting / pricing / included / cancel / faq / meta
   * (insufficient_photos → media / cancellation_policy_invalid → cancel)
   */
  suggestedTab?: 'basic' | 'media' | 'stops' | 'pricing' | 'meeting' | 'cancel';
  /** 정확히 어느 필드/값이 부족한지 (UI 디버깅용) */
  missingFields?: string[];
}

/** stops 최소 2 — 1-stop 투어는 의미없음 (이동 자체가 투어 본질) */
export const MIN_STOPS = 2;

/** slots 최소 1 — 슬롯 0 = 예약 불가 */
export const MIN_SLOTS = 1;

/** photos 최소 3 (썸네일 1 + 갤러리 2) — 분위기 판단 가능 */
export const MIN_PHOTOS = 3;

/** slot capacity 최소값 — 0 = 예약 불가, 1 이상 의무 */
export const MIN_SLOT_CAPACITY = 1;

/**
 * 사진 개수 카운트 — legacy + v3 양쪽 합산.
 *
 *  - thumbnail (string) 또는 thumbnail_photo (TourPhoto) 가 있으면 1장
 *  - images (string[]) + photos (TourPhoto[]) 합산
 *
 * 빈 문자열은 0 으로 처리 (legacy 상품 마이그 시 빈 string 들어올 수 있음).
 */
export function countProductPhotos(draft: Partial<Tour>): number {
  const thumbnailCount =
    (typeof draft.thumbnail === 'string' && draft.thumbnail.trim().length > 0) ||
    (draft.thumbnail_photo && typeof draft.thumbnail_photo.url === 'string' && draft.thumbnail_photo.url.trim().length > 0)
      ? 1
      : 0;

  const legacyImages = Array.isArray(draft.images)
    ? draft.images.filter((u) => typeof u === 'string' && u.trim().length > 0).length
    : 0;

  const v3Photos = Array.isArray(draft.photos)
    ? draft.photos.filter((p) => p && typeof p.url === 'string' && p.url.trim().length > 0).length
    : 0;

  return thumbnailCount + legacyImages + v3Photos;
}

/** i18n string 의 한 lang 값이 의미있는 값인지 (trim 후 길이 > 0). */
function isFilledI18nLang(field: I18nString | undefined, lang: keyof I18nString): boolean {
  if (!field) return false;
  const v = field[lang];
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 각 stop 의 nested 필수 필드 검증 (A1-7-3 follow-up — review 1번 갭).
 *
 * 운영자 의도:
 *   - stop 2개 "통과" 인데 양쪽 다 name.ko 빈 값이면 손님 화면에 빈 카드
 *   - description.ko 도 검증 (어디를 보고 무엇을 하는지가 투어 본질)
 *   - en 도 필수 (외국인 primary)
 *
 * 첫 실패에서 어떤 stop 의 어떤 필드인지 정확히 안내 (운영자가 fix 위치 즉시 인지).
 */
export function validateStopNested(stops: TourStop[]): ProductValidationResult | null {
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const missingFields: string[] = [];

    if (!isFilledI18nLang(stop.name, 'ko')) {
      missingFields.push(`stops[${i}].name.ko`);
    }
    if (!isFilledI18nLang(stop.name, 'en')) {
      missingFields.push(`stops[${i}].name.en`);
    }
    if (!isFilledI18nLang(stop.description, 'ko')) {
      missingFields.push(`stops[${i}].description.ko`);
    }
    if (!isFilledI18nLang(stop.description, 'en')) {
      missingFields.push(`stops[${i}].description.en`);
    }

    if (missingFields.length > 0) {
      return {
        ok: false,
        reason: 'stop_nested_missing',
        message: `일정 탭의 ${i + 1}번째 stop 에 한국어/영어 이름과 설명이 모두 필수입니다 (외국인 손님 노출).`,
        suggestedTab: 'stops',
        missingFields,
      };
    }
  }
  return null;
}

/**
 * 각 slot 의 숫자 필드 검증 (A1-7-3 follow-up — review 2번 갭).
 *
 *  - capacity 가 명시되면 1 이상 (0 = 예약 불가, 음수 = 의미없음)
 *  - capacity undefined 는 허용 (Tour.maxPax 폴백 — 별도 비즈니스 룰)
 *  - price_modifier_krw 음수 차단 (할인 표현은 양수 -percent 별도 필드여야 함)
 */
export function validateSlotNumeric(slots: TourSlot[]): ProductValidationResult | null {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const missingFields: string[] = [];

    if (typeof slot.capacity === 'number' && slot.capacity < MIN_SLOT_CAPACITY) {
      missingFields.push(`slots[${i}].capacity=${slot.capacity}`);
    }
    if (typeof slot.price_modifier_krw === 'number' && slot.price_modifier_krw < 0) {
      missingFields.push(`slots[${i}].price_modifier_krw=${slot.price_modifier_krw}`);
    }

    if (missingFields.length > 0) {
      return {
        ok: false,
        reason: 'slot_numeric_invalid',
        message: `가격·예약 탭의 ${i + 1}번째 슬롯에 capacity ≥ ${MIN_SLOT_CAPACITY} / 추가요금 ≥ 0 필요합니다.`,
        suggestedTab: 'pricing',
        missingFields,
      };
    }
  }
  return null;
}

/**
 * i18n 4-lang 검증 (A1-7-3 follow-up — review 3번 갭).
 *
 * CocoTrip target = 외국인 visitor. 영어 primary, 일/중 권장.
 *
 * 정책 (운영자 review 필요 — 보수적 default):
 *   - title.en / summary.en / description.en 필수 (반환 fail) — 외국인 primary
 *   - title.ja / title.zh 권장 (warning 만 — 추후 운영자 결정에 따라 fail 승격 가능)
 *
 * 이 함수는 fail 케이스만 처리 (warning 은 별도 dispatch). 호출자가
 * warning 표시는 toast.info 로 처리하도록 분리. 운영자가 향후 "4-lang
 * 모두 필수" 로 강화하길 원하면 본 함수에서 ja/zh fail 처리 추가.
 */
export function validateI18nLangs(draft: Partial<Tour>): ProductValidationResult | null {
  const missingFields: string[] = [];

  // EN 필수 (외국인 primary)
  if (!isFilledI18nLang(draft.title, 'en')) missingFields.push('title.en');
  if (!isFilledI18nLang(draft.summary, 'en')) missingFields.push('summary.en');
  if (!isFilledI18nLang(draft.description, 'en')) missingFields.push('description.en');

  if (missingFields.length > 0) {
    return {
      ok: false,
      reason: 'i18n_lang_missing',
      message: '기본 정보 탭의 영어 (en) 제목 / 요약 / 설명이 필수입니다 (외국인 손님 primary).',
      suggestedTab: 'basic',
      missingFields,
    };
  }

  return null;
}

/**
 * i18n 4-lang warning 검증 (ja/zh 권장 — block 안 함).
 *
 * 호출자가 toast.info 로 표시할 수 있도록 분리. 운영자가 충분한 i18n 없이
 * publish 가능하지만, 일/중 손님 비율 ↑ 시 보호 신호.
 *
 * @returns missingFields 가 비어있으면 ok, 아니면 권장 부족 lang 안내.
 */
export function checkI18nWarnings(draft: Partial<Tour>): string[] {
  const warnings: string[] = [];
  if (!isFilledI18nLang(draft.title, 'ja')) warnings.push('title.ja');
  if (!isFilledI18nLang(draft.title, 'zh')) warnings.push('title.zh');
  if (!isFilledI18nLang(draft.summary, 'ja')) warnings.push('summary.ja');
  if (!isFilledI18nLang(draft.summary, 'zh')) warnings.push('summary.zh');
  return warnings;
}

/**
 * meeting_point 검증 (A1-7-3 follow-up — review 4번 갭).
 *
 * kind 별 필수 필드:
 *   - 'fixed_address' → lat / lng 필수 (손님이 위치 못 찾으면 노쇼)
 *   - 'hotel_pickup' → instructions 필수 (호텔 로비 위치 안내)
 *   - 'multi_zone' → zones[] 1개 이상 필수
 *   - meeting_point 자체 없음은 OK (어드민이 의도적으로 미설정 — 즉시확정 후 안내 케이스)
 */
export function validateMeetingPoint(mp: MeetingPoint | undefined): ProductValidationResult | null {
  if (!mp) return null; // meeting_point 미설정 자체는 허용

  const missingFields: string[] = [];

  if (mp.kind === 'fixed_address') {
    if (typeof mp.lat !== 'number' || !Number.isFinite(mp.lat)) missingFields.push('meeting_point.lat');
    if (typeof mp.lng !== 'number' || !Number.isFinite(mp.lng)) missingFields.push('meeting_point.lng');
    if (!isFilledI18nLang(mp.address, 'ko')) missingFields.push('meeting_point.address.ko');
  } else if (mp.kind === 'hotel_pickup') {
    if (!isFilledI18nLang(mp.instructions, 'ko')) missingFields.push('meeting_point.instructions.ko');
  } else if (mp.kind === 'multi_zone') {
    if (!Array.isArray(mp.zones) || mp.zones.length < 1) missingFields.push('meeting_point.zones');
  }

  if (missingFields.length > 0) {
    return {
      ok: false,
      reason: 'meeting_point_invalid',
      message: `미팅 장소 탭에 ${mp.kind} 방식 필수 필드가 누락되었습니다 (손님이 위치 못 찾으면 노쇼 발생).`,
      suggestedTab: 'meeting',
      missingFields,
    };
  }

  return null;
}

/**
 * cancellation_policy 검증 (A1-7-3 follow-up — review 5번 갭).
 *
 *  - kind='inherit_global' → 글로벌 RefundPolicyModal 표 사용 (tiers 불필요)
 *  - kind='custom' → tiers[] 1개 이상 필수 (운영자 명시 적정 환불 룰)
 *  - cancellation_policy 자체 없음은 inherit_global 로 간주 (호환 안전)
 */
export function validateCancellationPolicy(cp: CancellationPolicy | undefined): ProductValidationResult | null {
  if (!cp) return null; // 미설정은 글로벌 inherit (기본 안전)

  if (cp.kind === 'custom') {
    if (!Array.isArray(cp.tiers) || cp.tiers.length < 1) {
      return {
        ok: false,
        reason: 'cancellation_policy_invalid',
        message: '취소 정책 탭에 custom 환불 규칙을 1개 이상 추가해주세요 (분쟁 차단).',
        suggestedTab: 'cancel',
        missingFields: ['cancellation_policy.tiers'],
      };
    }
  } else if (cp.kind !== 'inherit_global') {
    // 알 수 없는 kind — schema 깨짐
    return {
      ok: false,
      reason: 'cancellation_policy_invalid',
      message: `취소 정책 탭의 kind 값이 올바르지 않습니다 (현재 "${cp.kind}", 'inherit_global' 또는 'custom' 만 허용).`,
      suggestedTab: 'cancel',
      missingFields: ['cancellation_policy.kind'],
    };
  }

  return null;
}

/**
 * publish 전 검증. 검증 순서 (운영자 의도):
 *   1. i18n basic — 가장 기본. 이거 없으면 다른거 의미 X
 *   2. stops count — 일정 없이는 투어 자체 정의 불가
 *   3. slots count — 일정 있어도 예약 슬롯 없으면 손님 결제 불가
 *   4. photos — 가장 cosmetic 하지만 빈 카드 노출 차단
 *
 * A1-7-3 follow-up nested 검증 (count 통과 후):
 *   5. stops nested — 각 stop 의 name.ko/en + description.ko/en 의미값
 *   6. slots numeric — capacity ≥ 1 / price_modifier_krw ≥ 0
 *   7. i18n 4-lang — en 필수 (ja/zh warning 은 별도 checkI18nWarnings)
 *   8. meeting_point — kind 별 필수 필드
 *   9. cancellation_policy — kind=custom 시 tiers[] 필수
 *
 * 첫 실패에서 즉시 return — 한 번에 하나만 안내 (운영자 인지부하 축소).
 */
export function validateProductPublish(draft: Partial<Tour>): ProductValidationResult {
  // 1. i18n basic (ko 필수)
  const titleKo = draft.title?.ko?.trim();
  const summaryKo = draft.summary?.ko?.trim();
  const descKo = draft.description?.ko?.trim();
  if (!titleKo || !summaryKo || !descKo) {
    const missing: string[] = [];
    if (!titleKo) missing.push('title.ko');
    if (!summaryKo) missing.push('summary.ko');
    if (!descKo) missing.push('description.ko');
    return {
      ok: false,
      reason: 'missing_i18n',
      message: '기본 정보 탭의 한국어 제목 / 요약 / 설명이 모두 필수입니다.',
      suggestedTab: 'basic',
      missingFields: missing,
    };
  }

  // 2. stops >= 2
  const stops = draft.stops || [];
  if (stops.length < MIN_STOPS) {
    return {
      ok: false,
      reason: 'insufficient_stops',
      message: `일정 탭에 stop ${MIN_STOPS}개 이상 필요합니다 (현재 ${stops.length}개). 손님이 어디를 가는지 보여줘야 합니다.`,
      suggestedTab: 'stops',
      missingFields: [`stops (${stops.length}/${MIN_STOPS})`],
    };
  }

  // 3. slots >= 1
  const slots = draft.slots || [];
  if (slots.length < MIN_SLOTS) {
    return {
      ok: false,
      reason: 'insufficient_slots',
      message: `가격·예약 탭에 슬롯 ${MIN_SLOTS}개 이상 필요합니다. 슬롯 없이는 손님이 예약 자체 불가합니다.`,
      suggestedTab: 'pricing',
      missingFields: [`slots (${slots.length}/${MIN_SLOTS})`],
    };
  }

  // 4. photos >= 3 (썸네일 + 갤러리)
  const totalPhotos = countProductPhotos(draft);
  if (totalPhotos < MIN_PHOTOS) {
    return {
      ok: false,
      reason: 'insufficient_photos',
      message: `미디어 탭에 사진 ${MIN_PHOTOS}장 이상 필요합니다 (썸네일 + 갤러리 합산, 현재 ${totalPhotos}장). 손님이 분위기를 판단할 수 없습니다.`,
      suggestedTab: 'media',
      missingFields: [`photos (${totalPhotos}/${MIN_PHOTOS})`],
    };
  }

  // ── A1-7-3 follow-up nested 검증 (count 통과 후) ──────────────────────────

  // 5. stops nested (각 stop name/description ko+en 의미값)
  const stopNested = validateStopNested(stops);
  if (stopNested) return stopNested;

  // 6. slots numeric (capacity / price_modifier_krw)
  const slotNumeric = validateSlotNumeric(slots);
  if (slotNumeric) return slotNumeric;

  // 7. i18n 4-lang (en 필수)
  const i18nLangs = validateI18nLangs(draft);
  if (i18nLangs) return i18nLangs;

  // 8. meeting_point (kind 별 필수)
  const meetingPoint = validateMeetingPoint(draft.meeting_point);
  if (meetingPoint) return meetingPoint;

  // 9. cancellation_policy (custom 시 tiers)
  const cancellation = validateCancellationPolicy(draft.cancellation_policy);
  if (cancellation) return cancellation;

  return { ok: true };
}
