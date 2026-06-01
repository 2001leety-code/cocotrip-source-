// transit-vs-charter-prc3.test.ts
// PR-C3 (2026-06-01): transitVsCharter 순수 모듈 회귀 방지
// 컴포넌트 직접 import 금지 (firebase CI crash 방지, R_Phase1 lint 가드)
// 순수 모듈 src/pages/PlanDetailPage/lib/transitVsCharter.ts 에서 import.

import { describe, it, expect } from 'vitest';
import {
  sumDayTransit,
  computeTransitVsCharter,
  isTransitVsCharterEnabled,
} from '../../src/pages/PlanDetailPage/lib/transitVsCharter';
import type {
  StopLikeForComparison,
  CharterPricingLike,
} from '../../src/pages/PlanDetailPage/lib/transitVsCharter';

// ────── fixture 공통 ──────

const SUBWAY_TRANSIT = { method: 'subway', est_min: 25, transfers: 2, est_fare_krw: 1500 };
const BUS_TRANSIT    = { method: 'bus',    est_min: 15, transfers: 1, est_fare_krw: 1200 };
const WALK_TRANSIT   = { method: 'walk',   est_min: 10, transfers: 0, est_fare_krw: 0 };

function makeStop(transit?: typeof SUBWAY_TRANSIT | typeof BUS_TRANSIT | typeof WALK_TRANSIT | null): StopLikeForComparison {
  return transit ? { transit_from_prev: transit } : {};
}

const CHARTER_PRICING: CharterPricingLike = {
  priceKRW: 600_000,
  hours: 10,
  en: 'Seoul City Tour',
  ko: '서울 시티 투어',
};

// ────── 1. 대중교통 합산 ──────

describe('sumDayTransit', () => {
  it('subway+bus 구간만 합산 — walk 제외', () => {
    const stops: StopLikeForComparison[] = [
      makeStop(SUBWAY_TRANSIT), // 25min, 2 transfers, 1500krw
      makeStop(BUS_TRANSIT),    // 15min, 1 transfer,  1200krw
      makeStop(WALK_TRANSIT),   // walk: 제외
      makeStop(null),           // transit 없음: 제외
    ];
    const result = sumDayTransit(stops);
    expect(result.totalMin).toBe(40);
    expect(result.totalTransfers).toBe(3);
    expect(result.totalFareKrw).toBe(2700);
    expect(result.publicTransitCount).toBe(2);
  });

  it('대중교통 구간 없으면 전부 0', () => {
    const stops: StopLikeForComparison[] = [makeStop(WALK_TRANSIT), makeStop(null)];
    const result = sumDayTransit(stops);
    expect(result.publicTransitCount).toBe(0);
    expect(result.totalMin).toBe(0);
    expect(result.totalFareKrw).toBe(0);
  });

  it('stops 빈 배열 → 0', () => {
    const result = sumDayTransit([]);
    expect(result.totalMin).toBe(0);
    expect(result.publicTransitCount).toBe(0);
  });

  it('transit 필드 일부 누락 시 0 처리 (안전)', () => {
    const stops: StopLikeForComparison[] = [
      { transit_from_prev: { method: 'subway' } }, // est_min 없음
    ];
    const result = sumDayTransit(stops);
    expect(result.totalMin).toBe(0);
    expect(result.publicTransitCount).toBe(1);
  });
});

// ────── 2. 비교 계산 ──────

describe('computeTransitVsCharter', () => {
  it('subway 구간 있을 때 비교 객체 반환', () => {
    const stops: StopLikeForComparison[] = [
      makeStop(SUBWAY_TRANSIT),
      makeStop(BUS_TRANSIT),
    ];
    const result = computeTransitVsCharter(stops, CHARTER_PRICING, 4);
    expect(result).not.toBeNull();
    expect(result!.charter.dailyPriceKrw).toBe(600_000);
    expect(result!.charter.perPersonKrw).toBe(150_000); // 600000/4
    expect(result!.transit.totalMin).toBe(40);
    expect(result!.timeSavedMin).toBeGreaterThan(0);
  });

  it('인당가 = dailyPriceKrw / pax (정수 반올림)', () => {
    const stops: StopLikeForComparison[] = [makeStop(SUBWAY_TRANSIT)];
    const result = computeTransitVsCharter(stops, CHARTER_PRICING, 3);
    expect(result!.charter.perPersonKrw).toBe(Math.round(600_000 / 3));
  });

  it('pax=0 이면 인당가 = dailyPriceKrw (pax 1 기준)', () => {
    const stops: StopLikeForComparison[] = [makeStop(SUBWAY_TRANSIT)];
    const result = computeTransitVsCharter(stops, CHARTER_PRICING, 0);
    expect(result!.charter.perPersonKrw).toBe(600_000); // safePax=1
  });

  it('timeSavedMin = round(totalMin * 0.45)', () => {
    const stops: StopLikeForComparison[] = [makeStop(SUBWAY_TRANSIT)]; // 25min
    const result = computeTransitVsCharter(stops, CHARTER_PRICING, 2);
    expect(result!.timeSavedMin).toBe(Math.round(25 * 0.45)); // 11
  });

  it('대중교통 구간 0개 → null (데이터 부족)', () => {
    const stops: StopLikeForComparison[] = [makeStop(WALK_TRANSIT), makeStop(null)];
    const result = computeTransitVsCharter(stops, CHARTER_PRICING, 2);
    expect(result).toBeNull();
  });

  it('charterPricing null → null', () => {
    const stops: StopLikeForComparison[] = [makeStop(SUBWAY_TRANSIT)];
    const result = computeTransitVsCharter(stops, null, 2);
    expect(result).toBeNull();
  });

  it('charterPricing.priceKRW=0 → null', () => {
    const stops: StopLikeForComparison[] = [makeStop(SUBWAY_TRANSIT)];
    const result = computeTransitVsCharter(stops, { priceKRW: 0 }, 2);
    expect(result).toBeNull();
  });

  it('stops 빈 배열 → null', () => {
    const result = computeTransitVsCharter([], CHARTER_PRICING, 2);
    expect(result).toBeNull();
  });
});

// ────── 3. 플래그 OFF/ON ──────

describe('isTransitVsCharterEnabled', () => {
  it('featureEnabled=false → false (플래그 OFF)', () => {
    expect(isTransitVsCharterEnabled(false)).toBe(false);
  });

  it('featureEnabled=true → true (플래그 ON override)', () => {
    expect(isTransitVsCharterEnabled(true)).toBe(true);
  });

  it('override 없으면 환경변수 읽기 (Node SSR = false)', () => {
    // plain Node.js / vitest 환경에서 import.meta.env 없음 → false
    expect(isTransitVsCharterEnabled()).toBe(false);
  });
});

// ────── 4. timeSavedMin 경계값 ──────

describe('timeSavedMin 경계', () => {
  it('totalMin=10 → timeSavedMin=5 미만 가능 (5min threshold 체크용)', () => {
    const stops: StopLikeForComparison[] = [
      { transit_from_prev: { method: 'subway', est_min: 10, transfers: 0, est_fare_krw: 1250 } },
    ];
    const result = computeTransitVsCharter(stops, CHARTER_PRICING, 2);
    // 10 * 0.45 = 4.5 -> round = 5 -> 경계값 정확히 5
    expect(result!.timeSavedMin).toBe(5);
  });

  it('totalMin=0 인 subway 구간 → timeSavedMin=0', () => {
    const stops: StopLikeForComparison[] = [
      { transit_from_prev: { method: 'subway', est_min: 0, transfers: 1, est_fare_krw: 1250 } },
    ];
    const result = computeTransitVsCharter(stops, CHARTER_PRICING, 2);
    expect(result!.timeSavedMin).toBe(0);
  });
});
