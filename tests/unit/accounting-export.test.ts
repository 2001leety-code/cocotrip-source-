/**
 * 회계자료 엑셀 내보내기 회귀 가드 (2026-06-02, FINANCIAL — 법인 세무사 제출용).
 *
 * 고정하는 것:
 *  1. 거래일 환율 기준 — capturedExchangeRate(저장값) 우선, 없으면 fallbackRate(현재환율) + "추정" 출처.
 *  2. 매출 원화 = 저장된 amountKRW 우선(권위), 없으면 round(USD×거래일환율) 재계산.
 *  3. 합계 = profitSettlement 의미와 동일(총매출 = Σ(원화매출+OT), 총비용 = Σ6, 마진).
 *  4. 세무 판단(매출유형/부가세/계정과목)은 잠정(빈칸) + 세무사확인필요=Y — 코드가 단정 안 함.
 *     (PayPal 외화 영세율 미적용 가능성, 국세청 예규 서면-2016-법령해석부가-3979.)
 */
import { describe, it, expect } from 'vitest';
import {
  computeAccountingData,
  buildAccountingSheets,
  RATE_SOURCE_STORED,
  RATE_SOURCE_ESTIMATED,
  type AccountingInputBooking,
} from '../../src/components/admin/accountingExport';
import { EMPTY_COST, type CostRow } from '../../src/lib/profitSettlement';

type CellObj = { value: unknown };
const v = (cell: unknown): unknown => (cell as CellObj).value;

const cost = (over: Partial<CostRow> = {}): CostRow => ({ ...EMPTY_COST, ...over });

const bk = (over: Partial<AccountingInputBooking> = {}): AccountingInputBooking => ({
  bookingId: 'CT-1', productType: '서울시티', tourDate: '2026-06-10', customer: '홍길동',
  amountUSD: 100, status: 'CONFIRMED', ...over,
});

describe('computeAccountingData — 거래일 환율 기준', () => {
  it('저장된 거래일 환율(capturedExchangeRate) + amountKRW 우선 사용', () => {
    const b = bk({ bookingId: 'CT-A', amountUSD: 9.9, capturedExchangeRate: 1452, amountKRW: 14375 });
    const d = computeAccountingData([b], new Map(), 9999 /* fallback 무시돼야 */, '2026-06');
    expect(d.sales[0].exchangeRate).toBe(1452);
    expect(d.sales[0].exchangeRateSource).toBe(RATE_SOURCE_STORED);
    expect(d.sales[0].revenueKRW).toBe(14375); // 저장된 amountKRW 사용 (fallback/재계산 아님)
  });

  it('거래일 환율 없음 → fallbackRate(현재환율)로 추정 + "추정" 출처', () => {
    const b = bk({ bookingId: 'CT-B', amountUSD: 100 }); // capturedExchangeRate 없음
    const d = computeAccountingData([b], new Map(), 1450, '2026-06');
    expect(d.sales[0].exchangeRate).toBe(1450);
    expect(d.sales[0].exchangeRateSource).toBe(RATE_SOURCE_ESTIMATED);
    expect(d.sales[0].revenueKRW).toBe(145000); // round(100 × 1450)
  });

  it('capturedExchangeRate 있고 amountKRW 없음 → round(USD×거래일환율) 재계산', () => {
    const b = bk({ bookingId: 'CT-C', amountUSD: 9.9, capturedExchangeRate: 1400 });
    const d = computeAccountingData([b], new Map(), 9999, '2026-06');
    expect(d.sales[0].exchangeRate).toBe(1400);
    expect(d.sales[0].exchangeRateSource).toBe(RATE_SOURCE_STORED);
    expect(d.sales[0].revenueKRW).toBe(Math.round(9.9 * 1400)); // 13860
  });

  it('비용장 = booking_costs 매핑, 비용합계 = 6개 합 (OT 제외)', () => {
    const b = bk({ bookingId: 'CT-D' });
    const costs = new Map<string, CostRow>([['CT-D', cost({ driverFee: 50000, fuelCost: 20000, mealCost: 10000, overtimeKRW: 99999 })]]);
    const d = computeAccountingData([b], costs, 1450, '2026-06');
    expect(d.costs[0].driverFee).toBe(50000);
    expect(d.costs[0].costTotal).toBe(80000); // 50000+20000+10000 (overtime 은 매출 측, 비용 아님)
    expect(d.sales[0].overtimeKRW).toBe(99999); // OT 수금은 매출장에
  });

  it('월별 손익요약 = Σ(원화매출+OT) / Σ6 / 마진 (profitSettlement 의미 동일)', () => {
    const a = bk({ bookingId: 'A', amountUSD: 100, capturedExchangeRate: 1450, amountKRW: 145000 });
    const b = bk({ bookingId: 'B', amountUSD: 10 }); // fallback 1500
    const costs = new Map<string, CostRow>([['A', cost({ driverFee: 50000, overtimeKRW: 10000 })]]);
    const d = computeAccountingData([a, b], costs, 1500, '2026-06');
    // A: rev 145000 + OT 10000 = 155000, cost 50000 / B: rev 15000(=10×1500) + 0, cost 0
    expect(d.summary.totalRevenueKRW).toBe(170000);
    expect(d.summary.totalCostKRW).toBe(50000);
    expect(d.summary.netProfitKRW).toBe(120000);
    expect(d.summary.marginPct).toBe(71); // round(120000/170000×100)=70.59→71
    expect(d.summary.count).toBe(2);
    expect(d.summary.period).toBe('2026-06');
  });

  it('빈 입력 → 0 합계, 마진 0 (0 division 방어)', () => {
    const d = computeAccountingData([], new Map(), 1450, '2026-06');
    expect(d.summary).toMatchObject({ count: 0, totalRevenueKRW: 0, totalCostKRW: 0, netProfitKRW: 0, marginPct: 0 });
  });
});

describe('buildAccountingSheets — 4 시트 + 세무 잠정칸', () => {
  const data = computeAccountingData(
    [bk({ bookingId: 'CT-A', amountUSD: 9.9, capturedExchangeRate: 1452, amountKRW: 14375 })],
    new Map(), 1450, '2026-06',
  );
  const sheets = buildAccountingSheets(data);

  it('시트 4개 + 이름 (매출장/비용장/월별손익요약/환율기록)', () => {
    expect(sheets.map((s) => s.sheet)).toEqual(['매출장', '비용장', '월별손익요약', '환율기록']);
  });

  it('매출장 헤더에 매출유형(잠정)·부가세액(잠정)·세무사확인필요 포함', () => {
    const header = sheets[0].data[0].map(v);
    expect(header).toContain('매출유형(잠정)');
    expect(header).toContain('부가세액(잠정)');
    expect(header).toContain('세무사확인필요');
  });

  it('매출장 데이터행: 매출유형/부가세 = 빈칸(잠정), 세무사확인필요 = Y (코드가 세무 단정 안 함)', () => {
    const row = sheets[0].data[1];
    // 헤더 인덱스: 매출유형(10), 부가세액(11), 세무사확인필요(14)
    expect(v(row[10])).toBe('');
    expect(v(row[11])).toBe('');
    expect(v(row[14])).toBe('Y');
  });

  it('비용장 헤더에 계정과목(추정)·세무사확인필요 포함', () => {
    const header = sheets[1].data[0].map(v);
    expect(header).toContain('계정과목(추정)');
    expect(header).toContain('세무사확인필요');
  });
});
