import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPreviewEmailSuppressed, suppressedEmailReceipt } from '../../api/_shared/email-delivery-policy.js';

const effects = vi.hoisted(() => ({
  send: vi.fn(), transport: vi.fn(), quota: vi.fn(), increment: vi.fn(), db: vi.fn(),
  notify: vi.fn(), app: vi.fn(), firestore: vi.fn(), pdf: vi.fn(),
}));
vi.mock('nodemailer', () => ({ default: { createTransport: effects.transport } }));
vi.mock('../../api/_shared/gmail-quota.js', () => ({ checkGmailQuota: effects.quota, incrementGmailSentCount: effects.increment, GMAIL_QUOTA_EXCEEDED: 'GMAIL_QUOTA_EXCEEDED' }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: effects.db }));
vi.mock('firebase-admin/app', () => ({ getApps: effects.app, initializeApp: effects.app, cert: effects.app }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: effects.firestore, FieldValue: { serverTimestamp: () => 'offline-timestamp' } }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: effects.notify, sendDiscord: effects.notify }));
vi.mock('../../api/_generate-voucher.js', () => ({ generateVoucherPDF: effects.pdf }));

const { sendEmail, sendBookingConfirmation } = await import('../../api/_send-email.js');
const { sendNotificationEmail } = await import('../../api/_ai_core/emailNotifier.js');
const { sendCustomerEmailWithAlert } = await import('../../api/_shared/customer-email-trigger.js');
const { sendBookingChangeEmail } = await import('../../api/_shared/booking-change-emails.js');
const crons = await Promise.all([
  import('../../api/_crons/email-retry-sweep.js'), import('../../api/_crons/review-request.js'),
  import('../../api/_crons/refund-reminder.js'), import('../../api/_crons/preview-lead-recovery.js'),
]);
const mail = { to: 'recipient@example.invalid', subject: 'Offline fixture', html: '<p>fixture</p>', text: 'fixture' };
const outbound = vi.fn(() => { throw new Error('Unmocked network forbidden'); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('PREVIEW_EMAIL_SUPPRESS', 'true');
  vi.stubEnv('GMAIL_USER', 'sender@example.invalid'); vi.stubEnv('GMAIL_APP_PASSWORD', 'offline-placeholder');
  vi.stubGlobal('fetch', outbound);
  effects.transport.mockReturnValue({ sendMail: effects.send });
  effects.send.mockResolvedValue({ messageId: 'offline-message' });
  effects.quota.mockResolvedValue({ ok: true });
  effects.notify.mockResolvedValue(undefined);
  effects.db.mockImplementation(() => { throw new Error('Unmocked DB forbidden'); });
  effects.app.mockImplementation(() => { throw new Error('Unmocked Firebase app forbidden'); });
  effects.firestore.mockImplementation(() => { throw new Error('Unmocked Firestore forbidden'); });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function noMailEffects() {
  for (const spy of [effects.transport, effects.send, effects.quota, effects.increment, effects.db, effects.app, effects.firestore, effects.notify, outbound]) expect(spy).not.toHaveBeenCalled();
}
function suppressed(receipt) {
  expect(receipt).toMatchObject({ status: 'suppressed', reason: 'preview_policy', delivery: 'not_attempted', suppressed: true, sent: false, retryable: false });
  for (const key of ['messageId', 'accepted', 'deliveredAt', 'sentAt']) expect(receipt).not.toHaveProperty(key);
}

describe('server-only Preview mail policy', () => {
  it.each([
    ['preview', 'true', true], ['preview', undefined, false], ['preview', 'false', false],
    ['preview', 'TRUE', false], ['preview', '1', false], ['preview', ' true ', false],
    ['production', 'true', false], ['development', 'true', false], [undefined, 'true', false],
  ])('matches exact deployment=%s flag=%s', (deployment, flag, expected) => {
    expect(isPreviewEmailSuppressed({ VERCEL_ENV: deployment, PREVIEW_EMAIL_SUPPRESS: flag })).toBe(expected);
  });
  it('blocks common SMTP before quota, credentials, transport and provider acceptance', async () => {
    vi.stubEnv('GMAIL_USER', ''); vi.stubEnv('GMAIL_APP_PASSWORD', '');
    for (let i = 0; i < 2; i++) suppressed(await sendEmail(mail));
    noMailEffects();
  });
  it('passes the explicit non-delivery receipt through confirmation mail', async () => {
    suppressed(await sendBookingConfirmation(mail.to, mail, 'offline voucher'));
    noMailEffects();
  });
  it('also blocks the independent planner SMTP path', async () => {
    suppressed(await sendNotificationEmail({ email: mail.to, guestName: 'Fixture', tourTitle: 'Offline', planId: 'offline-plan', planUrl: '/my-plans/offline' }));
    noMailEffects();
  });
  it('never calls mail, writes retry payloads, reports ok:true or alerts from the customer wrapper', async () => {
    const collection = vi.fn(() => { throw new Error('Retry DB must remain untouched'); });
    const receipt = await sendCustomerEmailWithAlert({ db: { collection }, ...mail });
    suppressed(receipt); expect(receipt.ok).toBe(false); expect(collection).not.toHaveBeenCalled(); noMailEffects();
  });
  it('does not generate a voucher or claim it was attached/sent for change mail', async () => {
    suppressed(await sendBookingChangeEmail({ booking: { payerEmail: mail.to }, bookingID: 'OFFLINE' }));
    expect(effects.pdf).not.toHaveBeenCalled(); noMailEffects();
  });
  it.each(crons.map((module, index) => [index, module.default]))('returns before any mail-cron DB query or done marker: %i', async (_index, handler) => {
    const out = { code: 0, body: null };
    const res = { status(code) { out.code = code; return this; }, json(body) { out.body = body; return this; }, end() { return this; } };
    for (let i = 0; i < 2; i++) {
      await handler({ method: 'GET', query: {}, body: { PREVIEW_EMAIL_SUPPRESS: 'false' } }, res);
      expect(out.code).toBe(200); suppressed(out.body); expect(out.body.status).not.toBe('done');
    }
    noMailEffects();
  });
  it.each([['production', 'true'], ['preview', 'false'], ['development', 'true']])('preserves normal SMTP/quota behavior in %s with flag=%s', async (deployment, flag) => {
    vi.stubEnv('VERCEL_ENV', deployment); vi.stubEnv('PREVIEW_EMAIL_SUPPRESS', flag);
    expect(await sendEmail(mail)).toEqual({ messageId: 'offline-message' });
    expect(effects.quota).toHaveBeenCalledOnce(); expect(effects.transport).toHaveBeenCalledOnce();
    expect(effects.send).toHaveBeenCalledWith(expect.objectContaining(mail)); expect(effects.increment).toHaveBeenCalledOnce();
    expect(outbound).not.toHaveBeenCalled();
  });
  it('retains the quota failure and production retry/alert contract under mocks', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    effects.quota.mockResolvedValue({ ok: false, code: 'GMAIL_QUOTA_EXCEEDED', count: 500, quota: 500 });
    const add = vi.fn(async () => {}), collection = vi.fn(() => ({ add }));
    const receipt = await sendCustomerEmailWithAlert({ db: { collection }, ...mail });
    expect(receipt.ok).toBe(false); expect(receipt.reason).toContain('GMAIL_QUOTA_EXCEEDED');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending', attempts: 0 }));
    expect(effects.notify).toHaveBeenCalledOnce(); expect(effects.transport).not.toHaveBeenCalled();
    expect(outbound).not.toHaveBeenCalled();
  });
  it('uses a non-provider receipt rather than silently simulating a delivery', () => {
    suppressed(suppressedEmailReceipt()); noMailEffects();
  });
});
