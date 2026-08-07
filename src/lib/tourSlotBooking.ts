// tourSlotBooking.ts — 투어 시간 슬롯 정원(capacity) 결제 배선.
//
// 🔴 정본 = 백엔드. `api/createPaypalOrder.js` 가 pre-lock(acquireSlotLock),
//   `api/capturePaypalOrder.js` 가 confirm(confirmSlotLock) 을 호출하는데, 둘 다
//   **tourId·tourSlotId·bookingDate·slotCapacity 4개가 전부 있을 때만** 호출하고
//   하나라도 없으면 조용히 스킵한다(슬롯 없는 상품 = AI 플래너·차터 보호).
//   → 프론트도 "전부 아니면 전무" 로 보내야 한다. 반쪽 전송은 정원 강제가 안 걸린
//   상태를 만들면서 아무 신호도 안 남긴다.
//
// 이 모듈은 금액을 만지지 않는다 — 필드 4개를 실어 보낼지 말지만 정한다.
// 필드명을 바꾸면 백엔드도 같이 바꿔야 한다(tests/unit/tour-slot-capacity-wiring.test.ts 가 가드).
//
// firebase-free 유지 필수 — 단위 테스트가 이 모듈만 import 하고 컴포넌트는 안 건드린다
// (lint 규칙 R_Phase1_testNoFirebaseClientImport: 테스트가 PayPalBookingButton 등을 import 하면
//  CI 에서 firebase 키가 없어 getAuth() throw → 스위트 통째 "0 test" crash).

/**
 * 정원 거절 안내 — 서버 메시지는 진단용 영어("Slot full: requested=3, confirmed=6, …")라
 * 손님에게 그대로 보이면 안 된다. PayPalBookingButton 이 BOOKING_CLOSED 와 같은 방식으로
 * (응답 code 분기 → 언어별 문구) 소비한다. 화면 문구를 여기 두는 이유는 위 firebase-free 주석과 같다.
 */
export const SLOT_REJECT_LABELS: Record<string, { SLOT_FULL: string; DATE_UNAVAILABLE: string }> = {
  ko: {
    SLOT_FULL: '선택하신 시간대가 방금 마감되었습니다. 다른 시간대나 날짜를 선택해 주세요.',
    DATE_UNAVAILABLE: '선택하신 날짜는 예약이 마감되었습니다. 다른 날짜를 선택해 주세요.',
  },
  en: {
    SLOT_FULL: 'That time slot just sold out. Please choose another time or date.',
    DATE_UNAVAILABLE: 'That date is fully booked. Please choose another date.',
  },
  ja: {
    SLOT_FULL: 'ご希望の時間帯はただ今満席になりました。別の時間または日付をお選びください。',
    DATE_UNAVAILABLE: 'ご希望の日付は満席です。別の日付をお選びください。',
  },
  zh: {
    SLOT_FULL: '该时段刚刚已满。请选择其他时段或日期。',
    DATE_UNAVAILABLE: '该日期已订满。请选择其他日期。',
  },
};

export interface TourSlotBookingFields {
  tourId: string;
  tourSlotId: string;
  bookingDate: string;
  /** 이 슬롯의 정원(명). confirmed + pending 합이 이 값을 넘으면 서버가 SLOT_FULL 로 막는다. */
  slotCapacity: number;
}

function positiveNumber(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
  return v;
}

function nonEmptyString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 슬롯 정원 출처 해석.
 *
 * 어드민이 슬롯별 capacity 를 비워둘 수 있고(`TourSlot.capacity?`), 그 경우의 규칙은
 * 코드 두 곳에 이미 명시돼 있다 — `api/_shared/slot-capacity.js` 헤더("capacity
 * null/undefined 면 tour.maxPax fallback") 와 `src/lib/admin-product-publish-validation.ts`
 * 의 validateSlotNumeric 주석("capacity undefined 는 허용 — Tour.maxPax 폴백").
 * 그 규칙을 그대로 따른다.
 *
 * 0·음수·NaN 은 값이 아니다 — 0 을 그대로 보내면 서버가 모든 예약을 SLOT_FULL 로 막는다.
 */
export function resolveSlotCapacity(
  slotCapacity: number | null | undefined,
  tourMaxPax: number | null | undefined,
): number | undefined {
  const own = positiveNumber(slotCapacity);
  if (own !== undefined) return own;
  return positiveNumber(tourMaxPax);
}

/**
 * createPaypalOrder / capturePaypalOrder body 에 합칠 슬롯 조각.
 * 4개가 전부 유효할 때만 4개 전부, 아니면 빈 객체(= 기존 동작 그대로).
 */
export function tourSlotBody(
  fields: Partial<TourSlotBookingFields> | null | undefined,
): Partial<TourSlotBookingFields> {
  const tourId = nonEmptyString(fields?.tourId);
  const tourSlotId = nonEmptyString(fields?.tourSlotId);
  const bookingDate = nonEmptyString(fields?.bookingDate);
  const slotCapacity = positiveNumber(fields?.slotCapacity);
  if (!tourId || !tourSlotId || !bookingDate || slotCapacity === undefined) return {};
  return { tourId, tourSlotId, bookingDate, slotCapacity };
}
