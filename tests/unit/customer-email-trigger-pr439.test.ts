/**
 * PR #439 — Audit Z-H16 regression slot.
 *
 * Pre-fix: api/_shared/booking-confirm.js called sendCustomerConfirmEmail
 * with `.catch(() => {})`. The inner function logged errors to stderr but
 * NO operator alert, NO retry. User saw "결제 확정" in the app, never got
 * the confirmation email, then asked support "did my payment go through?".
 *
 * Post-fix: api/_shared/customer-email-trigger.js exposes
 * `sendCustomerEmailWithAlert({ db, to, subject, html, text, context })`
 * which on failure:
 *   - writes pending_email_retries/{autoId} (payload + attempts counter)
 *   - fires Telegram booking-channel alert
 *   - always resolves (caller fire-and-forget safe)
 *
 * Cron `email-retry-sweep` (every 5min) retries up to MAX_ATTEMPTS=5,
 * then escalates to manual-intervention. Sister to processor-retry-sweep
 * (PR #436 / P60).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const helperSrc = readFileSync(
  resolve(process.cwd(), 'api/_shared/customer-email-trigger.js'),
  'utf8',
);
const confirmSrc = readFileSync(
  resolve(process.cwd(), 'api/_shared/booking-confirm.js'),
  'utf8',
);
const cronSrc = readFileSync(
  resolve(process.cwd(), 'api/_crons/email-retry-sweep.js'),
  'utf8',
);
const cronRunnerSrc = readFileSync(
  resolve(process.cwd(), 'api/cron-runner.js'),
  'utf8',
);
const vercelJsonSrc = readFileSync(
  resolve(process.cwd(), 'vercel.json'),
  'utf8',
);
const rulesSrc = readFileSync(
  resolve(process.cwd(), 'firestore.rules'),
  'utf8',
);

describe('PR #439 Z-H16 — sendCustomerEmailWithAlert behavior', () => {
  let savedSendEmail: any;
  let savedNotify: any;

  beforeEach(() => {
    // these mocks are reset between tests
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeDbMock() {
    const persisted: any[] = [];
    return {
      collection: vi.fn(() => ({
        add: vi.fn(async (data: any) => { persisted.push(data); }),
      })),
      _persisted: persisted,
    };
  }

  it('returns ok and does NOT persist a retry on success', async () => {
    vi.doMock('../../api/_send-email.js', () => ({
      sendEmail: vi.fn(async () => undefined),
    }));
    vi.doMock('../../api/_shared/notify.js', () => ({
      notify: vi.fn(async () => undefined),
    }));
    const mod = await import('../../api/_shared/customer-email-trigger.js?ok=1');
    const db = makeDbMock();
    const r = await mod.sendCustomerEmailWithAlert({
      db: db as any,
      to: 'a@b.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(r.ok).toBe(true);
    expect(db._persisted.length).toBe(0);
  });

  it('persists retry doc + invokes notify when sendEmail throws (silent-loss regression guard)', async () => {
    vi.doMock('../../api/_send-email.js', () => ({
      sendEmail: vi.fn(async () => { throw new Error('SMTP 421 quota'); }),
    }));
    const notifyMock = vi.fn(async () => undefined);
    vi.doMock('../../api/_shared/notify.js', () => ({ notify: notifyMock }));
    const mod = await import('../../api/_shared/customer-email-trigger.js?fail=1');
    const db = makeDbMock();
    const r = await mod.sendCustomerEmailWithAlert({
      db: db as any,
      to: 'lost@user.com',
      subject: 'Confirmation',
      html: '<p>hi</p>',
      text: 'hi',
      context: { bookingRef: 'CT-X-001', emailType: 'manual-payment-confirmed' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/SMTP 421 quota/);
    expect(db._persisted.length).toBe(1);
    expect(db._persisted[0].status).toBe('pending');
    expect(db._persisted[0].to).toBe('lost@user.com');
    expect(db._persisted[0].context.bookingRef).toBe('CT-X-001');
    expect(notifyMock).toHaveBeenCalledWith('booking', expect.stringContaining('고객 이메일 발송 실패'));
  });

  it('returns ok=false on invalid args (never throws — caller stays fire-and-forget safe)', async () => {
    const mod = await import('../../api/_shared/customer-email-trigger.js?args=1');
    const r1 = await mod.sendCustomerEmailWithAlert({ db: null, to: '', subject: 'x' } as any);
    expect(r1.ok).toBe(false);
    const r2 = await mod.sendCustomerEmailWithAlert({ db: null, to: 'a@b.com', subject: '' } as any);
    expect(r2.ok).toBe(false);
  });

  it('exports the retry-queue collection name as a stable constant', async () => {
    const mod = await import('../../api/_shared/customer-email-trigger.js?const=1');
    expect(mod.PENDING_EMAIL_RETRIES_COLLECTION).toBe('pending_email_retries');
  });
});

describe('PR #439 Z-H16 — wire-up across booking-confirm + cron + infra', () => {
  it('booking-confirm imports the helper and uses it (NOT raw .catch(()=>{}))', () => {
    expect(confirmSrc).toMatch(
      /import\s*\{[^}]*sendCustomerEmailWithAlert[^}]*\}\s*from\s*['"]\.\/customer-email-trigger\.js['"]/,
    );
    expect(confirmSrc).toMatch(/sendCustomerEmailWithAlert\s*\(/);
    // The original silent-loss line was:
    //   sendCustomerConfirmEmail(pending).catch(() => {});
    // Must be replaced — guard the .catch(() => {}) pattern on the confirm fn.
    expect(confirmSrc).not.toMatch(/sendCustomerConfirmEmail\s*\([^)]*\)\.\s*catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/);
  });

  it('cron-runner registers email-retry-sweep job', () => {
    expect(cronRunnerSrc).toMatch(/['"]email-retry-sweep['"]\s*:\s*emailRetrySweep/);
  });

  it('vercel.json schedules email-retry-sweep every 5 minutes', () => {
    const json = JSON.parse(vercelJsonSrc);
    const cron = json.crons.find((c: any) => c.path?.includes('email-retry-sweep'));
    expect(cron, 'email-retry-sweep cron must be registered').toBeTruthy();
    expect(cron.schedule).toBe('*/5 * * * *');
  });

  it('firestore.rules locks down pending_email_retries (server-only)', () => {
    expect(rulesSrc).toMatch(
      /match\s+\/pending_email_retries\/\{retryId\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false/,
    );
  });

  it('cron sweep escalates after MAX_ATTEMPTS=5 and notifies operator', () => {
    expect(cronSrc).toMatch(/MAX_ATTEMPTS\s*=\s*5/);
    expect(cronSrc).toMatch(/manual-intervention/);
    expect(cronSrc).toMatch(/notify\s*\(\s*['"]booking['"]/);
  });

  it('helper shape: notify on failure + persist with attempts counter', () => {
    expect(helperSrc).toMatch(/notify\s*\(\s*['"]booking['"]/);
    expect(helperSrc).toMatch(/attempts:\s*0/);
    expect(helperSrc).toMatch(/status:\s*['"]pending['"]/);
  });
});
