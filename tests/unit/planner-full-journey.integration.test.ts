import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import nampo from '../../src/data/zone_courses/busan_nampo_packed.json';
import haeundae from '../../src/data/zone_courses/busan_haeundae_standard.json';
import seomyeon from '../../src/data/zone_courses/busan_seomyeon_standard.json';

const boundary = vi.hoisted(() => ({
  db: null as ReturnType<typeof createFakeFirestore> | null,
  generate: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  sheetsAppend: vi.fn(),
  sheets: vi.fn(),
  jwt: vi.fn(),
  sendEvent: vi.fn(),
}));

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: async () => ({ uid: 'synthetic-planner-user', email: 'planner-test@example.invalid', email_verified: true }) }),
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }),
    increment: (by: number) => ({ __sentinel: 'increment', by }),
    delete: () => ({ __sentinel: 'delete' }),
  },
  getFirestore: () => boundary.db,
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => boundary.db }));
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: vi.fn(async () => ({ accessToken: 'synthetic-paypal-access-token', baseUrl: 'https://paypal.invalid' })),
  resolveIsSandbox: () => true,
}));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: boundary.generate,
        generateContentStream: async () => ({
          stream: (async function* () { yield { text: () => '' }; })(),
          response: Promise.resolve({ usageMetadata: {} }),
        }),
      };
    }
  },
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: boundary.createTransport },
}));
vi.mock('googleapis', () => ({
  google: {
    auth: { JWT: class { constructor(...args: unknown[]) { boundary.jwt(...args); } } },
    sheets: boundary.sheets,
  },
}));
vi.mock('inngest', () => ({ Inngest: class {
  send = boundary.sendEvent;
  createFunction(_config: unknown, handler: unknown) { return handler; }
} }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordUsageFromResponse: vi.fn(), recordGeminiUsage: vi.fn() }));

const generated = {
  tour_title: 'Synthetic Busan day',
  regions: ['busan'],
  days: [{
    day: 1, city: 'busan', theme: 'Coast and culture',
    stops: [
      { name: 'Haeundae Beach', display_name: 'Haeundae Beach', category: 'attraction', start_time: '10:00', stay_min: 60, address: 'Busan', tip: 'Enjoy the coast' },
      { name: 'Lunch House', display_name: 'Lunch House', category: 'food', start_time: '12:00', stay_min: 60, address: 'Busan', tip: 'Try a local lunch' },
      { name: 'Busan Museum', display_name: 'Busan Museum', category: 'attraction', start_time: '12:00', stay_min: 60, address: 'Busan', tip: 'Explore local history' },
      { name: 'Beomeosa', display_name: 'Beomeosa', category: 'attraction', start_time: '14:00', stay_min: 60, address: 'Busan', tip: 'Visit the temple' },
      { name: 'Dinner House', display_name: 'Dinner House', category: 'food', start_time: '18:00', stay_min: 60, address: 'Busan', tip: 'Enjoy dinner' },
    ],
  }],
  arrival_guide: { airport: 'PUS', steps: [] },
};

// B-AI4 (charterPricing TODO 1275): two-city model output with NO departure airport —
// no departure_guide and no PUS token anywhere — so a saved PUS can only come from the
// handler's own shaped departure_airport. The last day ends on a neutral 'travel' stop
// (B-10/B-15 departure-day shape); lodging bookends are left to the real self-heal.
const seoulBusanGenerated = {
  tour_title: 'Synthetic Seoul to Busan trip',
  regions: ['seoul', 'busan'],
  days: [{
    day: 1, city: 'seoul', theme: 'Palaces and markets',
    stops: [
      { name: 'Gyeongbokgung Palace', display_name: 'Gyeongbokgung Palace', category: 'attraction', start_time: '10:00', stay_min: 90, address: 'Seoul', tip: 'See the palace' },
      { name: 'Seoul Lunch House', display_name: 'Seoul Lunch House', category: 'food', start_time: '12:00', stay_min: 60, address: 'Seoul', tip: 'Try a local lunch' },
      { name: 'Bukchon Hanok Village', display_name: 'Bukchon Hanok Village', category: 'attraction', start_time: '14:00', stay_min: 60, address: 'Seoul', tip: 'Walk the alleys' },
      { name: 'Insadong', display_name: 'Insadong', category: 'attraction', start_time: '16:00', stay_min: 60, address: 'Seoul', tip: 'Browse the shops' },
      { name: 'Seoul Dinner House', display_name: 'Seoul Dinner House', category: 'food', start_time: '18:00', stay_min: 60, address: 'Seoul', tip: 'Enjoy dinner' },
    ],
  }, {
    day: 2, city: 'busan', theme: 'Coast before the flight',
    stops: [
      { name: 'Haeundae Beach', display_name: 'Haeundae Beach', category: 'attraction', start_time: '10:00', stay_min: 60, address: 'Busan', tip: 'Enjoy the coast' },
      { name: 'Busan Lunch House', display_name: 'Busan Lunch House', category: 'food', start_time: '12:00', stay_min: 60, address: 'Busan', tip: 'Try a local lunch' },
      { name: 'Airport transfer', display_name: 'Airport transfer', category: 'travel', start_time: '15:00', stay_min: 60, address: 'Busan', tip: 'Head out for your flight' },
    ],
  }],
  arrival_guide: { airport: 'ICN', steps: [] },
};

type ApiHandler = (req: Record<string, unknown>, res: {
  statusCode?: number; headersSent?: boolean; payload?: string;
  writeHead: (code: number) => void; end: (payload?: string) => void;
}) => Promise<void>;
let plannerHandler: ApiHandler;
let getPlanHandler: ApiHandler;
let restoreCollection = () => {};
const PAYPAL_ORDER = '5O190127TN364715T';
const paypalOrder = {
  id: PAYPAL_ORDER, status: 'COMPLETED',
  purchase_units: [{ payments: { captures: [{ id: 'CAP-SYNTH-1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } }] } }],
};

beforeAll(async () => {
  boundary.db = createFakeFirestore();
  plannerHandler = (await import('../../api/ai-planner-full.js')).default as ApiHandler;
  getPlanHandler = (await import('../../api/get-plan.js')).default as ApiHandler;
});

beforeEach(() => {
  boundary.sendEvent.mockReset().mockResolvedValue({ ids: ['synthetic-event'] });
  restoreCollection();
  restoreCollection = () => {};
  for (const path of Object.keys(boundary.db?.__dump() || {})) boundary.db?.__delete(path);
  boundary.db?.__set(`paypal_order_snapshots/${PAYPAL_ORDER}`, {
    productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', expectedKRW: 14000,
  });
  boundary.generate.mockReset().mockResolvedValue({ response: { text: () => JSON.stringify(generated), usageMetadata: {} } });
  boundary.sendMail.mockReset().mockRejectedValue(new Error('synthetic blocked mail transport'));
  boundary.createTransport.mockReset().mockReturnValue({ sendMail: boundary.sendMail });
  boundary.sheetsAppend.mockReset().mockRejectedValue(new Error('synthetic blocked Sheets transport'));
  boundary.sheets.mockReset().mockReturnValue({ spreadsheets: { values: { append: boundary.sheetsAppend } } });
  boundary.jwt.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe(`https://paypal.invalid/v2/checkout/orders/${PAYPAL_ORDER}`);
    return { ok: true, status: 200, json: async () => paypalOrder };
  }));
  vi.stubEnv('GEMINI_API_KEY', 'synthetic-offline-only-key');
  vi.stubEnv('PLANNER_MODE', 'legacy');
  vi.stubEnv('PLANNER_BLOCK_MODE', 'auto');
  vi.stubEnv('PLANNER_STREAMING_ENABLED', 'false');
  vi.stubEnv('PLANNER_STREAMING_EARLY_RESPONSE', 'false');
  vi.stubEnv('INNGEST_EVENT_KEY', '');
  vi.stubEnv('FEATURE_GUEST_ANON_AUTH', 'false');
  vi.stubEnv('P181_PRO_ESCALATE_ENABLED', 'false');
  vi.stubEnv('P181_MINIMAL_FALLBACK_ENABLED', 'false');
  // Exercise the completion-notification code with synthetic credentials while
  // nodemailer/googleapis are mocked transport boundaries; no real account wins.
  vi.stubEnv('GMAIL_USER', 'planner-test@example.invalid');
  vi.stubEnv('GMAIL_APP_PASSWORD', 'synthetic-blocked-password');
  vi.stubEnv('GOOGLE_CLIENT_EMAIL', 'planner-test@example.invalid');
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL', '');
  vi.stubEnv('GOOGLE_PRIVATE_KEY', 'synthetic-blocked-private-key');
  vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_KEY', '');
  vi.stubEnv('GOOGLE_SHEETS_SPREADSHEET_ID', 'synthetic-spreadsheet-id');
});

afterEach(() => {
  restoreCollection();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const requestBody = () => ({
  paypalOrderId: PAYPAL_ORDER,
  regions: ['Busan'], durationDays: 1, pax: 2, adults: 2, children: 0,
  startDate: '2099-01-10', language: 'en', styles: ['culture'], categories: ['culture'],
  reservation_status: 'none', vehicle: 'sedan', email: 'spoofed@example.invalid',
});

function response() {
  return {
    statusCode: 0, headersSent: false, payload: '',
    writeHead(this: { statusCode: number; headersSent: boolean }, code: number) { this.statusCode = code; this.headersSent = true; },
    end(this: { payload: string }, payload = '') { this.payload = payload; },
  };
}

async function runPlanner(body: Record<string, unknown>) {
  const res = response();
  await plannerHandler({ method: 'POST', headers: { authorization: 'Bearer synthetic-firebase-token' }, body }, res);
  return { ...res, json: JSON.parse(res.payload) };
}

describe('full planner journey: real handler → route/post-response → persist → read', () => {
  it('saves a generated plan and reads the same Firestore document through get-plan', async () => {
    const result = await runPlanner(requestBody());
    expect(result.statusCode).toBe(200);
    expect(result.json).toMatchObject({ ok: true, data: { firestoreSaved: true } });
    expect(boundary.generate).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`https://paypal.invalid/v2/checkout/orders/${PAYPAL_ORDER}`, expect.any(Object));
    expect(boundary.db?.__get(`plan_issued_orders/${PAYPAL_ORDER}`)).toMatchObject({ status: 'ISSUED' });
    await vi.waitFor(() => {
      expect(boundary.createTransport).toHaveBeenCalledWith({
        service: 'gmail', auth: { user: 'planner-test@example.invalid', pass: 'synthetic-blocked-password' },
      });
      expect(boundary.sendMail).toHaveBeenCalledTimes(1);
      expect(boundary.jwt).toHaveBeenCalledTimes(1);
      expect(boundary.sheets).toHaveBeenCalledWith(expect.objectContaining({ version: 'v4', auth: expect.any(Object) }));
      expect(boundary.sheetsAppend).toHaveBeenCalledTimes(1);
    });

    const { planId } = result.json.data;
    const stored = boundary.db?.__get(`plans/${planId}`);
    expect(stored).toMatchObject({ planId, status: 'ready', verifiedHistoryUid: 'synthetic-planner-user', itinerary: { tour_title: generated.tour_title } });
    expect(stored?.itinerary.days[0].stops.some((stop: { name: string }) => stop.name === 'Haeundae Beach')).toBe(true);
    const lodgings = stored?.itinerary.days[0].stops.filter((stop: { category: string }) => stop.category === 'lodging');
    expect(lodgings).toHaveLength(2);
    for (const lodging of lodgings) {
      expect(lodging.display_name).toContain('Accommodation');
      expect(lodging.tip).not.toMatch(/[가-힣]/);
    }
    const routeSteps = stored?.itinerary.days[0].stops.flatMap((stop: { transit_from_prev?: { step_by_step?: string[] } }) => stop.transit_from_prev?.step_by_step || []);
    expect(routeSteps.join(' ')).toContain('Estimated time');
    expect(routeSteps.join(' ')).not.toMatch(/[가-힣]/);

    const readRes = response();
    await getPlanHandler({ method: 'GET', query: { planId, token: stored?.accessToken } }, readRes);
    expect(readRes.statusCode).toBe(200);
    expect(JSON.parse(readRes.payload).plan).toEqual(stored);

    const artifactPath = resolve(process.cwd(), 'tmp/system-cleanup-20260923/planner-generated.json');
    mkdirSync(resolve(process.cwd(), 'tmp/system-cleanup-20260923'), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
  });

  it.each([false, true])('stores published block selection through full handler; worker=%s', async (worker) => {
    for (const block of [nampo, haeundae, seomyeon]) boundary.db?.__set(`zone_courses/${block.id}`, { ...block, status: 'published' });
    vi.stubEnv('PLANNER_BLOCK_MODE', 'enabled');
    if (worker) {
      for (const [key, value] of Object.entries({ INNGEST_EVENT_KEY: 'synthetic-event', INNGEST_SIGNING_KEY: 'synthetic-signing', VERCEL_ENV: 'production', PLANNER_INNGEST_ENABLED: 'true', PLANNER_INNGEST_WORKER_SYNCED: 'true' })) vi.stubEnv(key, value);
    }
    boundary.generate.mockResolvedValue({ response: { text: () => JSON.stringify({ day_selections: [{ day: 1, block_id: haeundae.id }] }), usageMetadata: {} } });
    const result = await runPlanner(requestBody());
    expect(result.statusCode).toBe(200);
    if (worker) {
      expect(boundary.sendEvent).toHaveBeenCalledTimes(1);
      const event = boundary.sendEvent.mock.calls[0][0];
      expect(event.name).toBe('plan/ai.complete');
      const { processPlanAfterAI } = await import('../../api/_inngest/functions/processPlanAfterAI.js');
      const runWorker = processPlanAfterAI as unknown as (args: { event: unknown; logger: Console; step: { run: (name: string, fn: () => Promise<unknown>) => Promise<unknown> } }) => Promise<unknown>;
      await runWorker({ event, logger: console, step: { run: async (_name, fn) => fn() } });
    } else expect(boundary.sendEvent).not.toHaveBeenCalled();
    const stored = boundary.db?.__get(`plans/${result.json.data.planId}`);
    expect(stored).toMatchObject({ status: 'ready', plannerMode: 'block_mode', verifiedHistoryUid: 'synthetic-planner-user', blocksUsed: [haeundae.id] });
    expect(boundary.generate).toHaveBeenCalledTimes(1);
    const readRes = response();
    await getPlanHandler({ method: 'GET', query: { planId: stored?.planId, token: stored?.accessToken } }, readRes);
    expect(readRes.statusCode).toBe(200);
    expect(JSON.parse(readRes.payload).plan).toEqual(stored);
  });

  it('generation failure returns failure and creates no plan document', async () => {
    boundary.generate.mockRejectedValueOnce(new Error('synthetic Gemini outage'));
    const result = await runPlanner(requestBody());
    expect(result.statusCode).toBe(500);
    expect(result.json.ok).toBe(false);
    expect(Object.keys(boundary.db?.__dump() || {}).some((path) => path.startsWith('plans/'))).toBe(false);
  });

  it('Firestore plan write failure cannot return success', async () => {
    const db = boundary.db!;
    const collection = db.collection.bind(db);
    restoreCollection = () => { db.collection = collection; };
    db.collection = (name: string) => {
      const col = collection(name);
      if (name !== 'plans') return col;
      return { ...col, doc: (id?: string) => {
        const ref = col.doc(id);
        return { ...ref, set: async () => { throw new Error('synthetic Firestore outage'); } };
      } };
    };
    const result = await runPlanner(requestBody());
    expect(result.statusCode).toBe(500);
    expect(result.json.ok).toBe(false);
    expect(Object.keys(db.__dump()).some((path) => path.startsWith('plans/'))).toBe(false);
  });

  it('Seoul→Busan without departure_airport persists the inferred PUS departure guide', async () => {
    // Same paid snapshot/capture as the other cases: the gate compares the order
    // snapshot with the PayPal capture (paymentGate.js), not with durationDays.
    const body: Record<string, unknown> = { ...requestBody(), regions: ['Seoul', 'Busan'], durationDays: 2, arrival_airport: 'ICN' };
    expect(body).not.toHaveProperty('departure_airport');
    expect(JSON.stringify(seoulBusanGenerated)).not.toContain('PUS');
    boundary.generate.mockResolvedValue({ response: { text: () => JSON.stringify(seoulBusanGenerated), usageMetadata: {} } });

    const result = await runPlanner(body);
    expect(result.statusCode).toBe(200);
    expect(result.json).toMatchObject({ ok: true, data: { firestoreSaved: true } });
    expect(boundary.generate).toHaveBeenCalledTimes(1);
    const fetchUrls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
    expect(fetchUrls.length).toBeGreaterThan(0);
    expect(new Set(fetchUrls)).toEqual(new Set([`https://paypal.invalid/v2/checkout/orders/${PAYPAL_ORDER}`]));
    expect(boundary.db?.__get(`plan_issued_orders/${PAYPAL_ORDER}`)).toMatchObject({ status: 'ISSUED' });
    await vi.waitFor(() => expect(boundary.sendMail).toHaveBeenCalledTimes(1));

    const { planId } = result.json.data;
    const stored = boundary.db?.__get(`plans/${planId}`);
    expect(stored).toMatchObject({ planId, status: 'ready', verifiedHistoryUid: 'synthetic-planner-user' });
    expect(stored?.itinerary.departure_guide.airport).toBe('PUS');
    expect(stored?.itinerary.arrival_guide.airport).toBe('ICN');
    expect(stored?.itinerary.days.map((day: { city?: string }) => String(day.city || '').toLowerCase())).toEqual(['seoul', 'busan']);

    const readRes = response();
    await getPlanHandler({ method: 'GET', query: { planId, token: stored?.accessToken } }, readRes);
    expect(readRes.statusCode).toBe(200);
    expect(JSON.parse(readRes.payload).plan).toEqual(stored);
  });
});
