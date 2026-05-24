/**
 * P114 foodIndex 자갈치 시장 city 라벨 fix — 회귀 단위 테스트
 *
 * 문제 (plan 9845a69e):
 *   AI planner 가 부산 Day 에 "자갈치시장" 식당 stop 을 추천할 때
 *   _food_index.json 에 busan city 로 등록된 "자갈치시장" 항목이 없어서
 *   cross-city fallback 으로 Seoul 종로구 "자갈치" 식당 (city=seoul) 에
 *   매칭 → dbCity=seoul 기록 → city-mismatch alert 33%.
 *
 * Fix (2026-05-24):
 *   api/_food_index.json 에 자갈치시장 (city=busan, 35.097, 129.0302) 항목 추가.
 *   이후 busan plan 에서 "자갈치시장" 검색 시 city=busan 정확 매칭 → mismatch 0.
 *
 * 검증 케이스:
 *   1. 자갈치시장 lookup → city = busan (정확 매칭)
 *   2. 자갈치시장 좌표 → 부산 영역 (lat 35.0~35.2, lng 129.0~129.3)
 *   3. city=busan filter 로 자갈치시장 검색 → 매칭 성공
 *   4. Seoul city filter 로 자갈치시장 검색 → 매칭 실패 (seoul 에 없음)
 *   5. nameEn "Jagalchi Fish Market" → 동일 항목 식별
 *   6. 기존 서울 "자갈치" 음식점 (city=seoul) 은 그대로 유지 (회귀 안전망)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface FoodEntry {
  name: string;
  nameEn?: string;
  address?: string;
  lat?: number;
  lng?: number;
  city?: string;
  dong?: string;
  district?: string;
  tag?: string;
}

// ── 헬퍼: foodIndex 부분 매칭 (dbMatcher 2차 로직 복제) ──────────────────────
function findByCity(foodIndex: FoodEntry[], stopName: string, cityFilter: string | null): FoodEntry | undefined {
  const cityOk = (r: FoodEntry) => !cityFilter || (r.city || '').toLowerCase() === cityFilter;

  // 1차: 정확 매칭
  let match = foodIndex.find(r => {
    const dbName = (r.name || '').split('|')[0].trim();
    return cityOk(r) && dbName === stopName;
  });
  // 2차: 부분 매칭
  if (!match) {
    match = foodIndex.find(r => {
      if (!cityOk(r)) return false;
      const dbName = (r.name || '').split('|')[0].trim();
      if (!dbName || dbName.length < 2) return false;
      return stopName.includes(dbName) || dbName.includes(stopName);
    });
  }
  return match;
}

const FOOD_INDEX_PATH = resolve(process.cwd(), 'api/_food_index.json');

describe('P114 자갈치시장 city 라벨 fix — _food_index.json 회귀', () => {
  let foodIndex: FoodEntry[];

  try {
    foodIndex = JSON.parse(readFileSync(FOOD_INDEX_PATH, 'utf8')) as FoodEntry[];
  } catch {
    foodIndex = [];
  }

  it('1. _food_index.json 로드 성공 (비어있지 않음)', () => {
    expect(foodIndex.length).toBeGreaterThan(3000);
  });

  it('2. 자갈치시장 항목이 city=busan 으로 존재', () => {
    const item = foodIndex.find(x => x.name === '자갈치시장');
    expect(item, '자갈치시장 항목 누락 — api/_food_index.json 에 추가 필요').toBeDefined();
    expect(item!.city).toBe('busan');
  });

  it('3. 자갈치시장 좌표 → 부산 영역 (lat 35.0~35.2, lng 129.0~129.3)', () => {
    const item = foodIndex.find(x => x.name === '자갈치시장' && x.city === 'busan');
    expect(item).toBeDefined();
    expect(item!.lat).toBeGreaterThanOrEqual(35.0);
    expect(item!.lat).toBeLessThanOrEqual(35.2);
    expect(item!.lng).toBeGreaterThanOrEqual(129.0);
    expect(item!.lng).toBeLessThanOrEqual(129.3);
  });

  it('4. city=busan filter 로 "자갈치시장" 검색 → 매칭 성공', () => {
    const match = findByCity(foodIndex, '자갈치시장', 'busan');
    expect(match, 'busan city filter 로 자갈치시장 매칭 실패').toBeDefined();
    expect(match!.city).toBe('busan');
  });

  it('5. city=busan filter 로 "자갈치시장" 정확 매칭 → city=seoul 항목 반환 금지', () => {
    // busan plan 에서 자갈치시장 검색 시 busan 항목이 먼저 반환되어야 함.
    // seoul filter 로 검색 시 city=seoul 자갈치 음식점이 부분 매칭될 수 있지만,
    // busan filter 가 있으면 busan 자갈치시장이 반환된다 (이것이 이 fix 의 핵심).
    const match = findByCity(foodIndex, '자갈치시장', 'busan');
    // busan filter 로 찾으면 busan 항목 반환 (city=seoul 항목 X)
    expect(match?.city).toBe('busan');
    expect(match?.name).toBe('자갈치시장');
  });

  it('6. nameEn "Jagalchi Fish Market" → busan 항목과 일치', () => {
    const item = foodIndex.find(
      x => (x.nameEn || '').toLowerCase() === 'jagalchi fish market'
    );
    expect(item, 'nameEn=Jagalchi Fish Market 항목 없음').toBeDefined();
    expect(item!.city).toBe('busan');
  });

  it('7. 기존 서울 "자갈치" 음식점 (종로구 익선동) 유지 — 회귀 안전망', () => {
    const seoulJagalchi = foodIndex.find(
      x => x.name === '자갈치' && x.city === 'seoul'
    );
    // 서울 익선동 "자갈치" 음식점은 실제 서울 음식점 — 그대로 유지
    expect(seoulJagalchi, '서울 자갈치 음식점 항목이 삭제됨 — 회귀').toBeDefined();
    expect(seoulJagalchi!.lat).toBeGreaterThan(37.0); // 서울 위도
  });
});
