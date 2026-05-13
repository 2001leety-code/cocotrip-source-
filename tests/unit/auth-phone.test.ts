// PR #390 (2026-05-13): Phone Auth E.164 + 6-digit code validation 회귀 assertion.
// PhoneSignInModal 내부 regex 와 동일 — 변경 시 양쪽 동시 update 필수.
//
// 의도:
// - E.164 format: + 다음 국가코드(1~3) + 가입자 번호. 총 8~15 자리.
// - SMS 코드: 정확히 6자리 숫자 (Firebase Phone Auth 표준).
//
// 회귀 사례 방지:
// - "+" 누락 → Firebase API 거부 → 사용자 의미 없는 에러
// - 국제 prefix 0 (한국 010, 일본 090 등) → +82 / +81 변환 필수
// - 5자리 또는 7자리 코드 입력 → confirm() 자동 실패 → UX 가드 우선

import { describe, it, expect } from 'vitest';

const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;
const SMS_CODE_REGEX = /^\d{6}$/;

describe('Phone Auth — E.164 phone format', () => {
  describe('valid cases', () => {
    it.each([
      ['+821012345678', 'Korea mobile +82 10-1234-5678'],
      ['+12025550123', 'US +1 202-555-0123'],
      ['+81901234567', 'Japan mobile +81 90-1234-567'],
      ['+886912345678', 'Taiwan mobile +886'],
      ['+85291234567', 'Hong Kong mobile +852'],
      ['+8613812345678', 'China mobile +86'],
      ['+447400123456', 'UK mobile +44'],
      ['+12345678', 'shortest valid (8 digits total after +)'],
      ['+123456789012345', 'longest valid (15 digits total after +)'],
    ])('accepts %s (%s)', (phone) => {
      expect(PHONE_E164_REGEX.test(phone)).toBe(true);
    });
  });

  describe('invalid cases', () => {
    it.each([
      ['', 'empty'],
      ['+', 'plus only'],
      ['821012345678', 'missing + prefix'],
      ['010-1234-5678', 'Korean local format with dashes'],
      ['+0821012345678', 'leading 0 after +'],
      ['+82-10-1234-5678', 'dashes inside'],
      ['+82 10 1234 5678', 'spaces inside'],
      ['+abc1234567', 'non-digits after +'],
      ['+12', 'too short (under 8 digits total)'],
      ['+1234567', 'too short (7 digits after +)'],
      ['+1234567890123456', 'too long (16 digits after +)'],
    ])('rejects %s (%s)', (phone) => {
      expect(PHONE_E164_REGEX.test(phone)).toBe(false);
    });
  });
});

// PR #399: 국가 select dropdown + nationalNumber 분리 입력 — PhoneSignInModal 의
// handleSendCode 조합 로직 검증. dialCode + leading-0-strip(nationalNumber) → E.164.
function composeE164(dialCode: string, nationalNumber: string): string {
  const trimmed = nationalNumber.replace(/^0+/, '');
  return `+${dialCode}${trimmed}`;
}

describe('Phone Auth — dial + nationalNumber 조합 (PR #399)', () => {
  describe('valid composition', () => {
    it.each([
      ['82', '1012345678', '+821012345678', 'Korea mobile (no leading 0)'],
      ['82', '01012345678', '+821012345678', 'Korea mobile (leading 0 strip)'],
      ['82', '0001012345678', '+821012345678', 'Korea (multiple leading 0 strip)'],
      ['81', '9012345678', '+819012345678', 'Japan mobile (no leading 0)'],
      ['81', '09012345678', '+819012345678', 'Japan mobile (leading 0 strip)'],
      ['886', '912345678', '+886912345678', 'Taiwan mobile'],
      ['852', '91234567', '+85291234567', 'Hong Kong mobile'],
      ['86', '13812345678', '+8613812345678', 'China mobile'],
      ['1', '2025550123', '+12025550123', 'US'],
      ['1', '4161234567', '+14161234567', 'Canada (same dial as US)'],
      ['65', '91234567', '+6591234567', 'Singapore'],
      ['44', '7400123456', '+447400123456', 'UK'],
    ])('dial=%s national=%s → %s (%s)', (dial, national, expected) => {
      const composed = composeE164(dial, national);
      expect(composed).toBe(expected);
      expect(PHONE_E164_REGEX.test(composed)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('strips multiple leading zeros', () => {
      expect(composeE164('82', '0001012345678')).toBe('+821012345678');
    });
    it('keeps leading 0 only inside the number (not at start)', () => {
      // 미국 +1 (XXX) 0YY-ZZZZ — 중간 0 은 유지
      expect(composeE164('1', '2020551234')).toBe('+12020551234');
    });
    it('all-zero national → still strips all → invalid (PHONE_E164_REGEX rejects)', () => {
      const composed = composeE164('82', '0000000000');
      expect(composed).toBe('+82');
      // PHONE_E164_REGEX 가 reject — UX 가드: 사용자 에러 메시지
      expect(PHONE_E164_REGEX.test(composed)).toBe(false);
    });
    it('empty national → just +dialCode (invalid)', () => {
      const composed = composeE164('82', '');
      expect(composed).toBe('+82');
      expect(PHONE_E164_REGEX.test(composed)).toBe(false);
    });
  });
});

describe('Phone Auth — SMS code format', () => {
  describe('valid cases', () => {
    it.each(['123456', '000000', '999999', '987654'])('accepts %s', (code) => {
      expect(SMS_CODE_REGEX.test(code)).toBe(true);
    });
  });

  describe('invalid cases', () => {
    it.each([
      ['', 'empty'],
      ['12345', '5 digits'],
      ['1234567', '7 digits'],
      ['12345a', 'contains letter'],
      ['123 456', 'contains space'],
      ['123-456', 'contains dash'],
      ['  123456', 'leading whitespace'],
      ['+12345', 'starts with +'],
    ])('rejects %s (%s)', (code) => {
      expect(SMS_CODE_REGEX.test(code)).toBe(false);
    });
  });
});
