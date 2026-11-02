import { projectPublicPlan } from '../../src/lib/publicPlanProjection.js';
/**
 * 2026-11-02 (첫날 도착 PR3 r7 — Astra r6 + 적대적 검증) 운영자 결정 ③ 경로 고정 테스트. 완전 오프라인(Firestore·인증·LLM mock).
 *   A1 면제 플랜 수정: B-12 최소 stop 수가 면제 끼니를 뺀다 — 3-stop 면제 플랜 "식당 바꾸기" = 200.
 *   A2 카페(끼니 아님)·엄격하지 않은 시각은 면제를 풀지 않는다(검증기 B-MEAL 과 같은 판정).
 *   A4 안내는 어느 끼니인지 밝히고, 그 끼니 식당이 다른 시간대에 남아 있으면 붙이지 않는다. 출국 stop = 공항 또는 블록 출국 travel.
 *   A5 수정 API 는 면제 재판정 전용 키(exempt_meal_departure_time)로 넘긴다. A6 표식은 근거가 마감을 실제로 넘을 때만 유효.
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('axios', () => ({ default: { get: vi.fn(async () => { throw new Error('offline'); }), post: vi.fn(async () => { throw new Error('offline'); }) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: vi.fn(async () => null), getTransitProvider: () => 'odsay' }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: () => '', getSubwayStationInfo: vi.fn(async () => null), getSubwayTimetable: vi.fn(async () => null) }));
vi.mock('../../api/_ai_core/transitCache.js', () => ({ lookupTransitCache: vi.fn(async () => null), getTransitCacheStats: () => ({}) }));
import { departureMealContext, proveDepartureMealExemption, exemptImpossibleDepartureMeals } from '../../api/_ai_core/departureMealExemption.js';
import { enrichItineraryWithRoute } from '../../api/_ai_core/routeEnrichment.js';
import { RouteAgent } from '../../api/_ai_core/agents/RouteAgent.js';


const store = vi.hoisted(() => ({ plan: null as unknown, saved: null as unknown }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({
    collection(name: string) {
      if (name === 'plans') {
        return { doc: () => ({
          get: async () => ({ exists: !!store.plan, data: () => JSON.parse(JSON.stringify(store.plan)) }),
          set: async (data: unknown) => { store.saved = JSON.parse(JSON.stringify(data)); },
          update: async (data: unknown) => { store.saved = JSON.parse(JSON.stringify(data)); },
        }) };
      }
      const q: Record<string, unknown> = { where: () => q, limit: () => q, get: async () => ({ empty: true, docs: [], forEach: () => {} }) };
      return { ...q, add: async () => ({}), doc: () => ({ set: async () => {}, get: async () => ({ exists: false, data: () => ({}) }) }) };
    },
  }),
}));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: async () => ({ ok: true, uid: 'u1', email: 'probe@example.invalid' }) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: () => { throw new Error('no LLM in tests'); }, resolveLlmModel: () => 'mock', resolveLlmApiKey: () => '' }));

import modifyHandler from '../../api/ai-planner-modify.js';
import { applyDepartureMealNote } from '../../api/_ai_core/planPersister.js';
import { checkRequiredMeals, validatePatternStructure } from '../../api/_ai_core/responseValidator.js';
import { departureActivityDeadlineMin } from '../../api/_ai_core/constants.js';
import { departureMealNote, stripDepartureMealExemptionIfMealAdded } from '../../src/lib/departureMealNote.js';

type AnyRec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DEP = '23:00';
const DL = departureActivityDeadlineMin(23 * 60, 'PUS', 'busan'); // 19:05
// 저녁 창(60분 기준 17:00–18:05)은 있는데 블록 저녁 식당 체류가 창 맨 앞에 앉아도 마감을 1분 넘는다 = 결정 ③ 면제(RouteAgent·blockMode 근거).
const BASIS = { dinner: { from: '17:00', stay: DL - 17 * 60 + 1 } };
const MW = { lunch: { from: '11:00', to: '16:59' }, dinner: { from: '17:00', to: fmt(DL - 60) } };

function exemptDay(extra: AnyRec = {}): AnyRec {
  return {
    day: 1, city: 'busan',
    stops: [
      { order: 1, name: '해운대 지역 숙소', category: 'lodging', start_time: '10:00', lat: 35.1631, lng: 129.1635 },
      { order: 2, name: '모토이시 광안점', category: 'food', start_time: '12:00', stay_min: 60, lat: 35.1523684, lng: 129.1163868, address: '부산광역시 수영구 광남로 122' },
      { order: 3, name: '김해국제공항', category: 'travel', _departure_airport_stop: true, start_time: fmt(DL), lat: 35.1795, lng: 128.9382 },
    ],
    exempt_meals: ['dinner'], exempt_meal_basis: structuredClone(BASIS), ...extra,
  };
}

async function callModify(day: AnyRec, text: string) {
  store.plan = {
    uid: 'u1',
    itinerary: { days: [day], departure_guide: { airport: 'PUS' } },
    input: { language: 'en', area: 'busan', regions: ['busan'], dietary: [], arrival_airport: 'ALREADY', departure_airport: 'PUS', arrival_time: '09:00',
      departure_time: DEP, tour_start_time: '09:00', tour_end_time: '21:00', durationDays: 1, arrival_rest_day: false, meal_windows: MW },
  };
  store.saved = null;
  let status = 0; let out = '';
  const res: AnyRec = { headersSent: false, setHeader: () => {}, writeHead: (s: number) => { status = s; }, end: (b?: string) => { out = b || ''; } };
  await modifyHandler({ method: 'POST', headers: {}, body: { planId: 'p1', request_text: text } } as AnyRec, res);
  let j: AnyRec = {}; try { j = JSON.parse(out); } catch { /* 빈 응답 */ }
  return { status, body: j, saved: store.saved as AnyRec };
}

describe('PR3 r7 A1/A5/A6 — a saved exempt 1-day plan stays editable', () => {
  const quiet = () => ['log', 'warn', 'error', 'info'].map((k) => vi.spyOn(console, k as 'log').mockImplementation(() => {}));
  it('3-stop exempt plan: "change restaurant" (stop_swap) → 200, the exemption survives and the note names dinner', async () => {
    const q = quiet();
    try {
      const r = await callModify(exemptDay(), 'Day 1 change restaurant');
      expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);
      const d1 = r.saved.itinerary.days[0];
      expect(d1.exempt_meals).toEqual(['dinner']);
      expect(d1.stops[1].name).not.toBe('모토이시 광안점');
      const target = d1.stops.find((s: AnyRec) => s.departure_meal_note);
      expect(target.category).toBe('travel'); // A4: 블록 출국 travel stop 도 출국 stop
      expect(target.departure_meal_note).toBe(departureMealNote('en', ['dinner']));
    } finally { q.forEach((s) => s.mockRestore()); }
  }, 30_000);
  it('control (A6): a marker whose basis fits before the deadline is not trusted → B-12/B-MEAL 422 as before', async () => {
    const q = quiet();
    try {
      const r = await callModify(exemptDay({ exempt_meal_basis: { dinner: { from: '17:00', stay: 60 } } }), 'Day 1 change restaurant');
      expect(r.status).toBe(422);
      expect(JSON.stringify(r.body)).toMatch(/B-12|B-MEAL-DINNER/);
    } finally { q.forEach((s) => s.mockRestore()); }
  }, 30_000);
  it('A5: the dedicated key honours the exemption without switching on departure-day rules; no key = marker ignored', () => {
    const it1 = { days: [exemptDay()] };
    const req = { meal_windows: MW, departure_airport: 'PUS', regions: ['busan'], durationDays: 1 };
    expect(validatePatternStructure(it1, { ...req, exempt_meal_departure_time: DEP }).filter((e: string) => /B-12|B-MEAL|B-EARLY/.test(e))).toEqual([]);
    expect(validatePatternStructure(it1, req).filter((e: string) => /B-12|B-MEAL-DINNER/.test(e)).length).toBeGreaterThan(0);
    expect(checkRequiredMeals({ days: [exemptDay({ exempt_meal_basis: undefined })] }, { ...req, departure_time: DEP })).toHaveLength(1); // 근거 없음
  });
});

describe('PR3 r7 A2 — a cafe or a non-strict time does not lift the exemption (same rule as B-MEAL)', () => {
  const withStop = (s: AnyRec) => { const d = exemptDay(); d.stops.splice(2, 0, s); return { days: [d] }; };
  it.each([
    ['block cafe marker', { category: 'food', name: 'Cafe', start_time: '17:10', _blockMealRole: 'cafe' }],
    ['saved cafe meta', { category: 'food', name: 'Cafe', start_time: '17:10', cafe_not_meal: true }],
    ['non-strict time', { category: 'food', name: 'Late', start_time: '17:10:00' }],
  ])('%s keeps the exemption, the note and passes the gate check', (_n, s) => {
    const it1 = withStop(s);
    expect(stripDepartureMealExemptionIfMealAdded(it1)).toBe(false);
    expect(applyDepartureMealNote(it1, { language: 'en' })).toBe(true);
    expect(checkRequiredMeals(it1, { meal_windows: MW, departure_time: DEP, departure_airport: 'PUS' })).toEqual([]);
  });
  it('control: a real dinner restaurant at 18:00 lifts the exemption and its basis', () => {
    const it1 = withStop({ category: 'food', name: 'Dinner', start_time: '18:00' });
    expect(stripDepartureMealExemptionIfMealAdded(it1)).toBe(true);
    expect(it1.days[0]).not.toHaveProperty('exempt_meals');
    expect(it1.days[0]).not.toHaveProperty('exempt_meal_basis');
  });
});

describe('PR3 r7 A4 — the note names the meal and is skipped when that restaurant is still in the day', () => {
  it.each(['ko', 'en', 'ja', 'zh'])('%s: lunch / dinner / both are distinct texts', (lang) => {
    const set = new Set([departureMealNote(lang, ['lunch']), departureMealNote(lang, ['dinner']), departureMealNote(lang, ['lunch', 'dinner'])]);
    expect(set.size).toBe(3);
  });
  it('HONGDAE A0900 shape: dinner exempt but its 120-min restaurant kept at 15:15 next to lunch → no note', () => {
    const d = exemptDay({ exempt_meal_basis: { dinner: { ...BASIS.dinner, name: 'Kept dinner place' } } });
    d.stops.splice(2, 0, { category: 'food', name: 'Kept dinner place', start_time: '15:15', stay_min: 120 });
    const it1 = { days: [d] };
    expect(applyDepartureMealNote(it1, { language: 'en' })).toBe(false);
    expect(d.stops.some((s: AnyRec) => s.departure_meal_note)).toBe(false);
    expect(d.exempt_meals).toEqual(['dinner']); // 면제 자체는 유지(저녁 창에는 여전히 못 들어간다)
  });
});


describe('narrow scope: zero-travel proof and sightseeing preservation', () => {
  const input = { durationDays: 1, arrival_time: '18:00', arrival_airport: 'ALREADY', departure_time: '23:00', departure_airport: 'PUS', tour_start_time: '09:00', tour_end_time: '21:00' };
  it('proves only an actually impossible stay; equal finish, no departure and multi-day remain required', () => {
    const c = departureMealContext(input, 'busan');
    expect(proveDepartureMealExemption('dinner', 90, c)).toEqual({ from: '18:00', stay: 90 });
    expect(proveDepartureMealExemption('dinner', 65, c)).toBeNull();
    expect(proveDepartureMealExemption('dinner', 60, c)).toBeNull();
    expect(proveDepartureMealExemption('lunch', 90, c)).toBeNull();
    expect(proveDepartureMealExemption('dinner', Infinity, c)).toBeNull();
    expect(departureMealContext({ ...input, departure_time: '' }, 'busan')).toBeNull();
    expect(departureMealContext(input, 'busan', 3)).toBeNull();
  });
  it('records the original restaurant before a block cap without moving another stop', () => {
    const sight = { category: 'sightseeing', name: 'Beach', start_time: '18:00', stay_min: 15 };
    const dinner = { category: 'food', name: 'Real dinner', start_time: '20:00', stay_min: 90, source_block_id: 'course' };
    const stops = [sight, dinner];
    const meta = exemptImpossibleDepartureMeals(stops, departureMealContext(input, 'busan'), new Map([[dinner, 'dinner']]));
    expect(stops).toEqual([sight]);
    expect(meta.exempt_meals).toEqual(['dinner']);
    expect(meta.exempt_meal_basis.dinner).toMatchObject({ name: 'Real dinner', stay: 90, from: '18:00' });
  });
  it('generic RouteAgent removes the impossible dinner before deleting a visit that still fits', async () => {
    const routeSpy = vi.spyOn(RouteAgent.prototype as AnyRec, '_getTransitData').mockImplementation((async (_p: unknown, _c: unknown, _a: unknown, _b: unknown, index: number) => ({ index, durationMin: 20, distanceKm: 2, publicTransit: null, drivingMin: null })) as never);
    const airportSpy = vi.spyOn(RouteAgent.prototype as AnyRec, '_routeAirportHotel').mockImplementation((async () => null) as never);
    const quiet = ['log', 'warn', 'error', 'info'].map((k) => vi.spyOn(console, k as 'log').mockImplementation(() => {}));
    const old = process.env.ROUTE_TSP_ENABLED; process.env.ROUTE_TSP_ENABLED = 'false';
    try {
      const itin: AnyRec = { days: [{ day: 1, city: 'busan', stops: [
        { name: 'Beach visit', category: 'sightseeing', start_time: '18:00', stay_min: 15, lat: 35.1631, lng: 129.1635 },
        { name: 'Long dinner', category: 'food', start_time: '18:20', stay_min: 90, lat: 35.164, lng: 129.164 },
      ] }] };
      await enrichItineraryWithRoute(itin, { body: { ...input, area: 'busan', regions: ['busan'] }, language: 'en', arrival_airport: 'ALREADY', departure_airport: 'PUS', pax: 2 });
      expect(itin.days[0].stops.map((x: AnyRec) => x.name)).toContain('Beach visit');
      expect(itin.days[0].stops.map((x: AnyRec) => x.name)).not.toContain('Long dinner');
      expect(itin.days[0].exempt_meals).toEqual(['dinner']);
      expect(itin.days[0].exempt_meal_basis.dinner).toMatchObject({ from: '18:00', stay: 90, name: 'Long dinner' });
      const blank: AnyRec = { days: [{ day: 1, city: 'busan', stops: [
        { name: 'Long visit', category: 'sightseeing', start_time: '15:20', stay_min: 90, lat: 35.1631, lng: 129.1635 },
        { name: 'Possible dinner', category: 'food', start_time: '17:00', stay_min: 90, lat: 35.164, lng: 129.164 },
      ] }] };
      await enrichItineraryWithRoute(blank, { body: { ...input, arrival_time: '15:20', arrival_airport: '', area: 'busan', regions: ['busan'] }, language: 'en', arrival_airport: '', departure_airport: 'PUS', pax: 2 });
      expect(blank.days[0].exempt_meals).toBeUndefined();
      expect(blank.days[0].stops.map((x: AnyRec) => x.name)).toContain('Possible dinner');
      for (const flags of [{ cafe_not_meal: true }, { _blockMealRole: 'cafe' }, { source_block_id: 'BLOCK' }]) {
        const cafe: AnyRec = { days: [{ day: 1, city: 'busan', stops: [{ name: 'Explicit non-meal', category: 'food', start_time: '18:00', stay_min: 90, lat: 35.1631, lng: 129.1635, ...flags }] }] };
        await enrichItineraryWithRoute(cafe, { body: { ...input, area: 'busan', regions: ['busan'] }, language: 'en', arrival_airport: 'ALREADY', departure_airport: 'PUS', pax: 2 });
        expect(cafe.days[0].exempt_meals).toBeUndefined();
      }


    } finally {
      routeSpy.mockRestore(); airportSpy.mockRestore(); quiet.forEach((q) => q.mockRestore());
      if (old === undefined) delete process.env.ROUTE_TSP_ENABLED; else process.env.ROUTE_TSP_ENABLED = old;
    }
  });
  it('unrelated second lunch does not suppress dinner advice; the marked departure wins over early travel', () => {
    const d = exemptDay({ exempt_meal_basis: { dinner: { ...BASIS.dinner, name: 'Removed dinner' } } });
    d.stops.splice(0, 0, { name: 'Early train', category: 'travel', start_time: '09:00' });
    d.stops.splice(2, 0, { name: 'Extra lunch', category: 'food', start_time: '13:00' });
    expect(applyDepartureMealNote({ days: [d] }, { language: 'en' })).toBe(true);
    expect(d.stops[0].departure_meal_note).toBeUndefined();
    expect(d.stops.find((x: AnyRec) => x._departure_airport_stop).departure_meal_note).toContain('Dinner');
  });
});

describe('Astra regression cases', () => {
  it.each(['ko', 'en', 'ja', 'zh'])('partial exemption updates the stored both-meals note in %s', (lang) => {
    const airport: AnyRec = { name: 'Airport', category: 'airport', tip: 'Original', _departure_airport_stop: true };
    const day: AnyRec = { exempt_meals: ['lunch', 'dinner'], exempt_meal_basis: { lunch: { from: '11:00', stay: 500 }, dinner: { from: '17:00', stay: 130 } }, stops: [airport] };
    applyDepartureMealNote({ days: [day] }, { language: lang });
    day.stops.unshift({ category: 'food', name: 'Lunch', start_time: '12:00' });
    expect(stripDepartureMealExemptionIfMealAdded({ days: [day] })).toBe(true);
    expect(day.exempt_meals).toEqual(['dinner']);
    expect(airport.departure_meal_roles).toEqual(['dinner']);
    expect(airport.departure_meal_note).toBe(departureMealNote(lang, ['dinner']));
    expect(airport.tip).not.toContain(departureMealNote(lang, ['lunch', 'dinner']));
  });
  it('a dinner placeholder that main places at 15:15 remains a 150-minute lunch that fits', () => {
    const stop = { category: 'food', name: 'Dinner placeholder restaurant', start_time: '15:15', stay_min: 150 };
    const stops = [stop];
    const c = departureMealContext({ durationDays: 1, arrival_time: '09:00', arrival_airport: 'ALREADY', departure_time: '23:00', departure_airport: 'PUS' }, 'busan');
    const meta = exemptImpossibleDepartureMeals(stops, c, new Map([[stop, 'dinner']]));
    expect(stops).toEqual([stop]);
    expect(meta).toEqual({});
  });
  it('another shorter candidate for the same meal prevents an exemption', () => {
    const stops = [{ category: 'food', name: 'Long', start_time: '18:00', stay_min: 90 }, { category: 'food', name: 'Short', start_time: '18:00', stay_min: 60 }];
    const c = departureMealContext({ durationDays: 1, arrival_time: '18:00', arrival_airport: 'ALREADY', departure_time: '23:00', departure_airport: 'PUS' }, 'busan');
    expect(exemptImpossibleDepartureMeals(stops, c)).toEqual({});
    expect(stops).toHaveLength(2);
  });
});

describe('proof and public projection parity', () => {
  it('accepts a stronger earlier zero-travel proof but rejects a later placement as proof', () => {
    const req = { meal_windows: { lunch: null, dinner: { from: '18:00', to: '18:05' } }, departure_time: '23:00', departure_airport: 'PUS', area: 'busan', regions: ['busan'] };
    const d = exemptDay({ exempt_meal_basis: { dinner: { from: '17:00', stay: 150 } } });
    expect(checkRequiredMeals({ days: [d] }, req)).toEqual([]);
    d.exempt_meal_basis = { dinner: { from: '18:30', stay: 60 } };
    expect(checkRequiredMeals({ days: [d] }, req)).not.toEqual([]);
  });
  it.each(['ko', 'en', 'ja', 'zh'])('public %s projection preserves dinner-only meaning on repeated projection', (lang) => {
    const d = exemptDay();
    applyDepartureMealNote({ days: [d] }, { language: 'en' });
    const plan = { isPublic: true, input: { language: 'en' }, itinerary: { days: [d] } };
    const once: AnyRec = projectPublicPlan(plan, { language: lang });
    const twice: AnyRec = projectPublicPlan(once, { language: lang });
    const note1 = once.itinerary.days[0].stops.find((x: AnyRec) => x.departure_meal_note);
    const note2 = twice.itinerary.days[0].stops.find((x: AnyRec) => x.departure_meal_note);
    expect(note1.departure_meal_roles).toEqual(['dinner']);
    expect(note1.departure_meal_note).toBe(departureMealNote(lang, ['dinner']));
    expect(note2.departure_meal_note).toBe(note1.departure_meal_note);
  });
});

it('empty-airport block proof uses the earlier route bound, not immigration estimates', () => {
  const c = departureMealContext({ durationDays: 1, arrival_time: '15:20', arrival_airport: '', departure_time: '23:00', departure_airport: 'PUS' }, 'busan');
  expect(proveDepartureMealExemption('dinner', 90, c)).toBeNull();
  expect(proveDepartureMealExemption('dinner', 150, c)).toEqual({ from: '17:00', stay: 150 });
});
