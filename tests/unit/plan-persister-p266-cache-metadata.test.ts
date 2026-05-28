/**
 * P266 (2026-05-28) — P195 cache instrumentation persistence regression slot.
 *
 * Pre-fix root cause (deep-search + Firestore 100 plan inspect):
 *   - planPersister.js#persistPlan 가 `_debug.cacheMetrics` 를 root field 로 persist 안 함
 *   - itinerary._cache_metadata hidden mutation (geminiPipeline.js:1515) 의존
 *   - debugInfo.js#buildAdminDebug 가 admin-bypass response 노출 후 pop & delete
 *   - Inngest worker dispatch path 에서 step output store 의 reconstruction layer 통과 시 marker 손실
 *   - 결과: 5/25 P195 머지 이후 100 plans 중 legacy 51 plans 중 10 plans (20%) 만 itinerary._cache_metadata 저장,
 *           root _debug 는 100/100 누락 → P265 measurement script (root path 검사) 0/100
 *
 * Post-fix:
 *   1. planPersister.js#persistPlan 가 explicit `cacheMetadata` 인자 + `docToSave._debug.cacheMetrics` root field persist.
 *   2. handlerCore.js:394 + processPlanAfterAI.js:219 savePlan 호출 site 가 `cacheMetadata` 명시 pass-through.
 *   3. inngestDispatch.js#buildPlanAiCompletePayload 가 `ctx.cacheMetadata` explicit field 추가
 *      (worker step output store reconstruction 통과 보장 — 5/28 P259 lesson 와 동일 함정 회피).
 *   4. block_mode / 3pass = cacheMetadata=null → docToSave._debug 미포함 (silent skip — 의도적, Gemini 미경유).
 *   5. legacy 1-pass = cacheMetadata={cached,total,output} → docToSave._debug.cacheMetrics={cached,total,output,cacheHitRate,persistedAt}.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const persisterSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/planPersister.js'),
  'utf8',
);
const handlerSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/handlerCore.js'),
  'utf8',
);
const inngestDispatchSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/inngestDispatch.js'),
  'utf8',
);
const workerSrc = readFileSync(
  resolve(process.cwd(), 'api/_inngest/functions/processPlanAfterAI.js'),
  'utf8',
);

vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../api/_ai_core/qualityMetrics.js', () => ({
  computeQualityScore: () => ({
    score: 80,
    metrics: {
      dietary_violation: { count: 0 },
      unverified_restaurant: { count: 0 },
      language_mismatch: { count: 0 },
      route_failure: { count: 0 },
    },
  }),
}));

import { persistPlan } from '../../api/_ai_core/planPersister.js';

function makeAdminDbMock() {
  const writes: Array<{ collection: string; doc?: string; data: any; merge?: boolean }> = [];
  const make = (collectionName: string) => {
    const docFn = (docId: string) => ({
      set: vi.fn(async (data: any, opts?: any) => {
        writes.push({ collection: collectionName, doc: docId, data, merge: opts?.merge });
      }),
      update: vi.fn(async (data: any) => {
        writes.push({ collection: collectionName, doc: docId, data });
      }),
      get: vi.fn(async () => ({ exists: false, data: () => ({}) })),
      collection: (sub: string) => makeSubCollection(`${collectionName}/${docId}/${sub}`),
    });
    return { doc: docFn };
  };
  const makeSubCollection = (path: string) => ({
    doc: (docId?: string) => ({
      set: vi.fn(async (data: any, opts?: any) => {
        writes.push({ collection: path, doc: docId, data, merge: opts?.merge });
      }),
    }),
  });
  return {
    collection: vi.fn((name: string) => make(name)),
    _writes: writes,
  };
}

const baseArgs = {
  body: { regions: ['seoul'], adults: 2, children: 0 },
  itinerary: { tour_title: 'P266 Test', regions: ['seoul'], days: [{ day: 1, stops: [{ name: 'A' }] }] },
  uid: 'u-p266',
  vehicle: 'sedan',
  priceKRW: 26600,
  priceUSD: 18.6,
  guestName: 'Test',
  pax: 2,
  styles: ['food'],
  area: 'seoul',
  duration: 1,
  startDate: '2026-06-01',
  email: 'test@example.com',
  specialRequest: '',
  arrival_airport: 'ICN',
  departure_airport: 'ICN',
  hotel_address: null,
  mobility: null,
  language: 'ko',
  dietary: [],
  foodIndex: [],
};

describe('P266 — planPersister cacheMetadata root field persist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('legacy 1-pass: cacheMetadata={cached,total,output} → docToSave._debug.cacheMetrics 저장', async () => {
    const db = makeAdminDbMock();
    const cacheMetadata = { cached: 12000, total: 30000, output: 7000 };
    await persistPlan(db as any, { ...baseArgs, cacheMetadata });

    const planWrite = db._writes.find((w) => w.collection === 'plans');
    expect(planWrite).toBeTruthy();
    expect(planWrite!.data._debug).toBeDefined();
    expect(planWrite!.data._debug.cacheMetrics).toBeDefined();
    expect(planWrite!.data._debug.cacheMetrics.cached).toBe(12000);
    expect(planWrite!.data._debug.cacheMetrics.total).toBe(30000);
    expect(planWrite!.data._debug.cacheMetrics.output).toBe(7000);
    // hitRate = 12000 / 30000 * 100 = 40.0
    expect(planWrite!.data._debug.cacheMetrics.cacheHitRate).toBeCloseTo(40, 1);
    expect(typeof planWrite!.data._debug.cacheMetrics.persistedAt).toBe('number');
  });

  it('block_mode / non-Gemini: cacheMetadata=null → docToSave._debug 미포함', async () => {
    const db = makeAdminDbMock();
    await persistPlan(db as any, { ...baseArgs, cacheMetadata: null });

    const planWrite = db._writes.find((w) => w.collection === 'plans');
    expect(planWrite).toBeTruthy();
    expect(planWrite!.data._debug).toBeUndefined();
  });

  it('cacheMetadata 인자 누락 (back-compat): docToSave._debug 미포함', async () => {
    const db = makeAdminDbMock();
    await persistPlan(db as any, { ...baseArgs });

    const planWrite = db._writes.find((w) => w.collection === 'plans');
    expect(planWrite).toBeTruthy();
    expect(planWrite!.data._debug).toBeUndefined();
  });

  it('total=0 (Gemini 미호출): docToSave._debug 미포함 — silent skip', async () => {
    const db = makeAdminDbMock();
    await persistPlan(db as any, { ...baseArgs, cacheMetadata: { cached: 0, total: 0, output: 0 } });

    const planWrite = db._writes.find((w) => w.collection === 'plans');
    expect(planWrite).toBeTruthy();
    expect(planWrite!.data._debug).toBeUndefined();
  });

  it('cached=0 + total>0 (cache miss 정상): cacheHitRate=0 저장', async () => {
    const db = makeAdminDbMock();
    await persistPlan(db as any, { ...baseArgs, cacheMetadata: { cached: 0, total: 30000, output: 7000 } });

    const planWrite = db._writes.find((w) => w.collection === 'plans');
    expect(planWrite!.data._debug.cacheMetrics.cached).toBe(0);
    expect(planWrite!.data._debug.cacheMetrics.total).toBe(30000);
    expect(planWrite!.data._debug.cacheMetrics.cacheHitRate).toBe(0);
  });

  it('high cache hit rate (>=90%): cacheHitRate 정확 계산', async () => {
    const db = makeAdminDbMock();
    await persistPlan(db as any, { ...baseArgs, cacheMetadata: { cached: 28000, total: 30000, output: 5000 } });

    const planWrite = db._writes.find((w) => w.collection === 'plans');
    // 28000 / 30000 * 100 = 93.333... → round to 93.3
    expect(planWrite!.data._debug.cacheMetrics.cacheHitRate).toBeCloseTo(93.3, 1);
  });
});

describe('P266 — source-level invariants (R-P266 lint)', () => {
  it('planPersister.js: persistPlan 가 cacheMetadata 인자 받음', () => {
    expect(persisterSrc).toMatch(/persistPlan\s*\(\s*adminDb\s*,\s*\{[\s\S]*?cacheMetadata[\s\S]*?\}\s*\)/);
  });

  it('planPersister.js: docToSave._debug.cacheMetrics root field persist 코드 존재', () => {
    expect(persisterSrc).toMatch(/_debug:\s*\{[\s\S]*?cacheMetrics:\s*\{/);
    expect(persisterSrc).toMatch(/cacheHitRate:\s*cacheMetadata\.total\s*>\s*0/);
    expect(persisterSrc).toMatch(/persistedAt:\s*Date\.now\(\)/);
  });

  it('planPersister.js: cacheMetadata=null / total<=0 → _debug 미포함 (silent skip)', () => {
    expect(persisterSrc).toMatch(/cacheMetadata\s*&&\s*typeof\s*cacheMetadata\s*===\s*['"]object['"]\s*&&\s*cacheMetadata\.total\s*>\s*0/);
  });

  it('handlerCore.js: savePlan 호출 site (line 394 부근) 가 cacheMetadata 명시 전달', () => {
    expect(handlerSrc).toMatch(/cacheMetadata:\s*itinerary\?\._cache_metadata\s*\|\|\s*null/);
  });

  it('inngestDispatch.js: buildPlanAiCompletePayload 가 ctx.cacheMetadata explicit pass-through', () => {
    expect(inngestDispatchSrc).toMatch(/const\s+cacheMetadata\s*=\s*\(itinerary\s*&&\s*itinerary\._cache_metadata\)\s*\|\|\s*null/);
    expect(inngestDispatchSrc).toMatch(/\.\.\.\(cacheMetadata\s*\?\s*\{\s*cacheMetadata\s*\}\s*:\s*\{\s*\}\)/);
  });

  it('processPlanAfterAI.js: worker savePlan 호출이 ctx.cacheMetadata fallback 체인 사용', () => {
    expect(workerSrc).toMatch(/cacheMetadata:\s*ctx\.cacheMetadata\s*\|\|\s*itinAfterBackfill\?\._cache_metadata\s*\|\|\s*null/);
  });

  it('debugInfo.js#buildAdminDebug 의 itinerary._cache_metadata pop & delete 유지 (response noise 방지)', () => {
    const debugInfoSrc = readFileSync(
      resolve(process.cwd(), 'api/_ai_core/debugInfo.js'),
      'utf8',
    );
    expect(debugInfoSrc).toMatch(/delete\s+itinerary\._cache_metadata/);
  });
});
