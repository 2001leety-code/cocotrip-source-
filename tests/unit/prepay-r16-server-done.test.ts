/**
 * 2026-10-26 B6-1 r16 — 서버: 완료 전용 조회(isPlanIssuanceComplete)가 입력 대조·식이 검사보다 먼저.
 *   재현: 손님이 상세를 안 본 채 서버 발급이 끝나고, 그 뒤 검증 식당 후보가 사라진 상태로 재방문 → 식이 검사 422 가 아니라 DUPLICATE_ORDER
 *   (프론트가 포인터 정리). 발급권 선점(claimPlanIssuance)은 그대로 식이 검사 뒤. 실 PayPal·Firestore 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Dict = Record<string, unknown>;
vi.mock('../../api/_shared/paypal.js', () => ({ getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api.mock' }), resolveIsSandbox: () => true }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', increment: (n: number) => ({ __inc: n }) } }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: async () => {} }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: async () => {} }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: async () => {} }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));

import { normalizePrepayInput, prepayFingerprint } from '../../api/_shared/prepay-coverage.js';
// @ts-expect-error — JS 모듈
const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');
// @ts-expect-error — JS 모듈
const { isPlanIssuanceComplete } = await import('../../api/_shared/plan-issuance.js');

const ORDER = '5O190127TN364715T';
const HALAL_SEOUL = { name: '합성할랄식당', nameEn: 'Synthetic Halal', city: 'seoul', tag: 'halal', verification_status: 'halal_certified', address: '서울특별시 중구 합성로 1', lat: 37.56, lng: 126.98 };
const input = (o: Dict = {}): Dict => ({ regions: ['Seoul'], dietaryRestrictions: ['Halal'], dietPrefs: [], startDate: '2099-12-01', durationDays: 3, ...o });

function memDb(seed: Record<string, Dict> = {}) {
  const store = new Map<string, Dict>(Object.entries(seed).map(([k, v]) => [k, structuredClone(v)]));
  const calls = { tx: 0 };
  const snap = (path: string) => { const d = store.get(path); return { exists: !!d, data: () => (d ? structuredClone(d) : undefined), ref: { __path: path } }; };
  const docRef = (path: string): Dict => ({
    __path: path, id: path.split('/').pop(),
    get: async () => snap(path),
    set: async (data: Dict, o?: { merge?: boolean }) => { store.set(path, o && o.merge ? { ...(store.get(path) || {}), ...data } : { ...data }); },
    update: async (data: Dict) => { if (!store.has(path)) throw new Error('NOT_FOUND'); store.set(path, { ...store.get(path), ...data }); },
    delete: async () => { store.delete(path); },
    collection: (name: string) => col(`${path}/${name}`),
  });
  const col = (base: string): Dict => ({
    doc: (id: string) => docRef(`${base}/${id}`),
    add: async (data: Dict) => { store.set(`${base}/auto${store.size}`, data); },
    where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
  });
  return {
    _store: store, _calls: calls,
    collection: (name: string) => col(name),
    runTransaction: async (fn: (tx: Dict) => Promise<unknown>) => {
      calls.tx += 1;
      const staged: Array<() => void> = [];
      const tx = {
        get: async (ref: { __path: string }) => snap(ref.__path),
        set: (ref: { __path: string }, data: Dict) => staged.push(() => store.set(ref.__path, { ...data })),
        create: (ref: { __path: string }, data: Dict) => staged.push(() => { store.set(ref.__path, { ...data }); }),
        update: (ref: { __path: string }, data: Dict) => staged.push(() => store.set(ref.__path, { ...store.get(ref.__path), ...data })),
        delete: (ref: { __path: string }) => staged.push(() => store.delete(ref.__path)),
      };
      const out = await fn(tx);
      staged.forEach((s) => s());
      return out;
    },
  };
}
const paidOrderFetch = () => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: ORDER, status: 'COMPLETED',
    purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } }] } }] }) })) as never;
};
const paidSeed = (issuance: Dict | null, plan: Dict | null = null) => {
  const n = normalizePrepayInput(input()); if (!n.ok) throw new Error('n');
  return memDb({
    [`paypal_order_snapshots/${ORDER}`]: { productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', expectedKRW: 14000, prepayInput: n.input, prepayInputVersion: 1, prepayFingerprint: prepayFingerprint(n.input) },
    ...(issuance ? { [`plan_issued_orders/${ORDER}`]: issuance } : {}),
    ...(plan ? { 'plans/PLAN-1': plan } : {}),
  });
};

beforeEach(() => { paidOrderFetch(); });

describe('r16 — an already issued order answers DUPLICATE_ORDER before the dietary check', () => {
  it('Astra repro: issued (ISSUED) + verified restaurants gone → DUPLICATE_ORDER (not 422), no new claim', async () => {
    const db = paidSeed({ status: 'ISSUED', planId: 'PLAN-1', attemptId: 'a1' });
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [] });
    expect(r.rejection).toMatchObject({ statusCode: 403, code: 'DUPLICATE_ORDER' });
    expect(db._calls.tx).toBe(0); // 발급권 선점 tx 까지 가지 않았다
  });
  it('legacy issued marker (no status) → DUPLICATE_ORDER before the dietary check', async () => {
    const db = paidSeed({ planId: 'PLAN-1', issuedAt: '2026-07-01' });
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [] });
    expect(r.rejection).toMatchObject({ code: 'DUPLICATE_ORDER' });
  });
  it('not issued yet (no record) + no verified restaurants → the dietary check still refuses (422-class), claim not taken', async () => {
    const db = paidSeed(null);
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [] });
    expect(r.rejection).toBeDefined();
    expect(r.rejection.code).not.toBe('DUPLICATE_ORDER');
    expect([...db._store.keys()].some((k) => k.startsWith('plan_issued_orders/'))).toBe(false);
  });
  it('not issued yet + verified restaurants → passes and claims (claim stays after the dietary check)', async () => {
    const db = paidSeed(null);
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER, language: 'ko' }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(r.rejection).toBeUndefined();
    expect(r.planClaim).toBeDefined();
  });
});

describe('r17 — the owner check comes before the completion check (no completion leak to another user)', () => {
  const owned = (issuance: Dict | null) => {
    const n = normalizePrepayInput(input()); if (!n.ok) throw new Error('n');
    return memDb({
      [`paypal_order_snapshots/${ORDER}`]: { productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', expectedKRW: 14000, prepayInput: n.input, prepayInputVersion: 1, prepayFingerprint: prepayFingerprint(n.input), ownerUid: 'owner-1' },
      ...(issuance ? { [`plan_issued_orders/${ORDER}`]: issuance } : {}),
    });
  };
  it.each([['issued', { status: 'ISSUED', planId: 'PLAN-1' }], ['not issued', null]] as Array<[string, Dict | null]>)('another uid, %s → FORBIDDEN (same answer)', async (_n, issuance) => {
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, owned(issuance), 'x@e.x', 'intruder', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
  it('the owner, issued → DUPLICATE_ORDER', async () => {
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, owned({ status: 'ISSUED', planId: 'PLAN-1' }), 'o@e.x', 'owner-1', null, { loadFoodIndex: async () => [] });
    expect(r.rejection).toMatchObject({ code: 'DUPLICATE_ORDER' });
  });
});

describe('r16 — isPlanIssuanceComplete (read-only)', () => {
  const readyPlan = { status: 'ready', planId: 'PLAN-1', input: { paypalOrderId: ORDER } };
  it.each([
    ['no record', null, null, false],
    ['ISSUED', { status: 'ISSUED', planId: 'PLAN-1' }, null, true],
    ['legacy marker without status', { planId: 'PLAN-1' }, null, true],
    ['ISSUING + finished plan for this order', { status: 'ISSUING', planId: 'PLAN-1', leaseExpiresAt: 0 }, readyPlan, true],
    ['COMMITTING + finished plan for this order', { status: 'COMMITTING', planId: 'PLAN-1', leaseExpiresAt: 0 }, readyPlan, true],
    ['ISSUING + streaming plan (record exists ≠ done)', { status: 'ISSUING', planId: 'PLAN-1', leaseExpiresAt: 0 }, { ...readyPlan, status: 'streaming' }, false],
    ['ISSUING + plan of another order', { status: 'ISSUING', planId: 'PLAN-1', leaseExpiresAt: 0 }, { ...readyPlan, input: { paypalOrderId: 'OTHER' } }, false],
    ['NEEDS_REVIEW', { status: 'NEEDS_REVIEW', planId: 'PLAN-1' }, readyPlan, false],
  ] as Array<[string, Dict | null, Dict | null, boolean]>)('%s → %s, state unchanged', async (_n, issuance, plan, want) => {
    const db = memDb({ ...(issuance ? { [`plan_issued_orders/${ORDER}`]: issuance } : {}), ...(plan ? { 'plans/PLAN-1': plan } : {}) });
    const before = JSON.stringify([...db._store.entries()]);
    expect(await isPlanIssuanceComplete(db, ORDER)).toBe(want);
    expect(JSON.stringify([...db._store.entries()])).toBe(before);
  });
  it('source order: completion pre-check → input bind → dietary coverage → claim', () => {
    const src = readFileSync(resolve(process.cwd(), 'api/_ai_core/paymentGate.js'), 'utf8');
    const pre = src.indexOf('alreadyIssued = await isPlanIssuanceComplete(adminDb, paypalOrderId)');
    const bind = src.indexOf('bound = await bindPrepayInputBeforeClaim(', pre); // PayPal 경로(앞쪽 QR 경로는 used 기록으로 이미 먼저 DUPLICATE 판정)
    const cov = src.indexOf('const paidCoverage = await paidCoverageRejection(', bind); // 유료 경로의 호출(앞쪽 다른 경로 호출 제외)
    const claim = src.indexOf('claimResult = await claimPlanIssuance(adminDb, paypalOrderId');
    expect(pre).toBeGreaterThan(0);
    expect(pre).toBeLessThan(bind);
    expect(bind).toBeLessThan(cov);
    expect(cov).toBeLessThan(claim);
  });
});
