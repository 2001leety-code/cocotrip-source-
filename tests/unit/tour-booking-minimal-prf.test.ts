/**
 * PR-F: 투어 예약 필수입력 축소 — isTourStep2Complete 순수 헬퍼 테스트.
 *
 * 검증 항목:
 *   minimal=true  (VITE_FEATURE_TOUR_BOOKING_MINIMAL=true):
 *     1. phone 만 있으면 통과.
 *     2. phone 없으면 차단 (다른 필드 모두 채워져 있어도).
 *     3. phone 공백만이면 차단.
 *     4. 나머지 4개 필드 비어있어도 phone 있으면 통과 (선택 필드).
 *   minimal=false (기본/OFF) [2026-06-06: 전화 형식검증 + 메신저 WhatsApp/LINE one-of]:
 *     5. 전화(형식)+픽업+메신저(둘 중 하나)+메모 채우면 통과.
 *     6. phone만 있고 나머지 비어있으면 차단.
 *     7. 메신저는 둘 중 하나만 있어도 통과 / 둘 다 없으면 차단.
 *     8. 공백만인 필드는 미입력 취급.
 *   기능 플래그 독립성:
 *     9. FEATURE_TOUR_BOOKING_MINIMAL export 값은 boolean 타입.
 *   트립닷컴식 예약정보 (2026-06-28):
 *     10. SMS 미인증이면 차단 (두 모드 공통).
 *     11. 약관 미동의이면 차단 (두 모드 공통).
 */
import { describe, it, expect } from 'vitest';
import { isTourStep2Complete, FEATURE_TOUR_BOOKING_MINIMAL } from '../../src/components/tours/tourBookingValidation';

// --- 테스트용 보조 헬퍼 ---
// 2026-06-28: 트립닷컴식 예약정보 게이트 추가 → SMS 인증 + 약관 동의 항상 필수.
//   기존 시나리오 보존 위해 기본 fixture 는 둘 다 true.
const allFilled = {
  phone: '+82 10 1234 5678',
  pickupAddress: '명동 롯데호텔',
  messenger: 'WhatsApp: +82 10 1234 5678',
  memoText: '알레르기 없음',
  phoneSmsVerified: true,
  termsAgreed: true,
};

const onlyPhone = {
  phone: '+82 10 1234 5678',
  pickupAddress: '',
  messenger: '',
  memoText: '',
  phoneSmsVerified: true,
  termsAgreed: true,
};

const noPhone = {
  phone: '',
  pickupAddress: '명동 롯데호텔',
  messenger: 'WhatsApp: +82 10 1234 5678',
  memoText: '알레르기 없음',
  phoneSmsVerified: true,
  termsAgreed: true,
};

const whitespacePhone = {
  phone: '   ',
  pickupAddress: '명동 롯데호텔',
  messenger: 'WhatsApp: +82 10 1234 5678',
  memoText: '알레르기 없음',
  phoneSmsVerified: true,
  termsAgreed: true,
};

// --- minimal=true (플래그 ON) ---
describe('isTourStep2Complete — minimal=true (플래그 ON)', () => {
  it('1. phone 만 있으면 통과', () => {
    expect(isTourStep2Complete(onlyPhone, true)).toBe(true);
  });

  it('2. phone 없으면 차단 (다른 필드 모두 채워도)', () => {
    expect(isTourStep2Complete(noPhone, true)).toBe(false);
  });

  it('3. phone 공백만이면 차단', () => {
    expect(isTourStep2Complete(whitespacePhone, true)).toBe(false);
  });

  it('4. 나머지 4개 비어도 phone 있으면 통과 (선택 필드)', () => {
    expect(isTourStep2Complete({ ...onlyPhone }, true)).toBe(true);
  });

  it('4b. 5개 전부 채워도 통과 (역방향 확인)', () => {
    expect(isTourStep2Complete(allFilled, true)).toBe(true);
  });

  it('4c. 오타 전화(글자/너무 짧음)면 차단 (형식 검증 — 2026-06-06)', () => {
    expect(isTourStep2Complete({ ...onlyPhone, phone: 'abc123' }, true)).toBe(false);
    expect(isTourStep2Complete({ ...onlyPhone, phone: '123' }, true)).toBe(false);
  });
});

// --- minimal=false (기본/OFF) ---
describe('isTourStep2Complete — minimal=false (기본/OFF)', () => {
  it('5. 5개 전부 채우면 통과', () => {
    expect(isTourStep2Complete(allFilled, false)).toBe(true);
  });

  it('6. phone만 있고 나머지 비면 차단', () => {
    expect(isTourStep2Complete(onlyPhone, false)).toBe(false);
  });

  it('7a. pickupAddress 누락 시 차단', () => {
    expect(isTourStep2Complete({ ...allFilled, pickupAddress: '' }, false)).toBe(false);
  });

  // CRITICAL-1 fix (2026-06-29): WhatsApp/LINE 2필드 → 단일 messenger ("WhatsApp: id" 등,
  //   KakaoTalk/WeChat 포함). 7b/7c (둘 중 하나) 케이스는 단일 모델로 통합.
  it('7b. messenger 있으면 통과', () => {
    expect(isTourStep2Complete({ ...allFilled, messenger: 'LINE: cocotrip_user' }, false)).toBe(true);
  });

  it('7c. messenger(KakaoTalk/WeChat 등 임의 타입)도 통과', () => {
    expect(isTourStep2Complete({ ...allFilled, messenger: 'KakaoTalk: cocotrip' }, false)).toBe(true);
  });

  it('7c-2. messenger 누락이면 차단', () => {
    expect(isTourStep2Complete({ ...allFilled, messenger: '' }, false)).toBe(false);
  });

  it('7d. memoText 누락 시 차단', () => {
    expect(isTourStep2Complete({ ...allFilled, memoText: '' }, false)).toBe(false);
  });

  it('8a. phone 공백만이면 차단', () => {
    expect(isTourStep2Complete({ ...allFilled, phone: '   ' }, false)).toBe(false);
  });

  it('8b. pickupAddress 공백만이면 차단', () => {
    expect(isTourStep2Complete({ ...allFilled, pickupAddress: '  ' }, false)).toBe(false);
  });

  it('8c. memoText 공백만이면 차단', () => {
    expect(isTourStep2Complete({ ...allFilled, memoText: '\t\n' }, false)).toBe(false);
  });
});

// --- 기능 플래그 독립성 ---
describe('FEATURE_TOUR_BOOKING_MINIMAL export 타입', () => {
  it('9. boolean 타입으로 export 됨 (firebase-free 순수 모듈)', () => {
    expect(typeof FEATURE_TOUR_BOOKING_MINIMAL).toBe('boolean');
  });
});

// --- 트립닷컴식 예약정보: SMS 인증 + 약관 동의 게이트 (2026-06-28) ---
describe('isTourStep2Complete — SMS 인증 + 약관 동의 (두 모드 공통)', () => {
  it('10a. SMS 미인증이면 차단 (minimal=true)', () => {
    expect(isTourStep2Complete({ ...onlyPhone, phoneSmsVerified: false }, true)).toBe(false);
  });
  it('10b. SMS 미인증이면 차단 (minimal=false)', () => {
    expect(isTourStep2Complete({ ...allFilled, phoneSmsVerified: false }, false)).toBe(false);
  });
  it('11a. 약관 미동의이면 차단 (minimal=true)', () => {
    expect(isTourStep2Complete({ ...onlyPhone, termsAgreed: false }, true)).toBe(false);
  });
  it('11b. 약관 미동의이면 차단 (minimal=false)', () => {
    expect(isTourStep2Complete({ ...allFilled, termsAgreed: false }, false)).toBe(false);
  });
  it('11c. SMS 인증 + 약관 동의 + 전화형식 OK 면 통과 (minimal=true)', () => {
    expect(isTourStep2Complete({ ...onlyPhone, phoneSmsVerified: true, termsAgreed: true }, true)).toBe(true);
  });
});
