/**
 * 게스트(비로그인) AI 플래너 결제 진입 게이트 — 보안 불변식 가드 (2026-06-16).
 *
 * 배경: 광고 유입 손님이 결제 전 로그인 강제(P315 벽)에 막혀 전환 0. FEATURE_GUEST_ANON_AUTH
 *   ON 시 비로그인 손님도 가입 없이 결제 허용 — 단 권한 위조(admin-bypass/TEST/MANUAL)·
 *   revision·플래그 OFF 경로는 절대 게스트 불가. 실제 결제 인증은 paymentGate(PayPal order API).
 */
import { describe, it, expect } from 'vitest';
import { isGuestCheckoutAllowed } from '../../api/_shared/user-auth.js';

const REAL_PAYPAL = '5O190127TN364715T'; // 17자 alphanumeric — 실 PayPal order 형식

describe('isGuestCheckoutAllowed — 게스트 결제 진입 게이트', () => {
  it('비로그인 + flag ON + 일반 PayPal order → 허용', () => {
    expect(isGuestCheckoutAllowed({ authOk: false, flagOn: true, paypalOrderId: REAL_PAYPAL })).toBe(true);
  });

  it('flag OFF(기본) → 항상 거부 (현행 401 byte-identical 보장)', () => {
    expect(isGuestCheckoutAllowed({ authOk: false, flagOn: false, paypalOrderId: REAL_PAYPAL })).toBe(false);
  });

  it('로그인 사용자(authOk=true) → 거부 (기존 인증 경로 사용, 이 게이트 무관)', () => {
    expect(isGuestCheckoutAllowed({ authOk: true, flagOn: true, paypalOrderId: REAL_PAYPAL })).toBe(false);
  });

  // 🔴 권한 위조 차단 — prefix order 는 '-' 포함 → 정규식 불일치 → 게스트 절대 불가.
  //    (admin 무료우회 / TEST 모드 / 수동결제 경로를 게스트가 못 탐 = paymentGate 가드 유지)
  it.each(['ADMIN-BYPASS-abc1234567', 'TEST-abc1234567', 'MANUAL-bookingRef1234'])(
    'flag ON 이어도 "%s" prefix order → 거부',
    (pid) => {
      expect(isGuestCheckoutAllowed({ authOk: false, flagOn: true, paypalOrderId: pid })).toBe(false);
    },
  );

  it('revision(revisionOf 존재) → 거부 (원본 소유자 필요 = 게스트 불가)', () => {
    expect(isGuestCheckoutAllowed({ authOk: false, flagOn: true, revisionOf: 'plan123', paypalOrderId: REAL_PAYPAL })).toBe(false);
  });

  it('paypalOrderId 누락/빈값/null → 거부', () => {
    expect(isGuestCheckoutAllowed({ authOk: false, flagOn: true })).toBe(false);
    expect(isGuestCheckoutAllowed({ authOk: false, flagOn: true, paypalOrderId: '' })).toBe(false);
    expect(isGuestCheckoutAllowed({ authOk: false, flagOn: true, paypalOrderId: null })).toBe(false);
  });

  it('너무 짧은 order id(<10자) → 거부', () => {
    expect(isGuestCheckoutAllowed({ authOk: false, flagOn: true, paypalOrderId: 'abc123' })).toBe(false);
  });

  it('non-string paypalOrderId → 거부 (타입 방어)', () => {
    expect(isGuestCheckoutAllowed({ authOk: false, flagOn: true, paypalOrderId: 12345678901 as unknown as string })).toBe(false);
  });

  it('인자 없음 → 거부 (방어적 기본값)', () => {
    expect(isGuestCheckoutAllowed()).toBe(false);
  });
});
