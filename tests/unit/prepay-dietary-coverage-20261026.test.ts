/**
 * 2026-10-26 B6-1 — AI 플래너 결제 전 식이 커버리지 서버 확인 (Astra 설계 (a), 운영자 승인).
 *   create: 서버가 플래너 입력을 다시 정규화 → 생성 단계와 같은 게이트 → 실패면 PayPal 주문 0회(422).
 *   capture: 새 capture POST 직전 snapshot 의 정규 입력으로 재검사 → 실패면 capture 0회 + '미결제' 응답.
 *   ai-planner-full: 유료 주문은 입력·커버리지 검증 뒤 발급권 선점. 쿠폰 소비·복원과 수정 크레딧 정책은 main 유지.
 *   실 PayPal·Firestore·LLM 호출 0 (전부 mock). 실제 식당 DB 로 서울+인천 할랄 재현.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFakeFirestore } from '../helpers/fake-firestore.js';

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
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', increment: (n: number) => ({ __sentinel: 'increment', by: n }) } }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: async () => {} }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: async () => {} }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: async () => {} }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({
  triggerBookingProcessor: async () => ({ ok: true, outcome: 'completed' }), PENDING_PROCESSOR_RETRIES_COLLECTION: 'pending_processor_retries',
}));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: async () => ({ ok: true, final: true }) }));

import { normalizePrepayInput, prepayFingerprint, checkPrepayCoverage, isPrepayCheckedProduct } from '../../api/_shared/prepay-coverage.js';
// @ts-expect-error — JS 핸들러
const { default: createHandler } = await import('../../api/createPaypalOrder.js');
// @ts-expect-error — JS 핸들러
const { default: captureHandler } = await import('../../api/capturePaypalOrder.js');
// @ts-expect-error — JS 모듈
const { enforcePaymentAndRevision } = await import('../../api/_ai_core/paymentGate.js');

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const ORDER = '5O190127TN364715T';
const HALAL_SEOUL = { name: '합성할랄식당', nameEn: 'Synthetic Halal', city: 'seoul', tag: 'halal', verification_status: 'halal_certified', address: '서울특별시 중구 합성로 1', lat: 37.56, lng: 126.98 };
// 먼 미래 날짜 — 출발일 > KST 오늘 규칙(r2)이 날짜 경과로 테스트를 깨지 않게.
const input = (o: Dict = {}): Dict => ({ regions: ['Seoul'], dietaryRestrictions: ['Halal'], dietPrefs: [], startDate: '2099-12-01', durationDays: 3, ...o });

function mockRes() {
  const out: { status?: number; body?: Dict } = {};
  return { _out: out, writeHead(s: number) { out.status = s; return this; }, end(b?: string) { out.body = b ? JSON.parse(b) : undefined; return this; } };
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

beforeEach(() => {
  paypalTokenCalls.length = 0;
  foodHolder.rows = [HALAL_SEOUL];
});

describe('normalizePrepayInput / prepayFingerprint (pure)', () => {
  const fp = (o: Dict) => { const n = normalizePrepayInput(o); if (!n.ok) throw new Error(String(n.code)); return prepayFingerprint(n.input); };
  it('rejects missing input, no city, missing dietary list, missing dates (new orders: no exceptions)', () => {
    expect(normalizePrepayInput(undefined)).toMatchObject({ ok: false, code: 'PREPAY_INPUT_MISSING' });
    expect(normalizePrepayInput(input({ regions: [] }))).toMatchObject({ ok: false, code: 'PREPAY_CITIES_MISSING' });
    expect(normalizePrepayInput(input({ regions: ['  '] }))).toMatchObject({ ok: false, code: 'PREPAY_CITIES_MISSING' });
    const noDiet = input(); delete noDiet.dietaryRestrictions;
    expect(normalizePrepayInput(noDiet)).toMatchObject({ ok: false, code: 'PREPAY_DIETARY_MISSING' });
    expect(normalizePrepayInput(input({ startDate: '' }))).toMatchObject({ ok: false, code: 'PREPAY_DATES_MISSING' });
    expect(normalizePrepayInput(input({ durationDays: 0 }))).toMatchObject({ ok: false, code: 'PREPAY_DATES_MISSING' });
    expect(normalizePrepayInput(input({ dietPrefs: 'Halal' }))).toMatchObject({ ok: false, code: 'PREPAY_INPUT_INVALID' });
  });
  it('aliases normalize to the same fingerprint: ko/en/ja/zh city names, snake/camel arrival city, legacy allergies', () => {
    const base = fp(input({ regions: ['Seoul', 'Busan'] }));
    expect(fp(input({ regions: ['서울', '부산'] }))).toBe(base);
    expect(fp(input({ regions: ['ソウル', '釜山'] }))).toBe(base);
    expect(fp(input({ regions: ['首尔', '釜山'] }))).toBe(base);
    expect(fp(input({ regions: ['Seoul'], arrival_city: 'busan' }))).toBe(fp(input({ regions: ['Seoul'], arrivalCity: 'busan' })));
    const legacy = input(); delete legacy.dietaryRestrictions;
    expect(fp({ ...legacy, allergies: ['Halal', 'Nuts'] })).toBe(fp(input()));
  });
  it('fingerprint changes with city, diet or dates', () => {
    const base = fp(input());
    expect(fp(input({ regions: ['Busan'] }))).not.toBe(base);
    expect(fp(input({ dietaryRestrictions: ['Vegan'] }))).not.toBe(base);
    expect(fp(input({ startDate: '2099-12-02' }))).not.toBe(base);
    expect(fp(input({ durationDays: 4 }))).not.toBe(base);
  });
  it('flat vs planner_intent_v1 conflict is rejected (Astra repro: flat 서울/none vs v1 부산/Vegan)', () => {
    const conflict = input({ regions: ['서울'], dietaryRestrictions: [], planner_intent_v1: { version: 1, cityKeys: ['busan'], dietaryRestrictions: ['Vegan'] } });
    expect(normalizePrepayInput(conflict)).toMatchObject({ ok: false, code: 'PLANNER_INPUT_CONFLICT' });
    const agree = input({ regions: ['서울'], planner_intent_v1: { version: 1, cityKeys: ['seoul'], dietaryRestrictions: ['Halal'] } });
    expect(normalizePrepayInput(agree)).toMatchObject({ ok: true });
  });
  it('the create plannerInput and the later full body (extra request fields) normalize identically', () => {
    const plannerInput = input({ area: 'seoul_city', arrival_city: 'seoul' });
    expect(fp({ ...plannerInput, paypalOrderId: ORDER, guestName: 'Guest', email: 'a@b.c', uid: null, language: 'ja' })).toBe(fp(plannerInput));
  });
  it('product scope is exactly ai_planner_full', () => {
    expect(isPrepayCheckedProduct('ai-planner-full')).toBe(true);
    expect(isPrepayCheckedProduct('ai_planner_full')).toBe(true);
    expect(isPrepayCheckedProduct('ai_planner_quick')).toBe(false);
    expect(isPrepayCheckedProduct('charter_seoul_city')).toBe(false);
  });
});

describe('Seoul + Incheon Halal — real restaurant DB (Astra repro: preview passes, full trip must not)', () => {
  const realIndex = JSON.parse(read('api/_food_index.json')) as Dict[];
  it('Seoul alone passes; Seoul + Incheon is blocked before payment', () => {
    const seoul = normalizePrepayInput(input({ regions: ['서울'] }));
    const both = normalizePrepayInput(input({ regions: ['서울', '인천'] }));
    if (!seoul.ok || !both.ok) throw new Error('normalize');
    expect(checkPrepayCoverage(seoul.input, realIndex)).toEqual({ ok: true });
    expect(checkPrepayCoverage(both.input, realIndex)).toMatchObject({ ok: false, status: 422, code: 'DIETARY_COVERAGE_UNAVAILABLE' });
  });
});

describe('createPaypalOrder — no PayPal order unless the planner input passes', () => {
  const run = async (body: Dict) => {
    dbHolder.db = memDb();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: ORDER }) }));
    global.fetch = fetchSpy as never;
    const res = mockRes();
    await createHandler({ method: 'POST', headers: {}, body: { productType: 'ai-planner-full', passengers: 1, ...body } }, res);
    return { res: res._out, fetchSpy, store: (dbHolder.db as ReturnType<typeof memDb>)._store };
  };
  it('Seoul + Incheon Halal → 422, PayPal token/order 0 calls, no snapshot', async () => {
    foodHolder.rows = JSON.parse(read('api/_food_index.json'));
    const { res, fetchSpy, store } = await run({ plannerInput: input({ regions: ['서울', '인천'] }) });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ ok: false, code: 'DIETARY_COVERAGE_UNAVAILABLE' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(paypalTokenCalls).toHaveLength(0);
    expect(store.has(`paypal_order_snapshots/${ORDER}`)).toBe(false);
  });
  it.each([
    ['missing plannerInput', {}, 'PREPAY_INPUT_MISSING'],
    ['empty cities', { plannerInput: input({ regions: [] }) }, 'PREPAY_CITIES_MISSING'],
    ['flat/v1 conflict', { plannerInput: input({ regions: ['서울'], dietaryRestrictions: [], planner_intent_v1: { version: 1, cityKeys: ['busan'], dietaryRestrictions: ['Vegan'] } }) }, 'PLANNER_INPUT_CONFLICT'],
  ])('%s → 400 %s, PayPal 0 calls', async (_l, body, code) => {
    const { res, fetchSpy } = await run(body as Dict);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('passing input → PayPal order created; snapshot binds the normalized input, version, fingerprint and check time', async () => {
    const { res, fetchSpy, store } = await run({ plannerInput: input() });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const snap = store.get(`paypal_order_snapshots/${ORDER}`) as Dict;
    const n = normalizePrepayInput(input()); if (!n.ok) throw new Error('n');
    expect(snap).toMatchObject({ prepayInput: n.input, prepayInputVersion: 1, prepayFingerprint: prepayFingerprint(n.input), prepayFoodIndexRows: 1 });
    expect(typeof snap.prepayCoverageCheckedAt).toBe('string');
  });
  it.each([
    ['ko', '새로고침'], ['en', 'Refresh'], ['ja', '再読み込み'], ['zh', '刷新'],
  ])('cached client without plannerInput gets refresh guidance in %s before any PayPal call', async (language, refreshWord) => {
    const { res, fetchSpy, store } = await run({ language });
    expect(res).toMatchObject({ status: 400, body: { code: 'PREPAY_INPUT_MISSING' } });
    expect(res.body?.error).toContain(refreshWord);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(paypalTokenCalls).toHaveLength(0);
    expect(store.size).toBe(0);
  });
  it('non-planner products are unaffected (no plannerInput needed)', async () => {
    const { res } = await run({ productType: 'airport_seoul_central', passengers: 2 });
    expect(String(res.body?.code || '')).not.toMatch(/^PREPAY_|DIETARY_COVERAGE/);
    expect(res.status).toBe(200);
  });
});

describe('capturePaypalOrder — re-check right before a NEW capture POST', () => {
  const n = normalizePrepayInput(input()); if (!n.ok) throw new Error('n');
  const snapshot = (extra: Dict = {}) => ({ productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', expectedKRW: 14000, passengers: 1, prepayInputVersion: 1, prepayInput: n.input, ...extra });
  const run = async (snap: Dict) => {
    dbHolder.db = memDb({ [`paypal_order_snapshots/${ORDER}`]: snap });
    const fetchSpy = vi.fn(async (url: unknown) => {
      const body = { id: ORDER, status: 'COMPLETED', payer: { email_address: 'b@e.x', name: { given_name: 'A', surname: 'B' } },
        purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } }] } }] };
      void url;
      return { ok: true, status: 201, json: async () => body, text: async () => JSON.stringify(body) };
    });
    global.fetch = fetchSpy as never;
    const res = mockRes();
    await captureHandler({ method: 'POST', body: { orderID: ORDER }, headers: {} }, res);
    const captureCalls = fetchSpy.mock.calls.filter((c) => /\/capture$/.test(String(c[0])));
    return { res: res._out, captureCalls, store: (dbHolder.db as ReturnType<typeof memDb>)._store };
  };
  it('coverage lost after the order (data changed) → capture 0 calls, proven not-captured answer, order voided', async () => {
    foodHolder.rows = [];
    const { res, captureCalls, store } = await run(snapshot());
    expect(captureCalls).toHaveLength(0);
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', paymentStatus: 'NOT_CAPTURED', preCaptureCode: 'DIETARY_COVERAGE_UNAVAILABLE', orderID: ORDER });
    // r20: this request carries no same-order proof (no cookie / owner) → the attempt is only deleted (r18), never a
    //   tombstone — knowing an orderID must not void it. Proven requests are voided (prepay-r20-server.test.ts).
    expect(store.has(`used_paypal_orders/${ORDER}`)).toBe(false);
  });
  it('old unpaid order without the checked input → capture 0 calls, PREPAY_INPUT_MISSING (create a new order)', async () => {
    const legacy = snapshot(); delete (legacy as Dict).prepayInput; delete (legacy as Dict).prepayInputVersion;
    const { res, captureCalls } = await run(legacy);
    expect(captureCalls).toHaveLength(0);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'PAYMENT_NOT_CAPTURED', preCaptureCode: 'PREPAY_INPUT_MISSING' });
  });
  it('coverage still available → the capture POST happens', async () => {
    const { captureCalls } = await run(snapshot());
    expect(captureCalls).toHaveLength(1);
  });
  it('source: already-verified captures skip the re-check; the refusal decision feeds forbidPost into reconcileCapture', () => {
    const src = read('api/capturePaypalOrder.js');
    // r3: 판정은 시도 기록(acquirePaymentAttempt) 전에 계산, 분기는 그 뒤·reconcile 전.
    expect(src.indexOf('let preCaptureBlock = null;')).toBeLessThan(src.indexOf('const acquired = await acquirePaymentAttempt('));
    expect(src).toContain('if (preCaptureBlock && !(attempt.lock && attempt.lock.captureVerified)) {');
    expect(src).toContain('const lookup = neverPosted ? null : await fetchPaypalOrder(');
    expect(src).toContain('forbidPost: forbidCapturePost, lookup: preCaptureLookup');
    expect(src.indexOf('if (preCaptureBlock && !(attempt.lock')).toBeLessThan(src.indexOf('const reconciled = await reconcileCapture('));
  });
});

describe('ai-planner-full gate — retained coupon/revision policy and paid order input binding', () => {
  const incheon = input({ regions: ['서울', '인천'] });
  const loadFoodIndex = async () => JSON.parse(read('api/_food_index.json'));
  it('free coupon validation retains main ordering; missing coupon is rejected before coverage', async () => {
    const db = memDb();
    const loadFoodIndex = vi.fn(async () => []);
    const r = await enforcePaymentAndRevision({ ...incheon, aiCouponCode: 'FREE1' }, db, 'u@e.x', 'uid1', null, { loadFoodIndex });
    expect(r.rejection).toMatchObject({ statusCode: 404, code: 'COUPON_NOT_FOUND' });
    expect(db._calls.tx).toBe(0);
    expect(loadFoodIndex).not.toHaveBeenCalled();
  });
  it('revision keeps main credit consumption; dietary rejection remains in generation', async () => {
    const db = createFakeFirestore({ 'plans/P1': { uid: 'uid1', revisionCredits: 2 } });
    const loadFoodIndex = vi.fn(async () => []);
    const r = await enforcePaymentAndRevision({ ...incheon, revisionOf: 'P1' }, db, 'u@e.x', 'uid1', null, { loadFoodIndex });
    expect(r).toMatchObject({ isRevision: true });
    expect(db.__get('plans/P1').revisionCredits).toBe(1);
    expect(loadFoodIndex).not.toHaveBeenCalled();
    const normalized = normalizePrepayInput(incheon);
    if (!normalized.ok) throw new Error('Invalid fixture');
    expect(checkPrepayCoverage(normalized.input, [])).toMatchObject({ ok: false, status: 422, code: 'DIETARY_COVERAGE_UNAVAILABLE' });
  });

  const paidOrderFetch = () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: ORDER, status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } }] } }] }) })) as never;
  };
  const paidSnap = (extra: Dict = {}) => ({ productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', expectedKRW: 14000, ...extra });
  it.each([
    { status: 'void_not_captured', captureState: 'not_captured' },
    { status: 'captured', captureState: 'captured', reviewQuarantined: true, voidedReason: 'no_attempt_record' },
  ])('tombstone/quarantine %j cannot claim issuance before the review document is recorded', async lock => {
    paidOrderFetch();
    const n = normalizePrepayInput(input()); if (!n.ok) throw new Error('Invalid fixture');
    const db = memDb({
      [`paypal_order_snapshots/${ORDER}`]: paidSnap({ prepayInput: n.input, prepayFingerprint: prepayFingerprint(n.input) }),
      [`used_paypal_orders/${ORDER}`]: lock,
    });
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(r.rejection).toMatchObject({ code: 'PAYMENT_UNDER_REVIEW' });
    expect(db._store.has(`plan_issued_orders/${ORDER}`)).toBe(false);
  });
  it('operator-confirmed quarantine retains existing authority after provenance checks', async () => {
    paidOrderFetch();
    const n = normalizePrepayInput(input()); if (!n.ok) throw new Error('Invalid fixture');
    const db = memDb({
      [`paypal_order_snapshots/${ORDER}`]: paidSnap({ prepayInput: n.input, prepayFingerprint: prepayFingerprint(n.input) }),
      [`used_paypal_orders/${ORDER}`]: { status: 'captured', reviewQuarantined: true },
      [`payment_reviews/${ORDER}`]: { resolvedAt: '2099-12-01', resolution: 'MANUALLY_CONFIRMED', resolvedBy: 'operator' },
    });
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(r.rejection).toBeUndefined();
    expect(r.planClaim).toBeDefined();
  });
  it('tombstone lookup failure is fail-closed and does not claim issuance', async () => {
    paidOrderFetch();
    const db = memDb();
    const collection = db.collection;
    db.collection = name => name === 'used_paypal_orders'
      ? { doc: () => ({ get: async () => { throw new Error('Synthetic unavailable'); } }) }
      : collection(name);
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1');
    expect(r.rejection).toMatchObject({ statusCode: 503, code: 'PAYMENT_REVIEW_CHECK_UNAVAILABLE' });
    expect(db._store.has(`plan_issued_orders/${ORDER}`)).toBe(false);
  });
  it('new paid order: request input ≠ order input → 409 PREPAY_INPUT_MISMATCH before the issuance claim', async () => {
    paidOrderFetch();
    const n = normalizePrepayInput(input()); if (!n.ok) throw new Error('n');
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: paidSnap({ prepayInput: n.input, prepayInputVersion: 1, prepayFingerprint: prepayFingerprint(n.input) }) });
    const r = await enforcePaymentAndRevision({ ...input({ regions: ['Busan'] }), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL, { ...HALAL_SEOUL, city: 'busan', address: '부산광역시 해운대구 합성로 1' }] });
    expect(r.rejection).toMatchObject({ statusCode: 409, code: 'PREPAY_INPUT_MISMATCH' });
    expect([...db._store.keys()].some((k) => k.startsWith('plan_issued_orders/'))).toBe(false);
  });
  it('new paid order: same input → passes and claims issuance', async () => {
    paidOrderFetch();
    const n = normalizePrepayInput(input()); if (!n.ok) throw new Error('n');
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: paidSnap({ prepayInput: n.input, prepayInputVersion: 1, prepayFingerprint: prepayFingerprint(n.input) }) });
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER, language: 'ko' }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(r.rejection).toBeUndefined();
    expect(r.planClaim).toBeDefined();
  });
  it('already-paid OLD order (no fingerprint): first normalizable request is pinned once; a later different request is refused', async () => {
    paidOrderFetch();
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: paidSnap({ ownerUid: 'uid1' }) });
    const first = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(first.rejection).toBeUndefined();
    const pinned = db._store.get(`paypal_order_snapshots/${ORDER}`) as Dict;
    expect(pinned).toMatchObject({ prepayPinnedFrom: 'legacy_paid_first_use', prepayPinnedUid: 'uid1' });
    db._store.delete(`plan_issued_orders/${ORDER}`); // 생성 실패 후 재시도 상황
    const changed = await enforcePaymentAndRevision({ ...input({ dietaryRestrictions: [] }), paypalOrderId: ORDER }, db, 'u@e.x', 'uid1', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(changed.rejection).toMatchObject({ code: 'PREPAY_INPUT_MISMATCH' });
  });
  it("old order owned by someone else cannot be pinned by another user", async () => {
    paidOrderFetch();
    const db = memDb({ [`paypal_order_snapshots/${ORDER}`]: paidSnap({ ownerUid: 'owner' }) });
    const r = await enforcePaymentAndRevision({ ...input(), paypalOrderId: ORDER }, db, 'x@e.x', 'intruder', null, { loadFoodIndex: async () => [HALAL_SEOUL] });
    expect(r.rejection).toMatchObject({ statusCode: 403 });
    expect((db._store.get(`paypal_order_snapshots/${ORDER}`) as Dict).prepayFingerprint).toBeUndefined();
  });
  it('source: paid input binding and coverage precede issuance, coupon context remains fifth', () => {
    const src = read('api/_ai_core/paymentGate.js');
    const bind = src.indexOf('bound = await bindPrepayInputBeforeClaim(');
    const coverage = src.indexOf('const paidCoverage = await paidCoverageRejection(');
    const claim = src.indexOf('claimResult = await claimPlanIssuance(');
    expect(bind).toBeGreaterThan(-1);
    expect(coverage).toBeGreaterThan(bind);
    expect(claim).toBeGreaterThan(coverage);
    expect(src).toContain('authenticatedUid, couponContext = null, { loadFoodIndex');
    expect(src).not.toContain('coverageRejectionBeforeConsumption');
  });
});

describe('wiring — frontend sends the same input; Inngest retries never re-charge', () => {


  it('the Inngest worker never re-enters the payment gate or PayPal order/capture', () => {
    const worker = read('api/_inngest/functions/processPlanAfterAI.js');
    expect(worker).not.toMatch(/enforcePaymentAndRevision|createPaypalOrder|capturePaypalOrder|claimPlanIssuance\(/);
  });
});
