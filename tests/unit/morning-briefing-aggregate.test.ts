import { describe, it, expect } from 'vitest';
// @ts-expect-error — ESM .js in api/, no type decls
import { aggregateMorningBriefing, aggregateErrors, kstYesterdayWindow, kstWeekStartMs, kstMonthStartMs, toMs, AI_FEE_USD } from '../../api/_shared/morningBriefingAggregate.js';
// @ts-expect-error — ESM .js
import { normalizeMarketing, buildMarketingSQL } from '../../api/_shared/morningBriefingMarketing.js';

// 2026-06-10 자가운영 에이전시 사무실 4직원 — 머지 전 로컬 검증($0, Gemini X).
// now(실) = 2026-06-10 02:00 UTC = 11:00 KST(수). 어제 = 06-09(화). 이번주 시작 = 월 06-08. 이번달 = 06-01.
const NOW = new Date('2026-06-10T02:00:00Z');
const YMS = Date.parse('2026-06-09T03:00:00Z');          // 어제 정오 KST
const MON_MS = Date.parse('2026-06-08T03:00:00Z');        // 이번주 월요일 KST
const EARLY_JUN_MS = Date.parse('2026-06-03T03:00:00Z');  // 이번달, 지난주
const MAY_MS = Date.parse('2026-05-20T03:00:00Z');        // 지난달
const ts = (ms: number) => ({ toDate: () => new Date(ms) }); // Firestore Timestamp mock

describe('KST 경계 (off-by-9h 차단)', () => {
  it('어제/주(월)/달(1일) 시작 실 epoch', () => {
    const { yStartMs, todayStartMs } = kstYesterdayWindow(NOW);
    expect(yStartMs).toBe(Date.parse('2026-06-08T15:00:00Z'));      // 06-09 00:00 KST
    expect(todayStartMs).toBe(Date.parse('2026-06-09T15:00:00Z'));  // 06-10 00:00 KST
    expect(kstWeekStartMs(NOW)).toBe(Date.parse('2026-06-07T15:00:00Z'));  // 06-08(월) 00:00 KST
    expect(kstMonthStartMs(NOW)).toBe(Date.parse('2026-05-31T15:00:00Z')); // 06-01 00:00 KST
  });
});

describe('aggregateMorningBriefing — 4직원 어제 집계 + 추세', () => {
  const result = aggregateMorningBriefing({
    bookingDocs: [
      { id: 'PAYPAL-1', createdAt: ts(YMS), amountUSD: '120.00', status: 'CONFIRMED', productType: 'charter_transfer', userEmail: 'real@x.com' }, // 어제 실매출
      { id: 'TEST-abc', createdAt: ts(YMS), amountUSD: '999', status: 'CONFIRMED', productType: 'tour-seoul' },                                  // 제외(bypass)
      { id: 'PAYPAL-2', createdAt: ts(YMS), amountUSD: '50', status: 'CANCELED', productType: 'tour-seoul', userEmail: 'real@x.com' },           // 제외(canceled)
      { id: 'PAYPAL-3', createdAt: ts(YMS), amountUSD: '100', status: 'PAID', productType: 'tour-busan', userEmail: '2001leety@gmail.com' },     // 제외(운영자)
      { id: 'MON-1', createdAt: ts(MON_MS), amountUSD: '200', status: 'CONFIRMED', productType: 'tour-seoul', userEmail: 'real@x.com' },         // 이번주(어제 아님)
      { id: 'JUN-1', createdAt: ts(EARLY_JUN_MS), amountUSD: '80', status: 'CONFIRMED', productType: 'pickup', userEmail: 'real@x.com' },        // 이번달(주 아님)
      { id: 'MAY-1', createdAt: ts(MAY_MS), amountUSD: '50', status: 'CONFIRMED', productType: 'tour-seoul', userEmail: 'real@x.com' },          // 지난달(추세 밖)
      { id: 'REV-1', createdAt: ts(MAY_MS), reviewRequestSent: ts(YMS), amountUSD: '0', status: 'CONFIRMED', productType: 'tour-seoul', userEmail: 'r@x.com' }, // 리뷰요청 어제 발송
    ],
    planDocs: [
      { id: 'p1', createdAtMs: YMS, status: 'ready', isAdminBypass: false, paymentSource: 'paypal' },
      { id: 'p2', createdAtMs: YMS, status: 'ready', isAdminBypass: true, paymentSource: 'admin-bypass' },
    ],
    userDocs: [{ id: 'u1', createdAt: ts(YMS), role: 'user' }, { id: 'u2', createdAt: ts(YMS), role: 'admin' }],
    errorDocs: [
      { id: 'e1', createdAt: YMS, severity: 'critical', key: 'PAYPAL_FAIL' },
      { id: 'e2', createdAt: YMS, severity: 'high', key: 'PAYPAL_FAIL' },
      { id: 'e3', createdAt: YMS, severity: 'low', key: 'GEMINI_TIMEOUT' },
      { id: 'e4', createdAt: Date.parse('2026-06-10T01:00:00Z'), severity: 'critical', key: 'TODAY' }, // 오늘=제외
    ],
    cstDocs: [
      { id: 'c1', createdAt: YMS, status: 'open' },
      { id: 'c2', createdAt: Date.parse('2026-06-10T01:00:00Z'), status: 'open' }, // 오늘=제외
    ],
  }, { now: NOW });

  it('💰 재무: 어제 매출 1건 $120 (테스트/취소/운영자 제외)', () => {
    expect(result.revenue.count).toBe(1);
    expect(result.revenue.usd).toBe(120);
    expect(result.byProduct['전세'].count).toBe(1);
  });
  it('💰 재무 추세: 이번주 $320(어제+월) · 이번달 $400(+초순)', () => {
    expect(result.trends.week).toEqual({ usd: 320, count: 2 });
    expect(result.trends.month).toEqual({ usd: 400, count: 3 });
  });
  it('🤖 AI 플래너 1건 / 👤 신규가입 1명', () => {
    expect(result.aiPlanner.paidCount).toBe(1);
    expect(result.aiPlanner.feeUsd).toBe(AI_FEE_USD);
    expect(result.newUsers).toBe(1);
  });
  it('🛠️ 운영: 오류 3건, 심각도 분포, Top 키', () => {
    expect(result.errors.total).toBe(3);
    expect(result.errors.bySeverity).toEqual({ critical: 1, high: 1, medium: 0, low: 1 });
    expect(result.errors.top[0]).toEqual({ key: 'PAYPAL_FAIL', count: 2 });
  });
  it('💬 고객: 신규 문의 1건 + 리뷰요청 발송 1건', () => {
    expect(result.customer.newTickets).toBe(1);
    expect(result.customer.reviewsSent).toBe(1);
  });
});

describe('aggregateErrors — 빈/경계', () => {
  it('빈 입력 → 0, throw 없음', () => {
    const e = aggregateErrors([], 0, 1);
    expect(e.total).toBe(0);
    expect(e.bySeverity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
    expect(e.top).toEqual([]);
  });
});

describe('마케팅 정규화 (순수) + SQL', () => {
  it('normalizeMarketing: results → {visitors, conversions}', () => {
    expect(normalizeMarketing([[150, 3]])).toEqual({ visitors: 150, conversions: 3 });
    expect(normalizeMarketing([])).toEqual({ visitors: 0, conversions: 0 });
    expect(normalizeMarketing(undefined)).toEqual({ visitors: 0, conversions: 0 });
  });
  it('buildMarketingSQL: 어제 UTC 구간 + payment_completed 포함', () => {
    const { yStartMs, todayStartMs } = kstYesterdayWindow(NOW);
    const sql = buildMarketingSQL(yStartMs, todayStartMs);
    expect(sql).toContain('payment_completed');
    expect(sql).toContain('2026-06-08 15:00:00'); // 어제 00:00 KST = UTC
    expect(sql).toContain('2026-06-09 15:00:00'); // 오늘 00:00 KST = UTC
  });
});

describe('graceful', () => {
  it('빈 입력 / undefined → 0, throw 없음', () => {
    const empty = aggregateMorningBriefing({}, { now: NOW });
    expect(empty.revenue.count).toBe(0);
    expect(empty.trends.week.usd).toBe(0);
    expect(empty.errors.total).toBe(0);
    expect(empty.customer.newTickets).toBe(0);
    expect(() => aggregateMorningBriefing(undefined as any, { now: NOW })).not.toThrow();
  });
});
