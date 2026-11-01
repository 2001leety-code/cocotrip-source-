/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * PR2 r13 — 편집 후 재계산(recalc-transit)이 생성(RouteAgent)과 같은 규칙을 쓴다.
 *   ① 앞 stop 의 명시 stay_min 0 은 0(예전 `|| 60` = 편집 한 번에 +60분) — LC-4·LC-3.
 *   ② 편집으로 새로 이웃한 같은 숙소 두 표식은 이동 없이 병합(표식 부착) — LC-2. 기존 병합 표식 유지.
 *   실 Firestore·NCP·ODsay 0.
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
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), updateDoc: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/lib/authFetch', () => ({ authFetch: vi.fn() }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({ checkIpRateLimit: async () => ({ ok: true }), getClientIp: () => '1.2.3.4' }));
vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.reject(new Error('offline'))), post: vi.fn(() => Promise.reject(new Error('offline'))) } }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => null }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: async () => null }));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: async () => ({ ok: false }), default: async () => ({ ok: false }) }));

import { markStopStale } from '../../src/pages/PlanDetailPage/hooks/usePlanEditor';
import { SAME_LODGING_FIELD, stayMinOf } from '../../api/_ai_core/mergedLodging.js';
import { projectPublicPlan } from '../../src/lib/publicPlanProjection.js';

const P = { lat: 37.5636, lng: 126.9826 };
const hotel = (t: string, extra: any = {}) => ({ category: 'lodging', name: 'Hotel', start_time: t, stay_min: 0, ...P, ...extra });
const act = (name: string, t: string, dLat: number, extra: any = {}) => ({ category: 'culture', name, start_time: t, stay_min: 60, lat: P.lat + dLat, lng: P.lng, transit_from_prev: { method: 'car', est_min: 20 }, ...extra });

beforeEach(() => { fx.planData = null; fx.updates.length = 0; });

async function recalc(stops: any[], dayExtra: any = {}, input: any = {}) {
  fx.planData = { uid: null, accessToken: null, input, itinerary: { days: [{ day: 2, ...dayExtra, stops }] } };
  const handler = (await import('../../api/recalc-transit.js')).default;
  const res: any = { statusCode: 0, body: null, setHeader() {}, status(s: number) { res.statusCode = s; return res; }, json(o: any) { res.body = o; return res; } };
  await handler({ method: 'POST', headers: {}, body: { planId: 'p', dayIndex: 0 } } as any, res);
  return { res, stops: fx.updates[0]?.['itinerary.days']?.[0]?.stops as any[] };
}
/** usePlanEditor.deleteStop 과 같은 순서: 삭제 → 그 자리와 다음을 stale(편집 전 배열 기준으로 병합 쌍 유지 판정). */
function deleteAt(stops: any[], i: number) {
  const before = stops.slice();
  stops.splice(i, 1);
  markStopStale(stops, i, before); markStopStale(stops, i + 1, before);
}
const times = (stops: any[]) => stops.map((s) => s.start_time);

describe('r13-1 — an explicit stay_min 0 is read as 0 after an edit (same rule as generation)', () => {
  it('LC-4: [Hotel 09:00 (stay 0), Museum, Market, Park, Hotel] delete Museum → Market 09:30 (not 10:30)', async () => {
    const stops: any[] = [hotel('09:00', { transit_from_prev: null }), act('Museum', '09:25', 0.01), act('Market', '10:50', 0.02), act('Park', '12:15', 0.03), hotel('13:40', { transit_from_prev: { method: 'car', est_min: 20 } })];
    deleteAt(stops, 1);
    const { res, stops: out } = await recalc(stops);
    expect(res.body).toMatchObject({ ok: true });
    expect(out[1].start_time).toBe('09:30'); // 09:00 + 0 + 25(오프라인 기본) + 5
    expect(out[2].start_time).toBe('11:00'); // 09:30 + 60 + 25 + 5
  });
  it('LC-3: zone plan, NightMarket 22:00 moved before the hotel pair → hotel 23:00, next hotel 23:30 (no 00:30 wrap)', async () => {
    const noCoord = { lat: null, lng: null };
    const before: any[] = [hotel('23:30', { name: '명동 호텔', ...noCoord, transit_from_prev: null }), hotel('23:30', { name: '명동 호텔', ...noCoord, transit_from_prev: null, [SAME_LODGING_FIELD]: true }), act('NightMarket', '22:00', 0.01, { stay_min: 30 })];
    const stops = [before[2], before[0], before[1]];
    stops.forEach((_s, i) => markStopStale(stops, i, before));
    const { stops: out } = await recalc(stops, {}, { recommended_zone_address: '서울 중구 명동' });
    expect(times(out)).toEqual(['22:00', '23:00', '23:30']);
  });
  it('stayMinOf: missing / empty / non-numeric → 60, explicit 0 → 0, negative → 0', () => {
    expect([stayMinOf({}), stayMinOf({ stay_min: '' }), stayMinOf({ stay_min: 'x' }), stayMinOf({ stay_min: null })]).toEqual([60, 60, 60, 60]);
    expect([stayMinOf({ stay_min: 0 }), stayMinOf({ stay_min: '0' }), stayMinOf({ stay_min: -5 }), stayMinOf({ stay_min: 45.7 })]).toEqual([0, 0, 0, 45]);
  });
});

describe('r13-2 — hotel markers that become neighbours through an edit are merged (no fake travel)', () => {
  const day2 = () => [
    hotel('09:00', { transit_from_prev: null }),
    act('Museum', '09:25', 0.01),
    hotel('10:50', { stay_min: 120, transit_from_prev: { method: 'car', est_min: 20 } }),
    hotel('12:50', { transit_from_prev: null, [SAME_LODGING_FIELD]: true }),
    act('Market', '13:15', 0.02),
    act('Park', '14:40', 0.03),
  ];
  it('LC-2: delete Museum → [09:00, 09:00, 11:00, 11:25], no travel for the merged hotels, both markers set', async () => {
    const stops = day2();
    deleteAt(stops, 1);
    expect(stops[2][SAME_LODGING_FIELD]).toBe(true); // 기존 병합 쌍(앞 stop 그대로)은 유지
    const { stops: out } = await recalc(stops);
    expect(times(out).slice(0, 4)).toEqual(['09:00', '09:00', '11:00', '11:25']);
    expect(out[1].transit_from_prev).toBeNull();
    expect(out[2].transit_from_prev).toBeNull();
    expect(out[1][SAME_LODGING_FIELD]).toBe(true);
    expect(out[2][SAME_LODGING_FIELD]).toBe(true);
    const pub: any = projectPublicPlan({ status: 'ready', itinerary: { days: [{ day: 2, stops: out }] } }, { language: 'en' });
    expect(JSON.stringify(pub)).not.toContain(SAME_LODGING_FIELD);
  });
  it('existing behaviour: an unrelated edit keeps the merged pair (marker, no travel, rest + stay)', async () => {
    const stops = day2();
    deleteAt(stops, 4); // Market 삭제 — 병합 쌍 뒤, 쌍과 무관
    expect(stops[4]._stale_transit === true || stops[4].transit_from_prev._stale === true).toBe(true);
    const { stops: out } = await recalc(stops);
    expect(out[3][SAME_LODGING_FIELD]).toBe(true);
    expect(out[3].transit_from_prev).toBeNull();
    expect(out[3].start_time).toBe('12:50');
    expect(out[4].start_time).toBe('13:20'); // 12:50 + 0 + 25 + 5
  });
  it('a hotel next to a different (far) hotel is not merged — normal re-query', async () => {
    const stops: any[] = [hotel('09:00', { transit_from_prev: null }), act('Museum', '09:25', 0.01), hotel('10:50', { name: 'Other', lat: P.lat + 0.02, transit_from_prev: { est_min: 20 } })];
    deleteAt(stops, 1);
    const { stops: out } = await recalc(stops);
    expect(out[1].transit_from_prev).toBeTruthy();
    expect(SAME_LODGING_FIELD in out[1]).toBe(false);
    expect(out[1].start_time).toBe('09:30');
  });
  it('coordinate-less bookend pair on a city-change day is not merged (generation excludes it too)', async () => {
    const noCoord = { lat: null, lng: null };
    const before: any[] = [hotel('20:00', { ...noCoord, transit_from_prev: null }), act('Museum', '20:30', 0.01), hotel('22:00', { ...noCoord, transit_from_prev: { est_min: 20 } })];
    const stops = before.slice();
    deleteAt(stops, 1);
    const city = await recalc(stops.map((s) => ({ ...s, transit_from_prev: s.transit_from_prev ? { ...s.transit_from_prev } : null })), { intercity_transit: { mode: 'ktx' } });
    expect(SAME_LODGING_FIELD in city.stops[1]).toBe(false);
    fx.updates.length = 0;
    const plain = await recalc(stops);
    expect(plain.stops[1][SAME_LODGING_FIELD]).toBe(true);
    expect(plain.stops[1].transit_from_prev).toBeNull();
  });
});
