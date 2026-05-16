/**
 * PR #447 — Audit Z-H8 regression slot.
 *
 * Pre-fix: api/_send-email.js's sendEmail() had no quota tracking. Gmail
 * SMTP for free accounts is capped at 500 messages/day; on overage Gmail
 * returns "550 5.4.5 Daily user sending quota exceeded" and locks the
 * account for ~24 hours. We'd start silent-failing customer confirmation
 * emails as soon as the cap was hit; operator only learned of it from
 * accumulating doc entries in pending_email_retries (PR #439 / P63).
 *
 * Post-fix: api/_shared/gmail-quota.js exposes
 *   - checkGmailQuota()       — { ok, count, quota, warn? } | { ok:false, code:'GMAIL_QUOTA_EXCEEDED' }
 *   - incrementGmailSentCount()  — Firestore atomic +1, fires 80% warn alert
 *   - GMAIL_QUOTA_EXCEEDED       — stable error code for caller string-match
 *
 * sendEmail now pre-checks quota and throws GMAIL_QUOTA_EXCEEDED on 96%
 * overage; customer-email-trigger (PR #439) routes those into
 * pending_email_retries so the cron's daily sweep picks them up next day
 * once the counter rolls over.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sendSrc = readFileSync(
  resolve(process.cwd(), 'api/_send-email.js'),
  'utf8',
);
const helperSrc = readFileSync(
  resolve(process.cwd(), 'api/_shared/gmail-quota.js'),
  'utf8',
);
const rulesSrc = readFileSync(
  resolve(process.cwd(), 'firestore.rules'),
  'utf8',
);

describe('PR #447 Z-H8 — gmail-quota helper shape', () => {
  it('exports GMAIL_QUOTA_EXCEEDED as a stable string constant', () => {
    expect(helperSrc).toMatch(/export\s+const\s+GMAIL_QUOTA_EXCEEDED\s*=\s*['"]GMAIL_QUOTA_EXCEEDED['"]/);
  });

  it('exports checkGmailQuota + incrementGmailSentCount', () => {
    expect(helperSrc).toMatch(/export\s+async\s+function\s+checkGmailQuota/);
    expect(helperSrc).toMatch(/export\s+async\s+function\s+incrementGmailSentCount/);
  });

  it('default quota is 500 (free Gmail) with GMAIL_DAILY_QUOTA env override', () => {
    expect(helperSrc).toMatch(/DEFAULT_DAILY_QUOTA\s*=\s*500/);
    expect(helperSrc).toMatch(/process\.env\.GMAIL_DAILY_QUOTA/);
  });

  it('80% warn threshold + 96% hard-block threshold', () => {
    expect(helperSrc).toMatch(/WARN_THRESHOLD_PCT\s*=\s*80/);
    expect(helperSrc).toMatch(/HARD_BLOCK_THRESHOLD_PCT\s*=\s*96/);
  });

  it('counter doc id is YYYY-MM-DD (UTC)', () => {
    expect(helperSrc).toMatch(/toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/);
  });

  it('uses FieldValue.increment for atomic +1 (race-safe)', () => {
    expect(helperSrc).toMatch(/FieldValue\.increment\(\s*1\s*\)/);
  });

  it('fires throttledTelegramAlert at warn threshold with daily dedup key', () => {
    expect(helperSrc).toMatch(/throttledTelegramAlert\s*\(\s*\{[\s\S]*?key:\s*[`'"]gmail-quota-warn-/);
    expect(helperSrc).toMatch(/channel:\s*['"]admin['"]/);
  });

  it('fail-OPEN on Firestore unavailable (no email lockout during Firebase outage)', () => {
    // checkGmailQuota: !db → ok:true degraded:true
    expect(helperSrc).toMatch(/if\s*\(\s*!\s*db\s*\)[\s\S]*?ok:\s*true[\s\S]*?degraded:\s*true/);
  });
});

describe('PR #447 Z-H8 — _send-email wires the quota guard', () => {
  it('imports checkGmailQuota + incrementGmailSentCount + GMAIL_QUOTA_EXCEEDED', () => {
    expect(sendSrc).toMatch(
      /import\s*\{[^}]*checkGmailQuota[^}]*incrementGmailSentCount[^}]*GMAIL_QUOTA_EXCEEDED[^}]*\}\s*from\s*['"]\.\/_shared\/gmail-quota\.js['"]/,
    );
  });

  it('sendEmail pre-checks quota BEFORE sendMail (no wasted SMTP connection on overage)', () => {
    const fnIdx = sendSrc.indexOf('export async function sendEmail');
    expect(fnIdx).toBeGreaterThan(-1);
    const body = sendSrc.slice(fnIdx, fnIdx + 2000);
    const checkIdx = body.indexOf('checkGmailQuota(');
    const sendIdx = body.indexOf('transporter.sendMail(');
    expect(checkIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeLessThan(sendIdx);
  });

  it('throws an Error with code=GMAIL_QUOTA_EXCEEDED on hard-block (caller string-matches)', () => {
    expect(sendSrc).toMatch(/err\.code\s*=\s*GMAIL_QUOTA_EXCEEDED/);
    expect(sendSrc).toMatch(/throw\s+err/);
  });

  it('increments counter AFTER successful sendMail (failed sends don\'t consume quota)', () => {
    const fnIdx = sendSrc.indexOf('export async function sendEmail');
    const body = sendSrc.slice(fnIdx, fnIdx + 2000);
    const sendIdx = body.indexOf('transporter.sendMail(');
    const incrIdx = body.indexOf('incrementGmailSentCount(');
    expect(sendIdx).toBeGreaterThan(-1);
    expect(incrIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeLessThan(incrIdx);
  });

  it('increment is fire-and-forget (does not delay caller)', () => {
    expect(sendSrc).toMatch(/void\s+incrementGmailSentCount\(\)/);
  });
});

describe('PR #447 Z-H8 — Firestore rules', () => {
  it('email_send_counter collection is server-only', () => {
    expect(rulesSrc).toMatch(
      /match\s+\/email_send_counter\/\{day\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false/,
    );
  });
});
