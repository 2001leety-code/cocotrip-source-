/**
 * test/admin-financial-coverage — src/lib/profitSettlement.ts (FINANCIAL).
 *
 * ProfitSettlement.tsx (M8 월별 손익) 의 매출/비용/순이익/마진/환율 산수를 byte-identical 하게
 * 추출한 순수 함수의 회귀 잠금. coverage 목적 — 값/계수/공식 변경 0.
 *
 * 알려진 KRW 숫자를 박아서, 향후 ProfitSettlement.tsx 리팩터 시 손익 결과가 1원이라도 바뀌면 fail.
 * FX 기본 1380, revenueKRW = round(USD×FX), totalCost = 6개 비용 합, margin = round(순이익/매출×100).
 */
import { describe, it, expect } from 'vitest';
import {
  enrichBooking,
  summarizeSettlement,
  EMPTY_COST,
  type CostRow,
} from '../../src/lib/profitSettlement';

const FX = 1380; // ProfitSettlement.tsx useState 기본값

function cost(over: Partial<CostRow> = {}): CostRow {
  return { ...EMPTY_COST, ...over };
}

describe('profitSettlement — enrichBooking 건별 손익', () => {
  it('AI 플래너 $9.90 @1380, 비용 없음 → revenueKRW=round(13662)=13662, 순이익=13662, 마진100%', () => {
    const r = enrichBooking(9.9, EMPTY_COST, FX);
    // 9.9 × 1380 = 13662 (정확)
    expect(r.revenueKRW).toBe(13662);
    expect(r.totalRevenue).toBe(13662);
    expect(r.totalCost).toBe(0);
    expect(r.netProfit).toBe(13662);
    expect(r.margin).toBe(100);
  });

  it('revenueKRW 는 round (소수 USD × FX) — $99.99 × 1380 = 137986.2 → 137986', () => {
    const r = enrichBooking(99.99, EMPTY_COST, FX);
    expect(r.revenueKRW).toBe(137986); // Math.round(137986.2)
  });

  it('OT수금(overtimeKRW)은 매출에 가산 — totalRevenue = revenueKRW + OT', () => {
    const r = enrichBooking(100, cost({ overtimeKRW: 50000 }), FX);
    expect(r.revenueKRW).toBe(138000);       // 100 × 1380
    expect(r.totalRevenue).toBe(188000);     // + 50000 OT
    expect(r.totalCost).toBe(0);
    expect(r.netProfit).toBe(188000);
  });

  it('totalCost = 6개 비용 합 (기사비+유류+톨+주차+식비+기타) — OT 는 비용 아님', () => {
    const c = cost({
      overtimeKRW: 99999,  // 비용 아님 (매출측)
      driverFee: 100000,
      fuelCost: 30000,
      tollCost: 12000,
      parkingCost: 8000,
      mealCost: 15000,
      otherCost: 5000,
    });
    const r = enrichBooking(0, c, FX);
    // 비용 = 100000+30000+12000+8000+15000+5000 = 170000 (OT 99999 미포함)
    expect(r.totalCost).toBe(170000);
  });

  it('전형적 투어 $500 @1380, 비용 합 170000 → 순이익 + 마진 정확', () => {
    const c = cost({ driverFee: 100000, fuelCost: 30000, tollCost: 12000, parkingCost: 8000, mealCost: 15000, otherCost: 5000 });
    const r = enrichBooking(500, c, FX);
    expect(r.revenueKRW).toBe(690000);       // 500 × 1380
    expect(r.totalRevenue).toBe(690000);     // OT 0
    expect(r.totalCost).toBe(170000);
    expect(r.netProfit).toBe(520000);        // 690000 - 170000
    // 520000 / 690000 = 0.7536... × 100 = 75.36 → round 75
    expect(r.margin).toBe(75);
  });

  it('margin 은 round(순이익/매출×100) — 음수 순이익도 반올림', () => {
    // 매출 138000, 비용 200000 → 순이익 -62000 → -62000/138000 = -0.449 × 100 = -44.9 → round -45
    const r = enrichBooking(100, cost({ driverFee: 200000 }), FX);
    expect(r.netProfit).toBe(-62000);
    expect(r.margin).toBe(-45);
  });

  it('적자 — 비용이 매출 초과 시 netProfit 음수 (손실 표시)', () => {
    const r = enrichBooking(9.9, cost({ driverFee: 50000 }), FX);
    expect(r.totalRevenue).toBe(13662);
    expect(r.netProfit).toBe(-36338);  // 13662 - 50000
    expect(r.margin).toBeLessThan(0);
  });

  it('환율 변경 반영 — 같은 USD, FX=1500 이면 revenueKRW 증가 (운영자 환율 조정)', () => {
    const r1380 = enrichBooking(100, EMPTY_COST, 1380);
    const r1500 = enrichBooking(100, EMPTY_COST, 1500);
    expect(r1380.revenueKRW).toBe(138000);
    expect(r1500.revenueKRW).toBe(150000);
  });
});

describe('profitSettlement — enrichBooking 엣지 케이스', () => {
  it('매출 0 + 비용 0 → 모두 0, 마진 0 (0 나눗셈 가드)', () => {
    const r = enrichBooking(0, EMPTY_COST, FX);
    expect(r).toEqual({ revenueKRW: 0, totalRevenue: 0, totalCost: 0, netProfit: 0, margin: 0 });
  });

  it('매출 0 인데 비용만 있음 → 마진 0 (NaN/Infinity 방지)', () => {
    const r = enrichBooking(0, cost({ driverFee: 50000 }), FX);
    expect(r.totalRevenue).toBe(0);
    expect(r.netProfit).toBe(-50000);
    expect(r.margin).toBe(0);  // totalRevenue<=0 이면 0 (÷0 가드)
  });

  it('totalRevenue 가 OT 덕에 양수 → 0 나눗셈 가드 통과', () => {
    // 매출 USD 0 이지만 OT 10000 → totalRevenue 10000 (>0)
    const r = enrichBooking(0, cost({ overtimeKRW: 10000, driverFee: 4000 }), FX);
    expect(r.totalRevenue).toBe(10000);
    expect(r.netProfit).toBe(6000);
    expect(r.margin).toBe(60);  // 6000/10000 = 60%
  });
});

describe('profitSettlement — summarizeSettlement 합계 KPI', () => {
  it('여러 건 합산 — totalRev/totalCost/totalProfit/avgMargin', () => {
    const rows = [
      enrichBooking(500, cost({ driverFee: 100000, fuelCost: 30000, tollCost: 12000, parkingCost: 8000, mealCost: 15000, otherCost: 5000 }), FX),
      enrichBooking(9.9, EMPTY_COST, FX),
    ];
    const t = summarizeSettlement(rows);
    // row1: rev 690000, cost 170000 / row2: rev 13662, cost 0
    expect(t.totalRev).toBe(703662);
    expect(t.totalCost).toBe(170000);
    expect(t.totalProfit).toBe(533662);
    // 533662 / 703662 = 0.7584 × 100 = 75.84 → round 76
    expect(t.avgMargin).toBe(76);
  });

  it('빈 배열 → 0 KPI + 마진 0 (÷0 가드)', () => {
    const t = summarizeSettlement([]);
    expect(t).toEqual({ totalRev: 0, totalCost: 0, totalProfit: 0, avgMargin: 0 });
  });

  it('합계 적자 → totalProfit 음수, avgMargin 음수', () => {
    const rows = [
      enrichBooking(10, cost({ driverFee: 100000 }), FX),  // rev 13800, cost 100000
    ];
    const t = summarizeSettlement(rows);
    expect(t.totalRev).toBe(13800);
    expect(t.totalCost).toBe(100000);
    expect(t.totalProfit).toBe(-86200);
    // -86200 / 13800 = -6.246 × 100 = -624.6 → round -625
    expect(t.avgMargin).toBe(-625);
  });

  it('avgMargin 은 합계 기준 (건별 마진 평균 아님) — 큰 매출이 가중치', () => {
    const rows = [
      enrichBooking(1000, EMPTY_COST, FX),                 // rev 1,380,000 마진 100%
      enrichBooking(10, cost({ driverFee: 13800 }), FX),   // rev 13,800 마진 0%
    ];
    const t = summarizeSettlement(rows);
    // 총매출 1,393,800 총비용 13,800 순이익 1,380,000
    expect(t.totalRev).toBe(1393800);
    expect(t.totalCost).toBe(13800);
    expect(t.totalProfit).toBe(1380000);
    // 1380000 / 1393800 = 0.990 × 100 = 99.0 → round 99 (건별 평균 50% 가 아님)
    expect(t.avgMargin).toBe(99);
  });
});

describe('profitSettlement — EMPTY_COST 상수', () => {
  it('모든 비용 필드 0', () => {
    expect(EMPTY_COST).toEqual({
      overtimeKRW: 0, driverFee: 0, fuelCost: 0, tollCost: 0, parkingCost: 0, mealCost: 0, otherCost: 0,
    });
  });
});
