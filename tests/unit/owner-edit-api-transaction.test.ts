import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { canonicalSource } from '../../src/lib/planEditCanonical.js';
import { ARRIVAL_REST_NOTE } from '../../src/lib/arrivalRestNote.js';
import { DEPARTURE_BREAKFAST_NOTE } from '../../src/lib/departureBreakfastNote.js';

const boundary = vi.hoisted(() => ({ verify: vi.fn(), init: vi.fn() }));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyFirebaseIdentityToken: boundary.verify }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: boundary.init }));
import handler from '../../api/plan-edit.js';

const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const fixture = () => ({
  uid: 'owner', planId: 'plan-a', status: 'ready', paid: true,
  pricing: { amount: 2500, currency: 'KRW' }, claimMarker: 'unchanged',
  input: { language: 'ko', dietary: ['synthetic-only'], nested: { keep: true } },
  itinerary: { tour_title: 'Original', serverMarker: 'keep', days: [
    { day: 1, marker: 'keep-day', stops: [
      { name: 'A', display_name: 'A', order: 1, category: 'culture', verified: true,
        dietaryTrust: { provenance: 'synthetic-original' }, tip: 'Keep this tip' },
      { name: 'B', display_name: 'B', order: 2, category: 'food', transit_from_prev: { method: 'walk' } },
    ] },
    { day: 2, stops: [{ name: 'C', category: 'lodging', order: 1 }] },
  ] },
});

// Versioned atomic simulation, not a Firestore emulator. The actual API and service
// are imported; only identity verification and Admin DB boundaries are replaced.
function database(plan = fixture()) {
  const rows = new Map([['plans/plan-a', structuredClone(plan)]]);
  const versions = new Map([['plans/plan-a', 1]]);
  const writes = [];
  let clock = 1;
  let attempts = 0;
  const control = { beforeCommit: null, failReceipt: false };
  const replace = (path, value) => {
    rows.set(path, structuredClone(value));
    versions.set(path, ++clock);
  };
  const db = {
    collection: name => ({ doc: id => `${name}/${id}` }),
    async runTransaction(run) {
      for (let retry = 0; retry < 6; retry++) {
        attempts++;
        const readVersions = new Map();
        const staged = [];
        const tx = {
          async get(path) {
            readVersions.set(path, versions.get(path) || 0);
            const exists = rows.has(path);
            const value = structuredClone(rows.get(path));
            return { exists, data: () => structuredClone(value) };
          },
          update: (path, patch) => staged.push({ kind: 'update', path, value: structuredClone(patch) }),
          create: (path, value) => staged.push({ kind: 'create', path, value: structuredClone(value) }),
        };
        const result = await run(tx);
        if (control.beforeCommit) {
          const once = control.beforeCommit;
          control.beforeCommit = null;
          once();
        }
        if ([...readVersions].some(([path, version]) => (versions.get(path) || 0) !== version)) continue;
        // Validate every staged write first. A receipt failure must not leave a plan patch.
        for (const write of staged) {
          if (write.kind === 'create' && (control.failReceipt || rows.has(write.path))) throw new Error('SIMULATED_CREATE_FAILURE');
          if (write.kind === 'update' && !rows.has(write.path)) throw new Error('SIMULATED_MISSING_DOC');
        }
        const nextRows = new Map([...rows].map(([path, value]) => [path, structuredClone(value)]));
        for (const write of staged) {
          if (write.kind === 'create') nextRows.set(write.path, write.value);
          else {
            const current = nextRows.get(write.path);
            for (const [field, value] of Object.entries(write.value)) {
              if (field === 'itinerary.days') current.itinerary.days = value;
              else current[field] = value;
            }
          }
        }
        for (const write of staged) {
          replace(write.path, nextRows.get(write.path));
          writes.push(write);
        }
        return result;
      }
      throw new Error('SIMULATED_RETRY_EXHAUSTED');
    },
  };
  return { db, rows, writes, control, replace, attempts: () => attempts };
}

const add = () => ({ type: 'add', dayIndex: 0, stop: {
  name: 'Manual', display_name: 'Manual', address: '', start_time: '12:00', stay_min: 30, category: 'food',
} });
function command(h, requestId = 'request-a', operation = add()) {
  return { planId: 'plan-a', requestId, expectedFingerprint: hash(canonicalSource(h.rows.get('plans/plan-a'))), operation };
}
async function call(body, method = 'POST') {
  const result = { status: 200, body: undefined, headers: {} };
  const res = {
    setHeader: (key, value) => { result.headers[key] = value; },
    status: status => { result.status = status; return res; },
    json: body => { result.body = body; return res; },
  };
  await handler({ method, body, headers: { authorization: 'Bearer synthetic-test-only' } }, res);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.verify.mockResolvedValue({ ok: true, uid: 'owner' });
});

describe('actual owner-edit API with versioned atomic simulation, no live services', () => {
  it('does not initialize DB for unsupported method or failed identity verification', async () => {
    expect((await call({}, 'GET')).status).toBe(405);
    expect(boundary.verify).not.toHaveBeenCalled();
    boundary.verify.mockResolvedValue({ ok: false });
    expect((await call({ token: 'synthetic-share-token', uid: 'owner' })).status).toBe(401);
    expect(boundary.init).not.toHaveBeenCalled();
  });

  it('rejects another verified UID and UID-less legacy plans without writes', async () => {
    const h = database(); boundary.init.mockReturnValue(h.db);
    boundary.verify.mockResolvedValue({ ok: true, uid: 'not-owner' });
    expect((await call(command(h))).status).toBe(403);
    boundary.verify.mockResolvedValue({ ok: true, uid: 'owner' });
    h.replace('plans/plan-a', { ...fixture(), uid: '' });
    expect((await call(command(h))).status).toBe(403);
    expect(h.writes).toHaveLength(0);
  });

  it('two simultaneous identical requests commit once and replay the same result', async () => {
    const h = database(); boundary.init.mockReturnValue(h.db);
    const c = command(h);
    const results = await Promise.all([call(c), call(c)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(results[0].body).toEqual(results[1].body);
    expect(h.attempts()).toBe(3);
    expect(h.writes.map(w => w.kind)).toEqual(['update', 'create']);
    expect(h.rows.get('plans/plan-a').itinerary.days[0].stops).toHaveLength(3);
  });

  it('different request IDs on the same source cannot both commit', async () => {
    const h = database(); boundary.init.mockReturnValue(h.db);
    const first = command(h, 'first'), second = command(h, 'second');
    const results = await Promise.all([call(first), call(second)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(results.find(r => r.status === 409).body.code).toBe('FINGERPRINT_MISMATCH');
    expect(h.writes).toHaveLength(2);
  });

  it('receipt create failure atomically aborts the plan write; exact retry can later succeed', async () => {
    const h = database(); boundary.init.mockReturnValue(h.db);
    const before = structuredClone(h.rows.get('plans/plan-a'));
    const c = command(h); h.control.failReceipt = true;
    expect((await call(c)).status).toBe(503);
    expect(h.rows.get('plans/plan-a')).toEqual(before);
    expect(h.writes).toHaveLength(0);
    h.control.failReceipt = false;
    expect((await call(c)).status).toBe(200);
    expect(h.writes).toHaveLength(2);
  });

  it('transaction retry rechecks ownership after a concurrent owner change', async () => {
    const h = database(); boundary.init.mockReturnValue(h.db);
    h.control.beforeCommit = () => h.replace('plans/plan-a', { ...fixture(), uid: 'new-owner' });
    expect((await call(command(h))).status).toBe(403);
    expect(h.attempts()).toBe(2);
    expect(h.writes).toHaveLength(0);
    expect(h.rows.get('plans/plan-a').uid).toBe('new-owner');
  });

  it('transaction retry preserves the original expected source rather than rebasing', async () => {
    const h = database(); boundary.init.mockReturnValue(h.db);
    h.control.beforeCommit = () => {
      const current = structuredClone(h.rows.get('plans/plan-a'));
      current.itinerary.days[1].stops[0].name = 'Concurrent edit';
      h.replace('plans/plan-a', current);
    };
    expect((await call(command(h))).body.code).toBe('FINGERPRINT_MISMATCH');
    expect(h.writes).toHaveLength(0);
    expect(h.rows.get('plans/plan-a').itinerary.days[1].stops[0].name).toBe('Concurrent edit');
  });

  it('same ID with changed command or expected fingerprint conflicts; replay remains ownership-bound', async () => {
    const h = database(); boundary.init.mockReturnValue(h.db);
    const c = command(h); expect((await call(c)).status).toBe(200);
    expect((await call({ ...c, operation: { type: 'delete', dayIndex: 0, stopIndex: 0 } })).body.code).toBe('OP_ID_CONFLICT');
    expect((await call({ ...c, expectedFingerprint: 'a'.repeat(64) })).body.code).toBe('OP_ID_CONFLICT');
    boundary.verify.mockResolvedValue({ ok: true, uid: 'other' });
    expect((await call(c)).status).toBe(403);
    expect(h.writes).toHaveLength(2);
  });

  it('receipt replay confirms a historical write, not current ready status', async () => {
    const h = database(); boundary.init.mockReturnValue(h.db);
    const c = command(h), first = await call(c);
    h.replace('plans/plan-a', { ...h.rows.get('plans/plan-a'), status: 'streaming', _streaming_in_progress: true });
    expect((await call(c)).body).toEqual(first.body);
    expect((await call(command(h, 'new-request'))).body.code).toBe('PLAN_NOT_READY');
    expect(h.writes).toHaveLength(2);
  });

  it('preserves protected and surviving fields, adds no trust, and never mutates input object', async () => {
    const seed = fixture(), before = structuredClone(seed), h = database(seed);
    boundary.init.mockReturnValue(h.db);
    expect((await call(command(h))).status).toBe(200);
    const actual = h.rows.get('plans/plan-a');
    expect(seed).toEqual(before);
    for (const field of ['uid', 'planId', 'paid', 'pricing', 'claimMarker', 'input']) expect(actual[field]).toEqual(before[field]);
    expect(actual.itinerary.serverMarker).toBe('keep');
    expect(actual.itinerary.days[0].stops[0]).toEqual(before.itinerary.days[0].stops[0]);
    expect(actual.itinerary.days[1]).toEqual(before.itinerary.days[1]);
    expect(actual.itinerary.days[0].stops[2]).not.toHaveProperty('verified');
    expect(actual.itinerary.days[0].stops[2]).not.toHaveProperty('dietaryTrust');
    expect(Object.keys(h.writes[0].value).sort()).toEqual(['editRevision', 'edited', 'itinerary.days', 'lastEditedAt']);
    expect(h.writes.every(w => w.path.startsWith('plans/') || w.path.startsWith('editReceipts/'))).toBe(true);
  });

  it('uses the actual arrival/departure note cleanup without changing other tips', async () => {
    const p = fixture();
    Object.assign(p.itinerary.days[0].stops[0], { category: 'lodging', arrival_rest_note: ARRIVAL_REST_NOTE.en,
      _arrival_rest_note: true, tip: `Keep tip ${ARRIVAL_REST_NOTE.en}` });
    p.itinerary.days[0].stops.splice(1, 1);
    Object.assign(p.itinerary.days[1].stops[0], { breakfast_note: DEPARTURE_BREAKFAST_NOTE.en,
      _breakfast_note: true, tip: `Keep breakfast tip ${DEPARTURE_BREAKFAST_NOTE.en}` });
    const h = database(p); boundary.init.mockReturnValue(h.db);
    expect((await call(command(h))).status).toBe(200);
    expect(h.rows.get('plans/plan-a').itinerary.days[0].stops[0].tip).toBe('Keep tip');
    expect(h.rows.get('plans/plan-a').itinerary.days[0].stops[0]).not.toHaveProperty('arrival_rest_note');
    const lastDayAdd = { ...add(), dayIndex: 1 };
    expect((await call(command(h, 'last-day', lastDayAdd))).status).toBe(200);
    expect(h.rows.get('plans/plan-a').itinerary.days[1].stops[0].tip).toBe('Keep breakfast tip');
    expect(h.rows.get('plans/plan-a').itinerary.days[1].stops[0]).not.toHaveProperty('breakfast_note');
  });

  it('rejects client attempts to supply trust or whole days before any transaction', async () => {
    const h = database(); boundary.init.mockReturnValue(h.db);
    const c = command(h); c.operation.stop.verified = true;
    expect((await call(c)).status).toBe(400);
    const full = { ...command(h), days: [] };
    expect((await call(full)).status).toBe(400);
    expect(h.attempts()).toBe(0);
    expect(h.writes).toHaveLength(0);
  });

  it('Node and browser-compatible WebCrypto hash the same canonical raw source', async () => {
    const raw = canonicalSource(fixture());
    const bytes = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const browserHash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    expect(browserHash).toBe(hash(raw));
  });
});
