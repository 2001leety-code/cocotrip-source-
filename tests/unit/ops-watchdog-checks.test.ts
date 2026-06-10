import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — ESM .js
import { resolveKrwAmount } from '../../api/_shared/resolve-line-item.js';
// @ts-expect-error — ESM .js
import { checkPaymentInvariants, checkStuckStreamingPlans, checkErrorSurge, priceAuditKind, checkTransitService, checkServiceRenewals } from '../../api/_shared/opsWatchdogChecks.js';
// @ts-expect-error — ESM .js
import { TRANSIT_SERVICES } from '../../api/_shared/transitServiceConfig.js';

// 2026-06-10 수정팀(운영 감시원) — 순수 체크 머지 전 검증($0). 발견만, 수정 자동 X.
const SPEC = JSON.parse(readFileSync(join(process.cwd(), 'api/_pricing_spec.json'), 'utf-8'));
const PROD = 'kpop_shuttle_oneway';
const LIST = resolveKrwAmount(SPEC, PROD, 2, 1); // pax2 = 70000

describe('priceAuditKind — 감사 범위 분류', () => {
  it('krw_fixed: airport/combo/kpop / usd_primary: ai_planner / unsupported: transfer·multiday', () => {
    expect(priceAuditKind('kpop_shuttle_oneway')).toBe('krw_fixed');
    expect(priceAuditKind('airport_seoul-central')).toBe('krw_fixed');
    expect(priceAuditKind('ai_planner_full')).toBe('usd_primary');
    expect(priceAuditKind('charter_seoul_city')).toBe('duration_dependent'); // day_tour
    expect(priceAuditKind('charter_multiday')).toBe('unsupported');
    expect(priceAuditKind('charter_transfer')).toBe('unsupported');
  });
});

describe('checkPaymentInvariants — 단방향 오과금 + 무결성', () => {
  const bookings = [
    { id: 'o1', status: 'CONFIRMED', productType: PROD, paxCount: 2, amountUSD: '60', amountKRW: Math.round(LIST * 1.15), payerEmail: 'a@x.com' }, // 오과금
    { id: 'o2', status: 'CONFIRMED', productType: PROD, paxCount: 2, amountUSD: '50', amountKRW: LIST, payerEmail: 'a@x.com' },                    // 정가
    { id: 'o3', status: 'CONFIRMED', productType: PROD, paxCount: 2, amountUSD: '30', amountKRW: Math.round(LIST * 0.7), couponApplied: true, payerEmail: 'a@x.com' }, // 쿠폰 할인(과소)
    { id: 'o4', status: 'CONFIRMED', productType: 'airport_seoul-central', paxCount: 1, amountUSD: '0', amountKRW: 0, payerEmail: 'a@x.com' },      // 무결성(0원)
    { id: 'o5', status: 'CONFIRMED', productType: 'charter_multiday', paxCount: 2, amountUSD: '1000', amountKRW: 1400000, payerEmail: 'a@x.com' }, // blindspot
    { id: 'o6', status: 'CONFIRMED', productType: 'ai_planner_full', paxCount: 1, amountUSD: '9.9', amountKRW: 13860, payerEmail: 'a@x.com' },     // blindspot(usd_primary)
    { id: 'o7', status: 'PENDING', productType: PROD, paxCount: 2, amountUSD: '999', amountKRW: 9999999, payerEmail: 'a@x.com' },                  // 미확정 skip
    { id: 'TEST-x', status: 'CONFIRMED', productType: PROD, paxCount: 2, amountUSD: '999', amountKRW: 9999999, payerEmail: 'a@x.com' },            // 운영자 테스트 skip
  ];
  const r = checkPaymentInvariants(bookings, SPEC, {});
  it('오과금(청구>정가) 1건 + 무결성(0원) 1건', () => {
    expect(r.findings.filter((f: any) => f.kind === 'overcharge')).toHaveLength(1);
    expect(r.findings.filter((f: any) => f.kind === 'integrity')).toHaveLength(1);
    expect(r.findings.find((f: any) => f.kind === 'overcharge').orderID).toBe('o1');
  });
  it('정가/쿠폰할인은 flag 안 함 (단방향=청구<정가는 쿠폰 가능)', () => {
    expect(r.findings.find((f: any) => f.orderID === 'o2')).toBeUndefined();
    expect(r.findings.find((f: any) => f.orderID === 'o3')).toBeUndefined();
  });
  it('multiday/ai_planner = 사각지대(blindspot 2), 감사 3건(kpop)', () => {
    expect(r.blindspot).toBe(2);
    expect(r.audited).toBe(3);
  });
  it('PENDING·운영자테스트 skip (무결성/오과금에 안 잡힘)', () => {
    expect(r.findings.find((f: any) => f.orderID === 'o7')).toBeUndefined();
    expect(r.findings.find((f: any) => f.orderID === 'TEST-x')).toBeUndefined();
  });
});

describe('checkStuckStreamingPlans — 30분+ streaming critical', () => {
  const now = 1_000_000_000_000;
  const plans = [
    { id: 'p1', status: 'streaming', _streaming_started_at: now - 31 * 60000 }, // 31분 → critical
    { id: 'p2', status: 'streaming', _streaming_started_at: now - 29 * 60000 }, // 29분 → none
    { id: 'p3', status: 'ready', createdAtMs: now - 99 * 60000 },               // ready → none
  ];
  const r = checkStuckStreamingPlans(plans, { nowMs: now });
  it('30분 초과 streaming만 critical', () => {
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].planId).toBe('p1');
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0].ageMin).toBe(31);
  });
});

describe('checkErrorSurge — 절대 임계 4/10, 일시오류 제외', () => {
  const errs = [
    ...Array(11).fill({ key: 'PAYPAL_FAIL' }),
    ...Array(5).fill({ key: 'GEMINI_X' }),
    ...Array(3).fill({ key: 'MINOR' }),
    ...Array(50).fill({ key: 'TIMEOUT' }),
  ];
  const r = checkErrorSurge(errs, {});
  it('11→critical, 5→warning, 3→없음, TIMEOUT 제외', () => {
    expect(r.findings.find((f: any) => f.key === 'PAYPAL_FAIL').severity).toBe('critical');
    expect(r.findings.find((f: any) => f.key === 'GEMINI_X').severity).toBe('warning');
    expect(r.findings.find((f: any) => f.key === 'MINOR')).toBeUndefined();
    expect(r.findings.find((f: any) => f.key === 'TIMEOUT')).toBeUndefined();
  });
  it('빈 입력 → 0 (throw 없음)', () => {
    expect(checkErrorSurge([], {}).findings).toHaveLength(0);
  });
});

describe('checkTransitService — 만료·한도 감시 (매끄러운 전환)', () => {
  const SVC = TRANSIT_SERVICES; // odsay: 만료 2026-10-14, 1000회/일
  const FAR = Date.parse('2026-06-10T00:00:00+09:00'); // 만료 한참 전
  it('만료 7일 이내 → critical', () => {
    const r = checkTransitService(SVC, { nowMs: Date.parse('2026-10-10T00:00:00+09:00'), activeKey: 'odsay', plansYesterday: 0 });
    expect(r.findings.find((f: any) => f.kind === 'transit-expiry').severity).toBe('critical');
  });
  it('만료 30일 이내 → warning', () => {
    const r = checkTransitService(SVC, { nowMs: Date.parse('2026-09-20T00:00:00+09:00'), activeKey: 'odsay', plansYesterday: 0 });
    expect(r.findings.find((f: any) => f.kind === 'transit-expiry').severity).toBe('warning');
  });
  it('만료 한참 남음 → 만료 finding 없음', () => {
    expect(checkTransitService(SVC, { nowMs: FAR, activeKey: 'odsay', plansYesterday: 0 }).findings.find((f: any) => f.kind === 'transit-expiry')).toBeUndefined();
  });
  it('한도 추정 90%+ → critical / 70%+ → warning / 낮으면 없음', () => {
    expect(checkTransitService(SVC, { nowMs: FAR, activeKey: 'odsay', plansYesterday: 50, callsPerPlan: 18.8 }).findings.find((f: any) => f.kind === 'transit-quota').severity).toBe('critical'); // 940/1000
    expect(checkTransitService(SVC, { nowMs: FAR, activeKey: 'odsay', plansYesterday: 40, callsPerPlan: 18.8 }).findings.find((f: any) => f.kind === 'transit-quota').severity).toBe('warning'); // 752/1000
    expect(checkTransitService(SVC, { nowMs: FAR, activeKey: 'odsay', plansYesterday: 10, callsPerPlan: 18.8 }).findings.find((f: any) => f.kind === 'transit-quota')).toBeUndefined();
  });
  it('유료(tmap_paid, quota null) → 한도 finding 없음', () => {
    expect(checkTransitService(SVC, { nowMs: FAR, activeKey: 'tmap_paid', plansYesterday: 9999 }).findings.find((f: any) => f.kind === 'transit-quota')).toBeUndefined();
  });
  it('알 수 없는 provider → findings 0', () => {
    expect(checkTransitService(SVC, { activeKey: 'bogus' }).findings).toHaveLength(0);
  });
});

describe('checkServiceRenewals — 자격증명/서비스 수명 감시', () => {
  const NOW = Date.parse('2026-06-10T00:00:00+09:00');
  it('만료일 미기록 → "기록 필요" warning(undated)', () => {
    const r = checkServiceRenewals([{ key: 'domain', label: '도메인', kind: 'expiry', expiryDate: null }], { nowMs: NOW });
    expect(r.findings[0].undated).toBe(true);
    expect(r.findings[0].severity).toBe('warning');
  });
  it('rotation 7일 이내 도래 → critical', () => {
    // lastRotated 2026-03-12 + 90일 = 2026-06-10 → daysLeft 0
    const r = checkServiceRenewals([{ key: 'paypal_secret', label: 'PayPal', kind: 'rotation', rotationDays: 90, lastRotated: '2026-03-13' }], { nowMs: NOW });
    expect(r.findings[0].severity).toBe('critical');
  });
  it('rotation 30일 이내 → warning, 한참 남으면 없음', () => {
    expect(checkServiceRenewals([{ key: 'k', label: 'K', kind: 'rotation', rotationDays: 365, lastRotated: '2025-07-01' }], { nowMs: NOW }).findings[0].severity).toBe('warning'); // 2026-07-01 도래 = 21일
    expect(checkServiceRenewals([{ key: 'k', label: 'K', kind: 'rotation', rotationDays: 365, lastRotated: '2026-04-01' }], { nowMs: NOW }).findings).toHaveLength(0); // 2027-04-01 도래
  });
  it('expiry 만료일 기반 + info kind 제외 + 빈 입력', () => {
    expect(checkServiceRenewals([{ key: 'd', label: 'D', kind: 'expiry', expiryDate: '2026-06-15' }], { nowMs: NOW }).findings[0].severity).toBe('critical'); // 5일 후
    expect(checkServiceRenewals([{ key: 'i', label: 'I', kind: 'info' }], { nowMs: NOW }).findings).toHaveLength(0);
    expect(checkServiceRenewals([], { nowMs: NOW }).findings).toHaveLength(0);
    expect(checkServiceRenewals(undefined, { nowMs: NOW }).findings).toHaveLength(0);
  });
});
