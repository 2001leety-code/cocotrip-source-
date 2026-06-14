/**
 * bughunt-profit-fx.test.ts — Bug #16 회귀 슈트
 *
 * 버그: ProfitSettlement 가 모든 booking 의 revenueKRW 를 마운트 시점 라이브 환율로 재환산.
 *       capturedExchangeRate / amountKRW (거래시점 값) 가 무시되어 과거 거래 KRW 가
 *       조회 시점마다 달라지고 엑셀 export 와 불일치.
 *
 * 수정: enrichBooking(tourPriceUSD, cost, fallbackRate, capturedAmountKRW?, capturedRate?) 에
 *       옵션 인자 추가. 우선순위: amountKRW > capturedRate×USD > fallbackRate×USD.
 *
 * 검증 범위:
 *   PFX-1: capturedAmountKRW 있으면 그대로 사용 (라이브 환율 무시)
 *   PFX-2: capturedAmountKRW 없고 capturedRate 있으면 round(USD × capturedRate)
 *   PFX-3: 둘 다 없으면 fallbackRate(현재 라이브 환율) 사용 — 하위호환
 *   PFX-4: capturedAmountKRW=0/undefined/null 은 거래시점 값 없는 것으로 간주 (폴백)
 *   PFX-5: capturedRate=0/undefined 는 거래시점 환율 없는 것으로 간주 (폴백)
 *   PFX-6: usedExchangeRate 반환값이 실제 사용된 환율을 반영
 *   PFX-7: totalRevenue / netProfit / margin 은 revenueKRW + cost 기준으로 일관
 *   PFX-8: 하위호환 — 인자 3개 호출(기존 호출부)은 동작 변경 없음
 *   PFX-9: summarizeSettlement 는 enrichBooking 결과 배열 합산 — 영향 없음 확인
 */
import { describe, it, expect } from 'vitest';
import { enrichBooking, summarizeSettlement, EMPTY_COST, type CostRow } from '../../src/lib/profitSettlement';

const LIVE_RATE = 1530; // 현재 라이브 환율 (조회 시점)
const CAPTURED_RATE = 1380; // 거래시점 환율 (6개월 전)
const USD = 100; // $100 거래

// 비용 픽스처
const NO_COST: CostRow = EMPTY_COST;
const WITH_COST: CostRow = { ...EMPTY_COST, driverFee: 50_000, fuelCost: 20_000, overtimeKRW: 10_000 };

describe('PFX-1: capturedAmountKRW 있으면 라이브 환율 무시', () => {
  it('amountKRW=138,000 → revenueKRW=138,000 (라이브 1530 재환산 안 함)', () => {
    const capturedKRW = 138_000; // $100 × 1380
    const result = enrichBooking(USD, NO_COST, LIVE_RATE, capturedKRW);
    expect(result.revenueKRW).toBe(138_000);
  });

  it('라이브 환율이 달라도 revenueKRW 불변', () => {
    const capturedKRW = 138_000;
    const r1 = enrichBooking(USD, NO_COST, 1530, capturedKRW);
    const r2 = enrichBooking(USD, NO_COST, 1600, capturedKRW);
    const r3 = enrichBooking(USD, NO_COST, 1000, capturedKRW);
    expect(r1.revenueKRW).toBe(r2.revenueKRW);
    expect(r1.revenueKRW).toBe(r3.revenueKRW);
  });

  it('비용이 있어도 revenueKRW 는 capturedAmountKRW 그대로', () => {
    const capturedKRW = 138_000;
    const result = enrichBooking(USD, WITH_COST, LIVE_RATE, capturedKRW);
    expect(result.revenueKRW).toBe(138_000);
    // totalRevenue = revenueKRW + overtimeKRW(10,000)
    expect(result.totalRevenue).toBe(148_000);
    // totalCost = driverFee(50,000) + fuelCost(20,000)
    expect(result.totalCost).toBe(70_000);
    expect(result.netProfit).toBe(78_000);
  });
});

describe('PFX-2: capturedAmountKRW 없고 capturedRate 있으면 거래시점 환율×USD', () => {
  it('capturedRate=1380 → revenueKRW=138,000 (라이브 1530 재환산 안 함)', () => {
    const result = enrichBooking(USD, NO_COST, LIVE_RATE, undefined, CAPTURED_RATE);
    expect(result.revenueKRW).toBe(Math.round(USD * CAPTURED_RATE)); // 138,000
  });

  it('capturedRate 가 라이브 환율과 다를 때 거래시점 환율 우선', () => {
    const resultCapture = enrichBooking(USD, NO_COST, LIVE_RATE, undefined, 1380);
    const resultLive    = enrichBooking(USD, NO_COST, LIVE_RATE);
    expect(resultCapture.revenueKRW).toBe(138_000);
    expect(resultLive.revenueKRW).toBe(153_000); // 라이브 1530
    expect(resultCapture.revenueKRW).not.toBe(resultLive.revenueKRW);
  });
});

describe('PFX-3: 둘 다 없으면 fallbackRate 사용 (하위호환)', () => {
  it('capturedAmountKRW/capturedRate 모두 미전달 → round(USD × fallbackRate)', () => {
    const result = enrichBooking(USD, NO_COST, LIVE_RATE);
    expect(result.revenueKRW).toBe(Math.round(USD * LIVE_RATE)); // 153,000
  });

  it('fallbackRate 가 바뀌면 revenueKRW 도 바뀜 (기존 동작)', () => {
    const r1 = enrichBooking(USD, NO_COST, 1530);
    const r2 = enrichBooking(USD, NO_COST, 1600);
    expect(r1.revenueKRW).toBe(153_000);
    expect(r2.revenueKRW).toBe(160_000);
  });
});

describe('PFX-4: capturedAmountKRW=0/undefined/null 은 폴백 처리', () => {
  it('0 전달 → 거래시점 없는 것으로 간주, fallbackRate 적용', () => {
    const result = enrichBooking(USD, NO_COST, LIVE_RATE, 0);
    expect(result.revenueKRW).toBe(Math.round(USD * LIVE_RATE));
  });

  it('undefined 전달 → fallbackRate 적용', () => {
    const result = enrichBooking(USD, NO_COST, LIVE_RATE, undefined);
    expect(result.revenueKRW).toBe(Math.round(USD * LIVE_RATE));
  });
});

describe('PFX-5: capturedRate=0/undefined 는 폴백 처리', () => {
  it('capturedRate=0 → fallbackRate 사용', () => {
    const result = enrichBooking(USD, NO_COST, LIVE_RATE, undefined, 0);
    expect(result.revenueKRW).toBe(Math.round(USD * LIVE_RATE));
  });

  it('capturedRate=undefined → fallbackRate 사용', () => {
    const result = enrichBooking(USD, NO_COST, LIVE_RATE, undefined, undefined);
    expect(result.revenueKRW).toBe(Math.round(USD * LIVE_RATE));
  });
});

describe('PFX-6: usedExchangeRate 는 실제 사용된 환율 반영', () => {
  it('capturedAmountKRW 사용 시 역산 환율 반환 (round(KRW/USD))', () => {
    // 138,000 / 100 = 1380
    const result = enrichBooking(USD, NO_COST, LIVE_RATE, 138_000);
    expect(result.usedExchangeRate).toBe(1380);
  });

  it('capturedRate 사용 시 capturedRate 그대로 반환', () => {
    const result = enrichBooking(USD, NO_COST, LIVE_RATE, undefined, 1380);
    expect(result.usedExchangeRate).toBe(1380);
  });

  it('fallback 사용 시 fallbackRate 반환', () => {
    const result = enrichBooking(USD, NO_COST, LIVE_RATE);
    expect(result.usedExchangeRate).toBe(LIVE_RATE);
  });
});

describe('PFX-7: totalRevenue / netProfit / margin 일관성', () => {
  it('capturedAmountKRW 기준: totalRevenue = capturedKRW + overtime', () => {
    const capturedKRW = 138_000;
    const cost: CostRow = { ...EMPTY_COST, overtimeKRW: 5_000, driverFee: 30_000 };
    const result = enrichBooking(USD, cost, LIVE_RATE, capturedKRW);
    expect(result.totalRevenue).toBe(143_000);       // 138,000 + 5,000
    expect(result.totalCost).toBe(30_000);
    expect(result.netProfit).toBe(113_000);
    expect(result.margin).toBe(Math.round(113_000 / 143_000 * 100)); // 79%
  });

  it('margin: 매출 0 이면 0 (ZeroDivision 방지)', () => {
    const result = enrichBooking(0, NO_COST, LIVE_RATE, 0);
    expect(result.margin).toBe(0);
    expect(result.totalRevenue).toBe(0);
  });
});

describe('PFX-8: 하위호환 — 기존 3인자 호출부는 동작 변경 없음', () => {
  it('enrichBooking(usd, cost, rate) 시그니처 그대로 동작', () => {
    const result = enrichBooking(USD, NO_COST, 1530);
    expect(result.revenueKRW).toBe(153_000);
    expect(result.totalRevenue).toBe(153_000);
    expect(result.netProfit).toBe(153_000);
    expect(result.margin).toBe(100);
  });

  it('기존 반환값 키 구조 유지 (revenueKRW/totalRevenue/totalCost/netProfit/margin)', () => {
    const result = enrichBooking(USD, NO_COST, 1530);
    expect(result).toHaveProperty('revenueKRW');
    expect(result).toHaveProperty('totalRevenue');
    expect(result).toHaveProperty('totalCost');
    expect(result).toHaveProperty('netProfit');
    expect(result).toHaveProperty('margin');
    expect(result).toHaveProperty('usedExchangeRate');
  });
});

describe('PFX-9: summarizeSettlement — enrichBooking 합산 정합', () => {
  it('3건 혼합: capturedAmountKRW/capturedRate/fallback → 합산 정확', () => {
    const cost = NO_COST;
    // 거래 A: capturedAmountKRW=138,000
    const a = enrichBooking(100, cost, LIVE_RATE, 138_000);
    // 거래 B: capturedRate=1400
    const b = enrichBooking(50, cost, LIVE_RATE, undefined, 1400);
    // 거래 C: 폴백 (라이브 1530)
    const c = enrichBooking(200, cost, LIVE_RATE);

    const totals = summarizeSettlement([a, b, c]);
    const expectedRev = a.totalRevenue + b.totalRevenue + c.totalRevenue;
    expect(totals.totalRev).toBe(expectedRev);
    expect(totals.totalProfit).toBe(expectedRev); // 비용 0이므로 매출=순이익
    expect(totals.avgMargin).toBe(100);
  });

  it('거래 C(폴백) revenueKRW 는 라이브 환율에 따라 달라짐 (회귀 확인)', () => {
    const c_live1530 = enrichBooking(200, NO_COST, 1530);
    const c_live1600 = enrichBooking(200, NO_COST, 1600);
    expect(c_live1530.revenueKRW).toBe(306_000);
    expect(c_live1600.revenueKRW).toBe(320_000);
    // 거래시점 값이 있는 건은 이 영향을 받지 않음 (PFX-1 검증)
  });
});
