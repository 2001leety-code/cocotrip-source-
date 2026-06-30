/**
 * country-dials 단위 테스트 — 예약폼 국가번호 드롭다운 합성/역파싱.
 * 핵심: 한국 010→+82 정규화, 미국 +1, resume 역파싱, 이중 prefix strip.
 * 게이트(isValidInternationalPhone) 호환성도 검증 — 합성값이 통과해야 결제 게이트 생존.
 */
import { describe, it, expect } from 'vitest';
import {
  COUNTRIES,
  PINNED_DIALS,
  DEFAULT_DIAL_BY_LANG,
  findCountryByDial,
  flagOf,
  parsePhoneValue,
  normalizeNationalNumber,
  composePhoneValue,
} from '@/lib/country-dials';
import { isValidInternationalPhone } from '@/lib/phone-validation';

describe('COUNTRIES — 외국인 핵심 국가 포함', () => {
  it('KR/US/CA(+1) 핵심국 존재 (데이터는 ISO 알파벳순)', () => {
    expect(findCountryByDial('82')?.code).toBe('KR'); // KR 존재(데이터는 ISO 알파벳순 — 첫번째 아님)
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


describe('전세계 데이터 확장 (~239국) — picker SSOT', () => {
  it('국가 수 ≥ 200 (전세계 정적 확장)', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(200);
  });
  it('모든 항목 4언어명 + dial(숫자) + ISO2 code 보유', () => {
    for (const c of COUNTRIES) {
      expect(/^[A-Z]{2}$/.test(c.code)).toBe(true);
      expect(/^\d{1,4}$/.test(c.dial)).toBe(true);
      expect(c.name.ko && c.name.en && c.name.ja && c.name.zh).toBeTruthy();
    }
  });
  it('flag 필드는 데이터에 없음 (flagOf 파생)', () => {
    // CountryDial 타입에서 flag 제거 — 런타임에도 미존재.
    expect((COUNTRIES[0] as Record<string, unknown>).flag).toBeUndefined();
  });
  it('핵심 타겟국 모두 존재 (KR/JP/CN/TW/HK/US/CA/VN/TH)', () => {
    for (const code of ['KR', 'JP', 'CN', 'TW', 'HK', 'US', 'CA', 'VN', 'TH']) {
      expect(COUNTRIES.some((c) => c.code === code)).toBe(true);
    }
  });
  it('중복 dial — +1 은 US 와 CA 둘 다 존재', () => {
    const ones = COUNTRIES.filter((c) => c.dial === '1').map((c) => c.code);
    expect(ones).toContain('US');
    expect(ones).toContain('CA');
  });
});

describe('PINNED_DIALS — 자주찾는 섹션', () => {
  it('8개 한국 타겟 dial (82/1/81/86/886/852/84/66)', () => {
    expect(PINNED_DIALS).toEqual(['82', '1', '81', '86', '886', '852', '84', '66']);
  });
  it('모든 PINNED dial 이 COUNTRIES 에서 매칭됨', () => {
    for (const d of PINNED_DIALS) {
      expect(findCountryByDial(d)).toBeDefined();
    }
  });
});

describe('flagOf — ISO2 → flag emoji 파생', () => {
  it('KR → 🇰🇷 (regional indicator surrogate pair)', () => {
    expect(flagOf('KR')).toBe('🇰🇷');
    expect(flagOf('kr')).toBe('🇰🇷'); // 소문자도 처리
  });
  it('US/JP 등 2자 코드', () => {
    expect(flagOf('US')).toBe('🇺🇸');
    expect(flagOf('JP')).toBe('🇯🇵');
  });
  it('잘못된 코드는 그대로 반환 (안전 fallback)', () => {
    expect(flagOf('')).toBe('');
    expect(flagOf('XYZ')).toBe('XYZ');
    expect(flagOf('1')).toBe('1');
  });
});

describe('en fallback — name[lang] 미존재 시 영문', () => {
  it('모든 국가 ja/zh 도 채워짐(ICU) — 비어도 en 폴백으로 표시 안전', () => {
    for (const c of COUNTRIES) {
      const shown = c.name.ja || c.name.en;
      expect(shown).toBeTruthy();
    }
  });
});

describe('parsePhoneValue — 200국 확장 round-trip + 함정', () => {
  it('공백 포함 emit 은 모든 dial 정확 역파싱 (US/CA/TW/한국 round-trip)', () => {
    const samples = [
      { dial: '82', nat: '01012345678' },
      { dial: '1', nat: '2025550123' },
      { dial: '886', nat: '912345678' },
      { dial: '84', nat: '0912345678' },
    ];
    for (const s of samples) {
      const v = composePhoneValue(s.dial, normalizeNationalNumber(s.nat, s.dial));
      const parsed = parsePhoneValue(v);
      // 공백 포함 emit → spaceMatch 로 dial 정확 복원.
      expect(parsed.dial).toBe(s.dial);
      const v2 = composePhoneValue(parsed.dial, normalizeNationalNumber(parsed.national, parsed.dial));
      expect(v2).toBe(v);
    }
  });
  it('공백 없는 구 raw "+11234567890" → dial 1 (US, 최장일치 3→2→1 안전)', () => {
    // 200국 확장 후에도 112/11 은 dial 아님 → 1 로 안착.
    expect(parsePhoneValue('+11234567890')).toEqual({ dial: '1', national: '1234567890' });
  });
  it('공백 없는 4자리 dial(바하마 1242) 은 표시만 dial=1 로 오추정 — 무해(설계 §5)', () => {
    // 공백 없는 외부 구 raw 에 한해 dial *표시*만 1 로 보임. 전체 숫자/게이트엔 무영향.
    const parsed = parsePhoneValue('+12421234567');
    expect(parsed.dial).toBe('1'); // 무공백 분기는 3자리까지만 — 문서화된 무해 edge.
    // 정상 emit(공백 포함)은 정확:
    expect(parsePhoneValue('+1242 1234567')).toEqual({ dial: '1242', national: '1234567' });
  });
  it('구 raw(국내형, + 없음) resume → dial="" (호출처 기본 dial 유지)', () => {
    expect(parsePhoneValue('01012345678')).toEqual({ dial: '', national: '01012345678' });
  });
});
