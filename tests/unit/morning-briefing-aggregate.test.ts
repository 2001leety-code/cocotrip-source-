import { describe, it, expect } from 'vitest';
// @ts-expect-error — ESM .js in api/, no type decls
import { aggregateMorningBriefing, kstYesterdayWindow, toMs, AI_FEE_USD } from '../../api/_shared/morningBriefingAggregate.js';

// 2026-06-10 자가운영 에이전시 P1 모닝 브리핑 — 머지 전 로컬 검증($0, Gemini X).
// 운영자 "돈 드는 dispatch 없이 머지 전 검증" 원칙: 집계는 순수 함수라 100% 로컬.

// now(실) = 2026-06-10 02:00 UTC = 11:00 KST. → 어제 KST = [2026-06-09 00:00 KST, 2026-06-10 00:00 KST).
const NOW = new Date('2026-06-10T02:00:00Z');
const YMS = Date.parse('2026-06-09T03:00:00Z'); // 어제 정오 KST (= 2026-06-09 12:00 KST)
const ts = (ms: number) => ({ toDate: () => new Date(ms) }); // Firestore Timestamp mock

describe('kstYesterdayWindow — KST 달력일 경계 (off-by-9h 차단)', () => {
  const { yStartMs, todayStartMs } = kstYesterdayWindow(NOW);
  it('어제 00:00 KST = 2026-06-08 15:00 UTC, 오늘 00:00 KST = 2026-06-09 15:00 UTC', () => {
    expect(yStartMs).toBe(Date.parse('2026-06-08T15:00:00Z'));
    expect(todayStartMs).toBe(Date.parse('2026-06-09T15:00:00Z'));
    expect(todayStartMs - yStartMs).toBe(24 * 3600 * 1000); // 정확히 24h
  });
  it('toMs: Timestamp / number / ISO / null 처리', () => {
    expect(toMs(ts(123))).toBe(123);
    expect(toMs(123)).toBe(123);
    expect(toMs('2026-06-09T03:00:00Z')).toBe(YMS);
    expect(toMs(null)).toBeNull();
    expect(toMs({ _seconds: 100 })).toBe(100000);
  });
});

describe('aggregateMorningBriefing — 어제 실데이터 집계', () => {
  const result = aggregateMorningBriefing({
    bookingDocs: [
      { id: 'PAYPAL-1', createdAt: ts(YMS), amountUSD: '120.00', status: 'CONFIRMED', productType: 'charter_transfer', userEmail: 'real@x.com' }, // 실매출
      { id: 'TEST-abc', createdAt: ts(YMS), amountUSD: '999', status: 'CONFIRMED', productType: 'tour-seoul' },                                  // 제외(bypass id)
      { id: 'PAYPAL-2', createdAt: ts(YMS), amountUSD: '50', status: 'CANCELED', productType: 'tour-seoul', userEmail: 'real@x.com' },           // 제외(canceled)
      { id: 'PAYPAL-3', createdAt: ts(YMS), amountUSD: '100', status: 'PAID', productType: 'tour-busan', userEmail: '2001leety@gmail.com' },     // 제외(운영자 이메일)
    ],
    planDocs: [
      { id: 'p1', createdAtMs: YMS, status: 'ready', isAdminBypass: false, paymentSource: 'paypal' }, // 카운트
      { id: 'p2', createdAtMs: YMS, status: 'ready', isAdminBypass: true, paymentSource: 'admin-bypass' }, // 제외
      { id: 'p3', createdAtMs: YMS, status: 'streaming', paymentSource: 'paypal' }, // 제외(미완성)
    ],
    userDocs: [
      { id: 'u1', createdAt: ts(YMS), role: 'user' }, // 카운트
      { id: 'u2', createdAt: ts(YMS), role: 'admin' }, // 제외
    ],
  }, { now: NOW });

  it('예약 실매출 = 1건 $120 (테스트/취소/운영자이메일 제외)', () => {
    expect(result.revenue.count).toBe(1);
    expect(result.revenue.usd).toBe(120);
  });
  it('상품 버킷: charter_transfer → 전세 1건', () => {
    expect(result.byProduct['전세'].count).toBe(1);
    expect(result.byProduct['전세'].usd).toBe(120);
  });
  it('AI 플래너 유료 = 1건, 수수료 = 1 × 9.90', () => {
    expect(result.aiPlanner.paidCount).toBe(1);
    expect(result.aiPlanner.feeUsd).toBe(AI_FEE_USD);
  });
  it('신규 가입 = 1명 (admin 제외)', () => {
    expect(result.newUsers).toBe(1);
  });
  it('제외 메타: bypass 2(테스트id+운영자이메일), canceled 1', () => {
    expect(result.meta.excludedBypass).toBe(2);
    expect(result.meta.excludedCanceled).toBe(1);
  });
});

describe('경계/graceful', () => {
  const { yStartMs, todayStartMs } = kstYesterdayWindow(NOW);
  it('어제 00:00 정각 포함(>=), 오늘 00:00 정각 제외(<)', () => {
    const atYStart = aggregateMorningBriefing({ bookingDocs: [{ id: 'b', createdAt: ts(yStartMs), amountUSD: '10', status: 'PAID', productType: 'tour-x', userEmail: 'r@x.com' }] }, { now: NOW });
    expect(atYStart.revenue.count).toBe(1);
    const atTodayStart = aggregateMorningBriefing({ bookingDocs: [{ id: 'b', createdAt: ts(todayStartMs), amountUSD: '10', status: 'PAID', productType: 'tour-x', userEmail: 'r@x.com' }] }, { now: NOW });
    expect(atTodayStart.revenue.count).toBe(0);
  });
  it('오늘/그저께 결제는 어제 집계에서 제외', () => {
    const r = aggregateMorningBriefing({ bookingDocs: [
      { id: 'today', createdAt: ts(Date.parse('2026-06-10T01:00:00Z')), amountUSD: '10', status: 'PAID', productType: 'tour-x', userEmail: 'r@x.com' },
      { id: 'd2ago', createdAt: ts(Date.parse('2026-06-07T03:00:00Z')), amountUSD: '10', status: 'PAID', productType: 'tour-x', userEmail: 'r@x.com' },
    ] }, { now: NOW });
    expect(r.revenue.count).toBe(0);
  });
  it('빈 입력 / undefined → 0, throw 없음', () => {
    const empty = aggregateMorningBriefing({}, { now: NOW });
    expect(empty.revenue.count).toBe(0);
    expect(empty.newUsers).toBe(0);
    expect(empty.aiPlanner.paidCount).toBe(0);
    expect(() => aggregateMorningBriefing(undefined as any, { now: NOW })).not.toThrow();
  });
});
