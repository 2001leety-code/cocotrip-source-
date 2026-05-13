/**
 * PR #418 — Audit W-C1~C4 regression slot.
 *
 * Asserts that the user-scoped endpoints (my-bookings / voucher / cancelBooking /
 * modifyBooking / reviews) require a verified Firebase ID token *before* doing
 * any Firestore work. Pre-PR-#418 these endpoints trusted body/query
 * `userEmail` and `userId`, enabling IDOR (Issue ref: Agent W finding W-C1..C4).
 *
 * Strategy: mock `verifyUserToken` + `verifyAdminToken` to return a rejection
 * and verify the handler returns 401 / 403 with `AUTH_REQUIRED` (or FORBIDDEN
 * for admin actions) WITHOUT touching firebase-admin/firestore.
 *
 * If a future refactor removes the early auth gate, this test fires.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mocks ------------------------------------------------------------------
const verifyUserTokenMock = vi.fn();
const verifyAdminTokenMock = vi.fn();

vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyUserToken: verifyUserTokenMock,
  default: verifyUserTokenMock,
}));
vi.mock('../../api/_shared/admin-auth.js', () => ({
  verifyAdminToken: verifyAdminTokenMock,
  default: verifyAdminTokenMock,
}));

// Prevent the handlers from booting up the real firebase-admin chain.
// my-bookings / cancelBooking / modifyBooking → initAdminDb('tag')
// voucher → initAdminDb()
// reviews → dynamic import('firebase-admin/app')+('firebase-admin/firestore')
function fakeDb() {
  // Return an object that satisfies the surface used after the auth gate.
  // Tests intentionally short-circuit at the auth check, so collection() etc.
  // never actually executes when the gate fires.
  const fake: any = {};
  fake.collection = () => fake;
  fake.doc = () => fake;
  fake.where = () => fake;
  fake.orderBy = () => fake;
  fake.limit = () => fake;
  fake.startAfter = () => fake;
  fake.get = async () => ({ exists: false, empty: true, docs: [], data: () => ({}) });
  fake.runTransaction = async (fn: any) => fn({
    get: async () => ({ exists: false, data: () => ({}) }),
    set: () => undefined,
    update: () => undefined,
  });
  return fake;
}

vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => fakeDb(),
}));
vi.mock('../../api/_ai_core/firestoreAdmin.js', () => ({
  initAdminDb: () => fakeDb(),
}));
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  cert: vi.fn(),
  getApps: vi.fn(() => [{ name: '[DEFAULT]' }]),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fakeDb(),
  FieldValue: { serverTimestamp: () => 'TS', arrayUnion: (x: unknown) => ({ arrayUnion: x }) },
}));
vi.mock('../../api/_shared/sentry.js', () => ({
  captureError: vi.fn(),
}));

// --- helpers ----------------------------------------------------------------
type MockRes = {
  statusCode?: number;
  headers: Record<string, string>;
  body: string;
  writeHead: (status: number, headers?: Record<string, string>) => MockRes;
  setHeader: (k: string, v: string) => void;
  end: (s?: string | Buffer) => MockRes;
};

function makeRes(): MockRes {
  const res = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode = status;
      if (headers) Object.assign(res.headers, headers);
      return res;
    },
    setHeader(k: string, v: string) { res.headers[k] = v; },
    end(s?: string | Buffer) {
      if (s != null) res.body = typeof s === 'string' ? s : s.toString('utf8');
      return res;
    },
  };
  return res;
}

function req(method: string, opts: { body?: object; query?: Record<string, string>; auth?: string } = {}) {
  const qs = opts.query ? '?' + new URLSearchParams(opts.query).toString() : '';
  return {
    method,
    url: `/api/_unit_test${qs}`,
    headers: {
      host: 'unit.test',
      ...(opts.auth ? { authorization: opts.auth } : {}),
    },
    query: opts.query ?? {},
    body: opts.body ?? {},
  };
}

// --- tests ------------------------------------------------------------------
describe('PR #418 — Auth IDOR fix regression slot', () => {
  beforeEach(() => {
    verifyUserTokenMock.mockReset();
    verifyAdminTokenMock.mockReset();
  });

  describe('my-bookings', () => {
    it('returns 401 + AUTH_REQUIRED when token missing', async () => {
      verifyUserTokenMock.mockResolvedValueOnce({ ok: false, status: 401, error: 'Authorization Bearer token required' });
      const handler = (await import('../../api/my-bookings.js')).default;
      const res = makeRes();
      await handler(req('GET'), res as any);
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    });
  });

  describe('voucher', () => {
    it('returns 401 + AUTH_REQUIRED when token missing', async () => {
      verifyUserTokenMock.mockResolvedValueOnce({ ok: false, status: 401, error: 'Authorization Bearer token required' });
      const handler = (await import('../../api/voucher.js')).default;
      const res = makeRes();
      await handler(req('GET', { query: { bookingID: 'COCO-1234' } }), res as any);
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    });

    it('rejects 400 with bookingID missing even when authed', async () => {
      verifyUserTokenMock.mockResolvedValueOnce({ ok: true, email: 'a@b.com', uid: 'u' });
      const handler = (await import('../../api/voucher.js')).default;
      const res = makeRes();
      await handler(req('GET'), res as any);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('cancelBooking', () => {
    it('returns 401 + AUTH_REQUIRED when token missing', async () => {
      verifyUserTokenMock.mockResolvedValueOnce({ ok: false, status: 401, error: 'Authorization Bearer token required' });
      const handler = (await import('../../api/cancelBooking.js')).default;
      const res = makeRes();
      await handler(req('POST', { body: { bookingID: 'COCO-1' } }), res as any);
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    });
  });

  describe('modifyBooking', () => {
    it('returns 401 + AUTH_REQUIRED when token missing', async () => {
      verifyUserTokenMock.mockResolvedValueOnce({ ok: false, status: 401, error: 'Authorization Bearer token required' });
      const handler = (await import('../../api/modifyBooking.js')).default;
      const res = makeRes();
      await handler(req('POST', { body: { bookingID: 'COCO-1', changes: { paxCount: 3 } } }), res as any);
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    });
  });

  describe('reviews (per-action auth gate)', () => {
    for (const action of ['create', 'my-reviews', 'delete', 'report']) {
      it(`returns 401 + AUTH_REQUIRED for action=${action} when token missing`, async () => {
        verifyUserTokenMock.mockResolvedValueOnce({ ok: false, status: 401, error: 'Authorization Bearer token required' });
        const handler = (await import('../../api/reviews.js')).default;
        const res = makeRes();
        await handler(req('POST', { body: { action, reviewId: 'r1' } }), res as any);
        expect(res.statusCode).toBe(401);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
      });
    }

    for (const action of ['admin-list', 'moderate']) {
      it(`returns 403 + FORBIDDEN for action=${action} when admin token missing`, async () => {
        verifyAdminTokenMock.mockResolvedValueOnce({ ok: false, status: 403, error: 'Not admin' });
        const handler = (await import('../../api/reviews.js')).default;
        const res = makeRes();
        await handler(req('POST', { body: { action, reviewId: 'r1', decision: 'hide' } }), res as any);
        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.body);
        expect(body).toMatchObject({ ok: false, code: 'FORBIDDEN' });
      });
    }

    it('list action is public — no auth gate', async () => {
      // We can't reach the DB layer in this unit test, but we can assert that
      // verifyUserToken is NOT called for action=list. The handler will fail
      // later because the firestore mock is null, but the absence of an
      // AUTH_REQUIRED response is what we're testing.
      const handler = (await import('../../api/reviews.js')).default;
      const res = makeRes();
      await handler(req('POST', { body: { action: 'list', targetType: 'tour', targetId: 't1' } }), res as any);
      expect(verifyUserTokenMock).not.toHaveBeenCalled();
      expect(verifyAdminTokenMock).not.toHaveBeenCalled();
    });
  });
});
