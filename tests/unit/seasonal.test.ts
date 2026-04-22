/**
 * 시즌 스팟 데이터 검증 테스트
 * - getCurrentSeason 월별 반환 검증
 * - 시즌 데이터 무결성 검증
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// 시즌 판별 로직
type Season = 'spring' | 'summer' | 'autumn' | 'winter';

function getCurrentSeason(date: Date = new Date()): Season {
  const month = date.getMonth() + 1; // 1-12
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

const SEASONAL_SPOTS: Record<Season, string[]> = {
  spring: ['여의도 벚꽃축제', '진해 군항제', '경주 보문단지'],
  summer: ['해운대 해수욕장', '제주도 만장굴', '남이섬'],
  autumn: ['내장산 단풍', '설악산 단풍', '경복궁 야간개장'],
  winter: ['용평 스키리조트', '화천 산천어축제', '에버랜드'],
};

describe('시즌 판별 로직', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('3-5월은 봄이다', () => {
    expect(getCurrentSeason(new Date('2026-03-15'))).toBe('spring');
    expect(getCurrentSeason(new Date('2026-04-01'))).toBe('spring');
    expect(getCurrentSeason(new Date('2026-05-31'))).toBe('spring');
  });

  it('6-8월은 여름이다', () => {
    expect(getCurrentSeason(new Date('2026-06-01'))).toBe('summer');
    expect(getCurrentSeason(new Date('2026-07-15'))).toBe('summer');
    expect(getCurrentSeason(new Date('2026-08-31'))).toBe('summer');
  });

  it('9-11월은 가을이다', () => {
    expect(getCurrentSeason(new Date('2026-09-01'))).toBe('autumn');
    expect(getCurrentSeason(new Date('2026-10-15'))).toBe('autumn');
    expect(getCurrentSeason(new Date('2026-11-30'))).toBe('autumn');
  });

  it('12-2월은 겨울이다', () => {
    expect(getCurrentSeason(new Date('2026-12-01'))).toBe('winter');
    expect(getCurrentSeason(new Date('2026-01-15'))).toBe('winter');
    expect(getCurrentSeason(new Date('2026-02-28'))).toBe('winter');
  });
});

describe('시즌별 추천 스팟', () => {
  it('모든 시즌에 3개 이상의 추천 스팟이 있다', () => {
    for (const [season, spots] of Object.entries(SEASONAL_SPOTS)) {
      expect(spots.length, `${season} 스팟 부족`).toBeGreaterThanOrEqual(3);
    }
  });

  it('모든 스팟 이름이 비어있지 않다', () => {
    for (const spots of Object.values(SEASONAL_SPOTS)) {
      for (const spot of spots) {
        expect(spot.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('중복 스팟이 없다', () => {
    const allSpots = Object.values(SEASONAL_SPOTS).flat();
    const uniqueSpots = new Set(allSpots);
    expect(uniqueSpots.size).toBe(allSpots.length);
  });
});