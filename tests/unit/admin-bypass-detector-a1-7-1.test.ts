/**
 * A1-7-1 (2026-05-24): admin bypass booking detector — SSOT helper.
 *
 * Root cause:
 *   admin-sales.js 가 paymentGate.js / planPersister.js / booking-processor.js 와
 *   달리 TEST- / ADMIN-BYPASS- prefix 인지 0건 → 운영자 본인 테스트가 매출 KPI 에 섞임.
 *
 * Fix:
 *   _shared/admin-bypass-detector.js 신규 SSOT helper 추출.
 *
 * 회귀 방지: 본 unit test 가 helper 로직을 잠금. helper signature 변경 시 즉시 fail.
 *
 * 비유: "식당 매출 계산기가 사장님 본인 시식까지 합산하던 것 → 분리".
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import {
  isAdminBypassBooking,
  countAdminBypassBookings,
  ADMIN_BYPASS_PREFIXES,
} from '../../api/_shared/admin-bypass-detector.js';

describe('A1-7-1 isAdminBypassBooking', () => {
  it('orderID 가 TEST- prefix → true', () => {
    expect(isAdminBypassBooking({ orderID: 'TEST-abc-123' })).toBe(true);
  });

  it('orderID 가 ADMIN-BYPASS- prefix → true', () => {
    expect(isAdminBypassBooking({ orderID: 'ADMIN-BYPASS-xyz-789' })).toBe(true);
  });

  it('일반 PayPal orderID → false', () => {
    expect(isAdminBypassBooking({ orderID: '5O190127TN364715T' })).toBe(false);
    expect(isAdminBypassBooking({ orderID: 'PAY-real-123' })).toBe(false);
  });

  it('MANUAL- prefix 는 실제 입금 확인 후 흐름 → false (제외 안 함, 의도)', () => {
    expect(isAdminBypassBooking({ orderID: 'MANUAL-CT-12345' })).toBe(false);
  });

  it('Firestore doc id 가 TEST- prefix 여도 매칭 (bookings.doc(orderID) 흐름)', () => {
    expect(isAdminBypassBooking({ id: 'TEST-doc-1' })).toBe(true);
    expect(isAdminBypassBooking({ id: 'ADMIN-BYPASS-doc-2' })).toBe(true);
  });

  it('bookingRef 가 TEST- prefix → true (capturePaypalOrder bookingDocPayload 흐름)', () => {
    expect(isAdminBypassBooking({ bookingRef: 'TEST-CT-99' })).toBe(true);
  });

  it('transactionId 가 ADMIN-BYPASS- prefix → true (booking-processor 흐름)', () => {
    expect(isAdminBypassBooking({ transactionId: 'ADMIN-BYPASS-tx-1' })).toBe(true);
  });

  it('paypalOrderId / orderId (camelCase 변형) 도 매칭 — forward-compat', () => {
    expect(isAdminBypassBooking({ paypalOrderId: 'TEST-pp-1' })).toBe(true);
    expect(isAdminBypassBooking({ orderId: 'ADMIN-BYPASS-low-1' })).toBe(true);
  });

  it('한 필드라도 prefix 매칭이면 true (paypalOrderId 만 TEST-, 나머지 정상)', () => {
    const booking = {
      orderID: 'PAY-real-123',
      bookingRef: 'CT-2025-001',
      paypalOrderId: 'TEST-xyz',  // 이 필드만 TEST- → admin bypass 로 식별
    };
    expect(isAdminBypassBooking(booking)).toBe(true);
  });

  it('paymentMethod === "admin-bypass" 단독으로 true (booking-processor 명시 신호)', () => {
    // capturePaypalOrder + booking-processor 가 paymentMethod 필드 set.
    // prefix 누락 케이스에도 잡힘.
    expect(isAdminBypassBooking({
      orderID: 'unexpected-format',
      paymentMethod: 'admin-bypass',
    })).toBe(true);
  });

  it('null / undefined / 빈 객체 → false (방어적 가드)', () => {
    expect(isAdminBypassBooking(null)).toBe(false);
    expect(isAdminBypassBooking(undefined)).toBe(false);
    expect(isAdminBypassBooking({})).toBe(false);
  });

  it('객체 아닌 타입 (string/number/array) → false', () => {
    expect(isAdminBypassBooking('TEST-abc' as unknown as object)).toBe(false);
    expect(isAdminBypassBooking(42 as unknown as object)).toBe(false);
    // 빈 배열은 object 타입이지만 prefix 매칭 필드가 없으므로 false
    expect(isAdminBypassBooking([] as unknown as object)).toBe(false);
  });

  it('필드 타입이 string 이 아니면 무시 (number/object 등)', () => {
    expect(isAdminBypassBooking({ orderID: 12345 })).toBe(false);
    expect(isAdminBypassBooking({ orderID: { nested: 'TEST-abc' } })).toBe(false);
  });

  it('대소문자 구분 — "test-" 소문자는 매칭 안 함 (paymentGate 규약과 일치)', () => {
    expect(isAdminBypassBooking({ orderID: 'test-abc' })).toBe(false);
    expect(isAdminBypassBooking({ orderID: 'admin-bypass-abc' })).toBe(false);
  });

  it('prefix 가 중간에 있으면 매칭 안 함 (startsWith 의무)', () => {
    expect(isAdminBypassBooking({ orderID: 'PAY-TEST-fake' })).toBe(false);
    expect(isAdminBypassBooking({ orderID: 'foo-ADMIN-BYPASS-bar' })).toBe(false);
  });
});

describe('A1-7-1 countAdminBypassBookings', () => {
  it('빈 배열 → 0', () => {
    expect(countAdminBypassBookings([])).toBe(0);
  });

  it('non-array → 0 (방어적)', () => {
    expect(countAdminBypassBookings(null as unknown as object[])).toBe(0);
    expect(countAdminBypassBookings(undefined as unknown as object[])).toBe(0);
    expect(countAdminBypassBookings({} as unknown as object[])).toBe(0);
  });

  it('혼합 booking 배열 → admin bypass 만 카운트', () => {
    const bookings = [
      { orderID: 'TEST-1' },
      { orderID: '5O190127TN364715T' },
      { orderID: 'ADMIN-BYPASS-2' },
      { orderID: 'PAY-real' },
      { paymentMethod: 'admin-bypass', orderID: 'weird-format' },
      { orderID: 'MANUAL-CT-1' },  // MANUAL- 은 실제 매출 → 제외 안 함
    ];
    expect(countAdminBypassBookings(bookings)).toBe(3);
  });
});

describe('A1-7-1 ADMIN_BYPASS_PREFIXES 규약', () => {
  it('정확히 2개 prefix — TEST- + ADMIN-BYPASS- (MANUAL- 제외 의무)', () => {
    expect(ADMIN_BYPASS_PREFIXES).toEqual(['TEST-', 'ADMIN-BYPASS-']);
  });

  it('paymentGate.js detectProvider 규약과 일치 — MANUAL- 는 실제 결제이므로 미포함', () => {
    // MANUAL- 는 admin 이 PayPal QR 입금 확인 후 마크 → 실제 매출.
    // 매출 KPI 에서 제외하면 운영자 손해.
    expect(ADMIN_BYPASS_PREFIXES).not.toContain('MANUAL-');
  });
});
