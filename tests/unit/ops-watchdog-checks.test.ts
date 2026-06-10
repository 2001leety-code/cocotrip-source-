import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — ESM .js
import { resolveKrwAmount } from '../../api/_shared/resolve-line-item.js';
// @ts-expect-error — ESM .js
import { checkPaymentInvariants, checkStuckStreamingPlans, checkErrorSurge, priceAuditKind } from '../../api/_shared/opsWatchdogChecks.js';

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
