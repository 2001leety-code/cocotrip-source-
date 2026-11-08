import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Actual HTTP handler; Firestore, identity, rate limit and every route provider
// are replaced before import. No credentials, live database or network calls.
type Stamp = { seconds: number; nanoseconds: number };
type Payload = Record<string, unknown>;
type Transit = { method: string; duration: number; fare: number; summary: string; steps: [] };

function fixture() {
  return {
    planId: 'synthetic-plan', uid: 'synthetic-owner', status: 'ready',
    editRevision: 0, lastEditedAt: 0, input: { regions: ['seoul'] },
    itinerary: { title: 'Preserve title', days: [
      { day: 1, stops: [
        { name: 'Synthetic museum', category: 'culture', order: 1, lat: 37.5, lng: 127,
          start_time: '09:00', stay_min: 30, transit_from_prev: null },
        { name: 'Synthetic park', category: 'culture', order: 2, lat: 37.6, lng: 127.1,
          start_time: '10:00', stay_min: 30,
          transit_from_prev: { method: 'walk', est_min: 10, _stale: true } },
      ] },
      { day: 2, stops: [
        { name: 'Other day must survive', category: 'culture', order: 1, lat: 37.7, lng: 127.2,
          start_time: '09:00', stay_min: 30, transit_from_prev: null },
      ] },
    ] },
  };
}
type Plan = ReturnType<typeof fixture>;

const fx = vi.hoisted(() => ({
  plan: null as Plan | null,
  version: 1,
  exposeVersion: true,
  writeError: null as Error | null,
  attempts: [] as Array<{ path: string; payload: Payload; precondition?: { lastUpdateTime: Stamp } }>,
  committed: [] as Payload[],
  stats: [] as Array<{ path: string; payload: Payload }>,
  snapshotTimes: [] as Stamp[],
  auth: vi.fn(), transit: vi.fn(), geocode: vi.fn(), axiosGet: vi.fn(), fetch: vi.fn(),
}));

function collection(path: string) {
  return { doc: (id: string) => reference(`${path}/${id}`) };
}

function reference(path: string) {
  return {
    collection: (name: string) => collection(`${path}/${name}`),
    async get() {
      if (path !== 'plans/synthetic-plan') throw new Error(`Unexpected read: ${path}`);
      const data = structuredClone(fx.plan);
      const updateTime = Object.freeze({ seconds: 1, nanoseconds: fx.version });
      fx.snapshotTimes.push(updateTime);
      return {
        exists: data !== null,
        data: () => structuredClone(data),
        updateTime: fx.exposeVersion ? updateTime : undefined,
      };
    },
    async update(payload: Payload, precondition?: { lastUpdateTime: Stamp }) {
      if (path !== 'plans/synthetic-plan') throw new Error(`Unexpected update: ${path}`);
      fx.attempts.push({ path, payload: structuredClone(payload), precondition });
      if (fx.writeError) throw fx.writeError;
      // Behave like Firestore: omitting a precondition permits a stale update.
      // Thus removing lastUpdateTime from the handler makes the race tests fail.
      const expected = precondition && precondition.lastUpdateTime;
      if (expected && (expected.seconds !== 1 || expected.nanoseconds !== fx.version)) {
        throw Object.assign(new Error('Synthetic stale snapshot'), { code: 9 });
      }
      if (!fx.plan) throw Object.assign(new Error('Synthetic missing plan'), { code: 5 });
      const days = payload['itinerary.days'] as Plan['itinerary']['days'];
      fx.plan = { ...fx.plan, itinerary: { ...fx.plan.itinerary, days: structuredClone(days) } };
      fx.version += 1;
      fx.committed.push(structuredClone(payload));
    },
    async set(payload: Payload) {
      if (!path.startsWith('api_stats/')) throw new Error(`Unexpected set: ${path}`);
      fx.stats.push({ path, payload: structuredClone(payload) });
    },
  };
}

vi.mock('firebase-admin/app', () => ({
  getApps: () => [{}],
  initializeApp: () => { throw new Error('Real Firebase initialization forbidden'); },
  cert: () => { throw new Error('Credential access forbidden'); },
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection }),
  FieldValue: { increment: (value: number) => ({ syntheticIncrement: value }) },
}));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: async () => ({ ok: true }), getClientIp: () => '192.0.2.1',
}));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: (...args: unknown[]) => fx.auth(...args) }));
vi.mock('../../api/_shared/mood-route.js', () => ({
  resolveNcpKeys: () => ({ clientId: '', clientSecret: '' }),
  geocode: (...args: unknown[]) => fx.geocode(...args),
}));
vi.mock('axios', () => ({ default: { get: (...args: unknown[]) => fx.axiosGet(...args) } }));
vi.mock('../../api/_transit_provider.js', () => ({ searchTransit: (...args: unknown[]) => fx.transit(...args) }));
vi.mock('../../api/_odsay_helper.js', () => ({ formatTransitSummary: (value: Transit) => value }));

import handler from '../../api/recalc-transit.js';

function response() {
  return {
    statusCode: 0, body: {} as Payload, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: Payload) { this.body = body; return this; },
  };
}

function request() {
  return {
    method: 'POST', headers: { authorization: 'Bearer synthetic-token' },
    body: { planId: 'synthetic-plan', dayIndex: 0 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const transit: Transit = { method: 'subway', duration: 17, fare: 1200, summary: 'Synthetic route', steps: [] };
const hasDoneLog = () => vi.mocked(console.log).mock.calls.some(args => String(args[0]).includes('[recalc-transit] Done.'));

beforeEach(() => {
  fx.plan = fixture(); fx.version = 1; fx.exposeVersion = true; fx.writeError = null;
  fx.attempts.length = 0; fx.committed.length = 0; fx.stats.length = 0; fx.snapshotTimes.length = 0;
  fx.auth.mockReset().mockResolvedValue({ ok: true, uid: 'synthetic-owner' });
  fx.transit.mockReset().mockResolvedValue(transit);
  fx.geocode.mockReset().mockRejectedValue(new Error('Unexpected geocode'));
  fx.axiosGet.mockReset().mockRejectedValue(new Error('Unexpected HTTP request'));
  fx.fetch.mockReset().mockRejectedValue(new Error('Network forbidden'));
  vi.stubGlobal('fetch', fx.fetch);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  expect(fx.fetch).not.toHaveBeenCalled();
  expect(fx.axiosGet).not.toHaveBeenCalled();
  expect(fx.geocode).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('actual recalc handler CAS boundary (all external IO mocked)', () => {
  it('passes the exact snapshot precondition, saves once, then records success', async () => {
    const original = structuredClone(fx.plan!);
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, recalculated: 1 });
    expect(fx.attempts).toHaveLength(1);
    expect(fx.attempts[0].precondition?.lastUpdateTime).toBe(fx.snapshotTimes[0]);
    expect(fx.committed).toHaveLength(1);
    expect(Object.keys(fx.committed[0]).sort()).toEqual(['itinerary.days', 'lastTransitRecalcAt']);
    expect(fx.plan!.itinerary.days[0].stops[1].transit_from_prev).toMatchObject({ method: 'subway', est_min: 17 });
    expect(fx.plan!.itinerary.days[1]).toEqual(original.itinerary.days[1]);
    expect(fx.plan!.input).toEqual(original.input);
    expect(fx.plan!.itinerary.title).toBe(original.itinerary.title);
    expect(fx.stats.map(item => Object.keys(item.payload).sort())).toEqual([['lastUpdated', 'recalcSuccess']]);
    expect(hasDoneLog()).toBe(true);
  });

  it.each([0, 1])('keeps a newer edit to day %i when a slow provider returns last', async dayIndex => {
    const entered = deferred<void>();
    const release = deferred<Transit>();
    fx.transit.mockImplementationOnce(() => { entered.resolve(); return release.promise; });
    const res = response();
    const running = handler(request(), res);
    await Promise.race([entered.promise, running.then(() => { throw new Error('Provider was not reached'); })]);
    fx.plan!.itinerary.days[dayIndex].stops[0].name = 'New owner edit';
    fx.plan!.editRevision = 1; fx.plan!.lastEditedAt = 123;
    fx.version = 2; // Same second, different nanoseconds must conflict.
    const newer = structuredClone(fx.plan);
    release.resolve(transit);
    await running;
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: 'RECALC_CONFLICT', savedEditUnaffected: true });
    expect(fx.plan).toEqual(newer);
    expect(fx.attempts).toHaveLength(1);
    expect(fx.committed).toHaveLength(0);
    expect(fx.stats).toHaveLength(0);
    expect(hasDoneLog()).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([9, 'failed-precondition', 'FAILED_PRECONDITION'])('maps precondition error %s to a quiet 409', async code => {
    const original = structuredClone(fx.plan);
    fx.writeError = Object.assign(new Error('Synthetic conflict'), { code });
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('RECALC_CONFLICT');
    expect(fx.plan).toEqual(original);
    expect(fx.committed).toHaveLength(0);
    expect(fx.stats).toHaveLength(0);
    expect(hasDoneLog()).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('keeps a real database error distinct: 500, error statistic, no success', async () => {
    const original = structuredClone(fx.plan);
    fx.writeError = Object.assign(new Error('Synthetic database unavailable'), { code: 14 });
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(fx.plan).toEqual(original);
    expect(fx.committed).toHaveLength(0);
    expect(fx.stats.map(item => Object.keys(item.payload).sort())).toEqual([['lastUpdated', 'recalcError']]);
    expect(hasDoneLog()).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing version before route-provider work or writes', async () => {
    fx.exposeVersion = false;
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('RECALC_VERSION_REQUIRED');
    expect(fx.transit).not.toHaveBeenCalled();
    expect(fx.attempts).toHaveLength(0);
    expect(fx.stats).toHaveLength(0);
  });

  it('preserves the no-stale success path without requiring a write version', async () => {
    fx.plan!.itinerary.days[0].stops[1].transit_from_prev!._stale = false;
    fx.exposeVersion = false;
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, recalculated: 0, message: 'No stale transits' });
    expect(fx.transit).not.toHaveBeenCalled();
    expect(fx.attempts).toHaveLength(0);
    expect(fx.stats).toHaveLength(0);
    expect(hasDoneLog()).toBe(false);
  });

  it('still denies a different verified owner before providers or writes', async () => {
    fx.auth.mockResolvedValue({ ok: true, uid: 'different-synthetic-owner' });
    const res = response();
    await handler(request(), res);
    expect(res.statusCode).toBe(403);
    expect(fx.transit).not.toHaveBeenCalled();
    expect(fx.attempts).toHaveLength(0);
    expect(fx.stats).toHaveLength(0);
  });
});
