/**
 * 5/25 sweep chore — src/data/tour-external-ids.ts 삭제 후 regression.
 *
 * 배경:
 *   tour-external-ids.ts 는 TOUR_EXTERNAL_IDS 객체가 전량 주석 처리된 빈 파일이었음.
 *   (Google Place ID 미발급 상태에서 placeholder 파일로만 존재)
 *   5/25 sweep 에서 dead 파일로 판단, 삭제.
 *
 *   useTourRating.ts 의 기존 동작:
 *     getTourExternalIds(tourId) → {} (빈 객체)
 *     → ids.googlePlaceId 없음 → early return
 *     → internal fallback 사용
 *
 *   삭제 후 동작:
 *     인라인 빈 객체 `{}` 사용 → 동일 early return → internal fallback 사용.
 *
 * 이 테스트가 검증하는 것:
 *   1. src/data/tour-external-ids.ts 파일이 더 이상 존재하지 않음
 *   2. useTourRating.ts 가 tour-external-ids import 를 더 이상 참조하지 않음
 *   3. useTourRating.ts 가 internal fallback 구조 (external 없으면 fallback 반환) 를 유지함
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CWD = process.cwd();
const DELETED_FILE = resolve(CWD, 'src/data/tour-external-ids.ts');
const HOOK_FILE = resolve(CWD, 'src/hooks/useTourRating.ts');

describe('5/25 sweep — tour-external-ids.ts 삭제 확인', () => {
  it('src/data/tour-external-ids.ts 파일이 삭제됨', () => {
    expect(existsSync(DELETED_FILE)).toBe(false);
  });
});

describe('useTourRating.ts — tour-external-ids import 제거 확인', () => {
  const src = readFileSync(HOOK_FILE, 'utf8');

  it('tour-external-ids import 가 없음', () => {
    expect(src).not.toMatch(/from\s+['"].*tour-external-ids['"]/);
    expect(src).not.toMatch(/getTourExternalIds/);
    expect(src).not.toMatch(/TOUR_EXTERNAL_IDS/);
  });

  it('internal fallback 반환 구조 유지 (external 없으면 fallback 반환)', () => {
    // 외부 평점 없을 때 fallback.rating / fallback.reviewCount / fallback.reviewSource 반환
    expect(src).toMatch(/fallback\.rating/);
    expect(src).toMatch(/fallback\.reviewCount/);
    expect(src).toMatch(/fallback\.reviewSource/);
  });

  it('external 있을 때 external 평점 반환 구조 유지', () => {
    expect(src).toMatch(/external\.rating/);
    expect(src).toMatch(/external\.reviewCount/);
    expect(src).toMatch(/external\.source/);
  });

  it('hasAnyExternalReviewKey 로 외부 fetch 조건 분기 유지', () => {
    expect(src).toMatch(/hasAnyExternalReviewKey\(\)/);
  });
});
