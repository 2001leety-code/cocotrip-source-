/**
 * phone-validation 단위 테스트 — 전화 형식 검증 (예약 오타·가짜번호 차단).
 * 딥서치 검증: 기사 배차는 닿는 전화가 이행 전제 → length>0 만으론 오타 통과.
 */
import { describe, it, expect } from 'vitest';
import { isValidInternationalPhone } from '@/lib/phone-validation';

describe('isValidInternationalPhone — 형식 검증', () => {
  it('유효: 국제형 (+ 국가코드)', () => {
    expect(isValidInternationalPhone('+821012345678')).toBe(true);
    expect(isValidInternationalPhone('+447792722412')).toBe(true); // GetYourGuide UK 예시
    expect(isValidInternationalPhone('+14155551234')).toBe(true);
  });
  it('유효: 국내형(선행 0) + 구분자(공백/하이픈/괄호)', () => {
    expect(isValidInternationalPhone('01012345678')).toBe(true);
    expect(isValidInternationalPhone('010-1234-5678')).toBe(true);
    expect(isValidInternationalPhone('+82 10 1234 5678')).toBe(true);
    expect(isValidInternationalPhone('(415) 555-1234')).toBe(true);
  });
  it('무효: 글자 포함 (오타)', () => {
    expect(isValidInternationalPhone('abc1234567')).toBe(false);
    expect(isValidInternationalPhone('010-call-me')).toBe(false);
  });
  it('무효: 너무 짧음/긺', () => {
    expect(isValidInternationalPhone('1234567')).toBe(false);        // 7자리
    expect(isValidInternationalPhone('1234567890123456')).toBe(false); // 16자리
  });
  it('무효: 빈값/공백/비문자', () => {
    expect(isValidInternationalPhone('')).toBe(false);
    expect(isValidInternationalPhone('   ')).toBe(false);
    expect(isValidInternationalPhone(undefined as unknown as string)).toBe(false);
  });
});
