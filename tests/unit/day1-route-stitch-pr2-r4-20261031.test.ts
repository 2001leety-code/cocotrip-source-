/**
 * 첫날 도착 PR2 r4 — Astra 코드 r3(CHANGES_REQUIRED 3건) 회귀. 실 Firestore·PayPal·ODsay 0.
 *   1) 무료 쿠폰 복구는 같은 소비(consumptionId)일 때만 — 가짜 Firestore 트랜잭션으로 **실제** consume/restoreAiPlanCoupon 실행.
 *   2) 같은 숙소 판정 = 두 좌표가 유효할 때만 50m 안(이름·누락 좌표로 합치지 않음).
 *   3) 경로 계산 실패 때 구제 식당과 겹치는 앞 관광을 뺀다(정상 경로 불변).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('offline'))), post: vi.fn(() => Promise.reject(new Error('offline'))) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));
vi.mock('../../api/_shared/paypal.js', () => ({ getPaypalAccessToken: async () => ({ accessToken: 'x', baseUrl: 'https://api.mock' }), resolveIsSandbox: () => false }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));

import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';
import { RouteAgent, isSameLodgingMarker } from '../../api/_ai_core/agents/RouteAgent.js';
import { expandBlocksToItinerary, settleUnroutedRescuedMeals } from '../../api/_ai_core/blockMode.js';
import { runRouteEnrichment } from '../../api/_ai_core/postResponsePipeline.js';
// @ts-expect-error — paymentGate.js 는 JS 모듈
import { enforcePaymentAndRevision, restoreAiPlanCoupon } from '../../api/_ai_core/paymentGate.js';

type Stop = Record<string, unknown>;
type Plan = { days: Array<{ day: number; city: string; stops: Stop[]; [k: string]: unknown }> };
const P = { lat: 37.5636, lng: 126.9826 };
const at = (n: number) => ({ lat: P.lat + n * 0.004, lng: P.lng + n * 0.004 });
const toMin = (v: unknown) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || '')); return m ? +m[1] * 60 + +m[2] : -1; };
const hotel = (t: string, extra: Stop = {}) => ({ category: 'lodging', name: 'Hotel', start_time: t, ...P, ...extra });
const midDay = (day: number) => ({ day, city: 'seoul', stops: [hotel('07:00'), { category: 'food', name: `Lunch ${day}`, start_time: '12:30', stay_min: 60, ...at(1) }, { category: 'food', name: `Dinner ${day}`, start_time: '18:30', stay_min: 60, ...at(2) }, hotel('21:00')] });
const lastDay = (day: number) => ({ day, city: 'seoul', stops: [hotel('06:00'), { category: 'airport', name: 'Incheon International Airport', start_time: '07:00' }] });

beforeEach(() => {
  process.env.ROUTE_TSP_ENABLED = 'false';
  vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) =>
    ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.ROUTE_TSP_ENABLED; });

/** users/{uid}/coupons 한 장 + 실제 트랜잭션 의미(tx.get 이 그 순간 문서, tx.update 가 반영). */
function fakeCouponDb(initial: Record<string, unknown>) {
  const doc: Record<string, unknown> = { ...initial };
  const ref = { id: 'coupon-1' };
  const col = { where() { return col; }, limit() { return col; }, async get() { return { empty: false, docs: [{ ref, data: () => ({ ...doc }) }] }; } };
  return {
    doc,
    collection: () => ({ doc: () => ({ collection: () => col }) }),
    async runTransaction(fn: (tx: unknown) => Promise<unknown>) {
      const writes: Array<Record<string, unknown>> = [];
      const out = await fn({ get: async () => ({ data: () => ({ ...doc }) }), update: (_r: unknown, patch: Record<string, unknown>) => { writes.push(patch); } });
      for (const w of writes) Object.assign(doc, w);
      return out;
    },
  };
}
const AI = { code: 'WELCOME-AIPLAN-ABC23', productScope: 'ai-plan', type: 'free', value: 100, isUsed: false, maxDays: 3 };
const UID = 'user123';
const consume = (db: ReturnType<typeof fakeCouponDb>) => enforcePaymentAndRevision({ aiCouponCode: AI.code, durationDays: 2 }, db, 'u@e.com', UID);

describe('r4-1 — coupon restore only undoes the same consumption', () => {
  it('A fails & restores → B reuses the coupon → A\'s failure handling runs again → B stays used', async () => {
    const db = fakeCouponDb(AI);
    const a = await consume(db);
    const aId = a.consumedCoupon.consumptionId;
    expect(typeof aId).toBe('string');
    expect(db.doc).toMatchObject({ isUsed: true, consumptionId: aId });
    await restoreAiPlanCoupon(db, UID, AI.code, aId);
    expect(db.doc).toMatchObject({ isUsed: false, consumptionId: null });
    const b = await consume(db);
    expect(b.isFreeAiCoupon).toBe(true);
    const bId = b.consumedCoupon.consumptionId;
    expect(bId).not.toBe(aId);
    await restoreAiPlanCoupon(db, UID, AI.code, aId); // A 의 onFailure 재실행
    expect(db.doc).toMatchObject({ isUsed: true, consumptionId: bId });
    expect((await consume(db)).rejection?.code).toBe('COUPON_USED');
  });
  it('restoring the same consumption twice = once (idempotent)', async () => {
    const db = fakeCouponDb(AI);
    const id = (await consume(db)).consumedCoupon.consumptionId;
    await restoreAiPlanCoupon(db, UID, AI.code, id);
    const firstRestoredAt = db.doc.restoredAt;
    await restoreAiPlanCoupon(db, UID, AI.code, id);
    expect(db.doc).toMatchObject({ isUsed: false, restoredAt: firstRestoredAt });
  });
  it('no consumption ID (old call shape) → nothing restored', async () => {
    const db = fakeCouponDb(AI);
    await consume(db);
    await restoreAiPlanCoupon(db, UID, AI.code);
    expect(db.doc.isUsed).toBe(true);
  });
});

describe('r4-2 — same-hotel markers need two valid coordinates within 50 m', () => {
  const L = (name: string, c: Stop) => ({ category: 'lodging', name, ...c });
  it.each([
    ['same coordinates', L('Hotel', P), L('Hotel', P), true],
    ['same coordinates, different names', L('Hotel', P), L('The Hotel Seoul', P), true],
    ['same name, coordinates 5 km apart', L('Hotel', P), L('Hotel', { lat: P.lat + 0.05, lng: P.lng }), false],
    ['both coordinates null (geocoding failed)', L('Hotel A', { lat: null, lng: null }), L('Hotel B', { lat: null, lng: null }), false],
    ['same name, both null', L('Hotel', { lat: null, lng: null }), L('Hotel', { lat: null, lng: null }), false],
    ['one side missing', L('Hotel', P), L('Hotel', {}), false],
  ] as Array<[string, Stop, Stop, boolean]>)('%s → %s', (_n, a, b, want) => {
    expect(isSameLodgingMarker(a, b)).toBe(want);
  });
  it('real RouteAgent: Day2 [Hotel A 22:40 (stay 60), Hotel B] with null coordinates → 422 (was merged and passed at 23:40)', async () => {
    const itin: Plan = { days: [midDay(1), { day: 2, city: 'seoul', stops: [{ category: 'lodging', name: 'Hotel A', start_time: '22:40', stay_min: 60, lat: null, lng: null }, { category: 'lodging', name: 'Hotel B', start_time: '23:40', lat: null, lng: null }] }, lastDay(3)] };
    await expect(enrichItineraryWithRoute(itin, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null }))
      .rejects.toMatchObject({ code: 'ROUTE_DAY_INFEASIBLE' });
  });
});

describe('r4-3 — route failure: no sightseeing overlaps the provisionally placed rescued meal', () => {
  const block = (id: string, spec: Array<[string, number]>) => ({
    id, city: 'seoul', zone: 'Test', theme: 'T', intensity: 'standard',
    stops: spec.map(([cat, off], i) => ({ order: i + 1, name: `${id} ${cat} ${off}`, category: cat, start_time_offset_min: off, stay_min: 60 })),
  });
  const input = { language: 'en', area: 'seoul', dietPrefs: [], foodIndex: [], startDate: '2026-06-15', arrival_time: '16:30', arrival_airport: 'ICN', tour_start_time: '09:00', tour_end_time: '21:00', arrival_rest_day: false };
  const sel = { day_selections: [{ day: 1, block_id: 'S1', tweak_notes: '' }, { day: 2, block_id: 'S2', tweak_notes: '' }], language: 'en' };
  const blocks = () => [block('S1', [['culture', 0], ['culture', 60], ['food', 360]]), block('S2', [['culture', 0], ['food', 180]])];
  const ctx = { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en', arrivalTime: '16:30', tourEndTime: '21:00' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null };
  const overlaps = (stops: Stop[]) => stops.some((s, i) => i > 0 && !['lodging', 'airport', 'airport_transfer', 'travel'].includes(String(stops[i - 1].category))
    && toMin(stops[i - 1].start_time) + Number(stops[i - 1].stay_min || 60) > toMin(s.start_time));

  it('probe repro: RouteAgent.call throws → the 20:30 sightseeing that runs into the 20:59 dinner is removed; 19:30 kept', async () => {
    const itin = expandBlocksToItinerary(sel, blocks(), structuredClone(input)) as Plan;
    expect(itin.days[0].stops.map((s) => s.start_time)).toEqual(['19:30', '20:30', '20:59']);
    vi.spyOn(RouteAgent.prototype, 'call').mockRejectedValue(new Error('ODsay down'));
    await runRouteEnrichment(itin, ctx);
    expect(itin.days[0].stops.map((s) => `${s.category}@${s.start_time}`)).toEqual(['culture@19:30', 'food@20:59']);
    expect(overlaps(itin.days[0].stops)).toBe(false);
    expect(itin.days[0].stops.some((s) => '_blockMealRole' in s)).toBe(false);
  });
  it('happy path (RouteAgent succeeds) is unchanged by the fallback: settle is a no-op without markers', async () => {
    const itin = expandBlocksToItinerary(sel, blocks(), structuredClone(input)) as Plan;
    await enrichItineraryWithRoute(itin, ctx);
    const before = JSON.stringify(itin);
    settleUnroutedRescuedMeals(itin);
    expect(JSON.stringify(itin)).toBe(before);
    expect(overlaps(itin.days[0].stops)).toBe(false);
  });
  it('pure: a meal right before the rescued one cannot be removed → the rescued meal goes, the day is flagged for the meal gate', () => {
    const plan: Plan = { days: [{ day: 1, city: 'seoul', stops: [
      { category: 'food', name: 'Lunch', start_time: '16:30', stay_min: 60 },
      { category: 'food', name: 'Dinner', start_time: '17:00', stay_min: 60, _blockMealRole: 'dinner' },
      hotel('21:00'),
    ] }] };
    settleUnroutedRescuedMeals(plan);
    expect(plan.days[0].stops.map((s) => s.name)).toEqual(['Lunch', 'Hotel']);
    expect(plan.days[0]._routeMealRemoved).toBe(true);
  });
});
