/**
 * Onboarding r1 C7 — behaviour of the real recovery handlers and the real issuer against an
 * in-memory Firestore double (no network, no credentials, no real Firebase).
 *   C1 audit doc written in the SAME transaction as the 3 coupons; guest path writes no audit;
 *      alreadyIssued / promoClosed write nothing.
 *   C2 dry-run scan finds users WITHOUT the marker field, pages by document id, writes nothing.
 *   C3 non-string uid/email → 400.   C4 issuance exception → 500 ok:false; promoClosed reported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Data = Record<string, unknown>;
type Write = { path: string; data: Data; txId: number | null };

const h = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  const writes: { path: string; data: Record<string, unknown>; txId: number | null }[] = [];
  let autoId = 0;
  let txSeq = 0;
  const state = { failTransaction: false };
  const ref = (path: string): any => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    path, id: path.split('/').pop(),
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    collection: (name: string) => collection(`${path}/${name}`),
  });
  const collection = (path: string): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const query = (after: string | null, size: number | null): any => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      startAfter: (id: string) => query(id, size),
      limit: (n: number) => query(after, n),
      get: async () => {
        const depth = path.split('/').length + 1;
        const ids = [...store.keys()].filter(k => k.startsWith(`${path}/`) && k.split('/').length === depth)
          .map(k => k.split('/').pop() as string).sort()
          .filter(id => after === null || id > after).slice(0, size === null ? undefined : size);
        const docs = ids.map(id => ({ id, data: () => store.get(`${path}/${id}`) }));
        return { size: docs.length, docs };
      },
    });
    return {
      doc: (id?: string) => ref(`${path}/${id || `auto${String(++autoId).padStart(4, '0')}`}`),
      orderBy: (field: unknown) => { if (field !== '__name__') throw new Error('doc-id order expected'); return query(null, null); },
      where: () => { throw new Error('field filters skip documents without the field'); },
    };
  };
  const db = {
    collection,
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (state.failTransaction) throw new Error('synthetic transaction failure');
      const txId = ++txSeq;
      const buffered: { path: string; data: Record<string, unknown>; merge: boolean }[] = [];
      const tx = {
        get: async (r: { path: string }) => ({ exists: store.has(r.path), data: () => store.get(r.path) }),
        set: (r: { path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => { buffered.push({ path: r.path, data, merge: !!opts?.merge }); },
      };
      const out = await fn(tx);
      for (const w of buffered) {
        store.set(w.path, w.merge ? { ...(store.get(w.path) || {}), ...w.data } : w.data);
        writes.push({ path: w.path, data: w.data, txId });
      }
      return out;
    },
  };
  return { store, writes, db, state, reset: () => { store.clear(); writes.length = 0; autoId = 0; state.failTransaction = false; } };
});

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => h.db }));
vi.mock('../../api/_shared/admin-auth.js', () => ({
  verifyAdminToken: async () => ({ ok: true, uid: 'admin-uid', email: 'admin@example.invalid' }),
}));
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyOnboardingUserToken: async () => ({ ok: true, uid: 'guest-uid', email: null, emailVerified: false }),
}));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{ name: '[DEFAULT]' }], initializeApp: () => { throw new Error('no init'); }, cert: () => ({}) }));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ getUser: async (uid: string) => ({ uid }), getUserByEmail: async () => ({ uid: 'email-user' }) }),
}));
vi.mock('firebase-admin/firestore', () => ({ FieldPath: { documentId: () => '__name__' } }));

async function call(file: string, body: unknown) {
  const { default: handler } = await import(file);
  const out = { status: 0, body: {} as Data };
  await handler({ method: 'POST', body, headers: { origin: 'http://localhost:5173', authorization: 'Bearer t' } }, {
    setHeader: () => {}, writeHead: (s: number) => { out.status = s; }, end: (v?: string) => { out.body = v ? JSON.parse(v) : {}; },
  });
  return out;
}
const FIX = '../../api/admin-coupon-fix.js';
const ISSUE = '../../api/admin-issue-onboarding-coupons.js';
const GUEST = '../../api/onboarding-coupons.js';
const audits = () => h.writes.filter((w: Write) => w.path.startsWith('admin_actions/'));
const coupons = (uid: string) => h.writes.filter((w: Write) => w.path.startsWith(`users/${uid}/coupons/`));

beforeEach(() => {
  h.reset();
  vi.stubEnv('VERCEL_ENV', 'production');
  ['log', 'warn', 'error'].forEach(k => vi.spyOn(console, k as 'log').mockImplementation(() => {}));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('C1 audit trail in the issuance transaction', () => {
  it.each([
    [FIX, { uid: 'victim' }, 'onboarding_coupon_fix'],
    [ISSUE, { uid: 'victim', dryRun: false }, 'onboarding_coupon_issue'],
  ])('%s writes 3 coupons + marker + 1 admin_actions doc in one transaction', async (file, body, action) => {
    const r = await call(file, body);
    expect(r.status).toBe(200);
    expect(coupons('victim')).toHaveLength(3);
    expect(audits()).toHaveLength(1);
    expect(new Set(h.writes.map((w: Write) => w.txId)).size).toBe(1);
    const a = audits()[0].data;
    expect(a).toMatchObject({ action, callerUid: 'admin-uid', callerEmail: 'admin@example.invalid', targetUid: 'victim', result: { issued: 3 } });
    expect(a.couponIds).toEqual(coupons('victim').map((w: Write) => w.path.split('/').pop()));
    expect(typeof a.timestamp).toBe('string');
  });

  it('a second recovery on an issued user (alreadyIssued) writes nothing, audit included', async () => {
    await call(ISSUE, { uid: 'victim', dryRun: false });
    const before = h.writes.length;
    const r = await call(FIX, { uid: 'victim' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, data: { issued: 0, alreadyIssued: true } });
    expect(h.writes.length).toBe(before);
  });

  it('guest signup path issues 3 coupons and writes no audit doc', async () => {
    const r = await call(GUEST, {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, issued: 3 });
    expect(coupons('guest-uid')).toHaveLength(3);
    expect(audits()).toHaveLength(0);
  });

  it('promo closed: 0 writes and the response says promoClosed', async () => {
    vi.stubEnv('ONBOARDING_PROMO_END', '2000-01-01');
    vi.resetModules();
    const r = await call(ISSUE, { uid: 'victim', dryRun: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, results: { issued: 0, alreadyIssued: 0, promoClosed: true } });
    expect(h.writes).toHaveLength(0);
    vi.resetModules();
  });
});

describe('C2 dry-run scan finds users without the marker field', () => {
  beforeEach(() => {
    h.store.set('users/a', { onboardingCouponsIssued: true, email: 'a@example.invalid' });
    h.store.set('users/b', { createdAt: { toMillis: () => 1_700_000_000_000 } });
    h.store.set('users/c', { onboardingCouponsIssued: false, name: 'Someone' });
    h.store.set('users/d', { email: 'd@example.invalid', createdAt: 1_700_000_000_123 });
    h.store.set('users/a/coupons/x', { code: 'nested docs are not users' });
  });

  it('pages in doc-id order, filters the marker in code, returns uid/createdAtMs/hasEmail only, writes nothing', async () => {
    const p1 = await call(ISSUE, { dryRun: true, pageSize: 2 });
    expect(p1.status).toBe(200);
    expect(p1.body.results).toMatchObject({ dryRun: true, issued: 0, alreadyIssued: 0, errors: 0, scanned: 2, candidates: 1, nextCursor: 'b' });
    expect((p1.body.results as Data).candidateList).toEqual([{ uid: 'b', createdAtMs: 1_700_000_000_000, hasEmail: false }]);

    const p2 = await call(ISSUE, { dryRun: true, pageSize: 2, cursor: 'b' });
    expect((p2.body.results as Data).candidateList).toEqual([
      { uid: 'c', createdAtMs: null, hasEmail: false },
      { uid: 'd', createdAtMs: 1_700_000_000_123, hasEmail: true },
    ]);
    expect((p2.body.results as Data).nextCursor).toBe('d');

    const p3 = await call(ISSUE, { dryRun: true, pageSize: 2, cursor: 'd' });
    expect(p3.body.results).toMatchObject({ scanned: 0, candidates: 0, candidateList: [], nextCursor: null });

    const all = JSON.stringify([p1.body, p2.body, p3.body]);
    expect(all).not.toContain('example.invalid');
    expect(all).not.toContain('Someone');
    expect(h.writes).toHaveLength(0);
  });

  it('B-ADM4 shape still holds for pageSize 1 (candidates is an integer 0..1)', async () => {
    const { isSafeOnboardingDryRunResponse } = await import('../../scripts/lib/admin-onboarding-dryrun-result.mjs');
    const r = await call(ISSUE, { dryRun: true, pageSize: 1, cursor: 'a' });
    expect(r.body.results).toMatchObject({ candidates: 1, nextCursor: 'b' });
    expect(isSafeOnboardingDryRunResponse(r.status, r.body)).toBe(true);
  });
});

describe('C3 / C4 error statuses', () => {
  it.each([{ uid: 123 }, { uid: { a: 1 } }, { email: 5 }, { uid: ['victim'] }])('admin-coupon-fix %j → 400 without writes', async body => {
    const r = await call(FIX, body);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ ok: false, code: 'INVALID_FIELDS' });
    expect(h.writes).toHaveLength(0);
  });

  it('admin-issue single run: an issuance exception is 500 ok:false, not 200 with errors', async () => {
    h.state.failTransaction = true;
    const r = await call(ISSUE, { uid: 'victim', dryRun: false });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, error: 'synthetic transaction failure' });
    expect(h.writes).toHaveLength(0);
  });
});
