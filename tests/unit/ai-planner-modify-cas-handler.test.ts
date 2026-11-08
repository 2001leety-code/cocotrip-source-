import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real default handler + real saveIfUnchanged. Every external integration and
// food/pattern pipeline is synthetic: this verifies CAS, not dietary/LLM quality.
type Payload = Record<string, unknown>;
type Stamp = {
  seconds: number; nanoseconds: number;
  isEqual: (other: Stamp) => boolean;
  toMillis: () => number;
};
type Write = { path: string; payload: Payload; options: { merge: boolean } };
type Tx = { get: (ref: { path: string }) => Promise<ReturnType<typeof snapshot>>; set: (ref: { path: string }, payload: Payload, options: { merge: boolean }) => void };

function fixture() {
  return {
    planId: 'synthetic-plan', uid: 'synthetic-owner', status: 'ready',
    modifyCount: 2, editRevision: 0, keepRoot: 'unchanged',
    input: { language: 'en', area: 'synthetic', dietary: [], arrival_rest_day: false },
    itinerary: { tour_title: 'Synthetic trip', keepUnknown: { nested: 'preserve' }, days: [
      { day: 1, unknown: 'preserve', stops: [
        { name: 'Synthetic gallery', category: 'culture', order: 1, start_time: '09:00', stay_min: 30 },
        { name: 'Synthetic park', category: 'culture', order: 2, start_time: '10:00', stay_min: 30 },
      ] },
    ] },
  };
}
type Plan = ReturnType<typeof fixture>;

const fx = vi.hoisted(() => ({
  plan: null as Plan | null, version: 100, initialVersionPresent: true, txVersionPresent: true,
  transactionError: null as Error | null,
  beforeCommitOnce: null as (() => void) | null,
  retryOnce: false, attempts: 0, retries: 0,
  queued: [] as Write[], committed: [] as Write[], logs: [] as Payload[],
  initialStamps: [] as Stamp[], compared: [] as Array<{ current: Stamp; original: Stamp }>,
  auth: vi.fn(), model: vi.fn(), generate: vi.fn(), usage: vi.fn(), food: vi.fn(),
  capture: vi.fn(), telegram: vi.fn(), fetch: vi.fn(),
}));

function stamp(nanoseconds: number): Stamp {
  return Object.freeze({
    seconds: 1000, nanoseconds,
    isEqual(other: Stamp) {
      fx.compared.push({ current: this, original: other });
      return this.seconds === other.seconds && this.nanoseconds === other.nanoseconds;
    },
    toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000); },
  });
}

function snapshot(initial: boolean) {
  const saved = structuredClone(fx.plan);
  const updateTime = stamp(fx.version);
  if (initial) fx.initialStamps.push(updateTime);
  return {
    exists: saved !== null,
    data: () => structuredClone(saved),
    updateTime: (initial ? fx.initialVersionPresent : fx.txVersionPresent) ? updateTime : undefined,
  };
}

function mergeDocument(target: Payload, patch: Payload): Payload {
  const out = structuredClone(target);
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const old = out[key];
      out[key] = mergeDocument(old && typeof old === 'object' && !Array.isArray(old) ? old as Payload : {}, value as Payload);
    } else out[key] = structuredClone(value);
  }
  return out;
}

function database() {
  return {
    collection(name: string) {
      return {
        doc(id: string) {
          const path = `${name}/${id}`;
          return {
            path,
            async get() {
              if (path !== 'plans/synthetic-plan') throw new Error(`Unexpected read: ${path}`);
              return snapshot(true);
            },
            async set() { throw new Error('Unconditional plan write is forbidden in the CAS test'); },
          };
        },
        async add(payload: Payload) {
          if (name !== 'intent_classifier_logs') throw new Error(`Unexpected log: ${name}`);
          fx.logs.push(structuredClone(payload));
        },
      };
    },
    async runTransaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
      if (fx.transactionError) throw fx.transactionError;
      for (let attempt = 0; attempt < 4; attempt++) {
        fx.attempts += 1;
        let readVersion = -1;
        const pending: Write[] = [];
        const result = await run({
          async get(ref) {
            if (ref.path !== 'plans/synthetic-plan') throw new Error(`Unexpected tx read: ${ref.path}`);
            if (pending.length) throw new Error('Transaction read after write');
            readVersion = fx.version;
            return snapshot(false);
          },
          set(ref, payload, options) {
            const write = { path: ref.path, payload: structuredClone(payload), options: { ...options } };
            pending.push(write); fx.queued.push(write);
          },
        });
        const hook = fx.beforeCommitOnce;
        fx.beforeCommitOnce = null;
        if (hook) hook();
        if (fx.retryOnce || readVersion !== fx.version) {
          fx.retryOnce = false; fx.retries += 1; continue;
        }
        for (const write of pending) {
          if (write.path !== 'plans/synthetic-plan' || !fx.plan) throw new Error('Unexpected tx write');
          fx.plan = (write.options.merge
            ? mergeDocument(fx.plan as Payload, write.payload)
            : structuredClone(write.payload)) as Plan;
          fx.version += 1;
          fx.committed.push(write);
        }
        return result;
      }
      throw new Error('Synthetic transaction retry exhausted');
    },
  };
}

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => database() }));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: (...args: unknown[]) => fx.auth(...args) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: (...args: unknown[]) => fx.capture(...args) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: (...args: unknown[]) => fx.telegram(...args) }));
vi.mock('../../api/_shared/llm/index.js', () => ({
  resolveLlmApiKey: () => 'synthetic-placeholder-never-sent',
  createLlmModel: (...args: unknown[]) => fx.model(...args),
}));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordUsageFromResponse: (...args: unknown[]) => fx.usage(...args) }));
vi.mock('../../api/_ai_core/geminiPipeline.js', () => ({ loadFoodIndex: () => fx.food() }));
vi.mock('../../api/_ai_core/blockMode.js', () => ({
  fetchAvailableBlocks: async () => [], expandBlocksToItinerary: () => ({ days: [] }),
  matchFoodPlaceholder: () => null, markReturnToAirport: () => {},
}));
vi.mock('../../api/_ai_core/planPersister.js', () => ({ backfillStopEndTimes: () => {}, applyArrivalRestNote: () => {} }));
vi.mock('../../api/_ai_core/responseValidator.js', () => ({
  validatePatternStructure: () => [], arrivalRestDayCityKey: () => 'synthetic', mealWindowsFromRequest: () => null,
}));
vi.mock('../../api/_ai_core/constants.js', () => ({ arrivalRestDayInfo: () => ({ rest: false }), resolveTourEndTime: () => '20:00' }));
vi.mock('../../api/_ai_core/revisitPolicy.js', () => ({
  normalizeRevisits: () => ({ changes: [] }), applyRevisitNotes: () => {}, clearReplacedLegs: () => {},
  applyFoodRowToStop: () => {}, safetyDiets: () => [],
}));
vi.mock('../../api/_ai_core/finalItineraryGate.js', () => ({ runDuplicateStopGate: () => ({ ok: true }) }));

import handler from '../../api/ai-planner-modify.js';

function classifierResult() {
  return { response: { text: () => JSON.stringify({
    intent: 'stop_add', confidence: 0.95, target: { day_index: 1, stop_name: 'Synthetic new stop' },
  }) } };
}

function request() {
  return { method: 'POST', headers: { authorization: 'Bearer synthetic-token' },
    body: { planId: 'synthetic-plan', request_text: 'synthetic request xyz' } };
}

function response() {
  return {
    statusCode: 0, headersSent: false, headers: {} as Record<string, string>, body: {} as Payload,
    writeHead(code: number, headers: Record<string, string>) { this.statusCode = code; this.headers = headers; this.headersSent = true; },
    end(body: string) { this.body = JSON.parse(body); return this; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers(); // Do not leave the handler's 12-second classifier timeout pending.
  fx.plan = fixture(); fx.version = 100; fx.initialVersionPresent = true; fx.txVersionPresent = true;
  fx.transactionError = null; fx.beforeCommitOnce = null; fx.retryOnce = false; fx.attempts = 0; fx.retries = 0;
  fx.queued.length = 0; fx.committed.length = 0; fx.logs.length = 0; fx.initialStamps.length = 0; fx.compared.length = 0;
  fx.auth.mockReset().mockResolvedValue({ ok: true, uid: 'synthetic-owner', email: 'synthetic@example.invalid' });
  fx.generate.mockReset().mockResolvedValue(classifierResult());
  fx.model.mockReset().mockReturnValue({ modelId: 'synthetic-model', generateContent: fx.generate });
  fx.food.mockReset().mockResolvedValue([]); fx.usage.mockReset().mockResolvedValue(undefined);
  fx.capture.mockReset().mockResolvedValue(undefined); fx.telegram.mockReset().mockResolvedValue(undefined);
  fx.fetch.mockReset().mockRejectedValue(new Error('Network forbidden'));
  vi.stubGlobal('fetch', fx.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  expect(fx.fetch).not.toHaveBeenCalled();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('actual modify handler + merge CAS (external integrations mocked)', () => {
  it('commits the original four-field merge payload before one success log', async () => {
    const original = structuredClone(fx.plan!);
    const res = response(); await handler(request(), res);
    expect(res.statusCode).toBe(200); expect(res.body.ok).toBe(true);
    expect(fx.committed).toHaveLength(1);
    expect(fx.committed[0].options).toEqual({ merge: true });
    expect(Object.keys(fx.committed[0].payload).sort()).toEqual(['itinerary', 'lastModifiedAt', 'lastModifyIntent', 'modifyCount']);
    expect(fx.plan!.modifyCount).toBe(3);
    expect(fx.plan!.itinerary.days[0].stops.map(stop => stop.name)).toEqual(['Synthetic gallery', 'Synthetic park', 'Synthetic new stop']);
    expect(fx.plan!.itinerary.keepUnknown).toEqual(original.itinerary.keepUnknown);
    expect(fx.plan!.input).toEqual(original.input); expect(fx.plan!.keepRoot).toBe('unchanged');
    expect(fx.logs).toHaveLength(1); expect(fx.logs[0]).toMatchObject({ mutator_success: true, classifier_source: 'llm' });
    expect(fx.generate).toHaveBeenCalledTimes(1); expect(fx.capture).not.toHaveBeenCalled(); expect(fx.telegram).not.toHaveBeenCalled();
  });

  it('rejects an edit made while the classifier is pending, including same-ms/different-nanos versions', async () => {
    const entered = deferred<void>(), release = deferred<ReturnType<typeof classifierResult>>();
    fx.generate.mockImplementationOnce(() => { entered.resolve(); return release.promise; });
    const res = response(), running = handler(request(), res);
    await Promise.race([entered.promise, running.then(() => { throw new Error('Classifier was not reached'); })]);
    fx.plan!.itinerary.days[0].stops[0].name = 'New owner edit'; fx.plan!.editRevision = 1; fx.version = 200;
    const newer = structuredClone(fx.plan);
    expect(stamp(100).toMillis()).toBe(stamp(200).toMillis());
    release.resolve(classifierResult()); await running;
    expect(res.statusCode).toBe(409); expect(res.body.code).toBe('PLAN_CHANGED');
    expect(fx.plan).toEqual(newer); expect(fx.queued).toHaveLength(0); expect(fx.committed).toHaveLength(0);
    expect(fx.logs).toHaveLength(0); expect(fx.capture).not.toHaveBeenCalled(); expect(fx.telegram).not.toHaveBeenCalled();
  });

  it('rechecks the first source after a transaction retry, without classifying twice', async () => {
    fx.beforeCommitOnce = () => {
      fx.plan!.itinerary.days[0].stops[0].name = 'Concurrent owner after tx read'; fx.plan!.editRevision = 1; fx.version = 200;
    };
    const res = response(); await handler(request(), res);
    expect(res.statusCode).toBe(409); expect(res.body.code).toBe('PLAN_CHANGED');
    expect(fx.attempts).toBe(2); expect(fx.retries).toBe(1);
    expect(fx.queued).toHaveLength(1); expect(fx.committed).toHaveLength(0);
    expect(fx.compared.map(item => item.current.nanoseconds)).toEqual([100, 200]);
    for (const compare of fx.compared) expect(compare.original).toBe(fx.initialStamps[0]);
    expect(fx.plan!.itinerary.days[0].stops[0].name).toBe('Concurrent owner after tx read');
    expect(fx.plan!.itinerary.days[0].stops).toHaveLength(2);
    expect(fx.generate).toHaveBeenCalledTimes(1); expect(fx.model).toHaveBeenCalledTimes(1); expect(fx.food).toHaveBeenCalledTimes(1);
    expect(fx.logs).toHaveLength(0); expect(fx.capture).not.toHaveBeenCalled(); expect(fx.telegram).not.toHaveBeenCalled();
  });

  it('retries an unchanged transaction without duplicate mutation, classifier or success log', async () => {
    fx.retryOnce = true;
    const res = response(); await handler(request(), res);
    expect(res.statusCode).toBe(200); expect(fx.attempts).toBe(2); expect(fx.retries).toBe(1);
    expect(fx.committed).toHaveLength(1); expect(fx.plan!.modifyCount).toBe(3);
    expect(fx.plan!.itinerary.days[0].stops).toHaveLength(3);
    expect(fx.generate).toHaveBeenCalledTimes(1); expect(fx.logs).toHaveLength(1);
    expect(fx.queued[0].payload).toEqual(fx.queued[1].payload);
  });

  it.each(['initial', 'transaction'])('fails closed when %s timestamp is missing', async where => {
    if (where === 'initial') fx.initialVersionPresent = false; else fx.txVersionPresent = false;
    const original = structuredClone(fx.plan);
    const res = response(); await handler(request(), res);
    expect(res.statusCode).toBe(409); expect(res.body.code).toBe('PLAN_CHANGED');
    expect(fx.plan).toEqual(original); expect(fx.queued).toHaveLength(0); expect(fx.committed).toHaveLength(0);
    expect(fx.logs).toHaveLength(0); expect(fx.capture).not.toHaveBeenCalled(); expect(fx.telegram).not.toHaveBeenCalled();
  });

  it('retains the original catch for a real database failure, never claiming success', async () => {
    fx.transactionError = Object.assign(new Error('Synthetic database unavailable'), { code: 'UNAVAILABLE' });
    const original = structuredClone(fx.plan);
    const res = response(); await handler(request(), res);
    expect(res.statusCode).toBe(500); expect(res.body).toMatchObject({ ok: false, code: 'UNAVAILABLE', error: 'Modification failed' });
    expect(fx.plan).toEqual(original); expect(fx.committed).toHaveLength(0); expect(fx.logs).toHaveLength(0);
    expect(fx.capture).toHaveBeenCalledTimes(1); expect(fx.telegram).toHaveBeenCalledTimes(1);
    expect(fx.telegram.mock.calls[0][0]).toMatchObject({ key: 'ai-planner-modify-error', severity: 'high' });
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('keeps authentication failure ahead of classifier and persistence', async () => {
    fx.auth.mockResolvedValue({ ok: false, status: 401, error: 'Synthetic invalid identity' });
    const res = response(); await handler(request(), res);
    expect(res.statusCode).toBe(401); expect(res.body.code).toBe('AUTH_REQUIRED');
    expect(fx.generate).not.toHaveBeenCalled(); expect(fx.initialStamps).toHaveLength(0); expect(fx.attempts).toBe(0);
    expect(fx.logs).toHaveLength(0); expect(fx.telegram).not.toHaveBeenCalled();
  });
});
