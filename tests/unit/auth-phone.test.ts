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
