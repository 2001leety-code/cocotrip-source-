import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — ESM .js in api/, no type decls
import { matchFoodPlaceholder } from '../../api/_ai_core/blockMode.js';

// 2026-06-10: block_mode plan(550fb532) Day3 식당이 동선 밖(대학로·잠실)으로 채워진 원인 =
// matchFoodPlaceholder 근접 가중(score=base/(1+dist/DECAY))이 placeholderStop.lat/lng 앵커를
// 요구하는데, seed 블록 food placeholder 는 좌표가 없어 hasAnchor=false → 평점만으로 도시
// 전체 1등(=먼 식당) 선택. fix = expandBlocksToItinerary 가 직전 명소 좌표를 앵커로 주입.
// 본 테스트: 앵커가 있으면 먼 고평점 식당 대신 가까운 식당을 고른다 + SAFETY(dietRequired) 불변.

const FOOD = [
  // 잠실(먼 곳) 고평점 — 앵커 없으면 이게 뽑힘
  { name: '잠실맛집', city: 'seoul', lat: 37.513, lng: 127.1, rating: 4.9, reviewCount: 5000, cuisine: 'korean', dietary_tags: [] },
  // 종로(조계사 근처) 평점 낮음 — 앵커 있으면 이게 뽑혀야
  { name: '종로맛집', city: 'seoul', lat: 37.574, lng: 126.982, rating: 4.6, reviewCount: 800, cuisine: 'korean', dietary_tags: [] },
  // 종로 근처 할랄 — 할랄 손님 SAFETY 케이스용
  { name: '종로할랄', city: 'seoul', lat: 37.575, lng: 126.983, rating: 4.3, reviewCount: 300, cuisine: 'korean', dietary_tags: ['halal'] },
];

const JONGNO = { lat: 37.574, lng: 126.981 }; // 조계사 근처 앵커

describe('block 식당 placeholder 근접 앵커', () => {
  it('앵커 없으면 도시 전체 고평점(먼 잠실) 선택 = 기존 버그 재현', () => {
    const m = matchFoodPlaceholder({ placeholder: 'verified_lunch', category: 'food' }, FOOD, 'seoul');
    expect(m?.name).toBe('잠실맛집');
  });

  it('앵커(조계사) 주입하면 가까운 종로 식당 선택 = fix', () => {
    const m = matchFoodPlaceholder(
      { placeholder: 'verified_lunch', category: 'food', lat: JONGNO.lat, lng: JONGNO.lng },
      FOOD,
      'seoul',
    );
    expect(m?.name).toBe('종로맛집');
  });

  it('SAFETY: 할랄 손님은 앵커 무관하게 할랄 식당만 (dietRequired 불변)', () => {
    // 앵커가 종로맛집(비할랄)에 더 가까워도, 할랄 필터가 비할랄을 hard-reject 해야.
    const m = matchFoodPlaceholder(
      { placeholder: 'verified_lunch', category: 'food', lat: JONGNO.lat, lng: JONGNO.lng },
      FOOD,
      'seoul',
      ['halal'],
    );
    expect(m?.name).toBe('종로할랄');
    expect(m?.dietary_tags).toContain('halal');
  });
});

// expandBlocksToItinerary 가 앵커를 실제로 wiring 하는지 소스 잠금 — un-anchored 호출로 회귀 금지.
const BLOCKMODE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../api/_ai_core/blockMode.js'),
  'utf8',
);
describe('blockMode 앵커 wiring 락', () => {
  it('단도시·다도시 expand 둘 다 anchorBs 사용 (호출부 2개 모두)', () => {
    // 2026-06-10 교훈: 단도시 expandBlocksToItinerary 만 고치고 다도시
    //   expandBlocksToItineraryMultiCity(L1382, 서울+부산 plan) 누락 → prod 식당 여전히 멂.
    //   matchFoodPlaceholder 호출 2개(단/다도시) 전부 anchorBs 여야 한다.
    const anchored = (BLOCKMODE_SRC.match(/matchFoodPlaceholder\(anchorBs,/g) || []).length;
    expect(anchored, '앵커된 matchFoodPlaceholder 호출이 2개 미만').toBeGreaterThanOrEqual(2);
    // un-anchored 호출(matchFoodPlaceholder(bs,) 직접)이 남아있으면 회귀.
    const unanchored = (BLOCKMODE_SRC.match(/matchFoodPlaceholder\(bs,/g) || []).length;
    expect(unanchored, 'un-anchored matchFoodPlaceholder(bs, ...) 잔존').toBe(0);
    expect(BLOCKMODE_SRC).toMatch(/lastAnchorLat/);
  });
});
