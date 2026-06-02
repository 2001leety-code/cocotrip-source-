/**
 * 회계자료 엑셀 내보내기 (법인 세무사 제출용) — 2026-06-02.
 *
 * 운영자 요청: 월별 손익 데이터를 한국 법인 회계자료 엑셀로 내보내기.
 * 딥서치(3 에이전트) 결과 반영 — 핵심 설계 원칙:
 *
 *  1. 🔴 세무 판단을 코드에 박지 않는다. 매출유형(과세/영세율)·부가세·계정과목은 모두
 *     "잠정(빈칸) + 세무사확인필요=Y". 이유: 국세청 예규(서면-2016-법령해석부가-3979)상
 *     PayPal 외화 용역대금은 영세율(0%) 미적용 가능성 → 우리가 단정하면 세무 사고.
 *     엑셀은 "세무사가 보고 판단할 깨끗한 원천 데이터"로만.
 *  2. 거래일 환율 기준. 결제 시점에 booking 에 저장된 capturedExchangeRate / amountKRW
 *     (PR #425) 를 사용 — 화면의 실시간 환율(추정) 아님. 외화 원화환산은 거래일 환율이 원칙.
 *     구버전 booking(환율 미저장)은 fallbackRate(현재 환율)로 추정 + "추정" 출처 표기.
 *  3. USD 원금·거래일 환율·주문ID 등 원천 데이터 무손실 보존 → 세무사가 어떤 기준을 택하든 재계산 가능.
 *
 * 산수는 `profitSettlement.ts` 의 enrichBooking 을 그대로 재사용(환율만 거래일 환율로 주입) — SSOT.
 * write-excel-file 은 버튼 클릭 시 동적 import(lazy) → 메인/어드민 entry 번들 영향 0.
 */
import type { Cell, SheetData } from 'write-excel-file/browser';
import { enrichBooking, EMPTY_COST, type CostRow } from '@/lib/profitSettlement';

/** write-excel-file 다중시트 한 장 (Sheet<FileContent> 의 우리 사용 부분만 — 이미지/조건부서식 미사용). */
interface XlsxSheet {
  data: SheetData;
  sheet: string;
  columns?: { width?: number }[];
  stickyRowsCount?: number;
}

/** ProfitSettlement → 회계 export 입력 (예약 1건). */
export interface AccountingInputBooking {
  bookingId: string;        // = PayPal orderID (doc ID)
  productType: string;      // 상품유형
  tourDate: string;         // 거래일(투어일) YYYY-MM-DD
  customer: string;         // 고객명
  amountUSD: number;        // 결제 외화 원금 (USD)
  amountKRW?: number;       // 거래일 원화 (capture 시점 저장, PR #425+). 없으면 추정.
  capturedExchangeRate?: number; // 거래일 환율 (capture 시점 저장). 없으면 fallback.
  status?: string;          // CONFIRMED / CANCELED ...
  paymentMethod?: string;   // 결제수단 (기본 PayPal)
}

export interface AccountingSalesRow {
  date: string; orderId: string; customer: string; product: string;
  amountUSD: number; exchangeRate: number; exchangeRateSource: string;
  revenueKRW: number; overtimeKRW: number; status: string; paymentMethod: string;
}
export interface AccountingCostRow {
  date: string; orderId: string; product: string;
  driverFee: number; fuelCost: number; tollCost: number; parkingCost: number;
  mealCost: number; otherCost: number; costTotal: number;
}
export interface AccountingFxRow {
  date: string; orderId: string; amountUSD: number; exchangeRate: number; revenueKRW: number; source: string;
}
export interface AccountingSummary {
  period: string; count: number;
  totalRevenueKRW: number; totalCostKRW: number; netProfitKRW: number; marginPct: number;
}
export interface AccountingData {
  sales: AccountingSalesRow[]; costs: AccountingCostRow[]; fx: AccountingFxRow[]; summary: AccountingSummary;
}

export const RATE_SOURCE_STORED = '저장(거래일)';
export const RATE_SOURCE_ESTIMATED = '추정(현재환율)';

/**
 * 회계 원천 데이터 계산 (PURE — 테스트 가능). 거래일 환율 기준.
 * 매출 원화 = 저장된 amountKRW 우선(= round(USD×거래일환율)), 없으면 enrichBooking 재계산.
 * 합계는 profitSettlement 의미와 동일: 총매출 = Σ(원화매출 + OT수금), 총비용 = Σ(6개 비용).
 */
export function computeAccountingData(
  bookings: ReadonlyArray<AccountingInputBooking>,
  costsById: ReadonlyMap<string, CostRow>,
  fallbackRate: number,
  period: string,
): AccountingData {
  const sales: AccountingSalesRow[] = [];
  const costs: AccountingCostRow[] = [];
  const fx: AccountingFxRow[] = [];
  let totalRevenueKRW = 0;
  let totalCostKRW = 0;

  for (const b of bookings) {
    const hasCaptured = Number.isFinite(b.capturedExchangeRate) && (b.capturedExchangeRate as number) > 0;
    const rate = hasCaptured ? (b.capturedExchangeRate as number) : fallbackRate;
    const source = hasCaptured ? RATE_SOURCE_STORED : RATE_SOURCE_ESTIMATED;
    const cost = costsById.get(b.bookingId) || EMPTY_COST;
    // 산수 SSOT 재사용 — 환율만 거래일 환율로 주입.
    const e = enrichBooking(b.amountUSD, cost, rate);
    // 거래일 원화: 저장값(amountKRW) 우선(권위), 없으면 enrichBooking 계산값(동일 공식).
    const revenueKRW = (hasCaptured && Number.isFinite(b.amountKRW) && (b.amountKRW as number) > 0)
      ? (b.amountKRW as number)
      : e.revenueKRW;

    sales.push({
      date: b.tourDate, orderId: b.bookingId, customer: b.customer, product: b.productType,
      amountUSD: b.amountUSD, exchangeRate: rate, exchangeRateSource: source,
      revenueKRW, overtimeKRW: cost.overtimeKRW,
      status: b.status || '', paymentMethod: b.paymentMethod || 'PayPal',
    });
    costs.push({
      date: b.tourDate, orderId: b.bookingId, product: b.productType,
      driverFee: cost.driverFee, fuelCost: cost.fuelCost, tollCost: cost.tollCost,
      parkingCost: cost.parkingCost, mealCost: cost.mealCost, otherCost: cost.otherCost,
      costTotal: e.totalCost,
    });
    fx.push({ date: b.tourDate, orderId: b.bookingId, amountUSD: b.amountUSD, exchangeRate: rate, revenueKRW, source });

    totalRevenueKRW += revenueKRW + cost.overtimeKRW; // 총매출 = 원화매출 + OT수금 (profitSettlement 의미)
    totalCostKRW += e.totalCost;
  }

  const netProfitKRW = totalRevenueKRW - totalCostKRW;
  const marginPct = totalRevenueKRW > 0 ? Math.round((netProfitKRW / totalRevenueKRW) * 100) : 0;

  return {
    sales, costs, fx,
    summary: { period, count: bookings.length, totalRevenueKRW, totalCostKRW, netProfitKRW, marginPct },
  };
}

// ── 셀 헬퍼 (write-excel-file Cell) ──────────────────────────────────────────
const KRW_FMT = '#,##0';
const USD_FMT = '$#,##0.00';
const HEAD_BG = '#1A1B26';
const head = (text: string): Cell => ({ value: text, fontWeight: 'bold', backgroundColor: HEAD_BG, textColor: '#FFFFFF', align: 'center' });
const txt = (value: string): Cell => ({ value, type: String });
const won = (value: number): Cell => ({ value, type: Number, format: KRW_FMT });
const usd = (value: number): Cell => ({ value, type: Number, format: USD_FMT });
const blank: Cell = { value: '' };                 // 세무 판단 잠정칸
const review: Cell = { value: 'Y', align: 'center' }; // 세무사확인필요

/**
 * 회계 데이터 → write-excel-file 다중 시트 (매출장 / 비용장 / 월별손익요약 / 환율기록).
 * 세무 판단 칸(매출유형·부가세·계정과목)은 잠정(빈칸) + 세무사확인필요=Y.
 */
export function buildAccountingSheets(data: AccountingData): XlsxSheet[] {
  const { sales, costs, fx, summary } = data;

  // 시트 1: 매출장
  const salesHead: Cell[] = ['거래일', '주문ID', '고객', '상품유형', '결제통화', 'USD금액', '거래일환율', '환율출처',
    '원화매출(KRW)', 'OT수금(KRW)', '매출유형(잠정)', '부가세액(잠정)', '결제수단', '상태', '세무사확인필요'].map(head);
  const salesData: Cell[][] = [salesHead, ...sales.map((r) => [
    txt(r.date), txt(r.orderId), txt(r.customer), txt(r.product), txt('USD'),
    usd(r.amountUSD), won(r.exchangeRate), txt(r.exchangeRateSource),
    won(r.revenueKRW), won(r.overtimeKRW), blank, blank, txt(r.paymentMethod), txt(r.status), review,
  ])];
  const salesCols = [{ width: 22 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 9 }, { width: 11 },
    { width: 11 }, { width: 14 }, { width: 14 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 11 }, { width: 11 }, { width: 13 }];

  // 시트 2: 매입·비용장
  const costHead: Cell[] = ['거래일', '주문ID', '상품유형', '기사비', '유류비', '통행료', '주차비', '식대', '기타',
    '비용합계(KRW)', '계정과목(추정)', '세무사확인필요'].map(head);
  const costData: Cell[][] = [costHead, ...costs.map((r) => [
    txt(r.date), txt(r.orderId), txt(r.product),
    won(r.driverFee), won(r.fuelCost), won(r.tollCost), won(r.parkingCost), won(r.mealCost), won(r.otherCost),
    won(r.costTotal), blank, review,
  ])];
  const costCols = [{ width: 22 }, { width: 22 }, { width: 18 }, { width: 11 }, { width: 11 }, { width: 11 },
    { width: 11 }, { width: 11 }, { width: 11 }, { width: 14 }, { width: 16 }, { width: 13 }];

  // 시트 3: 월별 손익요약
  const summaryData: Cell[][] = [
    [head('항목'), head('값')],
    [txt('기간'), txt(summary.period)],
    [txt('예약 건수'), { value: summary.count, type: Number, format: '#,##0"건"' }],
    [txt('총 매출 (거래일환율 기준, KRW)'), won(summary.totalRevenueKRW)],
    [txt('총 비용 (KRW)'), won(summary.totalCostKRW)],
    [txt('순이익 (KRW)'), won(summary.netProfitKRW)],
    [txt('평균 마진율'), { value: summary.marginPct, type: Number, format: '0"%"' }],
    [txt('비고'), txt('확정 예약만(취소 제외) · 거래일 환율 기준 · 부가세/매출유형/계정과목은 세무사 확정 필요')],
  ];
  const summaryCols = [{ width: 30 }, { width: 60 }];

  // 시트 4: 환율기록 (외화 회계 근거)
  const fxHead: Cell[] = ['거래일', '주문ID', '결제통화', 'USD금액', '적용환율', '원화금액(KRW)', '환율출처'].map(head);
  const fxData: Cell[][] = [fxHead, ...fx.map((r) => [
    txt(r.date), txt(r.orderId), txt('USD'), usd(r.amountUSD), won(r.exchangeRate), won(r.revenueKRW), txt(r.source),
  ])];
  const fxCols = [{ width: 22 }, { width: 22 }, { width: 9 }, { width: 11 }, { width: 11 }, { width: 14 }, { width: 16 }];

  return [
    { data: salesData, sheet: '매출장', columns: salesCols, stickyRowsCount: 1 },
    { data: costData, sheet: '비용장', columns: costCols, stickyRowsCount: 1 },
    { data: summaryData, sheet: '월별손익요약', columns: summaryCols },
    { data: fxData, sheet: '환율기록', columns: fxCols, stickyRowsCount: 1 },
  ];
}

/**
 * 회계자료 엑셀(.xlsx) 생성 + 브라우저 다운로드 트리거.
 * write-excel-file 은 여기서 동적 import → 클릭 전엔 번들에 미포함(lazy).
 */
export async function exportAccountingXlsx(
  bookings: ReadonlyArray<AccountingInputBooking>,
  costsById: ReadonlyMap<string, CostRow>,
  opts: { period: string; fallbackRate: number },
): Promise<void> {
  const data = computeAccountingData(bookings, costsById, opts.fallbackRate, opts.period);
  const sheets = buildAccountingSheets(data);
  const writeXlsxFile = (await import('write-excel-file/browser')).default;
  await writeXlsxFile(sheets).toFile(`코코트립-회계자료-${opts.period}.xlsx`);
}
