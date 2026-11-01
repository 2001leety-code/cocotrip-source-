/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * PR2 r11 — ① 편집으로 병합 숙소의 앞 stop 이 바뀌면(삭제·재정렬) 이동이 null 이어도 재조회 대상 + 병합 표식 해제(실제 편집기 helper → 실제 recalc 핸들러).
 *   ② 저장 후 재확인(isMergedLodgingStop)이 RouteAgent 와 같은 규칙(50m + 숙소뿐인 날·이름·주소·예약 숙소 주소)을 공유 — 생성 때보다 느슨하지 않다.
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
import { isMergedLodgingStop, isSameLodgingMarker, isLodgingBookendPair, SAME_LODGING_FIELD } from '../../api/_ai_core/mergedLodging.js';
import * as routeAgentModule from '../../api/_ai_core/agents/RouteAgent.js';
import { computeQualityScore } from '../../api/_ai_core/qualityMetrics.js';

const P = { lat: 37.5636, lng: 126.9826 };
const hotel = (t: string, extra: any = {}) => ({ category: 'lodging', name: 'Hotel', start_time: t, stay_min: 60, ...P, ...extra });

beforeEach(() => { fx.planData = null; fx.updates.length = 0; });

async function recalc(stops: any[], input: any = {}) {
  fx.planData = { uid: null, accessToken: null, input, itinerary: { days: [{ day: 1, stops }] } };
  const handler = (await import('../../api/recalc-transit.js')).default;
  const res: any = { statusCode: 0, body: null, setHeader() {}, status(s: number) { res.statusCode = s; return res; }, json(o: any) { res.body = o; return res; } };
  await handler({ method: 'POST', headers: {}, body: { planId: 'p', dayIndex: 0 } } as any, res);
  return { res, stops: fx.updates[0]?.['itinerary.days']?.[0]?.stops as any[] };
}

describe('r11-1 — an edit that changes the merged hotel\'s previous stop re-queries it and releases the marker', () => {
  it('Astra repro: [Palace, Hotel, Hotel(merged)] → delete the middle hotel → recalculated 1, transit + time updated, marker gone', async () => {
    const stops: any[] = [
      { category: 'culture', name: 'Palace', start_time: '09:00', stay_min: 60, lat: P.lat + 0.01, lng: P.lng },
      hotel('10:30', { transit_from_prev: { est_min: 20 } }),
      hotel('11:30', { transit_from_prev: null, [SAME_LODGING_FIELD]: true }),
    ];
    stops.splice(1, 1); // usePlanEditor.deleteStop 과 같은 순서: 삭제 → markStale(stopIdx) = 그 자리와 다음
    markStopStale(stops, 1); markStopStale(stops, 2);
    expect(stops[1]._stale_transit).toBe(true);
    expect(SAME_LODGING_FIELD in stops[1]).toBe(false);
    const { res, stops: out } = await recalc(stops);
    expect(res.body).toMatchObject({ ok: true, recalculated: 1 });
    expect(out[1].transit_from_prev).toBeTruthy(); // 재조회(오프라인 = 기본 25분)
    expect(out[1].start_time).toBe('10:30'); // 09:00 + 60 + 25 + 5 (옛 11:30 아님)
    expect('_stale_transit' in out[1]).toBe(false);
  });
  it('an edit elsewhere (not adjacent) keeps the marker and does not re-query the merged hotel', async () => {
    const stops: any[] = [
      { category: 'culture', name: 'A', start_time: '09:00', stay_min: 60, ...P, transit_from_prev: null },
      { category: 'culture', name: 'B', start_time: '10:30', stay_min: 60, lat: P.lat + 0.01, lng: P.lng, transit_from_prev: { est_min: 20 } },
      hotel('20:00', { transit_from_prev: { est_min: 20 } }),
      hotel('21:00', { transit_from_prev: null, [SAME_LODGING_FIELD]: true }),
    ];
    markStopStale(stops, 1); // B 만 바뀜
    expect(stops[3][SAME_LODGING_FIELD]).toBe(true);
    expect('_stale_transit' in stops[3]).toBe(false);
  });
  it('markStopStale on index 0 is a no-op', () => {
    const stops: any[] = [hotel('09:00', { transit_from_prev: null })];
    markStopStale(stops, 0);
    expect('_stale_transit' in stops[0]).toBe(false);
  });
});

describe('r11-2 — one identity rule for generation, recalculation and quality metrics', () => {
  it('RouteAgent re-exports the shared functions (same objects)', () => {
    expect(routeAgentModule.isSameLodgingMarker).toBe(isSameLodgingMarker);
    expect(routeAgentModule.isLodgingBookendPair).toBe(isLodgingBookendPair);
  });
  it('Astra repro: same name, different addresses, one side without coordinates → not merged on recheck (recalc adds the leg, quality counts the failure)', async () => {
    const pair = () => [
      hotel('09:00', { address: '서울 중구 명동길 1', lat: null, lng: null, transit_from_prev: { _stale: true } }),
      hotel('10:00', { address: '서울 강남구 테헤란로 2', transit_from_prev: null, [SAME_LODGING_FIELD]: true }),
    ];
    expect(isMergedLodgingStop(pair(), 1)).toBe(false);
    const { stops: out } = await recalc(pair());
    expect(out[1].start_time).toBe('10:30'); // 09:00 + 60 + 25 + 5 — RouteAgent 도 같은 쌍은 합치지 않는다
    expect(computeQualityScore({ days: [{ day: 1, stops: pair() }] }, [], 'seoul', []).metrics.route_failure).toEqual({ total: 1, count: 1 });
  });
  it('one address equal to the booked hotel address → merged only when that address is known', () => {
    const stops = [hotel('22:40', { address: '서울 중구 명동길 1', lat: null, lng: null }), hotel('22:40', { lat: null, lng: null, [SAME_LODGING_FIELD]: true })];
    expect(isMergedLodgingStop(stops, 1, '서울 중구 명동길 1')).toBe(true);
    expect(isMergedLodgingStop(stops, 1)).toBe(false); // 모르면 보수 쪽
  });
  it('normal merges still recheck true (same coordinates; same name + no coordinates on a lodging-only day)', () => {
    expect(isMergedLodgingStop([hotel('22:40'), hotel('22:40', { [SAME_LODGING_FIELD]: true })], 1)).toBe(true);
    expect(isMergedLodgingStop([hotel('22:40', { lat: null, lng: null }), hotel('22:40', { lat: null, lng: null, [SAME_LODGING_FIELD]: true })], 1)).toBe(true);
  });
});
