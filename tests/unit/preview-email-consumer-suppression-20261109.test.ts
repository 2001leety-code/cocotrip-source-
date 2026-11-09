import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const m = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  notify: vi.fn(),
  initAdminDb: vi.fn(),
}));

vi.mock('../../api/_shared/cron-auth.js', () => ({ verifyCronRequest: async () => ({ ok: true, source: 'test' }) }));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: m.sendEmail, default: m.sendEmail }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: m.notify, default: m.notify }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: m.initAdminDb }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

import { sendCustomerEmailWithAlert } from '../../api/_shared/customer-email-trigger.js';
import handler from '../../api/_crons/email-retry-sweep.js';
import { emailSuppressedReceipt } from '../../api/_shared/preview-notification-policy.js';

const KEYS = ['VERCEL_ENV', 'PREVIEW_EMAIL_SUPPRESS'] as const;
// Independent snapshot taken once at module start, before any test mutates env.
const ORIGINAL_ENV: Readonly<Record<string, string | undefined>> = Object.freeze({
  VERCEL_ENV: process.env.VERCEL_ENV,
  PREVIEW_EMAIL_SUPPRESS: process.env.PREVIEW_EMAIL_SUPPRESS,
});

function restoreEnv(): void {
  for (const k of KEYS) {
    const v = ORIGINAL_ENV[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

function setEnv(env: string | undefined, flag: string | undefined): void {
  if (env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = env;
  if (flag === undefined) delete process.env.PREVIEW_EMAIL_SUPPRESS; else process.env.PREVIEW_EMAIL_SUPPRESS = flag;
}

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function makeTriggerDb() {
  const add = vi.fn().mockResolvedValue({ id: 'x' });
  const collection = vi.fn(() => ({ add }));
  return { db: { collection }, add, collection };
}

function makeCronDb(docs: Array<Record<string, unknown>>) {
  const updates = docs.map(() => vi.fn().mockResolvedValue(undefined));
  const snapDocs = docs.map((d, i) => ({ data: () => d, ref: { update: updates[i] } }));
  const get = vi.fn().mockResolvedValue({ empty: snapDocs.length === 0, docs: snapDocs, size: snapDocs.length });
  const limit = vi.fn(() => ({ get }));
  const where = vi.fn(() => ({ limit }));
  const collection = vi.fn(() => ({ where }));
  return { db: { collection }, updates, collection };
}

const ARGS = { to: 'test@example.invalid', subject: 's', html: '<p>h</p>', text: 't', context: { emailType: 'test' } };

beforeEach(() => {
  restoreEnv();
  // Supplemental only: SMTP/outgoing isolation comes from the module mocks above, not from this deny.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network denied in tests'))));
  m.sendEmail.mockReset();
  m.notify.mockReset().mockResolvedValue(undefined);
  m.initAdminDb.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('customer-email-trigger', () => {
  it('preview+flag: early suppression, no send/db/alert/log, even with invalid args', async () => {
    setEnv('preview', 'true');
    const { db, collection } = makeTriggerDb();
    const r = await sendCustomerEmailWithAlert({ db, to: '', subject: '', html: '', text: '' });
    expect(r).toEqual({ ok: false, ...emailSuppressedReceipt() });
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(collection).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('defensive: suppressed receipt from sendEmail is not success, not retried, not alerted', async () => {
    setEnv('production', undefined);
    m.sendEmail.mockResolvedValue(emailSuppressedReceipt());
    const { db, add } = makeTriggerDb();
    const r = await sendCustomerEmailWithAlert({ db, ...ARGS });
    expect(r).toEqual({ ok: false, ...emailSuppressedReceipt() });
    expect(add).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('production with flag true: normal success', async () => {
    setEnv('production', 'true');
    m.sendEmail.mockResolvedValue({ messageId: 'm1' });
    const { db, add } = makeTriggerDb();
    expect(await sendCustomerEmailWithAlert({ db, ...ARGS })).toEqual({ ok: true });
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
  });

  it('undefined successful send result: normal success', async () => {
    setEnv('production', undefined);
    m.sendEmail.mockResolvedValue(undefined);
    const { db, add } = makeTriggerDb();
    expect(await sendCustomerEmailWithAlert({ db, ...ARGS })).toEqual({ ok: true });
    expect(add).not.toHaveBeenCalled();
  });

  it('preview with missing flag: normal delivery', async () => {
    setEnv('preview', undefined);
    m.sendEmail.mockResolvedValue({});
    const { db } = makeTriggerDb();
    expect(await sendCustomerEmailWithAlert({ db, ...ARGS })).toEqual({ ok: true });
    expect(m.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('invalid args outside suppression: original validation path, no send, not a suppressed receipt', async () => {
    setEnv('production', undefined);
    const { db } = makeTriggerDb();
    const r = await sendCustomerEmailWithAlert({ db, to: '', subject: '', html: '', text: '' });
    expect(r.ok).toBe(false);
    expect(r).not.toMatchObject({ status: 'suppressed' });
    expect(m.sendEmail).not.toHaveBeenCalled();
  });

  it('production failure: persists retry and alerts', async () => {
    setEnv('production', undefined);
    m.sendEmail.mockRejectedValue(new Error('smtp down'));
    const { db, add } = makeTriggerDb();
    const r = await sendCustomerEmailWithAlert({ db, ...ARGS });
    expect(r).toEqual({ ok: false, reason: 'smtp down' });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][0]).toMatchObject({ status: 'pending', attempts: 0, lastFailureReason: 'smtp down' });
    expect(m.notify).toHaveBeenCalled();
  });
});

describe('email-retry-sweep cron', () => {
  it('preview+flag: early 200 receipt, zero DB init/query/send/alert', async () => {
    setEnv('preview', 'true');
    const res = makeRes();
    await handler({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, swept: 0, ...emailSuppressedReceipt() });
    expect(m.initAdminDb).not.toHaveBeenCalled();
    expect(m.sendEmail).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('mixed batch success+failure+suppressed: exact counters, no batch delivery/reason/suppressed keys', async () => {
    setEnv('production', undefined);
    const c = makeCronDb([
      { to: 'a@example.invalid', subject: 's', attempts: 1 },
      { to: 'b@example.invalid', subject: 's', attempts: 0 },
      { to: 'c@example.invalid', subject: 's', attempts: 4 },
    ]);
    m.initAdminDb.mockReturnValue(c.db);
    m.sendEmail
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValueOnce(emailSuppressedReceipt());
    const res = makeRes();
    await handler({}, res);
    expect(m.sendEmail).toHaveBeenCalledTimes(3);
    expect(c.updates[0]).toHaveBeenCalledWith(expect.objectContaining({ status: 'done', attempts: 2 }));
    expect(c.updates[1]).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, lastFailureReason: 'smtp down' }));
    expect(c.updates[2]).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledTimes(1);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({ ok: true, swept: 3, succeeded: 1, retryAgain: 1, escalated: 0, suppressedCount: 1 });
    expect(body).not.toHaveProperty('delivery');
    expect(body).not.toHaveProperty('reason');
    expect(body).not.toHaveProperty('suppressed');
  });

  it('production success: marks done, no suppressedCount key', async () => {
    setEnv('production', 'true');
    const c = makeCronDb([{ to: 'a@example.invalid', subject: 's', attempts: 1 }]);
    m.initAdminDb.mockReturnValue(c.db);
    m.sendEmail.mockResolvedValue(undefined);
    const res = makeRes();
    await handler({}, res);
    expect(c.updates[0]).toHaveBeenCalledWith(expect.objectContaining({ status: 'done', attempts: 2 }));
    expect(res.json).toHaveBeenCalledWith({ ok: true, swept: 1, succeeded: 1, retryAgain: 0, escalated: 0 });
  });

  it('production failure: retry increment and escalation alert', async () => {
    setEnv('production', undefined);
    const c = makeCronDb([
      { to: 'a@example.invalid', subject: 's', attempts: 0 },
      { to: 'b@example.invalid', subject: 's', attempts: 4 },
    ]);
    m.initAdminDb.mockReturnValue(c.db);
    m.sendEmail.mockRejectedValue(new Error('smtp down'));
    const res = makeRes();
    await handler({}, res);
    expect(c.updates[0]).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, lastFailureReason: 'smtp down' }));
    expect(c.updates[1]).toHaveBeenCalledWith(expect.objectContaining({ status: 'manual-intervention', attempts: 5 }));
    expect(m.notify).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true, swept: 2, succeeded: 0, retryAgain: 1, escalated: 1 });
  });

  it('preview with missing flag: normal cron path', async () => {
    setEnv('preview', undefined);
    const c = makeCronDb([{ to: 'a@example.invalid', subject: 's', attempts: 0 }]);
    m.initAdminDb.mockReturnValue(c.db);
    m.sendEmail.mockResolvedValue({});
    const res = makeRes();
    await handler({}, res);
    expect(m.initAdminDb).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true, swept: 1, succeeded: 1, retryAgain: 0, escalated: 0 });
  });

  it('Firestore unavailable still 500 in production', async () => {
    setEnv('production', undefined);
    m.initAdminDb.mockReturnValue(null);
    const res = makeRes();
    await handler({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('env restore', () => {
  it('mutates env', () => {
    setEnv('preview', 'true');
    expect(process.env.PREVIEW_EMAIL_SUPPRESS).toBe('true');
  });
  it('env matches the module-start snapshot after prior mutation', () => {
    expect(process.env.VERCEL_ENV).toBe(ORIGINAL_ENV.VERCEL_ENV);
    expect(process.env.PREVIEW_EMAIL_SUPPRESS).toBe(ORIGINAL_ENV.PREVIEW_EMAIL_SUPPRESS);
  });
});
