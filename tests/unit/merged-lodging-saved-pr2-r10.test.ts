/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * PR2 r10 — 저장된 플랜에서 "같은 숙소로 합친 표식의 이동 null" 을 "경로 실패 null" 과 구분(same_lodging_as_prev).
 *   ① recalc-transit 재계산이 병합 숙소에 이동 25 + 버퍼 5 를 다시 더하지 않는다 ② qualityMetrics 가 병합을 route_failure 로 세지 않는다.
 *   편집으로 앞 stop 이 바뀌면 표식이 있어도 병합 아님(자동 해제). 공개 투영엔 노출 안 됨. 실 Firestore·NCP·ODsay 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fx = vi.hoisted(() => ({ planData: null as any, updates: [] as any[] }));
function chain(): any {
  return {
    collection: () => chain(),
    doc: () => chain(),
    get: async () => ({ exists: fx.planData !== null, data: () => fx.planData }),
    update: async (u: any) => { fx.updates.push(u); },
    set: async () => {},
  };
}
vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn(), cert: vi.fn(), getApps: () => [{}] }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => chain(), FieldValue: { increment: () => 1 } }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({ checkIpRateLimit: async () => ({ ok: true }), getClientIp: () => '1.2.3.4' }));
vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('offline'))), post: vi.fn(() => Promise.reject(new Error('offline'))) } }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => null, getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null), searchTransitRoute: vi.fn(async () => null) }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: async () => null, getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: async () => ({ ok: false }), default: async () => ({ ok: false }) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock' }));

import { isMergedLodgingStop, SAME_LODGING_FIELD } from '../../api/_ai_core/mergedLodging.js';
import { computeQualityScore } from '../../api/_ai_core/qualityMetrics.js';
import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';
import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';
import { projectPublicPlan } from '../../src/lib/publicPlanProjection.js';

const P = { lat: 37.5636, lng: 126.9826 };
const hotel = (t: string, extra: any = {}) => ({ category: 'lodging', name: 'Hotel', start_time: t, stay_min: 60, ...P, ...extra });

beforeEach(() => { fx.planData = null; fx.updates.length = 0; });

async function recalc(stops: any[]) {
  fx.planData = { uid: null, accessToken: null, itinerary: { days: [{ day: 1, stops }] } };
  const handler = (await import('../../api/recalc-transit.js')).default;
  const res: any = { statusCode: 0, headers: {}, setHeader() {}, status(s: number) { res.statusCode = s; return res; }, json() { return res; } };
  await handler({ method: 'POST', headers: {}, body: { planId: 'p', dayIndex: 0 } } as any, res);
  return fx.updates[0]?.['itinerary.days']?.[0]?.stops as any[];
}

describe('r10-1 — recalc-transit keeps a merged same-hotel marker at 0 travel', () => {
  it('Astra repro: edited activity → stale hotel → the merged same hotel follows at hotel + stay (no 25 + 5)', async () => {
    const out = await recalc([
      { category: 'culture', name: 'Palace', start_time: '09:00', stay_min: 60, lat: P.lat + 0.01, lng: P.lng },
      hotel('11:30', { transit_from_prev: { est_min: 20, _stale: true } }),
      hotel('12:30', { transit_from_prev: null, [SAME_LODGING_FIELD]: true }),
    ]);
    expect(out[1].start_time).toBe('10:30'); // 09:00 + 60 + 25(재조회 실패 기본) + 5
    expect(out[2].start_time).toBe('11:30'); // 10:30 + 숙소 체류 60 (수정 전 12:00)
    expect(out[2].transit_from_prev == null).toBe(true);
  });
  it('a stale-marked merged stop is not re-queried; transit stays null', async () => {
    const out = await recalc([hotel('11:30'), hotel('12:30', { transit_from_prev: { _stale: true }, [SAME_LODGING_FIELD]: true })]);
    expect(out[1].transit_from_prev).toBeNull();
    expect(out[1].start_time).toBe('12:30');
  });
  it('the previous stop changed by an edit (now an activity) → not merged → normal 25 + 5 restitch', async () => {
    const out = await recalc([
      hotel('09:00', { transit_from_prev: { _stale: true } }),
      { category: 'culture', name: 'Palace', start_time: '10:00', stay_min: 60, lat: P.lat + 0.01, lng: P.lng, transit_from_prev: { _stale: true } },
      hotel('12:30', { transit_from_prev: null, [SAME_LODGING_FIELD]: true }),
    ]);
    expect(out[1].start_time).toBe('10:30'); // 09:00 + 60 + 25 + 5
    expect(out[2].start_time).toBe('12:00'); // 10:30 + 60 + 25 + 5 — 병합 아님(표식 무시)
  });
});

describe('r10-2 — qualityMetrics does not count a merged marker as a route failure', () => {
  const itin = (flag: boolean) => ({ days: [{ day: 1, stops: [hotel('22:40'), hotel('22:40', { transit_from_prev: null, ...(flag ? { [SAME_LODGING_FIELD]: true } : {}) })] }] });
  it('merged → route_failure 0 (and not in the denominator)', () => {
    expect(computeQualityScore(itin(true), [], 'seoul', []).metrics.route_failure).toEqual({ total: 0, count: 0 });
  });
  it('an unmerged null transit with coordinates still counts as a failure', () => {
    expect(computeQualityScore(itin(false), [], 'seoul', []).metrics.route_failure).toEqual({ total: 1, count: 1 });
  });
});

describe('r10 — the field: set by RouteAgent, released by edits, never public', () => {
  it('RouteAgent sets same_lodging_as_prev on the merged marker only; public projection drops it', async () => {
    process.env.ROUTE_TSP_ENABLED = 'false';
    const spy = vi.spyOn(RouteAgent.prototype, '_getTransitData').mockImplementation(async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) =>
      ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null }) as never);
    const itinerary: any = { days: [
      { day: 1, city: 'seoul', stops: [hotel('07:00', { stay_min: 0 }), { category: 'food', name: 'Lunch', start_time: '12:30', stay_min: 60, lat: P.lat + 0.004, lng: P.lng }, { category: 'food', name: 'Dinner', start_time: '18:30', stay_min: 60, lat: P.lat + 0.008, lng: P.lng }, hotel('21:00')] },
      { day: 2, city: 'seoul', stops: [hotel('22:40'), hotel('23:30')] },
    ] };
    await enrichItineraryWithRoute(itinerary, { apiKey: null, body: { area: 'seoul', regions: ['seoul'], language: 'en' }, language: 'en', hotel_address: '', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1', pax: 2, zone_id: null });
    spy.mockRestore(); delete process.env.ROUTE_TSP_ENABLED;
    expect(itinerary.days[1].stops[1][SAME_LODGING_FIELD]).toBe(true);
    expect(itinerary.days[0].stops.some((s: any) => SAME_LODGING_FIELD in s)).toBe(false);
    const pub: any = projectPublicPlan({ status: 'ready', itinerary }, { language: 'en' });
    expect(JSON.stringify(pub)).not.toContain(SAME_LODGING_FIELD);
  });
  it.each([
    ['still the same hotel (same coordinates)', [hotel('22:40'), hotel('22:40', { [SAME_LODGING_FIELD]: true })], true],
    ['same name, no coordinates', [hotel('22:40', { lat: null, lng: null }), hotel('22:40', { lat: null, lng: null, [SAME_LODGING_FIELD]: true })], true],
    ['previous stop is now an activity', [{ category: 'culture', name: 'X', ...P }, hotel('22:40', { [SAME_LODGING_FIELD]: true })], false],
    ['previous stop is now a different hotel (5 km away)', [hotel('22:40', { lat: P.lat + 0.05 }), hotel('22:40', { [SAME_LODGING_FIELD]: true })], false],
    ['no field', [hotel('22:40'), hotel('22:40')], false],
  ] as Array<[string, any[], boolean]>)('isMergedLodgingStop: %s → %s', (_n, stops, want) => {
    expect(isMergedLodgingStop(stops, 1)).toBe(want);
  });
});
