/**
 * A1-7-1 (2026-05-24): 운영자 본인 테스트 결제 식별 SSOT helper.
 *
 * 비유: "식당 매출 계산기가 사장님 본인 시식까지 손님 매출에 합산" → 분리 표시.
 *
 * paymentGate.js / planPersister.js / booking-processor.js 는 TEST- / ADMIN-BYPASS-
 * prefix 를 각자 hard-coded 로 인지했지만 admin-sales.js 만 누락 → 본인 테스트가
 * 매출 KPI 에 섞임. 본 helper 를 단일 SSOT 로 추출해 매출 / 정산 / 통계 등
 * 비즈니스 집계에서 일관되게 제외.
 *
 * Prefix 규약 (paymentGate.js detectProvider 와 동일):
 *   - TEST-          : 🧪 Test Mode 버튼 (BRAINTREE_ENV ∈ {sandbox,dev,development})
 *   - ADMIN-BYPASS-  : 어드민 결제 우회 (LIVE 모드, ADMIN_BYPASS_EMAILS 검증)
 *
 * MANUAL- prefix 는 실제 입금 확인 후 admin 이 mark-paid 클릭 → 실제 매출이므로
 * 제외하지 않음 (의도).
 *
 * 사용 예:
 *   import { isAdminBypassBooking } from './_shared/admin-bypass-detector.js';
 *   const businessBookings = allBookings.filter(b =>
 *     b.status !== 'CANCELED' && !isAdminBypassBooking(b)
 *   );
 */

const ADMIN_BYPASS_PREFIXES = ['TEST-', 'ADMIN-BYPASS-'];

/**
 * booking document 가 운영자 테스트 결제인지 판정.
 *
 * bookings 컬렉션 doc ID 자체가 orderID (TEST-/ADMIN-BYPASS- prefix 그대로) 이지만
 * 일부 흐름은 capturePaypalOrder/booking-processor 에서 별도 필드로도 저장.
 * 어느 필드 1개라도 prefix 매칭이면 admin bypass 로 간주 — silent fail 차단.
 *
 * 검사 필드 (최소 1개 매칭 시 true):
 *   - id          : Firestore doc ID (orderID 그대로 = bookings.doc(orderID))
 *   - orderID     : capturePaypalOrder.js bookingDocPayload.orderID
 *   - bookingRef  : capturePaypalOrder.js bookingDocPayload.bookingRef = orderID
 *   - transactionId : booking-processor.js booking.transactionId = orderID
 *   - paypalOrderId : 다른 흐름에서 사용 가능 (forward-compat)
 *
 * paymentMethod === 'admin-bypass' 도 booking-processor.js 가 명시 기록하지만
 * prefix 기반 식별이 더 견고 (paymentMethod 누락 시에도 잡힘) — 보조 신호로 추가.
 *
 * @param {object|null|undefined} booking - bookings Firestore document data
 * @returns {boolean}
 */
export function isAdminBypassBooking(booking) {
  if (!booking || typeof booking !== 'object') return false;

  // paymentMethod 명시 신호 (booking-processor.js 가 set)
  if (booking.paymentMethod === 'admin-bypass') return true;

  // prefix 기반 식별 — 여러 필드 중 하나라도 매칭이면 true
  const candidateFields = [
    booking.id,
    booking.orderID,
    booking.orderId,        // camelCase 변형 (forward-compat)
    booking.bookingRef,
    booking.transactionId,
    booking.paypalOrderId,
  ];

  for (const field of candidateFields) {
    if (typeof field !== 'string') continue;
    for (const prefix of ADMIN_BYPASS_PREFIXES) {
      if (field.startsWith(prefix)) return true;
    }
  }

  return false;
}

/**
 * 전체 bookings 배열에서 admin bypass 건수만 카운트 (메타 응답용).
 * @param {Array<object>} bookings
 * @returns {number}
 */
export function countAdminBypassBookings(bookings) {
  if (!Array.isArray(bookings)) return 0;
  let n = 0;
  for (const b of bookings) {
    if (isAdminBypassBooking(b)) n++;
  }
  return n;
}

/**
 * #payment-separation (2026-06-05): 주문 ID 문자열의 결제 출처 분류 (SSOT).
 * paymentGate.js detectProvider 와 동일 규약 — 단, 여기는 booking 객체가 아니라
 * orderId 문자열을 받아 plan 저장(planPersister) 등에서 명시 필드로 쓰기 위함.
 *   TEST- → 'test' / ADMIN-BYPASS- → 'admin-bypass' / MANUAL- → 'manual' / 그 외 → 'paypal'
 * (paymentGate.detectProvider 와 반드시 동일 출력 — 본 모듈 test 가 규약 잠금.)
 *
 * @param {string|null|undefined} orderId
 * @returns {'test'|'admin-bypass'|'manual'|'paypal'}
 */
export function detectPaymentSource(orderId) {
  const id = typeof orderId === 'string' ? orderId : '';
  if (id.startsWith('TEST-')) return 'test';
  if (id.startsWith('ADMIN-BYPASS-')) return 'admin-bypass';
  if (id.startsWith('MANUAL-')) return 'manual';
  return 'paypal';
}

/**
 * 주문 ID 가 운영자 테스트(어드민 우회 / TEST)인지 — plan/booking 의 isAdminBypass 명시 필드용.
 * MANUAL-(실 입금) 과 일반 PayPal 은 false (= 실제 매출). isAdminBypassBooking 의 prefix 규약과 일치.
 *
 * @param {string|null|undefined} orderId
 * @returns {boolean}
 */
export function isAdminBypassOrderId(orderId) {
  const src = detectPaymentSource(orderId);
  return src === 'test' || src === 'admin-bypass';
}

export { ADMIN_BYPASS_PREFIXES };
