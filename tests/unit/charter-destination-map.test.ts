// destinationKeyMap — 한글/영문 입력 → 매트릭스 영문 키 매핑 + 권역 분류 회귀 방지
import { describe, it, expect } from 'vitest';
import {
  normalizeDestinationToMatrixKey,
  getMatrixKeyAlternatives,
  getDestinationSuggestions,
  getZoneForInput,
  getZoneForMatrixKey,
  ZONE_DEFAULTS,
} from '../../src/components/charter/destinationKeyMap';

describe('normalizeDestinationToMatrixKey', () => {
  it('매트릭스 21개 키 정확 매칭', () => {
    expect(normalizeDestinationToMatrixKey('서울')).toBe('SEL_METRO');
    expect(normalizeDestinationToMatrixKey('강남')).toBe('SEL_GANGNAM');
    expect(normalizeDestinationToMatrixKey('부산')).toBe('BUSAN');
    expect(normalizeDestinationToMatrixKey('해운대')).toBe('BUSAN');
    expect(normalizeDestinationToMatrixKey('경주')).toBe('GYEONGJU');
    expect(normalizeDestinationToMatrixKey('전주')).toBe('JEONJU');
    expect(normalizeDestinationToMatrixKey('여수')).toBe('YEOSU');
    expect(normalizeDestinationToMatrixKey('담양')).toBe('DAMYANG');  // 전남 담양 = 매트릭스 키
    expect(normalizeDestinationToMatrixKey('대구')).toBe('DAEGU');
    expect(normalizeDestinationToMatrixKey('대전')).toBe('DAEJEON');
    expect(normalizeDestinationToMatrixKey('안동')).toBe('ANDONG');
    expect(normalizeDestinationToMatrixKey('가평')).toBe('GAPYEONG');
    expect(normalizeDestinationToMatrixKey('남이섬')).toBe('GAPYEONG');
    expect(normalizeDestinationToMatrixKey('수원')).toBe('SUWON');
    expect(normalizeDestinationToMatrixKey('강릉')).toBe('GANGNEUNG');
    expect(normalizeDestinationToMatrixKey('춘천')).toBe('CHUNCHEON');
    expect(normalizeDestinationToMatrixKey('속초')).toBe('SOKCHO');
    expect(normalizeDestinationToMatrixKey('평창')).toBe('PYEONGCHANG');
    expect(normalizeDestinationToMatrixKey('제주')).toBe('JEJU_METRO');
  });

  it('단양(충북) vs 담양(전남) 구분 — 단양은 매트릭스 미존재', () => {
    expect(normalizeDestinationToMatrixKey('단양')).toBeNull();   // 충북 — zone fallback
    expect(normalizeDestinationToMatrixKey('담양')).toBe('DAMYANG'); // 전남 — 매트릭스
  });

  it('영문/대소문자 정규화', () => {
    expect(normalizeDestinationToMatrixKey('Gyeongju')).toBe('GYEONGJU');
    expect(normalizeDestinationToMatrixKey('JEONJU')).toBe('JEONJU');
    expect(normalizeDestinationToMatrixKey('busan')).toBe('BUSAN');
    expect(normalizeDestinationToMatrixKey('haeundae')).toBe('BUSAN');
  });

  it('공백/하이픈 정규화', () => {
    expect(normalizeDestinationToMatrixKey('서울 시내')).toBe('SEL_METRO');
    expect(normalizeDestinationToMatrixKey(' 부산 ')).toBe('BUSAN');
    expect(normalizeDestinationToMatrixKey('seoul-metro')).toBe('SEL_METRO');
  });

  it('1자 입력은 오감지 방지로 null', () => {
    expect(normalizeDestinationToMatrixKey('단')).toBeNull();
  });

  it('완전 일치 영문 키워드는 매트릭스 매핑', () => {
    expect(normalizeDestinationToMatrixKey('gyeongju')).toBe('GYEONGJU');
  });

  it('매트릭스 미존재 — null 반환 (zone fallback 또는 별도견적)', () => {
    expect(normalizeDestinationToMatrixKey('포항')).toBeNull();
    expect(normalizeDestinationToMatrixKey('창원')).toBeNull();
    expect(normalizeDestinationToMatrixKey('광주')).toBeNull();
    expect(normalizeDestinationToMatrixKey('울릉도')).toBeNull();
    expect(normalizeDestinationToMatrixKey('알수없는지역')).toBeNull();
  });

  it('빈 문자열/공백은 null', () => {
    expect(normalizeDestinationToMatrixKey('')).toBeNull();
    expect(normalizeDestinationToMatrixKey('   ')).toBeNull();
  });
});

describe('getZoneForInput — 권역 분류', () => {
  it('매트릭스 도시도 zone 반환', () => {
    expect(getZoneForInput('서울')).toBe('capital');
    expect(getZoneForInput('부산')).toBe('yeongnam');
    expect(getZoneForInput('경주')).toBe('yeongnam');
    expect(getZoneForInput('전주')).toBe('honam');
    expect(getZoneForInput('여수')).toBe('honam');
    expect(getZoneForInput('강릉')).toBe('gangwon');
    expect(getZoneForInput('대전')).toBe('chungcheong');
    expect(getZoneForInput('제주')).toBe('jeju');
  });

  it('매트릭스 미존재 도시도 zone 반환 (fallback 가능)', () => {
    expect(getZoneForInput('포항')).toBe('yeongnam');
    expect(getZoneForInput('창원')).toBe('yeongnam');
    expect(getZoneForInput('광주')).toBe('honam');
    expect(getZoneForInput('울산')).toBe('yeongnam');
    expect(getZoneForInput('인천')).toBe('capital');
    expect(getZoneForInput('성남')).toBe('capital');
    expect(getZoneForInput('단양')).toBe('chungcheong');
    expect(getZoneForInput('원주')).toBe('gangwon');
    expect(getZoneForInput('순천')).toBe('honam');
    expect(getZoneForInput('통영')).toBe('yeongnam');
  });

  it('알 수 없는 입력은 null', () => {
    expect(getZoneForInput('알수없음')).toBeNull();
    expect(getZoneForInput('')).toBeNull();
  });
});

describe('getZoneForMatrixKey', () => {
  it('매트릭스 키 → zone', () => {
    expect(getZoneForMatrixKey('SEL_METRO')).toBe('capital');
    expect(getZoneForMatrixKey('SEL_GANGNAM')).toBe('capital');
    expect(getZoneForMatrixKey('BUSAN')).toBe('yeongnam');
    expect(getZoneForMatrixKey('GYEONGJU')).toBe('yeongnam');
    expect(getZoneForMatrixKey('JEONJU')).toBe('honam');
    expect(getZoneForMatrixKey('YEOSU')).toBe('honam');
    expect(getZoneForMatrixKey('DAMYANG')).toBe('honam'); // 전남
    expect(getZoneForMatrixKey('GANGNEUNG')).toBe('gangwon');
    expect(getZoneForMatrixKey('DAEJEON')).toBe('chungcheong');
    expect(getZoneForMatrixKey('JEJU_METRO')).toBe('jeju');
  });

  it('알 수 없는 매트릭스 키는 null', () => {
    expect(getZoneForMatrixKey('UNKNOWN')).toBeNull();
  });
});

describe('ZONE_DEFAULTS — 권역 평균 km/hours', () => {
  it('5권역 + 제주 (전체 6) 정의됨', () => {
    expect(ZONE_DEFAULTS.capital.km).toBe(50);
    expect(ZONE_DEFAULTS.chungcheong.km).toBe(200);
    expect(ZONE_DEFAULTS.gangwon.km).toBe(250);
    expect(ZONE_DEFAULTS.honam.km).toBe(370);
    expect(ZONE_DEFAULTS.yeongnam.km).toBe(420);
    expect(ZONE_DEFAULTS.jeju.km).toBe(0); // 도선료 별도
  });
});

describe('getMatrixKeyAlternatives — METRO ↔ city 키 fallback', () => {
  it('BUSAN ↔ BUS_METRO 양방향', () => {
    expect(getMatrixKeyAlternatives('BUSAN')).toEqual(['BUSAN', 'BUS_METRO']);
    expect(getMatrixKeyAlternatives('BUS_METRO')).toEqual(['BUS_METRO', 'BUSAN']);
  });

  it('대체 키 없으면 입력만 반환', () => {
    expect(getMatrixKeyAlternatives('DAMYANG')).toEqual(['DAMYANG']);
    expect(getMatrixKeyAlternatives('GYEONGJU')).toEqual(['GYEONGJU']);
  });
});

describe('getDestinationSuggestions — 자동완성 후보', () => {
  it('빈 입력은 상위 50개 반환', () => {
    const all = getDestinationSuggestions('');
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(50);
  });

  it('"부" 입력 시 부산 관련 포함', () => {
    const suggestions = getDestinationSuggestions('부');
    const matrixKeys = suggestions.map(s => s.matrixKey);
    expect(matrixKeys).toContain('BUSAN');
  });

  it('매트릭스 없는 도시도 자동완성에 포함 + zone 표시', () => {
    const suggestions = getDestinationSuggestions('포항');
    expect(suggestions.length).toBeGreaterThan(0);
    const pohang = suggestions.find(s => s.display.includes('Pohang'));
    expect(pohang).toBeDefined();
    expect(pohang?.matrixKey).toBeNull();
    expect(pohang?.zone).toBe('yeongnam');
  });

  it('매칭 없으면 빈 배열', () => {
    const suggestions = getDestinationSuggestions('zzzznotreal');
    expect(suggestions).toEqual([]);
  });
});
