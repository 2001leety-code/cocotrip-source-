// @vitest-environment jsdom
/**
 * 관리자 통계·매출 화면 환율 표시 통일 (2026-10-23, PR-4 + Astra 명세 검토 r1).
 * 잠그는 것:
 *   - 통계(AdminAnalytics)는 관리자 인증을 붙여 /api/admin-sales 를 새로 호출하고 응답 최상위 exchangeRate 로 원화 참고 환산.
 *   - 문구 "참고 환산 · 적용 환율 N원/USD" — "실시간"·"(고정)" 표기 없음(6시간 캐시·하한 정책이 적용될 수 있다).
 *   - 통계 데이터보다 늦게 온 환율도 반영(KPI 의존 목록), 환율 실패는 통계 오류와 분리,
 *     로딩·실패·0·음수·NaN·문자열 환율은 USD 만(가짜 원화 금지).
 *   - 같은 USD 를 매출(AdminSales)과 통계가 같은 원화로 보여 준다.
 *   - src/lib/exchange-rate.ts·api/_shared/exchange-rate.js 상수(다른 호출처·결제 정책)는 불변.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

void React;

const fetchMock = vi.fn();
const authState = vi.hoisted(() => ({ user: { getIdToken: vi.fn(async () => 'synthetic-token') }, loading: false }));
const docsHolder = vi.hoisted(() => ({ docs: [] as Array<Record<string, unknown>> }));

vi.stubGlobal('fetch', fetchMock);
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'ko', t: {}, changeLanguage: () => {} }) }));
vi.mock('../../src/sections/Header', () => ({ Header: () => null }));
vi.mock('../../src/components/admin/AffiliatePerformance', () => ({ AffiliatePerformance: () => null }));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), where: vi.fn(),
  getDocs: vi.fn(async () => ({ forEach: (fn: (d: { data: () => unknown }) => void) => docsHolder.docs.forEach((d) => fn({ data: () => d })) })),
}));

const { default: AdminAnalytics } = await import('../../src/pages/AdminAnalytics');
const { default: AdminSales } = await import('../../src/pages/AdminSales');

const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const MONTH_USD = 350.5;
const RATE = 1480;
const KRW = `₩${Math.round(MONTH_USD * RATE).toLocaleString('ko-KR')}`;
const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

beforeEach(() => {
  cleanup();
  fetchMock.mockReset();
  docsHolder.docs = [
    { tourDate: `${ym}-10`, productType: 'tour_gyeongbok', amountUSD: '100.00', status: 'CONFIRMED' },
    { tourDate: `${ym}-12`, productType: 'charter_dmz', amountUSD: 250.5, status: 'CONFIRMED' },
  ];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const renderAnalytics = () => render(<MemoryRouter><AdminAnalytics /></MemoryRouter>);

describe('AdminAnalytics — reference KRW from admin-sales exchangeRate', () => {
  it('converts the same USD total with the admin-sales rate; label "참고 환산 · 적용 환율 N원/USD", no "실시간"/"(고정)"', async () => {
    fetchMock.mockResolvedValueOnce(reply({ exchangeRate: RATE }));
    renderAnalytics();
    expect(await screen.findByText(KRW)).toBeInTheDocument();
    expect(screen.getByText('이번 달 총 매출 (참고 환산)')).toBeInTheDocument();
    expect(screen.getByText(/참고 환산 · 적용 환율 1,480원\/USD/)).toBeInTheDocument();
    expect(screen.queryByText(/실시간|\(고정\)/)).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toContain('/api/admin-sales');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-token');
    expect(screen.queryByText(`₩${Math.round(MONTH_USD * 1350).toLocaleString('ko-KR')}`)).toBeNull();
  });

  it('rate arriving after the statistics → USD first, then the KRW reference (KPI re-computes)', async () => {
    let resolveRate!: (v: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => { resolveRate = r; }));
    renderAnalytics();
    expect(await screen.findByText('$350.50')).toBeInTheDocument();
    expect(screen.getByText('이번 달 총 매출 (USD)')).toBeInTheDocument();
    await act(async () => { resolveRate(reply({ exchangeRate: RATE })); });
    expect(await screen.findByText(KRW)).toBeInTheDocument();
  });

  it.each([
    ['admin-sales 500', () => fetchMock.mockResolvedValueOnce(reply({ error: 'x' }, false))],
    ['network error', () => fetchMock.mockRejectedValueOnce(new Error('offline'))],
    ['rate missing', () => fetchMock.mockResolvedValueOnce(reply({ kpi: {} }))],
    ['rate 0', () => fetchMock.mockResolvedValueOnce(reply({ exchangeRate: 0 }))],
    ['rate negative', () => fetchMock.mockResolvedValueOnce(reply({ exchangeRate: -5 }))],
    ['rate NaN string', () => fetchMock.mockResolvedValueOnce(reply({ exchangeRate: 'abc' }))],
  ])('%s → USD only, no invented KRW, and the statistics are not shown as an error', async (_label, arrange) => {
    arrange();
    renderAnalytics();
    expect(await screen.findByText('$350.50')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/₩/)).toBeNull();
    expect(screen.getByText(/원화 환산 생략/)).toBeInTheDocument();
    expect(screen.queryByText(/⚠/)).toBeNull(); // 환율 실패 ≠ 통계 조회 실패
  });
});

describe('AdminSales — same wording and the same KRW for the same USD', () => {
  it('shows "참고 환산 · 적용 환율 N원/USD" and the month KPI KRW equals the Analytics value', async () => {
    const bucket = (usd: number, count: number) => ({ usd, count });
    fetchMock.mockResolvedValueOnce(reply({
      kpi: { today: bucket(0, 0), week: bucket(0, 0), month: bucket(MONTH_USD, 2), ytd: bucket(0, 0) },
      daily: [], byProduct: {}, recent: [], exchangeRate: RATE, totalBookings: 2, generatedAt: new Date().toISOString(),
    }));
    render(<MemoryRouter><AdminSales /></MemoryRouter>);
    expect(await screen.findByText(`참고 ${KRW} · 2건`)).toBeInTheDocument();
    expect(screen.getByText(/참고 환산 · 적용 환율 1,480원\/USD/)).toBeInTheDocument();
    expect(screen.queryByText(/실시간/)).toBeNull();

    cleanup();
    fetchMock.mockResolvedValueOnce(reply({ exchangeRate: RATE }));
    renderAnalytics();
    expect(await screen.findByText(KRW)).toBeInTheDocument(); // 같은 USD → 같은 원화
  });
});

describe('constants other callers rely on', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

  it('AdminAnalytics no longer imports the fixed USD_TO_KRW', () => {
    expect(read('src/pages/AdminAnalytics.tsx')).not.toMatch(/import[^\n]*USD_TO_KRW/);
  });

  it('src/lib/exchange-rate.ts (policy_krw_per_usd || 1350) and api/_shared/exchange-rate.js are unchanged', async () => {
    const lib = await import('../../src/lib/exchange-rate');
    const spec = JSON.parse(read('src/data/pricing_spec.json')) as { policy_krw_per_usd?: number };
    expect(lib.KRW_PER_USD).toBe(spec.policy_krw_per_usd || 1350);
    expect(lib.USD_TO_KRW).toBe(lib.KRW_PER_USD);
    const shared = await import('../../api/_shared/exchange-rate.js');
    const { loadPricingSpec } = await import('../../api/_shared/pricing.js');
    expect(shared.USD_TO_KRW).toBe(((loadPricingSpec() || {}) as { charter_usd_fix_rate?: number }).charter_usd_fix_rate || 1350);
    expect(shared.usdToKrw(1)).toBe(shared.USD_TO_KRW);
  });
});
