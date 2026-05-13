/**
 * PR #419 — Audit CZ3 / WC5 regression slot.
 *
 * Asserts that /api/cron-runner refuses unauthenticated callers before
 * touching Firestore or firing email/Telegram alerts. Pre-PR-#419 the
 * dispatcher had zero auth — anyone could POST `?job=daily-report` and
 * trigger mass operator alerts.
 *
 * Acceptable callers: CRON_SECRET Bearer, `x-vercel-cron:1` header, or
 * admin Firebase ID token.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const verifyAdminTokenMock = vi.fn();

// Mock the admin auth helper so we control the success/fail outcome.
vi.mock('../../api/_shared/admin-auth.js', () => ({
  verifyAdminToken: verifyAdminTokenMock,
  default: verifyAdminTokenMock,
}));

// All cron job handlers — mock to no-op so we can verify whether they were
// reached. Each returns a marker object the dispatcher writes to res.
function makeJobMock(name: string) {
  return vi.fn(async (_req: any, res: any) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ executed: name }));
  });
}
const jobMocks = {
  dailyReport: makeJobMock('daily-report'),
  refundReminder: makeJobMock('refund-reminder'),
  dispatchTimeoutSweep: makeJobMock('dispatch-timeout-sweep'),
  weeklyQualityReport: makeJobMock('weekly-quality-report'),
  dispatchReminder: makeJobMock('dispatch-reminder'),
  operatorTodoReminder: makeJobMock('operator-todo-reminder'),
};
vi.mock('../../api/_crons/daily-report.js', () => ({ default: jobMocks.dailyReport }));
vi.mock('../../api/_crons/refund-reminder.js', () => ({ default: jobMocks.refundReminder }));
vi.mock('../../api/_crons/dispatch-timeout-sweep.js', () => ({ default: jobMocks.dispatchTimeoutSweep }));
vi.mock('../../api/_crons/weekly-quality-report.js', () => ({ default: jobMocks.weeklyQualityReport }));
vi.mock('../../api/_crons/dispatch-reminder.js', () => ({ default: jobMocks.dispatchReminder }));
vi.mock('../../api/_crons/operator-todo-reminder.js', () => ({ default: jobMocks.operatorTodoReminder }));

// --- helpers ----------------------------------------------------------------
type MockRes = {
  statusCode?: number;
  headers: Record<string, string>;
  body: string;
  writeHead: (status: number, headers?: Record<string, string>) => MockRes;
  setHeader: (k: string, v: string) => void;
  end: (s?: string) => MockRes;
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
    end(s?: string) { if (s != null) res.body = s; return res; },
  };
  return res;
}
function req(method: string, opts: { headers?: Record<string, string>; query?: Record<string, string> } = {}) {
  const qs = opts.query ? '?' + new URLSearchParams(opts.query).toString() : '';
  return {
    method,
    url: `/api/cron-runner${qs}`,
    headers: opts.headers ?? {},
    query: opts.query ?? {},
  };
}

// --- tests ------------------------------------------------------------------
describe('PR #419 — cron-runner auth gate', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    verifyAdminTokenMock.mockReset();
    Object.values(jobMocks).forEach((m) => m.mockClear());
    // Clean slate per test.
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns 401 + AUTH_REQUIRED with no auth header and no CRON_SECRET set', async () => {
    const handler = (await import('../../api/cron-runner.js')).default;
    const res = makeRes();
    await handler(req('GET', { query: { job: 'daily-report' } }), res as any);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    // job handler must NOT have run.
    expect(jobMocks.dailyReport).not.toHaveBeenCalled();
  });

  it('accepts request with x-vercel-cron: 1 header', async () => {
    const handler = (await import('../../api/cron-runner.js')).default;
    const res = makeRes();
    await handler(
      req('GET', {
        headers: { 'x-vercel-cron': '1' },
        query: { job: 'daily-report' },
      }),
      res as any,
    );
    expect(res.statusCode).toBe(200);
    expect(jobMocks.dailyReport).toHaveBeenCalledOnce();
  });

  it('accepts request with Bearer CRON_SECRET when env var set', async () => {
    process.env.CRON_SECRET = 'super-secret-123';
    const handler = (await import('../../api/cron-runner.js')).default;
    const res = makeRes();
    await handler(
      req('GET', {
        headers: { authorization: 'Bearer super-secret-123' },
        query: { job: 'daily-report' },
      }),
      res as any,
    );
    expect(res.statusCode).toBe(200);
    expect(jobMocks.dailyReport).toHaveBeenCalledOnce();
  });

  it('rejects Bearer with wrong CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'super-secret-123';
    verifyAdminTokenMock.mockResolvedValueOnce({ ok: false, status: 403, error: 'Not admin' });
    const handler = (await import('../../api/cron-runner.js')).default;
    const res = makeRes();
    await handler(
      req('GET', {
        headers: { authorization: 'Bearer wrong-token' },
        query: { job: 'daily-report' },
      }),
      res as any,
    );
    expect(res.statusCode).toBe(401);
    expect(jobMocks.dailyReport).not.toHaveBeenCalled();
  });

  it('accepts admin Firebase ID token via verifyAdminToken', async () => {
    verifyAdminTokenMock.mockResolvedValueOnce({ ok: true, email: 'admin@example.com', uid: 'uid-1' });
    const handler = (await import('../../api/cron-runner.js')).default;
    const res = makeRes();
    await handler(
      req('GET', {
        headers: { authorization: 'Bearer firebase-id-token' },
        query: { job: 'daily-report' },
      }),
      res as any,
    );
    expect(res.statusCode).toBe(200);
    expect(jobMocks.dailyReport).toHaveBeenCalledOnce();
  });

  it('rejects 400 with unknown job even when authed', async () => {
    const handler = (await import('../../api/cron-runner.js')).default;
    const res = makeRes();
    await handler(
      req('GET', {
        headers: { 'x-vercel-cron': '1' },
        query: { job: 'bogus-job-name' },
      }),
      res as any,
    );
    expect(res.statusCode).toBe(400);
  });

  it('OPTIONS preflight still returns 200 without auth (CORS preflight needs no body)', async () => {
    const handler = (await import('../../api/cron-runner.js')).default;
    const res = makeRes();
    await handler(req('OPTIONS'), res as any);
    expect(res.statusCode).toBe(200);
  });

  it('rejects forged x-vercel-cron value (only "1" is accepted)', async () => {
    const handler = (await import('../../api/cron-runner.js')).default;
    const res = makeRes();
    await handler(
      req('GET', {
        headers: { 'x-vercel-cron': 'true' },
        query: { job: 'daily-report' },
      }),
      res as any,
    );
    expect(res.statusCode).toBe(401);
  });
});
