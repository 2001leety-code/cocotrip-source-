/**
 * UIUX P5 Route Insight 판정 회귀 (2026-07-13)
 * - 임계값: 환승≥2 / 도보≥900m / 60분+ — 대중교통 구간만. 하루 최대 1개(최고 점수).
 * - car/walk/downgrade 구간은 절대 비노출 (차터 제안 무의미 + 환각 금지).
 */
import { describe, it, expect } from 'vitest';
import { findMostTiringSegment, segmentTiringReasons } from '../../src/pages/PlanDetailPage/lib/routeInsight';

const stop = (t: Record<string, unknown> | null) => ({ transit_from_prev: t });

describe('segmentTiringReasons — 임계값', () => {
  it('환승 2회 = transfers 사유', () => {
    expect(segmentTiringReasons({ mode: 'subway', transfers: 2 })).toEqual(['transfers']);
  });
  it('도보 900m = walk 사유', () => {
    expect(segmentTiringReasons({ mode: 'bus', total_walk_m: 900 })).toEqual(['walk']);
  });
  it('60분 = duration 사유', () => {
    expect(segmentTiringReasons({ mode: 'subway', est_min: 60 })).toEqual(['duration']);
  });
  it('임계 미만 = 빈 배열 (환승1·도보800·55분)', () => {
    expect(segmentTiringReasons({ mode: 'subway', transfers: 1, total_walk_m: 800, est_min: 55 })).toEqual([]);
  });
  it('car/walk 구간은 항상 제외', () => {
    expect(segmentTiringReasons({ mode: 'car', transfers: 5, est_min: 120 })).toEqual([]);
    expect(segmentTiringReasons({ mode: 'walk', total_walk_m: 2000 })).toEqual([]);
  });
});

describe('findMostTiringSegment — 하루 1개 최고점', () => {
  it('여러 힘든 구간 중 최고 점수 1개만', () => {
    const stops = [
      stop(null),
      stop({ mode: 'subway', transfers: 2, total_walk_m: 300, est_min: 40 }),
      stop({ mode: 'bus', transfers: 3, total_walk_m: 1200, est_min: 70 }), // 최악
      stop({ mode: 'subway', transfers: 2, est_min: 50 }),
    ];
    const r = findMostTiringSegment(stops);
    expect(r).not.toBeNull();
    expect(r!.index).toBe(2);
    expect(r!.reasons).toEqual(['transfers', 'walk', 'duration']);
    expect(r!.walkMin).toBe(Math.round(1200 / 70));
  });
  it('힘든 구간 없으면 null', () => {
    expect(findMostTiringSegment([stop({ mode: 'subway', transfers: 1, est_min: 20 })])).toBeNull();
    expect(findMostTiringSegment([])).toBeNull();
    expect(findMostTiringSegment(null)).toBeNull();
  });
});
