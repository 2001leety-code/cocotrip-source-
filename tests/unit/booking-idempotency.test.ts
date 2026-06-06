/**
 * booking-idempotency 단위 테스트 — booking-processor 멱등 가드.
 * retry 큐 sweep / admin-replay / cart fan-out 재호출 시 Sheets·로열티·메일 중복 방지.
 * 핵심 안전 불변식: 마커 없음/읽기실패 = 전부 처리(첫 처리 보장). 마커 존재 = 해당 단계만 스킵.
 */
import { describe, it, expect } from 'vitest';
import { bookingStepGuards, BOOKING_STEP_MARKERS } from '../../api/_shared/booking-idempotency.js';

describe('bookingStepGuards — 멱등 단계 가드', () => {
  it('마커 없음 {} = 전부 처리 (스킵 0)', () => {
    expect(bookingStepGuards({})).toEqual({ skipSheets: false, skipLoyalty: false, skipVoucher: false });
  });

  it('null/undefined = 전부 처리 (안전 기본 — 읽기 실패 시 첫 처리 보장)', () => {
    expect(bookingStepGuards(null)).toEqual({ skipSheets: false, skipLoyalty: false, skipVoucher: false });
    expect(bookingStepGuards(undefined)).toEqual({ skipSheets: false, skipLoyalty: false, skipVoucher: false });
  });

  it('각 마커 존재 시 해당 단계만 스킵', () => {
    expect(bookingStepGuards({ sheetsAppendedAt: 1 })).toMatchObject({ skipSheets: true, skipLoyalty: false, skipVoucher: false });
    expect(bookingStepGuards({ loyaltyEarnedAt: 1 })).toMatchObject({ skipSheets: false, skipLoyalty: true, skipVoucher: false });
    expect(bookingStepGuards({ voucherSentAt: 1 })).toMatchObject({ skipSheets: false, skipLoyalty: false, skipVoucher: true });
  });

  it('전 마커 존재 = 전부 스킵 (완전 재처리 = 부수효과 0)', () => {
    expect(bookingStepGuards({ sheetsAppendedAt: 1, loyaltyEarnedAt: 1, voucherSentAt: 1 }))
      .toEqual({ skipSheets: true, skipLoyalty: true, skipVoucher: true });
  });

  it('falsy 마커값(0/빈문자열)은 미완료 취급 = 처리 (Boolean 강제)', () => {
    expect(bookingStepGuards({ sheetsAppendedAt: 0, voucherSentAt: '' }))
      .toEqual({ skipSheets: false, skipLoyalty: false, skipVoucher: false });
  });

  it('마커 필드명 상수 일치 (handler set 시 사용)', () => {
    expect(BOOKING_STEP_MARKERS).toEqual({
      sheets: 'sheetsAppendedAt', loyalty: 'loyaltyEarnedAt', voucher: 'voucherSentAt',
    });
  });
});
