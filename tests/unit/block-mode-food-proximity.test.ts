/**
 * matchFoodPlaceholder 근접 가중 회귀 가드 (2026-06-02, plan b720d6db/9c0c2eaa 운영자 "동선 이상").
 *
 * 버그: food placeholder 가 도시(seoul/jeju) 전체에서 평점 1등만 골라 → 종로 코스에 강남 식당,
 *      제주 서쪽 클러스터에 동쪽 끝 식당이 박혀 동선이 지역을 널뛰기. (PR #760 후속 "③거리필터".)
 *      추가로 food_index 필드는 reviewCount 인데 코드가 r.reviews 를 봐서 rating 가중치가 죽어
 *      사실상 배열순 선택이었음.
 * fix: placeholder 앵커 좌표(빌드 시 geocoding)에서 가까울수록 가산 (score = base/(1+dist/DECAY)),
 *      reviewCount 로 가중치 복구. 앵커/후보 좌표 0·누락 시 base 만 = 현행 폴백(회귀 0).
 */
import { describe, it, expect } from 'vitest';
import { matchFoodPlaceholder } from '../../api/_ai_core/blockMode.js';

// 강남 베이글 = 멀지만 평점/리뷰 최강 (실제 plan b720d6db 에서 종로 코스에 박혔던 venue 재현).
const GANGNAM = { name: '강남 베이글', city: 'seoul', cuisine: 'Dessert', rating: 5, reviewCount: 2602, lat: 37.5025, lng: 127.0264, dietary_tags: [] };
// 종로 카페 = 앵커(인사동) 근처, 평점은 조금 낮음.
const JONGNO = { name: '종로 카페', city: 'seoul', cuisine: 'Cafe', rating: 4.5, reviewCount: 500, lat: 37.575, lng: 126.985, dietary_tags: [] };
const seoulCafes = [GANGNAM, JONGNO];

// 제주: 서쪽(협재) 점심 vs 동쪽 끝(구좌) 보말칼국수 (실제 plan 9c0c2eaa Day5 재현).
const JEJU_WEST = { name: '협재 점심', city: 'jeju', cuisine: 'Korean', rating: 4.3, reviewCount: 300, lat: 33.39, lng: 126.25, dietary_tags: [] };
const JEJU_EAST = { name: '보말칼국수 명진전복', city: 'jeju', cuisine: 'Korean', rating: 4.9, reviewCount: 1000, lat: 33.53, lng: 126.85, dietary_tags: [] };
const jejuLunch = [JEJU_EAST, JEJU_WEST]; // 동쪽을 배열 앞에 (배열순 폴백이면 동쪽이 뽑히도록)

describe('matchFoodPlaceholder 근접 가중 (동선 zigzag fix)', () => {
  it('앵커(종로) 가까운 식당 선택 — 멀리 있는 평점 1등(강남)보다 우선', () => {
    const m = matchFoodPlaceholder({ placeholder: 'verified_cafe', lat: 37.5717, lng: 126.9858 }, seoulCafes, 'seoul', [], new Set());
    expect(m?.name).toBe('종로 카페'); // 강남 베이글(평점↑) 아님
  });

  it('제주 서쪽 앵커 → 서쪽 식당, 섬 반대편(동쪽) 평점 1등 배제', () => {
    const m = matchFoodPlaceholder({ placeholder: 'verified_lunch', lat: 33.39, lng: 126.24 }, jejuLunch, 'jeju', [], new Set());
    expect(m?.name).toBe('협재 점심');
  });

  it('앵커 좌표 없음 → 현행 폴백(평점×log(reviewCount) 1등 = 강남)', () => {
    const m = matchFoodPlaceholder({ placeholder: 'verified_cafe' }, seoulCafes, 'seoul', [], new Set());
    expect(m?.name).toBe('강남 베이글');
  });

  it('앵커 좌표 0,0 → 폴백(앵커 없음과 동일)', () => {
    const m = matchFoodPlaceholder({ placeholder: 'verified_cafe', lat: 0, lng: 0 }, seoulCafes, 'seoul', [], new Set());
    expect(m?.name).toBe('강남 베이글');
  });

  it('reviewCount 로 가중치 복구 — 앵커 없을 때 reviewCount 높은 쪽이 base 우위', () => {
    // 좌표 동일(거리 무관)인 두 식당: reviewCount 큰 쪽이 선택돼야 (기존 r.reviews 버그면 배열순).
    const a = { name: '리뷰많음', city: 'seoul', cuisine: 'Korean', rating: 4.5, reviewCount: 5000, lat: 37.5, lng: 127.0 };
    const b = { name: '리뷰적음', city: 'seoul', cuisine: 'Korean', rating: 4.5, reviewCount: 10, lat: 37.5, lng: 127.0 };
    const m = matchFoodPlaceholder({ placeholder: 'verified_lunch' }, [b, a], 'seoul', [], new Set());
    expect(m?.name).toBe('리뷰많음');
  });

  it('후보 좌표 누락 → crash 없이 멀리 취급(앵커 있을 때 좌표 있는 근처 후보 우선)', () => {
    const noCoord = { name: '좌표없음', city: 'seoul', cuisine: 'Cafe', rating: 5, reviewCount: 9999 };
    const m = matchFoodPlaceholder({ placeholder: 'verified_cafe', lat: 37.575, lng: 126.985 }, [noCoord, JONGNO], 'seoul', [], new Set());
    expect(m?.name).toBe('종로 카페'); // 좌표 있는 근처 후보가 좌표없는 평점왕보다 우선
  });

  it('excludeNames + 근접 — 가까운 1순위가 제외되면 차순위 반환(여전히 동작)', () => {
    const m = matchFoodPlaceholder({ placeholder: 'verified_cafe', lat: 37.5717, lng: 126.9858 }, seoulCafes, 'seoul', [], new Set(['종로 카페']));
    expect(m?.name).toBe('강남 베이글'); // 근처 1순위 제외 → 차순위
  });

  it('dietary 필터는 근접보다 우선 (SAFETY) — halal 태그 없는 근처 식당 배제', () => {
    const halalFar = { name: '할랄 식당(먼곳)', city: 'seoul', cuisine: 'Korean', rating: 4, reviewCount: 100, lat: 37.6, lng: 127.1, dietary_tags: ['halal'] };
    const nearNoHalal = { name: '근처 일반식당', city: 'seoul', cuisine: 'Korean', rating: 5, reviewCount: 2000, lat: 37.5717, lng: 126.9858, dietary_tags: [] };
    const m = matchFoodPlaceholder({ placeholder: 'verified_lunch', lat: 37.5717, lng: 126.9858 }, [nearNoHalal, halalFar], 'seoul', ['halal'], new Set());
    expect(m?.name).toBe('할랄 식당(먼곳)'); // 근처여도 halal 아니면 배제, 먼 halal 선택
  });
});
