/**
 * Profit Settlement (M8 월별 손익) — PURE 손익 계산 추출.
 *
 * src/components/admin/ProfitSettlement.tsx 가 인라인으로 갖고 있던 매출/비용/순이익/마진/환율
 * 계산을 byte-identical 하게 옮긴 것. 컴포넌트는 Firestore 실시간 구독 + 편집 UI 만 담당하고,
 * "USD → KRW 환산 + 비용 합산 + 순이익 + 마진" 산수는 여기서 deterministic 하게 계산.
 *
 * ⚠️ BEHAVIOR-PRESERVING (test/admin-financial-coverage):
 *   환율 기본값(1380), revenueKRW = round(USD × FX), totalRevenue = revenueKRW + OT수금,
 *   totalCost = 6개 비용 합, netProfit, margin = round(netProfit/totalRevenue × 100),
 *   합계(totalRev/totalCost/totalProfit/avgMargin) 전부 원본 ProfitSettlement.tsx 와 동일.
 *   값/계수/공식 변경 0 — coverage 목적.
 */

/** 운영자 편집 가능한 건별 비용 (KRW). ProfitSettlement.tsx CostRow 와 동일. */
export interface CostRow {
  overtimeKRW: number;
  driverFee: number;
  fuelCost: number;
  tollCost: number;
  parkingCost: number;
  mealCost: number;
  otherCost: number;
}

/** 모든 비용 0 — 비용 미입력 예약 기본값. */
export const EMPTY_COST: CostRow = {
  overtimeKRW: 0, driverFee: 0, fuelCost: 0, tollCost: 0, parkingCost: 0, mealCost: 0, otherCost: 0,
};

/**
 * USD→KRW 환율 폴백 (실시간 fetch 실패 시에만 사용).
 *
 * ⚠️ 정상 동작 시 ProfitSettlement 는 마운트 시 `/api/exchange-rate` 로 **실시간 환율**을 받아
 * 기본값을 채운다 (매출 대시보드 admin-sales / 결제 createPaypalOrder 와 동일 SSOT =
 * backend `api/_exchange-rate.js`). 이 상수는 그 fetch 가 실패했을 때의 안전망일 뿐.
 *
 * 값 1450 = 운영자 환율 정책 floor (`_exchange-rate.js` RATE_FLOOR / FALLBACK_RATE, 2026-05-13).
 * ❌ 출시 초기 잔재였던 stale 1380 으로 되돌리지 말 것 — 실시세·정책과 불일치해 두 화면이 다른
 * 환율을 보이는 drift 의 원인이었음 (2026-06-02 운영자 "환율은 실시간 아냐?" 지적으로 정정).
 */
export const DEFAULT_KRW_PER_USD = 1450;

/** enrichBooking 가 계산하는 건별 손익 파생값 (KRW). */
export interface EnrichedFinancials {
  revenueKRW: number;    // round(USD × 환율) — 투어가의 원화 환산
  totalRevenue: number;  // revenueKRW + OT수금(현장 추가 수금)
  totalCost: number;     // 기사비 + 유류 + 톨 + 주차 + 식비 + 기타
  netProfit: number;     // totalRevenue - totalCost
  margin: number;        // round(netProfit / totalRevenue × 100), 매출 0 이면 0
}

/** 합계 KPI. */
export interface SettlementTotals {
  totalRev: number;
  totalCost: number;
  totalProfit: number;
  avgMargin: number;
}

/**
 * 건별 손익 파생값 계산. ProfitSettlement.tsx enriched useMemo 의 산수와 byte-identical.
 *
 * @param tourPriceUSD 투어가 (USD)
 * @param cost 건별 비용 (KRW). 미입력 시 EMPTY_COST.
 * @param exchangeRate USD→KRW 환율 (기본 1380, 운영자가 화면에서 조정 가능)
 */
export function enrichBooking(
  tourPriceUSD: number,
  cost: CostRow,
  exchangeRate: number,
): EnrichedFinancials {
  const revenueKRW = Math.round(tourPriceUSD * exchangeRate);
  const totalRevenue = revenueKRW + cost.overtimeKRW;
  const totalCost = cost.driverFee + cost.fuelCost + cost.tollCost + cost.parkingCost + cost.mealCost + cost.otherCost;
  const netProfit = totalRevenue - totalCost;
  const margin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0;
  return { revenueKRW, totalRevenue, totalCost, netProfit, margin };
}

/**
 * 합계 KPI 계산. ProfitSettlement.tsx 의 totalRev/totalCost/totalProfit/avgMargin 와 byte-identical.
 *
 * @param rows enrichBooking 결과(최소 totalRevenue/totalCost 포함) 배열
 */
export function summarizeSettlement(
  rows: ReadonlyArray<Pick<EnrichedFinancials, 'totalRevenue' | 'totalCost'>>,
): SettlementTotals {
  const totalRev = rows.reduce((s, e) => s + e.totalRevenue, 0);
  const totalCost = rows.reduce((s, e) => s + e.totalCost, 0);
  const totalProfit = totalRev - totalCost;
  const avgMargin = totalRev > 0 ? Math.round((totalProfit / totalRev) * 100) : 0;
  return { totalRev, totalCost, totalProfit, avgMargin };
}
