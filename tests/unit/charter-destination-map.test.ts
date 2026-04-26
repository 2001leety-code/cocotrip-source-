// destinationKeyMap — 한글/영문 입력 → 매트릭스 영문 키 매핑 회귀 방지
import { describe, it, expect } from 'vitest';
import {
  normalizeDestinationToMatrixKey,
  getMatrixKeyAlternatives,
  getDestinationSuggestions,
} from '../../src/components/charter/destinationKeyMap';

describe('normalizeDestinationToMatrixKey', () => {
  it('직접 한글 정확 매칭', () => {
    expect(normalizeDestinationToMatrixKey('단양')).toBe('DAMYANG');
    expect(normalizeDestinationToMatrixKey('담양')).toBe('DAMYANG');
    expect(normalizeDestinationToMatrixKey('경주')).toBe('GYEONGJU');
    expect(normalizeDestinationToMatrixKey('전주')).toBe('JEONJU');
    expect(normalizeDestinationToMatrixKey('부산')).toBe('BUSAN');
    expect(normalizeDestinationToMatrixKey('서울')).toBe('SEL_METRO');
    expect(normalizeDestinationToMatrixKey('강남')).toBe('SEL_GANGNAM');
    expect(normalizeDestinationToMatrixKey('잠실')).toBe('SEL_GANGNAM');
    expect(normalizeDestinationToMatrixKey('가평')).toBe('GAPYEONG');
    expect(normalizeDestinationToMatrixKey('남이섬')).toBe('GAPYEONG');
    expect(normalizeDestinationToMatrixKey('대구')).toBe('DAEGU');
    expect(normalizeDestinationToMatrixKey('대전')).toBe('DAEJEON');
    expect(normalizeDestinationToMatrixKey('안동')).toBe('ANDONG');
    expect(normalizeDestinationToMatrixKey('여수')).toBe('YEOSU');
    expect(normalizeDestinationToMatrixKey('해운대')).toBe('BUSAN');
  });

  it('영문/소문자 매칭', () => {
    expect(normalizeDestinationToMatrixKey('damyang')).toBe('DAMYANG');
    expect(normalizeDestinationToMatrixKey('Gyeongju')).toBe('GYEONGJU');
    expect(normalizeDestinationToMatrixKey('JEONJU')).toBe('JEONJU');
    expect(normalizeDestinationToMatrixKey('busan')).toBe('BUSAN');
    expect(normalizeDestinationToMatrixKey('haeundae')).toBe('BUSAN');
  });

  it('공백/하이픈/소문자 정규화', () => {
    expect(normalizeDestinationToMatrixKey('서울 시내')).toBe('SEL_METRO');
    expect(normalizeDestinationToMatrixKey(' 부산 ')).toBe('BUSAN');
    expect(normalizeDestinationToMatrixKey('seoul-metro')).toBe('SEL_METRO');
  });

  it('부분 매칭 — 라벨 포함', () => {
    // 1자는 오감지 방지로 null
    expect(normalizeDestinationToMatrixKey('단')).toBeNull();
    // 3자 이상 부분 매칭 (단, 모호한 prefix는 결과 비결정적이라 datalist가 가이드)
    expect(normalizeDestinationToMatrixKey('dan')).toBe('DAMYANG');
    expect(normalizeDestinationToMatrixKey('gyeongju')).toBe('GYEONGJU'); // 6자 명확
  });

  it('매트릭스 미존재 지역은 null 반환 (별도견적 분기)', () => {
    // 신규: 한국 시·군 전체 등록 — 광주/포항/창원도 라벨에는 있지만 matrixKey: null
    expect(normalizeDestinationToMatrixKey('광주')).toBeNull();
    expect(normalizeDestinationToMatrixKey('포항')).toBeNull();
    expect(normalizeDestinationToMatrixKey('창원')).toBeNull();
    expect(normalizeDestinationToMatrixKey('울릉도')).toBeNull();
    expect(normalizeDestinationToMatrixKey('알수없는지역')).toBeNull();
  });

  it('빈 문자열/널은 null', () => {
    expect(normalizeDestinationToMatrixKey('')).toBeNull();
    expect(normalizeDestinationToMatrixKey('   ')).toBeNull();
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
  it('빈 입력은 상위 50개 반환 (전체 시·군 사전 등록 기준)', () => {
    const all = getDestinationSuggestions('');
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(50);
  });

  it('"dan" 입력 시 단양/Damyang 포함', () => {
    const suggestions = getDestinationSuggestions('dan');
    const matrixKeys = suggestions.map(s => s.matrixKey);
    expect(matrixKeys).toContain('DAMYANG');
  });

  it('"부" 입력 시 부산 관련 포함', () => {
    const suggestions = getDestinationSuggestions('부');
    const matrixKeys = suggestions.map(s => s.matrixKey);
    expect(matrixKeys).toContain('BUSAN');
  });

  it('매트릭스 없는 도시도 자동완성에 포함 — 별도견적 안내', () => {
    const suggestions = getDestinationSuggestions('포항');
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some(s => s.matrixKey === null && s.display.includes('Pohang'))).toBe(true);
  });

  it('매칭 없으면 빈 배열', () => {
    const suggestions = getDestinationSuggestions('zzzznotreal');
    expect(suggestions).toEqual([]);
  });
});
