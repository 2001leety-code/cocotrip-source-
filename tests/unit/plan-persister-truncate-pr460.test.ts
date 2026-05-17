/**
 * PR #460 — Audit X-H1 regression slot.
 *
 * Pre-fix: api/_ai_core/planPersister.js detected docs > 900KB (Firestore
 * 1MB limit guard) and silently popped trailing days. Only a `console.error`
 * surfaced — operator missed it unless they watched Vercel logs. The
 * `_truncated_days` flag was buried inside `itinerary.*` so PlanDetailPage
 * (or any banner UI) couldn't surface it without a deep walk. End result:
 * user paid, received a plan with days 4–5 silently missing, no alert.
 *
 * Post-fix:
 * 1. Root-level `__truncated: true` + `__truncated_days_count` +
 *    `__truncated_original_days` + `__truncated_initial_size_bytes` on the
 *    saved doc — PlanDetailPage can detect at the top level.
 * 2. throttledTelegramAlert (admin channel) dedup key
 *    `plan-persister-truncate:${regionKey}:${durationKey}` so repeated
 *    14-day multi-city attempts collapse to 1 alert / 5min.
 * 3. Legacy `itinerary._truncated_days/_truncation_note` retained
 *    (back-compat for any caller still reading there).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/planPersister.js'),
  'utf8',
);

// Mock throttledTelegramAlert before importing the SUT so the alert call
// is observable. We capture invocations in a shared array.
const alertCalls: any[] = [];
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn(async (args: any) => {
    alertCalls.push(args);
    return { ok: true, alerted: true };
  }),
}));

// computeQualityScore is non-blocking inside persistPlan; stub to a no-op
// returning a stable shape so we don't pull the whole pipeline graph in.
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

/** Build a synthetic 'huge' itinerary so the size guard fires deterministically. */
function makeHugeItinerary(days: number, perStopBytes: number) {
  const filler = 'x'.repeat(perStopBytes);
  return {
    tour_title: 'Mega Korea 14-day',
    regions: ['seoul', 'busan', 'jeju'],
    days: Array.from({ length: days }, (_, i) => ({
      day: i + 1,
      stops: Array.from({ length: 8 }, (__, j) => ({
        name: `Stop ${i + 1}-${j + 1}`,
        description: filler,
        notes: filler,
      })),
    })),
    arrival_guide: { steps: [] },
    departure_guide: {},
  };
}

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

describe('PR #460 X-H1 — planPersister truncation surfacing', () => {
  beforeEach(() => {
    alertCalls.length = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: small itinerary persists with NO truncation flags + NO alert', async () => {
    const db = makeAdminDbMock();
    const itinerary = {
      tour_title: 'Mini Seoul',
      regions: ['seoul'],
      days: [{ day: 1, stops: [{ name: 'A' }] }],
    };
    const result = await persistPlan(db as any, {
      body: { regions: ['seoul'], adults: 2, children: 0 },
      itinerary,
      uid: 'u-1',
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
    });
    expect(result.planId).toBeTruthy();

    const planWrite = db._writes.find((w) => w.collection === 'plans');
    expect(planWrite).toBeTruthy();
    expect(planWrite!.data.__truncated).toBeUndefined();
    expect(planWrite!.data.__truncated_days_count).toBeUndefined();
    expect(planWrite!.data.itinerary._truncated_days).toBeUndefined();

    expect(alertCalls.length).toBe(0);
  });

  it('oversize itinerary: sets root-level __truncated flags + fires admin alert', async () => {
    const db = makeAdminDbMock();
    // 14 days × 8 stops × ~10KB filler ≈ 1.12MB raw — guaranteed > 900KB.
    const itinerary = makeHugeItinerary(14, 10_000);

    await persistPlan(db as any, {
      body: { regions: ['seoul', 'busan', 'jeju'], adults: 2, children: 1 },
      itinerary,
      uid: 'u-truncate',
      vehicle: 'staria',
      priceKRW: 53200,
      priceUSD: 37.2,
      guestName: 'Big',
      pax: 3,
      styles: ['food'],
      area: 'seoul',
      duration: 14,
      startDate: '2026-07-01',
      email: 'big@example.com',
      specialRequest: '',
      arrival_airport: 'ICN',
      departure_airport: 'GMP',
      hotel_address: null,
      mobility: null,
      language: 'ko',
      dietary: [],
      foodIndex: [],
    });

    const planWrite = db._writes.find((w) => w.collection === 'plans');
    expect(planWrite).toBeTruthy();
    expect(planWrite!.data.__truncated).toBe(true);
    expect(typeof planWrite!.data.__truncated_days_count).toBe('number');
    expect(planWrite!.data.__truncated_days_count).toBeGreaterThan(0);
    expect(planWrite!.data.__truncated_original_days).toBe(14);
    expect(typeof planWrite!.data.__truncated_initial_size_bytes).toBe('number');
    expect(planWrite!.data.__truncated_initial_size_bytes).toBeGreaterThan(900_000);

    // Legacy fields still present.
    expect(planWrite!.data.itinerary._truncated_days).toBeGreaterThan(0);
    expect(planWrite!.data.itinerary._truncation_note).toMatch(/exceeded Firestore limit/);

    // Alert fired once with dedup key including region+duration.
    expect(alertCalls.length).toBe(1);
    expect(alertCalls[0].key).toBe('plan-persister-truncate:seoul+busan+jeju:14');
    expect(alertCalls[0].channel).toBe('admin');
    expect(alertCalls[0].severity).toBe('high');
    expect(alertCalls[0].message).toMatch(/Plan truncated/);
    expect(alertCalls[0].context.planId).toBeTruthy();
    expect(alertCalls[0].context.durationDays).toBe(14);
  });

  it('region fallback: regions[] missing → uses area in dedup key', async () => {
    const db = makeAdminDbMock();
    const itinerary = makeHugeItinerary(10, 12_000);

    await persistPlan(db as any, {
      body: { adults: 2, children: 0 }, // no regions
      itinerary,
      uid: null, // guest
      vehicle: 'sedan',
      priceKRW: 26600,
      priceUSD: 18.6,
      guestName: 'Guest',
      pax: 2,
      styles: [],
      area: 'busan',
      duration: 10,
      startDate: '2026-08-01',
      email: null,
      specialRequest: '',
      arrival_airport: 'PUS',
      departure_airport: 'PUS',
      hotel_address: null,
      mobility: null,
      language: 'en',
      dietary: [],
      foodIndex: [],
    });

    expect(alertCalls.length).toBe(1);
    expect(alertCalls[0].key).toBe('plan-persister-truncate:busan:10');
    expect(alertCalls[0].context.uid).toBe('guest');
  });
});

describe('PR #460 X-H1 — source-level invariants', () => {
  it('imports throttledTelegramAlert from the shared helper', () => {
    expect(src).toMatch(/from\s+['"]\.\.\/_shared\/telegram-throttle\.js['"]/);
    expect(src).toMatch(/import\s+\{\s*throttledTelegramAlert\s*\}/);
  });

  it('uses the canonical dedup key prefix', () => {
    expect(src).toMatch(/plan-persister-truncate:\$\{regionKey\}:\$\{durationKey\}/);
  });

  it('alerts on the admin channel with severity high', () => {
    expect(src).toMatch(/channel:\s*['"]admin['"]/);
    expect(src).toMatch(/severity:\s*['"]high['"]/);
  });

  it('sets root-level __truncated flags (not buried in itinerary)', () => {
    expect(src).toMatch(/docToSave\.__truncated\s*=\s*true/);
    expect(src).toMatch(/docToSave\.__truncated_days_count\s*=/);
    expect(src).toMatch(/docToSave\.__truncated_original_days\s*=/);
    expect(src).toMatch(/docToSave\.__truncated_initial_size_bytes\s*=/);
  });

  it('retains legacy itinerary._truncated_days/_truncation_note for back-compat', () => {
    expect(src).toMatch(/itinerary\._truncated_days\s*=/);
    expect(src).toMatch(/itinerary\._truncation_note\s*=/);
  });

  it('keeps the 900_000-byte safety margin under Firestore 1MB', () => {
    expect(src).toMatch(/SIZE_LIMIT_BYTES\s*=\s*900_000/);
  });

  it('alert call is fire-and-forget (.catch swallow) — no plan-save latency impact', () => {
    expect(src).toMatch(/throttledTelegramAlert\(\{[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });
});
