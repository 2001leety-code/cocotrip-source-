import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), db: vi.fn(), email: vi.fn(), discord: vi.fn(), notify: vi.fn(),
  longMessage: vi.fn(), errorAlert: vi.fn(), throttle: vi.fn(),
  yesterday: vi.fn(), today: vi.fn(), week: vi.fn(), rate: vi.fn(),
}));
vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: mocks.admin }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: mocks.db }));
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => { throw new Error('Unexpected Firebase initialization'); }),
  cert: vi.fn(() => { throw new Error('Unexpected credentials'); }), getApps: vi.fn(() => []),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => { throw new Error('Unexpected real Firestore'); }),
  FieldValue: { serverTimestamp: vi.fn() },
}));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: mocks.email }));
vi.mock('../../api/_shared/notify.js', () => ({ sendDiscord: mocks.discord, notify: mocks.notify }));
vi.mock('../../api/_telegram.js', () => ({ sendLongMessage: mocks.longMessage, sendErrorAlert: mocks.errorAlert }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: mocks.throttle }));
vi.mock('../../api/_google-sheets.js', () => ({
  getYesterdayBookings: mocks.yesterday, getTodayTours: mocks.today, getWeekSummary: mocks.week,
}));
vi.mock('../../api/_exchange-rate.js', () => ({ getExchangeRate: mocks.rate }));
vi.mock('../../api/_shared/customer-email-trigger.js', () => ({ PENDING_EMAIL_RETRIES_COLLECTION: 'pending_email_retries' }));
vi.mock('../../api/_shared/marketing-optout.js', () => ({ isMarketingOptedOut: vi.fn(), buildUnsubscribeUrl: vi.fn() }));

import * as cronAuth from '../../api/_shared/cron-auth.js';
import daily from '../../api/_crons/daily-report.js';
import retry from '../../api/_crons/email-retry-sweep.js';
import recovery from '../../api/_crons/preview-lead-recovery.js';
import refund from '../../api/_crons/refund-reminder.js';
import review from '../../api/_crons/review-request.js';

const handlers = [
  { name: 'daily-report', handler: daily, options: true },
  { name: 'email-retry-sweep', handler: retry, options: false },
  { name: 'preview-lead-recovery', handler: recovery, options: true },
  { name: 'refund-reminder', handler: refund, options: true },
  { name: 'review-request', handler: review, options: true },
];
function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn().mockReturnThis() };
}
function expectNoWork() {
  for (const [name, mock] of Object.entries(mocks)) {
    if (name !== 'admin') expect(mock, name).not.toHaveBeenCalled();
  }
  expect(fetch).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('CRON_SECRET', 'unit-test-cron-secret');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in cron auth tests'); }));
  mocks.admin.mockResolvedValue({ ok: false, status: 403 });
  const query = {
    where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    doc: vi.fn().mockReturnThis(), collection: vi.fn().mockReturnThis(), count: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ exists: false, empty: true, docs: [], size: 0, data: () => ({ count: 0 }) }),
  };
  mocks.db.mockReturnValue({ collection: vi.fn(() => query) });
  mocks.yesterday.mockResolvedValue([]);
  mocks.today.mockResolvedValue([]);
  mocks.week.mockResolvedValue({ totalUSD: 0, count: 0 });
  mocks.rate.mockResolvedValue({ krwPerUsd: 1300, source: 'test', fetchedAt: new Date() });
  mocks.longMessage.mockResolvedValue({ ok: true });
  mocks.throttle.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe.each(handlers)('$name direct HTTP authentication', ({ handler, options, name }) => {
  it.each([
    {}, { 'x-vercel-cron': '1' }, { authorization: 'Bearer wrong-secret' },
    { authorization: 'Basic unit-test-cron-secret' },
  ])('rejects unauthorized headers %j before all job work', async (headers) => {
    const res = response();
    await handler({ method: 'GET', headers, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, code: 'AUTH_REQUIRED' }));
    expectNoWork();
  });

  it('awaits authentication before doing any work', async () => {
    let finishAuth!: (value: { ok: boolean; status: number }) => void;
    mocks.admin.mockImplementationOnce(() => new Promise((resolve) => { finishAuth = resolve; }));
    const res = response();
    const pending = handler({ method: 'GET', headers: { authorization: 'Bearer pending-admin' }, query: {} }, res);
    await Promise.resolve();
    expectNoWork();
    expect(res.status).not.toHaveBeenCalled();
    finishAuth({ ok: false, status: 403 });
    await pending;
    expect(res.status).toHaveBeenCalledWith(401);
    expectNoWork();
  });

  it('preserves a shared verifier 403 without running the job', async () => {
    vi.spyOn(cronAuth, 'verifyCronRequest').mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' });
    const res = response();
    await handler({ method: 'POST', headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expectNoWork();
  });

  it.each(['cron', 'admin'])('accepts a valid %s credential through the real shared verifier', async (source) => {
    if (source === 'admin') mocks.admin.mockResolvedValue({ ok: true });
    const req = { method: 'GET', headers: { authorization: `Bearer ${source === 'cron' ? 'unit-test-cron-secret' : 'unit-test-admin-token'}` }, query: {} };
    const res = response();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    if (source === 'admin') expect(mocks.admin).toHaveBeenCalledWith(req);
    else expect(mocks.admin).not.toHaveBeenCalled();
    if (name === 'email-retry-sweep') {
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ swept: 0, suppressed: true }));
      expect(mocks.db).not.toHaveBeenCalled();
    } else expect(mocks.db).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates authentication errors before job work or success responses', async () => {
    const error = new Error('Authentication unavailable');
    mocks.admin.mockRejectedValueOnce(error);
    const res = response();
    await expect(handler({ method: 'GET', headers: { authorization: 'Bearer admin-token' }, query: {} }, res)).rejects.toBe(error);
    expect(res.status).not.toHaveBeenCalled();
    expectNoWork();
  });

  if (options) it('preserves the existing no-work OPTIONS response', async () => {
    const res = response();
    await handler({ method: 'OPTIONS', headers: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.end).toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expectNoWork();
  });
});
