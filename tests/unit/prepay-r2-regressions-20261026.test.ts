/**
 * 2026-10-26 B6-1 r2 — 결제 전 확인 PR 보완 회귀(적대적 리뷰 prepay-adversarial-r1 · Astra astra-prepay-pr-r1).
 *   1 QR(paypal.me) 경로도 같은 결제 전 확인 · 2 capture 상태기계(사전 거부 뒤 새 capture POST 금지, 안전 창)
 *   3 paymentGate 소유자 검사 우선 · 4 지문(도시 집합·입출국·area) · 5 409 고정 입력 요약 + 같은 조건 재구성
 *   6 출발일 > KST 오늘(주문 생성·capture 직전) · 7 결제 전/후 문구 분리.
 *   실 PayPal·Firestore·LLM 호출 0 (전부 mock).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { runHandlerFailureCleanup } from '../../api/_ai_core/planCloseout.js';
import { checkStartDateTooSoon } from '../../api/_ai_core/validateStartDate.js';
import { checkPrepayCoverage } from '../../api/_shared/prepay-coverage.js';

type Dict = Record<string, unknown>;
const dbHolder: { db: unknown } = { db: null };
const foodHolder: { rows: Dict[] } = { rows: [] };
const paypalTokenCalls: number[] = [];

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbHolder.db }));
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => { paypalTokenCalls.push(1); return { accessToken: 'tok', baseUrl: 'https://api.mock' }; },
  resolveIsSandbox: () => true,
}));
vi.mock('../../api/_ai_core/geminiPipeline.js', () => ({ loadFoodIndex: async () => foodHolder.rows }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', increment: (n: number) => ({ __inc: n }) } }));
const observed = vi.hoisted(() => ({ alerts: [] as string[], errors: [] as string[] }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: async (a: { key: string }) => { observed.alerts.push(a.key); } }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: async () => {} }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: async () => {} }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async (_e: unknown, ctx: { step?: string }) => { observed.errors.push(String(ctx && ctx.step)); } }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({
  triggerBookingProcessor: async () => ({ ok: true, outcome: 'completed' }), PENDING_PROCESSOR_RETRIES_COLLECTION: 'pending_processor_retries',
}));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: async () => ({ ok: true, final: true }) }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: async () => ({ ok: true }) }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({ checkIpRateLimit: async () => ({ ok: true }), getClientIp: () => '1.2.3.4' }));

import { normalizePrepayInput, prepayFingerprint } from '../../api/_shared/prepay-coverage.js';
import { reconcileCapture, CLAIM_LEASE_MS, isCheckoutUnresolved } from '../../api/_shared/payment-fulfillment-recovery.js';
// @ts-expect-error — JS 핸들러
const { default: createHandler } = await import('../../api/createPaypalOrder.js');
// @ts-expect-error — JS 핸들러
const { default: captureHandler } = await import('../../api/capturePaypalOrder.js');
// @ts-expect-error — JS 핸들러
const { default: manualHandler } = await import('../../api/manual-payment-request.js');
// @ts-expect-error — JS 모듈
const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ORDER = '5O190127TN364715T';
const HALAL_SEOUL = { name: '합성할랄식당', nameEn: 'Synthetic Halal', city: 'seoul', tag: 'halal', verification_status: 'halal_certified', address: '서울특별시 중구 합성로 1', lat: 37.56, lng: 126.98 };
const HALAL_BUSAN = { ...HALAL_SEOUL, city: 'busan', address: '부산광역시 해운대구 합성로 1' };
const input = (o: Dict = {}): Dict => ({ regions: ['Seoul'], dietaryRestrictions: ['Halal'], dietPrefs: [], startDate: '2099-12-01', durationDays: 3, ...o });
const todayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const fp = (o: Dict) => { const n = normalizePrepayInput(o); if (!n.ok) throw new Error(String(n.code)); return prepayFingerprint(n.input); };
const norm = (o: Dict) => { const n = normalizePrepayInput(o); if (!n.ok) throw new Error(String(n.code)); return n.input as Dict; };

function mockRes() {
  const out: { status?: number; body?: Dict } = {};
  return { _out: out, writeHead(s: number) { out.status = s; return this; }, end(b?: string) { out.body = b ? JSON.parse(b) : undefined; return this; }, setHeader() {} };
}
/** 메모리 Firestore — get/set/update/delete + runTransaction(get/set/update/create/delete). */
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
        set: (ref: { __path: string }, data: Dict, o?: { merge?: boolean }) => staged.push(() => store.set(ref.__path, o && o.merge ? { ...(store.get(ref.__path) || {}), ...data } : { ...data })),
        create: (ref: { __path: string }, data: Dict) => staged.push(() => { if (store.has(ref.__path)) throw new Error('ALREADY_EXISTS'); store.set(ref.__path, { ...data }); }),
        update: (ref: { __path: string }, data: Dict) => staged.push(() => store.set(ref.__path, { ...store.get(ref.__path), ...data })),
        delete: (ref: { __path: string }) => staged.push(() => store.delete(ref.__path)),
      };
      const out = await fn(tx);
      staged.forEach((s) => s());
      return out;
    },
  };
}

const couponPath = 'users/uid1/coupons/free1';
const couponOwner = { planOwnerUid: 'uid1', verifiedHistoryUid: 'uid1', forceGuestToken: false };
const couponDb = () => createFakeFirestore({ [couponPath]: { code: 'FREE1', productScope: 'ai-plan', type: 'free', isUsed: false, maxDays: 3 } });
async function assertCouponFailureRestores(db: ReturnType<typeof couponDb>, body: Dict, gate: Awaited<ReturnType<typeof enforcePaymentAndRevision>>, code: string, statusCode: number) {
  expect(gate.rejection).toBeUndefined();
  expect(gate.isFreeAiCoupon).toBe(true);
  const binding = gate.consumedCoupon.binding;
  expect(db.__get(couponPath)).toMatchObject({ isUsed: true, consumptionId: binding.consumptionId, aiPlanBinding: binding });
  const res = mockRes();
  await runHandlerFailureCleanup({ req: { method: 'POST', body }, res, adminDb: db,
    error: Object.assign(new Error(code), { code, statusCode }),
    issuance: { handedToWorker: false, releaseIfUnused: vi.fn(async () => {}) },
    consumedCouponInfo: gate.consumedCoupon, planPersisted: false, streamingPlanId: null, stage: 'pre-generation', plannerMode: 'legacy' });
  expect(res._out).toMatchObject({ status: statusCode, body: { code } });
  expect(db.__get(couponPath)).toMatchObject({ isUsed: false, consumptionId: null, aiPlanBinding: binding, aiPlanBindingState: 'restored' });
}

beforeEach(() => {
  paypalTokenCalls.length = 0;
  observed.alerts.length = 0;
  observed.errors.length = 0;
  foodHolder.rows = [HALAL_SEOUL];
});

// ── 2 capture 상태기계 ────────────────────────────────────────────────────────
describe('capture state machine after a pre-capture refusal (adversarial seq + Astra PAYER_ACTION_REQUIRED→APPROVED)', () => {
  const SECRET = 'a'.repeat(64);
  const cookie = `cocotrip_checkout_single=${ORDER}.${SECRET}`;
  const snapshot = () => ({
    productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', expectedKRW: 14000, passengers: 1,
    prepayInputVersion: 1, prepayInput: norm(input()), recoveryDigest: createHash('sha256').update(SECRET).digest('hex'),
  });
  const COMPLETED = { id: ORDER, status: 'COMPLETED', payer: { email_address: 'b@e.x', name: { given_name: 'A', surname: 'B' } },
    purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } }] } }] };
  const resp = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  /** gets: 차례로 돌려줄 GET 주문 상태('COMPLETED'·'APPROVED'·'PAYER_ACTION_REQUIRED'·'NETWORK'). post: capture POST 결과. */
  function paypal(plan: { post?: 'timeout' | 'completed'; gets?: string[] }) {
    const calls: string[] = [];
    const gets = [...(plan.gets || [])];
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (/\/v2\/checkout\/orders\/[^/]+\/capture$/.test(u)) {
        calls.push('POST');
        if (plan.post === 'timeout') { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }
        return resp(COMPLETED, 201);
      }
      if (/\/v2\/checkout\/orders\/[^/]+$/.test(u)) {
        calls.push('GET');
        const s = gets.shift() || 'APPROVED';
        if (s === 'NETWORK') throw new TypeError('fetch failed');
        return resp(s === 'COMPLETED' ? COMPLETED : { id: ORDER, status: s });
      }
      return resp({ ok: true });
    }) as never;
    return calls;
  }
  const call = async (body: Dict) => { const res = mockRes(); await captureHandler({ method: 'POST', body, headers: { cookie } }, res); return res._out; };
  const lockOf = () => (dbHolder.db as ReturnType<typeof memDb>)._store.get(`used_paypal_orders/${ORDER}`) as Dict | undefined;
  const ageLock = (ms: number) => {
    const store = (dbHolder.db as ReturnType<typeof memDb>)._store;
    const old = Date.now() - ms;
    store.set(`used_paypal_orders/${ORDER}`, { ...lockOf(), lastUnknownAtMs: old, capturePostedAtMs: old, createdAtMs: old });
  };
  /** 첫 capture: 커버리지 통과 → POST timeout → 202, 시도 기록 captureState='unknown'. */
  async function unknownAttempt() {
    dbHolder.db = memDb({ [`paypal_order_snapshots/${ORDER}`]: snapshot() });
    const calls = paypal({ post: 'timeout' });
    const out = await call({ orderID: ORDER });
    expect(out.status).toBe(202);
    expect(calls).toEqual(['POST']);
    expect(lockOf()).toMatchObject({ captureState: 'unknown' });
  }

  it('adversarial seq: unknown → coverage lost → lookup APPROVED inside the window keeps the attempt (202); late COMPLETED then records the payment without a new POST', async () => {
    await unknownAttempt();
    foodHolder.rows = []; // 그 사이 식당 자료 변경 → 커버리지 실패
    let calls = paypal({ gets: ['APPROVED'] });
    const seq2 = await call({ orderID: ORDER, reconcile: true });
    expect(seq2.status).toBe(202);
    expect(seq2.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(calls).toEqual(['GET']);
    expect(lockOf()).toBeDefined(); // 예전: 삭제 → 늦은 COMPLETED 가 no_attempt_record 로 사라졌다

    calls = paypal({ gets: ['COMPLETED'] }); // PayPal 이 진행 중이던 capture 를 끝냈다
    const seq3 = await call({ orderID: ORDER, reconcile: true });
    expect(seq3.status).toBe(200);
    expect(seq3.body).toMatchObject({ ok: true, finalized: true });
    expect(calls).not.toContain('POST');
    expect((dbHolder.db as ReturnType<typeof memDb>)._store.has(`bookings/${ORDER}`)).toBe(true);
  });

  it('r3 Astra repro: POST timeout → 125 s later APPROVED → record KEPT (elapsed time is not proof), operator alerted → late COMPLETED is recorded, never no_attempt_record', async () => {
    await unknownAttempt();
    foodHolder.rows = [];
    ageLock(125_000);
    let calls = paypal({ gets: ['APPROVED'] });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ code: 'PAYMENT_RECOVERY_PENDING', paymentStatus: 'CAPTURE_UNKNOWN' });
    expect(calls).toEqual(['GET']);
    expect(lockOf()).toMatchObject({ captureState: 'unknown' });
    expect(observed.alerts).toContain(`single-capture-unknown-${ORDER}`);

    calls = paypal({ gets: ['COMPLETED'] });
    const late = await call({ orderID: ORDER, reconcile: true });
    expect(late.status).toBe(200);
    expect(late.body).not.toMatchObject({ evidence: 'no_attempt_record' });
    expect(calls).not.toContain('POST');
    expect((dbHolder.db as ReturnType<typeof memDb>)._store.has(`bookings/${ORDER}`)).toBe(true);
  });

  it('only an explicit PayPal terminal state (VOIDED) proves nonpayment → record released, NOT_CAPTURED with the refusal reason', async () => {
    await unknownAttempt();
    foodHolder.rows = [];
    ageLock(CLAIM_LEASE_MS * 10);
    const calls = paypal({ gets: ['VOIDED'] });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(422);
    expect(out.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', paymentStatus: 'NOT_CAPTURED', preCaptureCode: 'DIETARY_COVERAGE_UNAVAILABLE' });
    expect(calls).toEqual(['GET']);
    expect(lockOf()).toMatchObject({ status: 'void_not_captured', captureState: 'not_captured' }); // r19: tombstone, not deleted
  });

  it('Astra seq: first lookup PAYER_ACTION_REQUIRED, a second would say APPROVED — never POSTed after the refusal; record kept even long after', async () => {
    await unknownAttempt();
    foodHolder.rows = [];
    ageLock(CLAIM_LEASE_MS * 10);
    const calls = paypal({ gets: ['PAYER_ACTION_REQUIRED', 'APPROVED'] });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(calls).toEqual(['GET']); // 예전: GET 2회 + POST 1회
    expect(out.status).toBe(202);
    expect(lockOf()).toBeDefined();
  });

  it('Astra seq inside the window: still no POST, attempt kept, 202', async () => {
    await unknownAttempt();
    foodHolder.rows = [];
    const calls = paypal({ gets: ['PAYER_ACTION_REQUIRED', 'APPROVED'] });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(calls).toEqual(['GET']);
    expect(out.status).toBe(202);
    expect(lockOf()).toBeDefined();
  });

  it('H: lookup unknown (network) after a refusal on a POSTED attempt → 202, captureState=unknown + lastUnknownAtMs recorded, operator alerted, no POST', async () => {
    await unknownAttempt();
    const store = (dbHolder.db as ReturnType<typeof memDb>)._store;
    store.set(`used_paypal_orders/${ORDER}`, { ...lockOf(), captureState: 'posted', lastUnknownAtMs: undefined, capturePostedAtMs: Date.now() - 200_000 });
    foodHolder.rows = [];
    observed.alerts.length = 0;
    const calls = paypal({ gets: ['NETWORK'] });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(out.status).toBe(202);
    expect(calls).toEqual(['GET']);
    expect(lockOf()).toMatchObject({ captureState: 'unknown' });
    expect(typeof lockOf()!.lastUnknownAtMs).toBe('number');
    expect(observed.alerts).toEqual([`single-capture-unknown-${ORDER}`]);
  });

  it('r4-7 (adversarial N4/N5): a recovering record still in captureState "none" never POSTed → refusal clears it (no GET, no POST), NOT_CAPTURED — not a forever 202', async () => {
    dbHolder.db = memDb({
      [`paypal_order_snapshots/${ORDER}`]: snapshot(),
      [`used_paypal_orders/${ORDER}`]: { status: 'pending', flow: 'single', environment: 'sandbox', requestKey: `${ORDER}-cap`, intent: { version: 1, body: { product: 'ai-planner-full' } },
        captureState: 'none', claimToken: 'dead-worker', claimUntil: 0, stages: {}, createdAtMs: Date.now() - 300_000 },
    });
    foodHolder.rows = [];
    const calls = paypal({ gets: ['APPROVED'] });
    const out = await call({ orderID: ORDER, reconcile: true });
    expect(calls).toEqual([]);
    expect(out.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', preCaptureCode: 'DIETARY_COVERAGE_UNAVAILABLE' });
    expect(lockOf()).toMatchObject({ status: 'void_not_captured', captureState: 'not_captured' }); // r19: tombstone, not deleted
  });

  it('I: corrupt snapshot input (no cities) → the check fails before any capture call: 503, PayPal 0 calls, the same order stays retryable', async () => {
    dbHolder.db = memDb({ [`paypal_order_snapshots/${ORDER}`]: { ...snapshot(), prepayInput: { version: 1, startDate: '2099-12-01', diets: ['halal'] } } });
    const calls = paypal({});
    const out = await call({ orderID: ORDER });
    expect(out.status).toBe(503);
    expect(out.body).toMatchObject({ code: 'ORDER_CHECK_UNAVAILABLE' });
    expect(calls).toEqual([]);
    // r20: a temporary check failure is not nonpayment proof — no tombstone; only the claim is released (record as before
    //   any POST), so the same order can be retried once the check works.
    expect(lockOf()).toMatchObject({ status: 'pending', captureState: 'none', claimUntil: 0 });
    expect(isCheckoutUnresolved(lockOf(), null)).toBe(true);
  });

  it('fresh attempt + refusal → zero PayPal order calls (no GET, no POST), order voided', async () => {
    dbHolder.db = memDb({ [`paypal_order_snapshots/${ORDER}`]: snapshot() });
    foodHolder.rows = [];
    const calls = paypal({});
    const out = await call({ orderID: ORDER });
    expect(calls).toEqual([]);
    expect(out.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', preCaptureCode: 'DIETARY_COVERAGE_UNAVAILABLE' });
    expect(lockOf()).toMatchObject({ status: 'void_not_captured', captureState: 'not_captured' }); // r19: tombstone, not deleted
  });

  it('reconcileCapture(forbidPost): an APPROVED order answers unknown and postCapture is never called; a reused lookup skips the GET', async () => {
    const postCapture = vi.fn();
    const attempt = { lock: { captureState: 'unknown' }, recovering: true };
    const calls = paypal({ gets: ['APPROVED'] });
    const r = await reconcileCapture({ attempt, orderID: ORDER, baseUrl: 'https://api.mock', accessToken: 't', postCapture, forbidPost: true });
    expect(r).toMatchObject({ state: 'unknown', noPost: true });
    expect(postCapture).not.toHaveBeenCalled();
    const reused = await reconcileCapture({ attempt, orderID: ORDER, baseUrl: 'https://api.mock', accessToken: 't', postCapture, forbidPost: true, lookup: { state: 'captured', capture: COMPLETED } });
    expect(reused).toMatchObject({ state: 'captured', source: 'get' });
    expect(calls).toEqual(['GET']);
  });

  // ── 6 출발일 ────────────────────────────────────────────────────────────────
  it('start date no longer after KST today at capture time → refused before any PayPal order call', async () => {
    dbHolder.db = memDb({ [`paypal_order_snapshots/${ORDER}`]: { ...snapshot(), prepayInput: norm(input({ startDate: '2099-12-01' })) } });
    const store = (dbHolder.db as ReturnType<typeof memDb>)._store;
    const s = store.get(`paypal_order_snapshots/${ORDER}`) as Dict;
    store.set(`paypal_order_snapshots/${ORDER}`, { ...s, prepayInput: { ...(s.prepayInput as Dict), startDate: todayKST() } });
    const calls = paypal({});
    const out = await call({ orderID: ORDER });
    expect(calls).toEqual([]);
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', preCaptureCode: 'PLANNER_DATE_TOO_SOON' });
  });
});

describe('start date rule (same function as the generation step) at order creation', () => {
  it('normalizePrepayInput(requireFutureStart) refuses today; paymentGate binding (no flag) does not', () => {
    expect(normalizePrepayInput(input({ startDate: todayKST() }), { requireFutureStart: true })).toMatchObject({ ok: false, code: 'PLANNER_DATE_TOO_SOON' });
    expect(normalizePrepayInput(input({ startDate: todayKST() }))).toMatchObject({ ok: true });
  });
  it('createPaypalOrder: today → 400 PLANNER_DATE_TOO_SOON, PayPal token/order 0 calls', async () => {
    dbHolder.db = memDb();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as never;
    const res = mockRes();
    await createHandler({ method: 'POST', headers: {}, body: { productType: 'ai-planner-full', passengers: 1, plannerInput: input({ startDate: todayKST() }) } }, res);
    expect(res._out.status).toBe(400);
    expect(res._out.body).toMatchObject({ code: 'PLANNER_DATE_TOO_SOON' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(paypalTokenCalls).toHaveLength(0);
  });
});

// ── 4 지문 ───────────────────────────────────────────────────────────────────
describe('fingerprint: sorted city set + arrival/departure keys + area + sorted diets + dates', () => {
  it('city order does not change it (adversarial: 부산→서울 re-entry)', () => {
    expect(fp(input({ regions: ['서울', '부산'] }))).toBe(fp(input({ regions: ['Busan', 'Seoul'] })));
  });
  it('swapping arrival/departure cities or changing area changes it (Astra repro)', () => {
    const base = input({ regions: ['Seoul', 'Busan'], arrival_city: 'seoul', departure_city: 'busan', area: 'seoul_city' });
    expect(fp({ ...base, arrival_city: 'busan', departure_city: 'seoul' })).not.toBe(fp(base));
    expect(fp({ ...base, area: 'busan_haeundae' })).not.toBe(fp(base));
  });
  it('diet order does not change it', () => {
    expect(fp(input({ dietaryRestrictions: ['Vegan', 'Halal'] }))).toBe(fp(input({ dietaryRestrictions: ['Halal', 'Vegan'] })));
  });
});

// ── 3 소유자 우선 · 5 409 요약 ──────────────────────────────────────────────────
describe('paymentGate binding: owner check first; 409 carries the pinned input', () => {
  const paidOrderFetch = () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: ORDER, status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } }] } }] }) })) as never;
  };
  const paidSnap = (extra: Dict = {}) => ({ productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', expectedKRW: 14000, ...extra });
  const loadFoodIndex = async () => [HALAL_SEOUL, HALAL_BUSAN];
  const pinnedSnap = (extra: Dict = {}) => { const n = norm(input()); return paidSnap({ prepayInput: n, prepayInputVersion: 1, prepayFingerprint: prepayFingerprint(n as never), ...extra }); };

  it('Astra repro: intruder with the SAME (fingerprint-matching) input → 403, no issuance claim', async () => {
    paidOrderFetch();
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: pinnedSnap({ ownerUid: 'owner' }) });
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'x@e.x', 'intruder', null, { loadFoodIndex });
    expect(r.rejection).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect([...db._store.keys()].some((k) => k.startsWith('plan_issued_orders/'))).toBe(false);
  });
  it('Astra repro: intruder with an un-normalizable request on an OLD order (missing dietary key / empty date) → 403', async () => {
    paidOrderFetch();
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: paidSnap({ ownerUid: 'owner' }) });
    const noDiet = input({ startDate: '' }); delete noDiet.dietaryRestrictions;
    const r = await enforcePaymentAndRevision({ ...noDiet, paypalOrderId: ORDER }, db, 'x@e.x', 'intruder', null, { loadFoodIndex });
    expect(r.rejection).toMatchObject({ statusCode: 403 });
  });
  it('owner with a different input → 409 PREPAY_INPUT_MISMATCH with details.pinnedInput (cities, diets, dates, arrival/departure)', async () => {
    paidOrderFetch();
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: pinnedSnap({ ownerUid: 'uid1' }) });
    const r = await enforcePaymentAndRevision({ ...input({ regions: ['Busan'] }), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex });
    expect(r.rejection).toMatchObject({ statusCode: 409, code: 'PREPAY_INPUT_MISMATCH' });
    expect(r.rejection.details).toMatchObject({ paidOrder: true, pinnedInput: { cities: ['seoul'], diets: ['halal'], startDate: '2099-12-01', durationDays: 3, regions: ['Seoul'], arrivalCity: '', departureCity: '' } });
    expect(r.rejection.details.pinnedInput.version).toBeUndefined();
  });
});



// ── 1 QR 경로 ────────────────────────────────────────────────────────────────
describe('manual-payment-request (QR / paypal.me) — same pre-payment check before any remittance guidance', () => {
  const realIndex = () => JSON.parse(read('api/_food_index.json')) as Dict[];
  const run = async (body: Dict) => {
    dbHolder.db = memDb();
    const res = mockRes();
    await manualHandler({ method: 'POST', headers: {}, body }, res);
    return { res: res._out, store: (dbHolder.db as ReturnType<typeof memDb>)._store };
  };
  it('checkOnly: Seoul+Incheon Halal → 422 and nothing written (the panel then shows no QR/link)', async () => {
    foodHolder.rows = realIndex();
    const { res, store } = await run({ checkOnly: true, productType: 'ai-planner-full', plannerInput: input({ regions: ['서울', '인천'] }) });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ ok: false, code: 'DIETARY_COVERAGE_UNAVAILABLE' });
    expect(store.size).toBe(0);
  });
  it('checkOnly: missing plannerInput (old bundle) → 400 PREPAY_INPUT_MISSING; passing input → 200 checked', async () => {
    expect((await run({ checkOnly: true, productType: 'ai-planner-full' })).res).toMatchObject({ status: 400, body: { code: 'PREPAY_INPUT_MISSING' } });
    expect((await run({ checkOnly: true, productType: 'ai-planner-full', plannerInput: input() })).res).toMatchObject({ status: 200, body: { ok: true, data: { checked: true } } });
  });
  const report = (extra: Dict) => ({ bookingRef: 'CT-20991201-123', productType: 'ai-planner-full', passengers: 1, priceKRW: 14000, customerEmail: 'g@e.x', ...extra });
  it('report after remittance: a failing check is recorded for the operator, never dropped (money may have moved)', async () => {
    foodHolder.rows = realIndex();
    const { res, store } = await run(report({ plannerInput: input({ regions: ['서울', '인천'] }) }));
    expect(res.status).toBe(200);
    expect(store.get('pending_bookings/CT-20991201-123')).toMatchObject({ status: 'AWAITING_VERIFICATION', prepayCheckFailed: { code: 'DIETARY_COVERAGE_UNAVAILABLE' } });
  });
  it('report with a passing check stores the same normalized input + fingerprint as createPaypalOrder', async () => {
    const { store } = await run(report({ plannerInput: input() }));
    expect(store.get('pending_bookings/CT-20991201-123')).toMatchObject({ prepayInput: norm(input()), prepayFingerprint: fp(input()) });
  });

});

// ── 5 프론트 · 7 문구 ─────────────────────────────────────────────────────────


// ── r3 (Astra r2 · 적대적 r2) ─────────────────────────────────────────────────
describe('r3 B/J/D/F — paid orders: owner → pinned input → coverage → claim; verified orders skip the start-date re-check', () => {
  const paidOrderFetch = () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: ORDER, status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } }] } }] }) })) as never;
  };
  const realIndex = async () => JSON.parse(read('api/_food_index.json')) as Dict[];
  const paidSnap = (pinned: Dict, extra: Dict = {}) => ({ productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', expectedKRW: 14000,
    prepayInput: norm(pinned), prepayInputVersion: 1, prepayFingerprint: fp(pinned), ...extra });
  const claimed = (db: ReturnType<typeof memDb>) => [...db._store.keys()].some((k) => k.startsWith('plan_issued_orders/'));

  it('B (Astra repro): paid Seoul/Halal, re-entry Seoul+Incheon/Halal → 409 with pinnedInput (not 422), no claim', async () => {
    paidOrderFetch();
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: paidSnap(input({ regions: ['서울'] }), { ownerUid: 'uid1' }) });
    const r = await enforcePaymentAndRevision({ ...input({ regions: ['서울', '인천'] }), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: realIndex });
    expect(r.rejection).toMatchObject({ statusCode: 409, code: 'PREPAY_INPUT_MISMATCH' });
    expect(r.rejection.details.pinnedInput).toMatchObject({ cities: ['seoul'], diets: ['halal'] });
    expect(claimed(db)).toBe(false);
  });
  it('J: paid order with the pinned input but coverage now gone → 422 after the bind, operator alert + Sentry, no claim', async () => {
    paidOrderFetch();
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: paidSnap(input(), { ownerUid: 'uid1' }) });
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [] });
    expect(r.rejection).toMatchObject({ statusCode: 422, code: 'DIETARY_COVERAGE_UNAVAILABLE' });
    expect(observed.alerts).toContain(`paid-dietary-coverage:${ORDER}`);
    expect(observed.errors).toContain('paid_dietary_coverage');
    expect(claimed(db)).toBe(false);
  });
  it('free coupon is consumed with fifth-argument binding, then dietary failure restores that exact consumption', async () => {
    const db = couponDb();
    const body = { ...input({ regions: ['Seoul', 'Incheon'] }), aiCouponCode: 'FREE1' };
    const loadFoodIndex = vi.fn(async () => []);
    const gate = await enforcePaymentAndRevision(body, db, 'u@e.x', 'uid1', couponOwner, { loadFoodIndex });
    expect(loadFoodIndex).not.toHaveBeenCalled();
    expect(checkPrepayCoverage(norm(body), [])).toMatchObject({ ok: false, status: 422, code: 'DIETARY_COVERAGE_UNAVAILABLE' });
    await assertCouponFailureRestores(db, body, gate, 'DIETARY_COVERAGE_UNAVAILABLE', 422);
  });
  it('D (midnight repro): order pinned to a start date that is now "today" → gate passes with prepayVerified, the generation start-date check is skipped', async () => {
    paidOrderFetch();
    const today = input({ startDate: todayKST() });
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: paidSnap(today, { ownerUid: 'uid1' }) });
    const body = { ...today, paypalOrderId: ORDER };
    const gate = await enforcePaymentAndRevision(body, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(gate.rejection).toBeUndefined();
    expect(gate.prepayVerified).toBe(true);
    // @ts-expect-error — JS 모듈
    const { checkStartDateTooSoon } = await import('../../api/_ai_core/validateStartDate.js');
    expect(checkStartDateTooSoon(body, false)).not.toBeNull(); // 면제 없으면 400 이던 상황
    expect(checkStartDateTooSoon(body, gate.isRevision || gate.prepayVerified === true)).toBeNull();
    expect(read('api/_ai_core/handlerCore.js')).toContain('checkStartDateTooSoon(body, gate.isRevision || gate.prepayVerified === true');
  });
  it('D: an OLD paid order pinned on first use is also verified; an un-normalizable legacy request is not', async () => {
    paidOrderFetch();
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: { productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', ownerUid: 'uid1' } });
    const noDiet = input(); delete noDiet.dietaryRestrictions;
    const loose = await enforcePaymentAndRevision({ ...noDiet, paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(loose.rejection).toBeUndefined();
    expect(loose.prepayVerified).toBeUndefined();
    db._store.delete(`plan_issued_orders/${ORDER}`);
    const pinned = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(pinned.prepayVerified).toBe(true);
  });
  it('F (phone login, no email claim): the owner uid recorded at order creation matches the uid passed as ownerUid', async () => {
    paidOrderFetch();
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: paidSnap(input(), { ownerUid: 'phoneUid' }) });
    const ok = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, null, undefined, null, { loadFoodIndex: async () => [HALAL_SEOUL], ownerUid: 'phoneUid' });
    expect(ok.rejection).toBeUndefined();
    const other = memDb({ [`paypal_order_snapshots/${ORDER}`]: paidSnap(input(), { ownerUid: 'phoneUid' }) });
    const no = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, other, null, undefined, null, { loadFoodIndex: async () => [HALAL_SEOUL], ownerUid: 'someoneElse' });
    expect(no.rejection).toMatchObject({ statusCode: 403 });
    expect(read('api/_ai_core/handlerCore.js')).toContain('const ownerUid = auth.ok ? auth.uid : ((await verifyFirebaseIdentityToken(req)).uid || null);');
  });
});

describe('r4 — legacy pin after coverage, atomic MANUAL use, coupon start date, date type', () => {
  const paidOrderFetch = () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: ORDER, status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } }] } }] }) })) as never;
  };
  const realIndex = async () => JSON.parse(read('api/_food_index.json')) as Dict[];
  it('r4-3 (adversarial L1, PayPal): old paid order, Seoul+Incheon Halal → 422 and NOT pinned; then Seoul only → passes and pins Seoul', async () => {
    paidOrderFetch();
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: { productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', ownerUid: 'uid1' } });
    const bad = await enforcePaymentAndRevision({ ...input({ regions: ['서울', '인천'] }), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: realIndex });
    expect(bad.rejection).toMatchObject({ statusCode: 422, code: 'DIETARY_COVERAGE_UNAVAILABLE' });
    expect((db._store.get(`paypal_order_snapshots/${ORDER}`) as Dict).prepayFingerprint).toBeUndefined();
    const good = await enforcePaymentAndRevision({ ...input({ regions: ['서울'] }), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: realIndex });
    expect(good.rejection).toBeUndefined();
    expect((db._store.get(`paypal_order_snapshots/${ORDER}`) as Dict)).toMatchObject({ prepayFingerprint: fp(input({ regions: ['서울'] })), prepayPinnedFrom: 'legacy_paid_first_use' });
  });
  it('r4-3 (MANUAL): the same order for an old QR order (pending_bookings without a fingerprint)', async () => {
    const MREF = 'CT-20991201-321';
    const db = memDb({ [`pending_bookings/${MREF}`]: { status: 'CONFIRMED', productType: 'ai-planner-full', userId: 'uid1', customerEmail: 'u@e.x' } });
    const bad = await enforcePaymentAndRevision({ ...input({ regions: ['서울', '인천'] }), paypalOrderId: `MANUAL-${MREF}` }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: realIndex });
    expect(bad.rejection).toMatchObject({ statusCode: 422 });
    expect((db._store.get(`pending_bookings/${MREF}`) as Dict).prepayFingerprint).toBeUndefined();
    expect(db._store.has(`used_paypal_orders/MANUAL-${MREF}`)).toBe(false);
    const good = await enforcePaymentAndRevision({ ...input({ regions: ['서울'] }), paypalOrderId: `MANUAL-${MREF}` }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: realIndex });
    expect(good.rejection).toBeUndefined();
  });
  it('r4-4 (adversarial L2): two concurrent MANUAL requests → exactly one passes, the other DUPLICATE_ORDER', async () => {
    const MREF = 'CT-20991201-555';
    const db = memDb({ [`pending_bookings/${MREF}`]: { status: 'CONFIRMED', productType: 'ai-planner-full', userId: 'uid1', customerEmail: 'u@e.x', prepayInput: norm(input()), prepayFingerprint: fp(input()) } });
    const slowIndex = async () => { await new Promise((r) => setTimeout(r, 20)); return [HALAL_SEOUL]; };
    const body = { ...input(), paypalOrderId: `MANUAL-${MREF}` };
    const [a, b] = await Promise.all([
      enforcePaymentAndRevision(body, db, 'u@e.x', 'uid1', null, { loadFoodIndex: slowIndex }),
      enforcePaymentAndRevision(body, db, 'u@e.x', 'uid1', null, { loadFoodIndex: slowIndex }),
    ]);
    const codes = [a, b].map((r) => (r.rejection ? r.rejection.code : 'PASS')).sort();
    expect(codes).toEqual(['DUPLICATE_ORDER', 'PASS']);
  });
  it('coupon transaction crossing midnight retains the date check and restores exact consumption on failure', async () => {
    let now = Date.UTC(2026, 10, 1, 14, 59, 59, 950);
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const db = couponDb();
      const transact = db.runTransaction.bind(db);
      db.runTransaction = async fn => { now += 100; return transact(fn); };
      const body = { ...input({ startDate: '2026-11-02', durationDays: 1 }), aiCouponCode: 'FREE1' };
      expect(checkStartDateTooSoon(body, false)).toBeNull();
      const gate = await enforcePaymentAndRevision(body, db, 'u@e.x', 'uid1', couponOwner);
      expect(checkStartDateTooSoon(body, gate.isRevision || gate.prepayVerified === true)).not.toBeNull();
      await assertCouponFailureRestores(db, body, gate, 'PLANNER_DATE_TOO_SOON', 400);
      expect(read('api/_ai_core/handlerCore.js')).toContain('checkStartDateTooSoon(body, gate.isRevision || gate.prepayVerified === true)');
    } finally { spy.mockRestore(); }
  });

  it('free coupon with today start date retains main consumption then fenced restoration', async () => {
    const db = couponDb();
    const body = { ...input({ startDate: todayKST() }), aiCouponCode: 'FREE1' };
    const gate = await enforcePaymentAndRevision(body, db, 'u@e.x', 'uid1', couponOwner);
    expect(checkStartDateTooSoon(body, false)).not.toBeNull();
    await assertCouponFailureRestores(db, body, gate, 'PLANNER_DATE_TOO_SOON', 400);
  });
  it.each([[['2020-01-01']], [20200101], [{ y: 2020 }]])('r4-6 (datetype repro): non-string date %j → refused at order creation (no split from the stored date)', (date) => {
    expect(normalizePrepayInput({ ...input(), date }, { requireFutureStart: true })).toMatchObject({ ok: false, code: 'PLANNER_INPUT_CONFLICT' });
  });
  it('r4-6: whitespace date is truthy for requestShaper → it is the date that is checked (and refused), not startDate', () => {
    expect(normalizePrepayInput({ ...input(), date: '   ' }, { requireFutureStart: true })).toMatchObject({ ok: false });
  });
  it('r4-2 server: a create block for an unfinished checkout names the original product', async () => {
    const { pendingPaymentResponse } = await import('../../api/_shared/payment-fulfillment-recovery.js');
    expect(pendingPaymentResponse({ orderID: 'X', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', productType: 'ai-planner-full' })).toMatchObject({ productType: 'ai-planner-full' });
    expect(pendingPaymentResponse({ orderID: 'X', flow: 'single', paymentStatus: 'CAPTURE_UNKNOWN', productType: 'unknown' }).productType).toBeUndefined();
    expect(read('api/_shared/payment-fulfillment-recovery.js')).toContain('productType: snapshot.productType || lock.product');
  });
});

describe('r3 K — MANUAL (QR) orders get the same input pinning', () => {
  const pending = (extra: Dict = {}) => ({ status: 'CONFIRMED', productType: 'ai-planner-full', userId: 'uid1', customerEmail: 'u@e.x', ...extra });
  const MREF = 'CT-20991201-123';
  it('fingerprint from the report: different input → 409 pinnedInput, used record NOT written; same input → passes, verified', async () => {
    const db = memDb({ [`pending_bookings/${MREF}`]: pending({ prepayInput: norm(input()), prepayFingerprint: fp(input()) }) });
    const bad = await enforcePaymentAndRevision({ ...input({ regions: ['Busan'] }), paypalOrderId: `MANUAL-${MREF}` }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL, HALAL_BUSAN] });
    expect(bad.rejection).toMatchObject({ statusCode: 409, code: 'PREPAY_INPUT_MISMATCH' });
    expect(db._store.has(`used_paypal_orders/MANUAL-${MREF}`)).toBe(false);
    const good = await enforcePaymentAndRevision({ ...input(), paypalOrderId: `MANUAL-${MREF}` }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(good.rejection).toBeUndefined();
    expect(good.prepayVerified).toBe(true);
    expect(db._store.has(`used_paypal_orders/MANUAL-${MREF}`)).toBe(true);
  });
  it('old manual order without a fingerprint is pinned on first use (pending_bookings)', async () => {
    const db = memDb({ [`pending_bookings/${MREF}`]: pending() });
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: `MANUAL-${MREF}` }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(r.rejection).toBeUndefined();
    expect(db._store.get(`pending_bookings/${MREF}`)).toMatchObject({ prepayFingerprint: fp(input()), prepayPinnedFrom: 'legacy_paid_first_use' });
  });
});

describe('r3 E — one date source in normalizePrepayInput', () => {
  it('adversarial repro: startDate 2099 + date today → refused as a conflict (the checked date can no longer differ from the stored one)', () => {
    const split = { ...input(), endDate: '2099-12-03', date: `${todayKST()}T09:00` };
    expect(normalizePrepayInput(split, { requireFutureStart: true })).toMatchObject({ ok: false, code: 'PLANNER_INPUT_CONFLICT' });
  });
  it('date alone is the checked and stored date (same precedence as requestShaper)', () => {
    const only = { ...input(), date: '2099-12-05' }; delete only.startDate;
    expect(norm(only)).toMatchObject({ startDate: '2099-12-05' });
    const past = { ...input(), date: '2020-01-01' }; delete past.startDate;
    expect(normalizePrepayInput(past, { requireFutureStart: true })).toMatchObject({ ok: false, code: 'PLANNER_DATE_TOO_SOON' });
  });
});


