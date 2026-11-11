import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

const m = vi.hoisted(() => {
  // Capture exact originals once, before any import can read synthetic values; restored only in afterAll.
  const vapidOrig = {
    pubSet: Object.prototype.hasOwnProperty.call(process.env, 'VAPID_PUBLIC_KEY'),
    pub: process.env.VAPID_PUBLIC_KEY,
    privSet: Object.prototype.hasOwnProperty.call(process.env, 'VAPID_PRIVATE_KEY'),
    priv: process.env.VAPID_PRIVATE_KEY,
  };
  process.env.VAPID_PUBLIC_KEY = 'test-pub';
  process.env.VAPID_PRIVATE_KEY = 'test-priv';
  const sendMail = vi.fn(async () => ({ messageId: 'test-msg' }));
  const append = vi.fn(async () => ({}));
  return {
    vapidOrig,
    sendMail,
    createTransport: vi.fn(() => ({ sendMail })),
    sendNotification: vi.fn(async () => ({})),
    setVapidDetails: vi.fn(),
    checkGmailQuota: vi.fn(async () => ({ ok: true })),
    increment: vi.fn(async () => {}),
    append,
    JWT: vi.fn(),
    sheets: vi.fn(() => ({ spreadsheets: { values: { append } } })),
    alert: vi.fn(async () => {}),
  };
});

vi.mock('nodemailer', () => ({ default: { createTransport: m.createTransport } }));
vi.mock('web-push', () => ({ default: { setVapidDetails: m.setVapidDetails, sendNotification: m.sendNotification } }));
vi.mock('googleapis', () => ({ google: { auth: { JWT: m.JWT }, sheets: m.sheets } }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'ts' } }));
vi.mock('../../api/_shared/gmail-quota.js', () => ({ checkGmailQuota: m.checkGmailQuota, incrementGmailSentCount: m.increment, GMAIL_QUOTA_EXCEEDED: 'GMAIL_QUOTA_EXCEEDED' }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: m.alert }));

import { isPreviewSuppressed, isNotificationSuppressed, emailSuppressedReceipt, sheetsSuppressedReceipt, pushSuppressedReceipt, pushBulkSuppressedReceipt } from '../../api/_shared/preview-notification-policy.js';
import { sendNotificationEmail, recordLeadToSheets } from '../../api/_ai_core/emailNotifier.js';
import { sendEmail, sendBookingConfirmation, sendReviewRequest, sendRetargetingEmail } from '../../api/_send-email.js';
import { appendBooking, updateBookingStatus } from '../../api/_google-sheets.js';
import { sendPush, sendPushToUser } from '../../api/_send-push.js';

const KEYS = ['VERCEL_ENV', 'PREVIEW_EMAIL_SUPPRESS', 'PREVIEW_SHEETS_SUPPRESS', 'PREVIEW_PUSH_SUPPRESS', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_SHEETS_SPREADSHEET_ID'];
const saved: Record<string, string | undefined> = {};
interface FetchInit { method?: string; headers?: Record<string, string>; body?: string }
interface MockResponse { ok: boolean; status: number; json: () => Promise<unknown> }
type FetchFn = (url: unknown, init?: FetchInit) => Promise<MockResponse>;
const unexpectedFetch = async (url: unknown): Promise<MockResponse> => { throw new Error(`unexpected fetch in test: ${String(url)}`); };
const fetchMock = vi.fn<FetchFn>(unexpectedFetch);
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_PREFIX = 'https://sheets.googleapis.com/v4/spreadsheets/test-sheet/values/';
type SheetsStep = { method: string; url: string; status?: number; body: unknown; check?: (init: FetchInit | undefined) => void };
// Token calls are optional (a cached token may skip them); Sheets calls must match the queue in order; anything else throws.
function routeSheets(steps: SheetsStep[]) {
  const queue = [...steps];
  fetchMock.mockImplementation(async (url: unknown, init?: FetchInit): Promise<MockResponse> => {
    const u = String(url);
    if (u === TOKEN_URL) {
      expect(init?.method).toBe('POST');
      const params = new URLSearchParams(String(init?.body));
      expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      expect(params.get('assertion')?.split('.')).toHaveLength(3);
      return { ok: true, status: 200, json: async () => ({ access_token: 'test-token', expires_in: 3599, token_type: 'Bearer' }) };
    }
    const step = queue.shift();
    if (!step) throw new Error(`unexpected fetch in test: ${u}`);
    expect(u).toBe(step.url);
    expect((init?.method || 'GET').toUpperCase()).toBe(step.method);
    expect(init?.headers?.Authorization).toBe('Bearer test-token');
    step.check?.(init);
    const status = step.status === undefined ? 200 : step.status;
    return { ok: status < 400, status, json: async () => step.body };
  });
  return queue;
}
function fakeSheetsCreds() {
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'svc@example.test';
  process.env.GOOGLE_PRIVATE_KEY = ['-----BEGIN PRIVATE KEY-----', 'ZmFrZWtleQ==', '-----END PRIVATE KEY-----'].join(String.fromCharCode(10));
  const importKey = vi.spyOn(globalThis.crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
  const sign = vi.spyOn(globalThis.crypto.subtle, 'sign').mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer);
  return { importKey, sign };
}
const content = { subject: 's', html: '<html><body>x</body></html>', text: 't' };
const makeFirestore = () => ({ collection: vi.fn(() => ({ where: () => ({ get: async () => ({ docs: [{ ref: {}, data: () => ({ endpoint: 'e', keys: {} }) }] }) }) })) });

function setFlags(env: string) {
  process.env.VERCEL_ENV = env;
  process.env.PREVIEW_EMAIL_SUPPRESS = 'true';
  process.env.PREVIEW_SHEETS_SUPPRESS = 'true';
  process.env.PREVIEW_PUSH_SUPPRESS = 'true';
  process.env.GMAIL_USER = 'test-user';
  process.env.GMAIL_APP_PASSWORD = 'test-pass';
  process.env.GOOGLE_CLIENT_EMAIL = 'test-client';
  process.env.GOOGLE_PRIVATE_KEY = 'test-not-a-key';
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-sheet';
}

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  vi.clearAllMocks();
  fetchMock.mockReset();
  fetchMock.mockImplementation(unexpectedFetch);
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => {
  if (m.vapidOrig.pubSet) process.env.VAPID_PUBLIC_KEY = m.vapidOrig.pub; else delete process.env.VAPID_PUBLIC_KEY;
  if (m.vapidOrig.privSet) process.env.VAPID_PRIVATE_KEY = m.vapidOrig.priv; else delete process.env.VAPID_PRIVATE_KEY;
});

function expectNoBoundary() {
  expect(m.createTransport).not.toHaveBeenCalled();
  expect(m.sendMail).not.toHaveBeenCalled();
  expect(m.checkGmailQuota).not.toHaveBeenCalled();
  expect(m.increment).not.toHaveBeenCalled();
  expect(m.JWT).not.toHaveBeenCalled();
  expect(m.sheets).not.toHaveBeenCalled();
  expect(m.append).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(m.setVapidDetails).not.toHaveBeenCalled();
  expect(m.sendNotification).not.toHaveBeenCalled();
  expect(m.alert).not.toHaveBeenCalled();
}

describe('isPreviewSuppressed', () => {
  it('suppresses every supported preview channel regardless of flags', () => {
    for (const ch of ['email', 'sheets', 'push', 'telegram', 'discord']) {
      for (const value of [undefined, '', 'false', 'true', '1', 'TRUE']) {
        const env = { VERCEL_ENV: 'preview', PREVIEW_EMAIL_SUPPRESS: value, PREVIEW_SHEETS_SUPPRESS: value, PREVIEW_PUSH_SUPPRESS: value, PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: value };
        expect(isPreviewSuppressed(ch, env)).toBe(true);
      }
    }
    expect(isPreviewSuppressed('unknown', { VERCEL_ENV: 'preview' })).toBe(false);
  });
  it('preserves all non-preview environment behavior', () => {
    for (const env of ['production', 'development', undefined, '', 'Preview', ' preview']) {
      for (const ch of ['email', 'sheets', 'push', 'telegram', 'discord']) {
        expect(isPreviewSuppressed(ch, { VERCEL_ENV: env, PREVIEW_EMAIL_SUPPRESS: 'true', PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS: 'true' })).toBe(false);
      }
    }
  });
});

describe('isNotificationSuppressed', () => {
  it('accepts every suppressed receipt shape', () => {
    for (const r of [emailSuppressedReceipt(), sheetsSuppressedReceipt('appendBooking'), pushSuppressedReceipt(), pushBulkSuppressedReceipt()]) {
      expect(r).toMatchObject({ status: 'suppressed', suppressed: true, reason: 'preview_policy', retryable: false });
      expect(isNotificationSuppressed(r)).toBe(true);
    }
    expect(pushBulkSuppressedReceipt()).toMatchObject({ sent: 0, total: 0, expired: 0, authFailed: 0, authFailedDeleted: 0 });
    expect(emailSuppressedReceipt().sent).toBe(false);
    expect(pushSuppressedReceipt()).toMatchObject({ ok: false, sent: false });
  });
  it('rejects partial, success and empty values without throwing', () => {
    const base = emailSuppressedReceipt();
    expect(isNotificationSuppressed({ ...base, suppressed: undefined })).toBe(false);
    expect(isNotificationSuppressed({ ...base, retryable: true })).toBe(false);
    expect(isNotificationSuppressed({ ...base, reason: 'other' })).toBe(false);
    expect(isNotificationSuppressed({ ...base, status: 'sent' })).toBe(false);
    expect(isNotificationSuppressed({ status: 'suppressed' })).toBe(false);
    expect(isNotificationSuppressed({ messageId: 'x' })).toBe(false);
    expect(isNotificationSuppressed({ ok: true })).toBe(false);
    expect(isNotificationSuppressed(true)).toBe(false);
    expect(isNotificationSuppressed(null)).toBe(false);
    expect(isNotificationSuppressed(undefined)).toBe(false);
  });
});

describe('preview + flags: every public entrypoint suppressed with zero boundary calls', () => {
  const cases: Array<[string, () => Promise<unknown>, Record<string, unknown>]> = [
    ['sendNotificationEmail', () => sendNotificationEmail({ email: 'a@example.test', guestName: 'g', tourTitle: 't', planId: 'p', planUrl: '/p' }), { delivery: 'not_attempted', sent: false }],
    ['recordLeadToSheets', () => recordLeadToSheets({ email: 'a@example.test', guestName: 'g', area: 'x', styles: ['a'], pax: 1, planId: 'p' }), { write: 'not_attempted' }],
    ['sendEmail', () => sendEmail({ to: 'a@example.test', subject: 's', html: 'h', text: 't' }), { delivery: 'not_attempted', sent: false }],
    ['sendBookingConfirmation', () => sendBookingConfirmation('a@example.test', content, 'v', null, 'https://w.test', { url: 'https://m.test' }), { delivery: 'not_attempted', sent: false }],
    ['sendReviewRequest', () => sendReviewRequest('a@example.test', content), { delivery: 'not_attempted', sent: false }],
    ['sendRetargetingEmail', () => sendRetargetingEmail('a@example.test', content), { delivery: 'not_attempted', sent: false }],
    ['appendBooking', () => appendBooking({ transactionId: 'T1' }), { write: 'not_attempted' }],
    ['updateBookingStatus', () => updateBookingStatus('T1', 'x'), { write: 'not_attempted' }],
    ['sendPush', () => sendPush({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }, { title: 't', body: 'b' }), { ok: false, delivery: 'not_attempted', sent: false }],
  ];
  for (const [name, call, extra] of cases) {
    it(name, async () => {
      setFlags('preview');
      const r = await call();
      expect(r).toMatchObject({ status: 'suppressed', suppressed: true, retryable: false, reason: 'preview_policy', ...extra });
      expect(isNotificationSuppressed(r)).toBe(true);
      expect(r).not.toHaveProperty('messageId');
      expectNoBoundary();
    });
  }
  it('sendPushToUser skips the Firestore lookup', async () => {
    setFlags('preview');
    const fs = makeFirestore();
    const r = await sendPushToUser(fs, 'u1', { title: 't', body: 'b' });
    expect(r).toMatchObject({ status: 'suppressed', suppressed: true, retryable: false, reason: 'preview_policy', delivery: 'not_attempted', sent: 0, total: 0 });
    expect(isNotificationSuppressed(r)).toBe(true);
    expect(fs.collection).not.toHaveBeenCalled();
    expectNoBoundary();
  });
});

describe('production unchanged even with flags true', () => {
  it('sendEmail sends', async () => {
    setFlags('production');
    const r = await sendEmail({ to: 'a@example.test', subject: 's', html: 'h', text: 't' });
    expect(r).toEqual({ messageId: 'test-msg' });
    expect(m.checkGmailQuota).toHaveBeenCalledTimes(1);
    expect(m.sendMail).toHaveBeenCalledTimes(1);
  });
  it('sendNotificationEmail and recordLeadToSheets reach providers', async () => {
    setFlags('production');
    await sendNotificationEmail({ email: 'a@example.test', guestName: 'g', tourTitle: 't', planId: 'p', planUrl: '/p' });
    await recordLeadToSheets({ email: 'a@example.test', guestName: 'g', area: 'x', styles: ['a'], pax: 1, planId: 'p' });
    expect(m.sendMail).toHaveBeenCalledTimes(1);
    expect(m.append).toHaveBeenCalledTimes(1);
  });
  it('appendBooking keeps the original env-skip path', async () => {
    setFlags('production');
    delete process.env.GOOGLE_PRIVATE_KEY;
    await expect(appendBooking({ transactionId: '' })).rejects.toMatchObject({ skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('push sends and looks up subscriptions', async () => {
    setFlags('production');
    expect(await sendPush({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }, { title: 't', body: 'b' })).toEqual({ ok: true });
    const fs = makeFirestore();
    const r = await sendPushToUser(fs, 'u1', { title: 't', body: 'b' });
    expect(fs.collection).toHaveBeenCalledWith('push_subscriptions');
    expect(r.sent).toBe(1);
  });
});

describe('production Sheets: real append/update funcs, fake crypto signing, mocked fetch only', () => {
  it('appendBooking dedupe lookup then append returns realistic response', async () => {
    setFlags('production');
    const { importKey, sign } = fakeSheetsCreds();
    const left = routeSheets([
      { method: 'GET', url: SHEETS_PREFIX + encodeURIComponent('시트1!N:N'), body: { range: '시트1!N1:N1', majorDimension: 'ROWS', values: [['PayPal거래ID']] } },
      {
        method: 'POST',
        url: SHEETS_PREFIX + encodeURIComponent('시트1!A:R') + ':append?valueInputOption=USER_ENTERED',
        body: { spreadsheetId: 'test-sheet', tableRange: '시트1!A1:R1', updates: { spreadsheetId: 'test-sheet', updatedRange: '시트1!A2:R2', updatedRows: 1, updatedColumns: 18, updatedCells: 18 } },
        check: (init) => {
          const parsed = JSON.parse(String(init?.body)) as { values: string[][] };
          const row = parsed.values[0];
          expect(row).toHaveLength(18);
          expect(row[13]).toBe('T-NEW');
          expect(row[14]).toBe('대기');
        },
      },
    ]);
    const r = await appendBooking({ transactionId: 'T-NEW', customerName: 'g' });
    expect(left).toHaveLength(0);
    expect(r).toMatchObject({ updates: { updatedRange: '시트1!A2:R2', updatedRows: 1 } });
    expect(isNotificationSuppressed(r)).toBe(false);
    if (sign.mock.calls.length) {
      expect(importKey).toHaveBeenCalledWith('pkcs8', expect.any(Uint8Array), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
      expect(sign.mock.calls[0][0]).toBe('RSASSA-PKCS1-v1_5');
    }
    expect(m.JWT).not.toHaveBeenCalled();
  });
  it('updateBookingStatus reads rows then PUTs status column', async () => {
    setFlags('production');
    fakeSheetsCreds();
    const header = ['예약일시', '고객명', '이메일', '전화번호', '상품', '투어날짜', '출발지', '도착지', '인원', '차량', '결제금액(USD)', '원화환산', '쿠폰', 'PayPal거래ID', '상태', '드라이버', '바우처발송', '메모'];
    const dataRow = header.map((_, i) => (i === 13 ? 'T1' : i === 14 ? '대기' : ''));
    const left = routeSheets([
      { method: 'GET', url: SHEETS_PREFIX + encodeURIComponent('시트1!A:R'), body: { range: '시트1!A1:R2', majorDimension: 'ROWS', values: [header, dataRow] } },
      {
        method: 'PUT',
        url: SHEETS_PREFIX + encodeURIComponent('시트1!O2') + '?valueInputOption=USER_ENTERED',
        body: { spreadsheetId: 'test-sheet', updatedRange: '시트1!O2', updatedRows: 1, updatedColumns: 1, updatedCells: 1 },
        check: (init) => expect(JSON.parse(String(init?.body)) as unknown).toEqual({ values: [['확정']] }),
      },
    ]);
    expect(await updateBookingStatus('T1', '확정')).toBe(true);
    expect(left).toHaveLength(0);
  });
  it('default fetch mock throws on unexpected requests', async () => {
    await expect(fetch('https://example.test/x')).rejects.toThrow(/unexpected fetch/);
  });
});

describe('preview entrypoints cannot opt out via per-channel flags', () => {
  it.each([undefined, '', 'false', 'TRUE', '1', ' true'])('suppresses every channel when flags are %s', async (flag) => {
    setFlags('preview');
    for (const key of ['PREVIEW_EMAIL_SUPPRESS', 'PREVIEW_PUSH_SUPPRESS', 'PREVIEW_SHEETS_SUPPRESS']) {
      if (flag === undefined) delete process.env[key]; else process.env[key] = flag;
    }
    const receipts = [
      await sendEmail({ to: 'a@example.test', subject: 's', html: 'h', text: 't' }),
      await sendPush({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }, { title: 't', body: 'b' }),
      await sendNotificationEmail({ email: 'a@example.test', guestName: 'g', tourTitle: 't', planId: 'p', planUrl: '/p' }),
      await recordLeadToSheets({ email: 'a@example.test', guestName: 'g', area: 'x', styles: ['a'], pax: 1, planId: 'p' }),
    ];
    for (const receipt of receipts) expect(isNotificationSuppressed(receipt)).toBe(true);
    expectNoBoundary();
  });
  it('development with all flags true is never suppressed', async () => {
    setFlags('development');
    await sendEmail({ to: 'a@example.test', subject: 's', html: 'h', text: 't' });
    await sendPush({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }, { title: 't', body: 'b' });
    expect(m.sendMail).toHaveBeenCalledTimes(1);
    expect(m.sendNotification).toHaveBeenCalledTimes(1);
  });
  it('flag set but VERCEL_ENV missing preserves delivery', async () => {
    setFlags('preview');
    delete process.env.VERCEL_ENV;
    await sendPush({ endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } }, { title: 't', body: 'b' });
    expect(m.sendNotification).toHaveBeenCalledTimes(1);
  });
});
