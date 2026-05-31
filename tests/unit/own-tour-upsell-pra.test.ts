/**
 * PR-A: 자사 투어 업셀 매칭 유닛 테스트
 * 검증 대상: getMatchedOwnTours() in src/data/tours.ts
 *
 * 3 시나리오:
 *   1. stop 이름 겹침 >= 2 → 해당 투어 반환
 *   2. stop 겹침 < 2 + region 이름 일치 → region 폴백 반환
 *   3. 매칭 0 → 빈 배열
 */
import { describe, it, expect } from 'vitest';
import { getMatchedOwnTours } from '../../src/data/tours';

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 1: stop 이름 겹침 >= 2
// 서울 시티투어(tour-seoul-city) stops에 '경복궁', '북촌한옥마을' 존재
// ─────────────────────────────────────────────────────────────────────────────
describe('getMatchedOwnTours — 시나리오 1: stop 이름 겹침 >= 2', () => {
  it('경복궁 + 북촌한옥마을 → 서울 시티투어 매칭', () => {
    const placeNames = ['경복궁', '북촌한옥마을', '명동'];
    const result = getMatchedOwnTours(placeNames, '서울');

    expect(result.length).toBeGreaterThan(0);
    const ids = result.map(t => t.id);
    expect(ids).toContain('tour-seoul-city');
  });

  it('겹침 >= 2 이면 region 폴백보다 stop-match 결과를 반환', () => {
    // 경복궁(stop) + 광장시장(stop) — 두 곳 모두 서울 시티투어 stops 에 존재
    const placeNames = ['경복궁', '광장시장', '해운대'];
    const result = getMatchedOwnTours(placeNames, '부산', 2);

    // stop 겹침 2 이므로 region '부산' 폴백 아닌 서울 시티투어 반환
    const ids = result.map(t => t.id);
    expect(ids).toContain('tour-seoul-city');
  });

  it('겹침 1 (임계값 2 미달) → stop-match 0건 → region 폴백', () => {
    const placeNames = ['경복궁', '해운대', '감천문화마을'];
    // '경복궁' 1건만 서울 시티투어 stops에 겹침 → 임계값 2 미달
    // region '부산' 폴백 투어를 반환해야 함
    const result = getMatchedOwnTours(placeNames, '부산', 2);
    const ids = result.map(t => t.id);
    expect(ids).toContain('tour-busan-day');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 2: stop 겹침 0 → region 폴백
// ─────────────────────────────────────────────────────────────────────────────
describe('getMatchedOwnTours — 시나리오 2: region 폴백', () => {
  it('stop 겹침 없음 + region=Seoul → 서울 투어 반환', () => {
    const placeNames = ['아무데나거리', '판교', '용산'];
    const result = getMatchedOwnTours(placeNames, 'Seoul');

    expect(result.length).toBeGreaterThan(0);
    const regions = result.map(t => t.region.toLowerCase());
    // 반환된 투어 전부 Seoul region 이어야 함
    expect(regions.every(r => r.includes('seoul'))).toBe(true);
  });

  it('stop 겹침 없음 + region=Busan → 부산 투어 반환', () => {
    const placeNames = ['랜덤장소1', '랜덤장소2'];
    const result = getMatchedOwnTours(placeNames, 'Busan');

    const ids = result.map(t => t.id);
    expect(ids).toContain('tour-busan-day');
  });

  it('stop 겹침 없음 + region=Gyeongju → 경주 투어 반환', () => {
    const placeNames = ['랜덤장소A'];
    const result = getMatchedOwnTours(placeNames, 'Gyeongju');

    const ids = result.map(t => t.id);
    expect(ids).toContain('tour-gyeongju');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 시나리오 3: 매칭 0 → 빈 배열
// ─────────────────────────────────────────────────────────────────────────────
describe('getMatchedOwnTours — 시나리오 3: 매칭 0 → 빈 배열', () => {
  it('완전히 알 수 없는 region + stop 겹침 없음 → 빈 배열', () => {
    const placeNames = ['존재하지않는장소X', '존재하지않는장소Y'];
    const result = getMatchedOwnTours(placeNames, 'UnknownCity999');

    expect(result).toEqual([]);
  });

  it('빈 플레이스 목록 + 알 수 없는 region → 빈 배열', () => {
    const result = getMatchedOwnTours([], 'NoneExistent');
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 추가: 공백 정규화 (띄어쓰기 차이 무시)
// ─────────────────────────────────────────────────────────────────────────────
describe('getMatchedOwnTours — 공백 정규화', () => {
  it('stop 이름 공백 차이 무시: "경복 궁" → 정규화 후 "경복궁" 매칭', () => {
    // 공백 포함 이름도 정규화되어야 함
    const placeNames = ['경복 궁', '북촌 한옥마을'];
    const result = getMatchedOwnTours(placeNames, '서울');

    const ids = result.map(t => t.id);
    expect(ids).toContain('tour-seoul-city');
  });
});
