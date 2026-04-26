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
    // "danyang" 일부만 입력
    expect(normalizeDestinationToMatrixKey('단')).toBeNull(); // 1자는 매칭 X (오감지 방지)
    expect(normalizeDestinationToMatrixKey('dan')).toBe('DAMYANG'); // 3자 이상 부분 매칭
    expect(normalizeDestinationToMatrixKey('gyeong')).toBe('GYEONGJU');
  });

  it('매트릭스 미존재 지역은 null 반환 (별도견적 분기)', () => {
    expect(normalizeDestinationToMatrixKey('광주')).toBeNull();
    expect(normalizeDestinationToMatrixKey('포항')).toBeNull();
    expect(normalizeDestinationToMatrixKey('창원')).toBeNull();
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
  it('빈 입력은 상위 30개 반환', () => {
    const all = getDestinationSuggestions('');
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(30);
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

  it('매칭 없으면 빈 배열', () => {
    const suggestions = getDestinationSuggestions('zzzznotreal');
    expect(suggestions).toEqual([]);
  });
});
