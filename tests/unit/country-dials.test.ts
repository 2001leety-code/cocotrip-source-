/**
 * country-dials 단위 테스트 — 예약폼 국가번호 드롭다운 합성/역파싱.
 * 핵심: 한국 010→+82 정규화, 미국 +1, resume 역파싱, 이중 prefix strip.
 * 게이트(isValidInternationalPhone) 호환성도 검증 — 합성값이 통과해야 결제 게이트 생존.
 */
import { describe, it, expect } from 'vitest';
import {
  COUNTRIES,
  DEFAULT_DIAL_BY_LANG,
  findCountryByDial,
  parsePhoneValue,
  normalizeNationalNumber,
  composePhoneValue,
} from '@/lib/country-dials';
import { isValidInternationalPhone } from '@/lib/phone-validation';

describe('COUNTRIES — 외국인 핵심 국가 포함', () => {
  it('KR 첫번째(국내 회귀 안전) + US/CA(+1) 포함', () => {
    expect(COUNTRIES[0].code).toBe('KR');
    expect(findCountryByDial('82')?.code).toBe('KR');
    expect(findCountryByDial('1')).toBeDefined(); // US 또는 CA 첫일치
    expect(COUNTRIES.some((c) => c.code === 'US' && c.dial === '1')).toBe(true);
    expect(COUNTRIES.some((c) => c.code === 'CA' && c.dial === '1')).toBe(true);
  });
  it('4언어 국가명 모두 존재', () => {
    for (const c of COUNTRIES) {
      expect(c.name.ko && c.name.en && c.name.ja && c.name.zh).toBeTruthy();
    }
  });
  it('DEFAULT_DIAL_BY_LANG — ko=82, en=1, ja=81, zh=86', () => {
    expect(DEFAULT_DIAL_BY_LANG.ko).toBe('82');
    expect(DEFAULT_DIAL_BY_LANG.en).toBe('1');
    expect(DEFAULT_DIAL_BY_LANG.ja).toBe('81');
    expect(DEFAULT_DIAL_BY_LANG.zh).toBe('86');
  });
});

describe('normalizeNationalNumber — 선행 0 + 이중 prefix strip', () => {
  it('한국 010→10 (선행 0 제거)', () => {
    expect(normalizeNationalNumber('01012345678', '82')).toBe('1012345678');
  });
  it('구분자(공백/하이픈) 제거', () => {
    expect(normalizeNationalNumber('010-1234-5678', '82')).toBe('1012345678');
    expect(normalizeNationalNumber('10 1234 5678', '82')).toBe('1012345678');
  });
  it('이중 prefix — 번호 칸에 dial 또 침 → 1회 strip', () => {
    expect(normalizeNationalNumber('821012345678', '82')).toBe('1012345678');
    expect(normalizeNationalNumber('+82 1012345678', '82')).toBe('1012345678');
  });
  it('미국 — 선행 0 없음, 그대로', () => {
    expect(normalizeNationalNumber('2025550123', '1')).toBe('2025550123');
  });
  it('빈값 → 빈문자', () => {
    expect(normalizeNationalNumber('', '82')).toBe('');
  });
});

describe('composePhoneValue — "+{dial} {national}" 공백 1개', () => {
  it('한국 010 입력 → +82 1012345678', () => {
    const national = normalizeNationalNumber('01012345678', '82');
    expect(composePhoneValue('82', national)).toBe('+82 1012345678');
  });
  it('미국 → +1 2025550123', () => {
    const national = normalizeNationalNumber('2025550123', '1');
    expect(composePhoneValue('1', national)).toBe('+1 2025550123');
  });
  it('번호 빈값 → "+{dial}" (게이트 미통과 = 의도)', () => {
    expect(composePhoneValue('82', '')).toBe('+82');
  });
});

describe('parsePhoneValue — resume 역파싱', () => {
  it('"+82 1012345678" → dial 82, national 1012345678', () => {
    expect(parsePhoneValue('+82 1012345678')).toEqual({ dial: '82', national: '1012345678' });
  });
  it('"+1 2025550123" → dial 1, national 2025550123', () => {
    expect(parsePhoneValue('+1 2025550123')).toEqual({ dial: '1', national: '2025550123' });
  });
  it('하이픈 형태 "+82-10-1234-5678" → dial 82', () => {
    expect(parsePhoneValue('+82-10-1234-5678')).toEqual({ dial: '82', national: '1012345678' });
  });
  it('공백 없는 "+11234567890" → 알려진 dial(1) 최장일치', () => {
    expect(parsePhoneValue('+11234567890')).toEqual({ dial: '1', national: '1234567890' });
  });
  it('공백 없는 "+8210..." → dial 82 (2자리 우선)', () => {
    expect(parsePhoneValue('+821012345678')).toEqual({ dial: '82', national: '1012345678' });
  });
  it('3자리 dial "+886..." (대만)', () => {
    expect(parsePhoneValue('+886912345678')).toEqual({ dial: '886', national: '912345678' });
  });
  it('구 raw "01012345678"(+ 없음) → dial="" (호출처 기본 dial 유지), national 그대로', () => {
    expect(parsePhoneValue('01012345678')).toEqual({ dial: '', national: '01012345678' });
  });
  it('빈값 → dial="" national=""', () => {
    expect(parsePhoneValue('')).toEqual({ dial: '', national: '' });
  });
});

describe('게이트 호환 — 합성값이 isValidInternationalPhone 통과 (결제 게이트 생존)', () => {
  it('한국 010 합성 → 통과', () => {
    expect(isValidInternationalPhone(composePhoneValue('82', normalizeNationalNumber('01012345678', '82')))).toBe(true);
  });
  it('미국 합성 → 통과', () => {
    expect(isValidInternationalPhone(composePhoneValue('1', normalizeNationalNumber('2025550123', '1')))).toBe(true);
  });
  it('번호 미입력(+82만) → 미통과 (필수 검증 의도)', () => {
    expect(isValidInternationalPhone(composePhoneValue('82', ''))).toBe(false);
  });
  it('round-trip: 합성→역파싱→재합성 안정', () => {
    const v1 = composePhoneValue('82', normalizeNationalNumber('010-1234-5678', '82'));
    const { dial, national } = parsePhoneValue(v1);
    const v2 = composePhoneValue(dial, normalizeNationalNumber(national, dial));
    expect(v2).toBe(v1);
  });
});
