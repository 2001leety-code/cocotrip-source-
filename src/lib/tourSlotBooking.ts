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
// 필드명을 바꾸면 백엔드도 같이 바꿔야 한다(tests/unit/tour-slot-capacity-wiring.test.tsx 가 가드).

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
