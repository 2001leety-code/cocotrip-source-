/**
 * matchFoodPlaceholder — seed preferred_dietary soft relax (2026-06-05)
 *
 * 운영자 "플랜 완성도 99%" → prod plan b6b2fd9b Day5 에 "[추천 verified_lunch - 부산광역시 사하구]"
 *   placeholder (사용자엔 "이름 빠진 가게"). 로컬 재현으로 근본 원인 확정:
 *   - foodIndex 에 부산 식당 323개 존재 (DB 갭 아님).
 *   - 그러나 seed 블록 stop 의 preferred_dietary(vegetarian 등)가 323개를 0 으로 필터 → null → placeholder.
 *
 * 핵심 구분:
 *   - dietRequired (사용자 실제 식이, userDietPrefs) = SAFETY-CRITICAL (CLAUDE.md J) → 절대 relax 금지.
 *   - preferred (seed 블록의 soft 힌트, placeholderStop.preferred_dietary) → 후보 0 이면 relax
 *     (실제 식당 추천이 placeholder 보다 나음). SAFETY 는 dietRequired 가 이미 보존.
 */
import { describe, it, expect } from 'vitest';
import { matchFoodPlaceholder } from '../../api/_ai_core/blockMode.js';

// 합성 foodIndex (부산): 일반 2 + 비건/베지 1. 좌표 없음 → base score 정렬.
const FOOD = [
  { name: '부산일반A', city: 'busan', cuisine: 'korean', rating: 4.6, reviewCount: 100, dietary_tags: [] },
  { name: '부산일반B', city: 'busan', cuisine: 'korean', rating: 4.8, reviewCount: 300, dietary_tags: [] }, // 최고 score
  { name: '부산비건C', city: 'busan', cuisine: 'vegan', rating: 4.5, reviewCount: 80, dietary_tags: ['vegan', 'vegetarian'] },
];
const nameOf = (r: { name?: string } | null) => (r ? r.name : null);

describe('matchFoodPlaceholder — seed preferred_dietary relax (placeholder 회피)', () => {
  it('preferred 가 0 후보 → relax → 실제 식당 반환 (null/placeholder 아님)', () => {
    // halal 태그 식당 없음 → 옛 동작은 null(placeholder) → 신 동작은 최고 score 일반식당.
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch', preferred_dietary: ['halal'] }, FOOD, 'busan', [], new Set());
    expect(r, 'preferred 못 맞춰도 실제 식당 반환돼야 함 (placeholder 회피)').not.toBeNull();
    expect(nameOf(r)).toBe('부산일반B'); // 최고 score
  });

  it('preferred 맞출 수 있으면 우선 (relax 아님)', () => {
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch', preferred_dietary: ['vegetarian'] }, FOOD, 'busan', [], new Set());
    expect(nameOf(r), 'vegetarian 태그 있는 식당 우선').toBe('부산비건C');
  });

  it('preferred 없으면 기존대로 최고 score (회귀 0)', () => {
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch' }, FOOD, 'busan', [], new Set());
    expect(nameOf(r)).toBe('부산일반B');
  });

  // ── SAFETY-CRITICAL: 사용자 실제 식이(dietRequired)는 절대 relax 안 됨 ──
  it('SAFETY: 사용자=vegan → vegan 식당만 (relax 안 함)', () => {
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch' }, FOOD, 'busan', ['vegan'], new Set());
    expect(nameOf(r), 'vegan 사용자에겐 vegan 식당만').toBe('부산비건C');
  });

  it('SAFETY: 사용자=halal + halal 식당 0 → NULL (placeholder/임의식당 금지 → legacy fallback)', () => {
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch' }, FOOD, 'busan', ['halal'], new Set());
    expect(r, 'halal 못 맞추면 NULL (caller 가 throw → legacy)').toBeNull();
  });

  it('SAFETY + preferred 동시: 사용자=vegan(보존) + seed preferred=halal(relax) → vegan 식당', () => {
    // safetyCandidates = [부산비건C] (vegan). preferred=halal 은 C 에 없음 → relax → C 유지 (vegan 보존).
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch', preferred_dietary: ['halal'] }, FOOD, 'busan', ['vegan'], new Set());
    expect(nameOf(r), 'vegan(SAFETY) 보존 + halal(soft) relax').toBe('부산비건C');
  });

  it('city 후보 0 → NULL (도시 매칭 SAFETY)', () => {
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch', preferred_dietary: ['vegan'] }, FOOD, 'jeju', [], new Set());
    expect(r, 'jeju 식당 없음 → NULL').toBeNull();
  });
});

// 좌표-city 정합 필터 (2026-06-05) — foodIndex 오태깅(서울 식당 city=busan) 배제.
//   prod plan 0a02b686 Day5 부산 day 에 "한국이슬람교 서울중앙성원"(서울 모스크, city=busan 오태깅,
//   reviewCount 4686 최고점) 노출 → 지리 파탄. 좌표가 도시 centroid 70km+ 면 배제.
describe('matchFoodPlaceholder — 좌표-city 정합 필터 (오태깅 배제)', () => {
  const COORD_FOOD = [
    { name: '진짜부산식당', city: 'busan', cuisine: 'korean', rating: 4.6, reviewCount: 100, dietary_tags: [], lat: 35.10, lng: 129.03 }, // 부산 중구 (정합)
    { name: '오태깅서울모스크', city: 'busan', cuisine: 'halal', rating: 4.9, reviewCount: 9999, dietary_tags: ['halal'], lat: 37.53, lng: 126.99 }, // 서울 좌표 (오태깅, 최고점)
  ];

  it('오태깅(좌표 320km+) 고평점 entry 배제 → 실제 부산 식당 반환', () => {
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch' }, COORD_FOOD, 'busan', [], new Set());
    expect(r?.name, '서울 좌표 오태깅 entry 가 부산 day 에 안 나와야 함').toBe('진짜부산식당');
  });

  it('halal preferred 여도 오태깅 모스크 배제 (좌표 우선)', () => {
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch', preferred_dietary: ['halal'] }, COORD_FOOD, 'busan', [], new Set());
    // halal 태그는 오태깅 모스크만 있지만 좌표로 배제 → relax → 진짜부산식당.
    expect(r?.name).toBe('진짜부산식당');
  });

  it('좌표 없는 entry 는 graceful 통과 (필터 미적용)', () => {
    const noCoord = [{ name: '좌표없음식당', city: 'busan', cuisine: 'korean', rating: 4.7, reviewCount: 200, dietary_tags: [] }];
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch' }, noCoord, 'busan', [], new Set());
    expect(r?.name).toBe('좌표없음식당');
  });

  it('정합 도시권 내 entry 는 보존 (false 배제 0)', () => {
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch' }, [COORD_FOOD[0]], 'busan', [], new Set());
    expect(r?.name, '부산 중구 좌표는 정합 → 보존').toBe('진짜부산식당');
  });
});
