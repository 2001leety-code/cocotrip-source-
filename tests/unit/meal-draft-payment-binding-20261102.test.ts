/**
 * 2026-11-01 B6-1 r23 — capturePaypalOrder 핸들러 수준(완전 오프라인).
 *   1) ROLL: r22 이전 기록(intentProven 칸 없음)은 main 처럼 재생 — 쿠폰 포함(쿠폰은 정상 사용 처리).
 *   2) S1(명시적 intentProven:false) 삭제 때 그 기록 입력이 선점한 쿠폰도 같은 트랜잭션에서 해제 — 다른 주문이 쥔 쿠폰은 안 풂.
 *   3) noPost('posted' 저장 실패 = PayPal 에 POST 0회) + 무증명 = 기록 삭제(+쿠폰 해제), 응답은 r24 부터 main 과 같은 202
 *      CAPTURE_UNKNOWN 모양(r23 은 503) · 증명 있으면 기존 202 UNKNOWN(기록 유지) ·
 *      이미 posted 였던 기록은 삭제하지 않음(앞선 POST 가 날아갔을 수 있다).
 *   main 비교: main 은 1) 과 같이 재생, 2) 는 S1 이 없어 외부인 입력으로 재생(쿠폰은 사용 처리), 3) 은 'unknown' 으로 남아 소유자
 *   확인 때 외부인 입력이 재생된다(r22 가 약속한 정리 범위).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newCheckoutCapability, checkoutCookie } from '../../api/_shared/payment-fulfillment-recovery.js';
import { memoryDb, fakeRes, providerFetch, completedOrder, type MemoryDb } from './helpers/payment-recovery-fixture';

const effects = vi.hoisted(() => ({
  store: { db: null as MemoryDb | null },
  processor: vi.fn(), alert: vi.fn(async () => {}), notifyOperator: vi.fn(async () => {}),
  discountV2: false,
  token: vi.fn(async () => ({ accessToken: 'offline-token', baseUrl: 'https://paypal.invalid' })),
}));
vi.mock('firebase-admin/firestore', async () => {
  const { TS } = await import('./helpers/payment-recovery-fixture');
  return { FieldValue: { serverTimestamp: () => TS } };
});
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async (token: string) => ({ uid: token, email: `${token}@example.invalid` }) }) }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('../../api/_shared/paypal.js', () => ({ getPaypalAccessToken: effects.token, resolveIsSandbox: () => false }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => effects.store.db }));
vi.mock('../../api/_shared/ai-planner-policy.js', () => ({ checkAiPlannerCouponPolicy: () => ({ ok: true }), isAiPlannerProduct: () => true }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ confirmSlotLock: vi.fn(), fetchServerSlotCapacity: vi.fn(async () => ({ ok: true, capacity: 10 })), readSlotFields: () => null }));
vi.mock('../../api/_shared/global-promo.js', () => ({ incrementGlobalPromoUsage: vi.fn(async () => ({ ok: true })), KNOWN_GLOBAL_PROMO_CODES: [] }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: vi.fn() }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: effects.processor }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: effects.alert }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: effects.notifyOperator }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => ({ ok: true, delivery: 'sent' })) }));
vi.mock('../../api/_shared/feature-flag.js', () => ({ featureEnabled: () => effects.discountV2 }));
vi.mock('../../api/_shared/attribution.js', () => ({ sanitizeAttribution: () => null }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));
vi.mock('../../api/_shared/pricing.js', () => ({ loadPricingSpec: () => ({ charter_usd_fix_rate: 1350 }), AI_PLANNER_FULL_KRW: 13300, AI_PLANNER_FULL_USD: 9.90, CUSTOM_ESTIMATE_MIN_KRW: 30000, CUSTOM_ESTIMATE_MAX_KRW: 10000000, isCustomEstimateProduct: () => false }));


vi.mock('../../api/_ai_core/mealActor.js', () => ({ verifyMealActor: async (req: { headers: Record<string,string> }) => ({ ok: req.headers.actor !== 'lost', uid: req.headers.actor || 'owner' }) }));
vi.mock('../../api/_ai_core/mealFoodRows.js', () => ({ loadMealFoodRows: async () => [] }));
vi.mock('../../api/_ai_core/mealPlanIntegration.js', () => ({ mealDatabaseVersion: () => 'db1', validateStoredMealDraft: async () => ({ status: 'verified' }) }));
vi.mock('../../api/_shared/prepay-coverage.js', async (original) => ({ ...(await original() as object), loadPrepayFoodIndex: async () => [], checkPrepayCoverage: () => ({ ok: true }) }));
import capture from '../../api/capturePaypalOrder.js';
import create from '../../api/createPaypalOrder.js';
import { normalizePrepayInput, prepaySnapshotFields } from '../../api/_shared/prepay-coverage.js';
import { assertMealDraftIntegrity, draftPayloadFingerprint, persistBoundMealDraft, fulfillBoundMealDraft } from '../../api/_shared/meal-draft-binding.js';
import { claimPlanIssuance } from '../../api/_shared/plan-issuance.js';
const input = { startDate: '2027-12-01', durationDays: 1, area: 'Seoul', regions: ['Seoul'], dietaryRestrictions: [] };
const prepay = normalizePrepayInput(input).input;
const draft = () => { const d = { uid: 'owner', status: 'verified', revision: 'r1', fingerprint: '', inputFingerprint: 'input1', dbVersion: 'db1', input, itinerary: { days: [{ day: 1, city: 'Seoul', stops: [] }] }, draftId: 'draft1' }; d.fingerprint = draftPayloadFingerprint(d); return d; };
let db: ReturnType<typeof memoryDb>;
let provider: ReturnType<typeof providerFetch>;
beforeEach(() => {
 vi.clearAllMocks(); db = memoryDb(); effects.store.db = db.db;
 provider = providerFetch([]); vi.stubGlobal('fetch', provider.impl);
 db.rows.set('meal_plan_drafts/draft1', draft());
 effects.processor.mockResolvedValue({ ok: true, status: 200, outcome: 'completed' });
});
async function call(handler: typeof capture, body: object, actor = 'owner', extraHeaders: Record<string, string> = {}) { const res = fakeRes(); await handler({ method: 'POST', body, headers: { actor, authorization: `Bearer ${actor}`, ...extraHeaders } }, res); return res.state; }
const snapshot = () => ({ mealDraftBindingVersion: 1, productType: 'ai_planner_full', expectedUSD: '9.90', expectedKRW: 13300, expectedCurrency: 'USD', usdRate: 1350, passengers: 1, ownerUid: 'owner', ...prepaySnapshotFields(prepay, []), mealDraftSnapshot: draft() });
function seed() { db.rows.set('paypal_order_snapshots/ORDER1', snapshot()); }
describe('server meal draft payment binding', () => {
 it('rejects owner, stale revision, payload tampering and input mismatch', () => {
   const d = draft();
   expect(() => assertMealDraftIntegrity(d, 'stranger', d, prepay)).toThrow('MEAL_DRAFT_OWNER_MISMATCH');
   expect(() => assertMealDraftIntegrity(d, 'owner', { ...d, revision: 'r2' }, prepay)).toThrow('MEAL_DRAFT_STALE');
   expect(() => assertMealDraftIntegrity({ ...d, itinerary: { days: [] } }, 'owner', d, prepay)).toThrow('MEAL_DRAFT_INTEGRITY');
   expect(() => assertMealDraftIntegrity(d, 'owner', d, { ...prepay, durationDays: 2 })).toThrow('MEAL_DRAFT_INPUT_MISMATCH');
 });
 it('create refuses missing and foreign drafts before PayPal transport', async () => {
   expect((await call(create, { productType: 'ai_planner_full', plannerInput: input })).status).toBe(409);
   expect(provider.calls).toHaveLength(0);
   expect((await call(create, { productType: 'ai_planner_full', plannerInput: input, mealDraft: draft() }, 'stranger')).status).toBe(409);
   expect(provider.calls).toHaveLength(0);
 });
 it('create stores the authoritative draft in its order snapshot', async () => {
   provider.push({ method: 'POST', reply: { status: 201, body: { id: 'ORDER1' } } });
   const out = await call(create, { productType: 'ai_planner_full', plannerInput: input, mealDraft: draft(), expectedUSD: 9.90, mealDraftBindingVersion: 0 });
   expect(out.status).toBe(200);
   expect(db.rows.get('paypal_order_snapshots/ORDER1')?.mealDraftSnapshot).toEqual(draft());
   expect(db.rows.get('paypal_order_snapshots/ORDER1')?.mealDraftBindingVersion).toBe(1);
   expect(provider.calls.filter(c => c.method === 'POST')).toHaveLength(1);
 });
 it('requires the disclosed opening notice version and records it before conditional checkout', async () => {
   const conditional = { ...draft(), status: 'opening_unconfirmed' };
   db.rows.set('meal_plan_drafts/draft1', conditional);
   const missing = await call(create, { productType: 'ai_planner_full', plannerInput: input, mealDraft: conditional });
   expect(missing.status).toBe(409); expect(provider.calls).toHaveLength(0);
   provider.push({ method: 'POST', reply: { status: 201, body: { id: 'ORDER1' } } });
   const out = await call(create, { productType: 'ai_planner_full', plannerInput: input, mealDraft: { ...conditional, openingNoticeVersion: 'meal-opening-unconfirmed-v1' } });
   expect(out.status).toBe(200);
   expect(db.rows.get('paypal_order_snapshots/ORDER1')?.mealDraftSnapshot).toMatchObject({ status: 'opening_unconfirmed', openingNoticeVersion: 'meal-opening-unconfirmed-v1', openingNoticeRecordedAt: expect.any(String) });
 });
 it('capture uses the snapshot notice and ignores a client replacement', async () => {
   const conditional = { ...draft(), status: 'opening_unconfirmed', openingNoticeVersion: 'meal-opening-unconfirmed-v1', openingNoticeRecordedAt: '2026-11-02T00:00:00.000Z', input: { ...input, email: 'server@example.invalid' } };
   conditional.fingerprint = draftPayloadFingerprint(conditional);
   db.rows.set('meal_plan_drafts/draft1', conditional);
   db.rows.set('paypal_order_snapshots/ORDER1', { ...snapshot(), mealDraftSnapshot: conditional });
   provider.push({ method: 'POST', reply: { status: 201, body: completedOrder('ORDER1', '9.90') } });
   const out = await call(capture, { orderID: 'ORDER1', userEmail: 'forged@example.invalid', mealDraft: { openingNoticeVersion: 'forged' } });
   expect(out.status).toBe(200);
   expect((db.rows.get('used_paypal_orders/ORDER1')?.intent as { body: { userEmail: string } }).body.userEmail).toBe('server@example.invalid');
   expect((db.rows.get('used_paypal_orders/ORDER1')?.intent as { body: { itineraryData: unknown } }).body.itineraryData).toMatchObject({ mealDraft: { openingNoticeVersion: 'meal-opening-unconfirmed-v1' } });
 });
 it('capture rejects a guest/owner mismatch without touching the attempt or provider', async () => {
   seed(); const out = await call(capture, { orderID: 'ORDER1' }, 'guest-other');
   expect(out.status).toBe(403); expect(provider.calls).toHaveLength(0); expect(db.rows.get('used_paypal_orders/ORDER1')?.captureState).not.toBe('posted');
 });
 it.each([null, 0, '1', 2])('never treats explicit malformed contract version %j as legacy', async (version) => {
   db.rows.set('paypal_order_snapshots/ORDER1', { ...snapshot(), mealDraftBindingVersion: version, mealDraftSnapshot: undefined });
   const out = await call(capture, { orderID: 'ORDER1', mealDraftBindingVersion: undefined });
   expect(out.status).toBe(409); expect(provider.calls).toHaveLength(0);
 });
 it('a draft-bearing snapshot without its contract version is never legacy', async () => {
   const snap = snapshot(); delete snap.mealDraftBindingVersion;
   db.rows.set('paypal_order_snapshots/ORDER1', snap);
   const out = await call(capture, { orderID: 'ORDER1' });
   expect(out.status).toBe(409); expect(provider.calls).toHaveLength(0);
 });
 it('v1 missing its draft cannot opt out through the capture body', async () => {
   const snap = snapshot(); delete snap.mealDraftSnapshot;
   db.rows.set('paypal_order_snapshots/ORDER1', snap);
   const out = await call(capture, { orderID: 'ORDER1', mealDraftBindingVersion: 0, mealDraftSnapshot: draft() });
   expect(out.status).toBe(409); expect(provider.calls).toHaveLength(0);
 });
 it('a lost v1 actor session reconciles posted UNKNOWN with the checkout capability and never sends another POST', async () => {
   const cap = newCheckoutCapability();
   db.rows.set('paypal_order_snapshots/ORDER1', { ...snapshot(), recoveryDigest: cap.digest });
   db.rows.set('used_paypal_orders/ORDER1', { status: 'pending', flow: 'single', environment: 'live', requestKey: 'ORDER1-cap', captureState: 'unknown', claimToken: 'expired', claimUntil: 0, intentProven: true, stages: {}, intent: { version: 1, body: { product: 'ai_planner_full', userEmail: 'saved@example.invalid', itineraryData: { itinerary: draft().itinerary } }, uid: 'owner', coupon: null, discountV2: false } });
   const headers = { cookie: checkoutCookie('single', 'ORDER1', cap.secret).split(';')[0] };
   provider.push({ method: 'GET', reply: { status: 200, body: { id: 'ORDER1', status: 'APPROVED' } } });
   const pending = await call(capture, { orderID: 'ORDER1', reconcile: true }, 'lost', headers);
   expect(pending.status).toBe(202); expect(db.rows.has('used_paypal_orders/ORDER1')).toBe(true);
   provider.push({ method: 'GET', reply: { status: 200, body: completedOrder('ORDER1', '9.90') } });
   const done = await call(capture, { orderID: 'ORDER1', reconcile: true }, 'lost', headers);
   expect(done.status).toBe(200);
   expect(provider.calls.map(c => c.method)).toEqual(['GET', 'GET']);
 });
 it('a fresh v1 lost actor session cannot start capture', async () => {
   seed();
   const out = await call(capture, { orderID: 'ORDER1' }, 'lost');
   expect(out.status).toBe(403); expect(provider.calls).toHaveLength(0);
 });
 it('stale capture is refused without a capture POST', async () => {
   seed(); db.rows.set('meal_plan_drafts/draft1', { ...draft(), revision: 'changed' });
   await call(capture, { orderID: 'ORDER1', itineraryData: { hacked: true } });
   expect(provider.calls.filter(c => c.method === 'POST')).toHaveLength(0);
 });
 it('capture ignores client draft swaps and an idempotent retry never charges twice', async () => {
   seed();
   provider.push({ method: 'POST', reply: { status: 201, body: completedOrder('ORDER1', '9.90') } });
   const out = await call(capture, { orderID: 'ORDER1', itineraryData: { hacked: true, mealDraft: { draftId: 'foreign' } } });
   expect(out.status).toBe(200);
   expect((db.rows.get('used_paypal_orders/ORDER1')?.intent as { body: { itineraryData: unknown } }).body.itineraryData).toEqual({ itinerary: draft().itinerary, mealDraft: { draftId: 'draft1', revision: 'r1', fingerprint: draft().fingerprint } });
   const retry = await call(capture, { orderID: 'ORDER1', reconcile: true });
   expect(retry.status).toBe(200);
   expect(provider.calls.filter(c => c.method === 'POST')).toHaveLength(1);
 });
 it('guest fulfillment uses the server draft contact without adopting it as identity', async () => {
   const d = { ...draft(), status: 'opening_unconfirmed', openingNoticeVersion: 'meal-opening-unconfirmed-v1', openingNoticeRecordedAt: '2026-11-02T00:00:00Z', input: { ...input, email: 'guest-contact@example.invalid' } };
   const claim = (await claimPlanIssuance(db.db, 'GUESTORDER', { uid: 'owner' })).claim;
   const notify = vi.fn();
   await fulfillBoundMealDraft({ db: db.db, draft: d, claim, guest: true, authenticatedEmail: null, pricingFor: () => ({ priceKRW: 100, priceUSD: 1 }), notify });
   expect(notify.mock.calls[0][0]).toMatchObject({ email: 'guest-contact@example.invalid', uid: 'owner' });
   expect(db.rows.get(`plans/${claim.planId}`)).toMatchObject({ uid: 'owner', guestEmail: 'guest-contact@example.invalid', mealDraftBinding: { openingNoticeVersion: 'meal-opening-unconfirmed-v1' } });
 });
 it('persists the exact itinerary using the reserved issuance plan ID', async () => {
   const result = await claimPlanIssuance(db.db, 'ORDER1', { uid: 'owner' });
   const saved = await persistBoundMealDraft(db.db, draft(), result.claim, { guest: true });
   expect(db.rows.get(`plans/${saved.planId}`)?.itinerary).toEqual(draft().itinerary);
   expect(db.rows.get(`plans/${saved.planId}`)?.uid).toBe('owner');
   expect(saved.planUrl).toContain('?token=');
   const second = await claimPlanIssuance(db.db, 'ORDER1', { uid: 'owner' });
   expect(second.claim).toBeUndefined();
 });
});
