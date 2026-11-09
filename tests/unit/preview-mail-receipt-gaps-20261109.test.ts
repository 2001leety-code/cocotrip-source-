import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isNotificationSuppressed } from '../../api/_shared/preview-notification-policy.js';

const read = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function uniqueIndex(src: string, marker: string): number {
  const at = src.indexOf(marker);
  expect(at, 'missing marker: ' + marker).toBeGreaterThan(-1);
  expect(src.indexOf(marker, at + 1), 'duplicate marker: ' + marker).toBe(-1);
  return at;
}

function between(src: string, startMarker: string, endMarker: string): string {
  const start = uniqueIndex(src, startMarker);
  const end = src.indexOf(endMarker, start);
  expect(end, 'missing end marker: ' + endMarker).toBeGreaterThan(start);
  return src.slice(start, end + endMarker.length);
}

const SUPPRESSED = Object.freeze({ status: 'suppressed', suppressed: true, reason: 'preview_policy', retryable: false });
const MALFORMED: Record<string, unknown>[] = [
  { ...SUPPRESSED, suppressed: 'true' },
  { ...SUPPRESSED, status: 'sent' },
  { ...SUPPRESSED, reason: 'preview-email-suppressed' },
  { ...SUPPRESSED, retryable: true },
  { suppressed: true, reason: 'preview_policy' },
];

const WARN_MSG = '[booking-confirm] suppression receipt persistence failed';
const WARN_CALL = "console.warn('" + WARN_MSG + "');";

type ConsoleLike = { warn: ReturnType<typeof vi.fn> };
const mockConsole = (): ConsoleLike => ({ warn: vi.fn() });

// Real source suffix after the opaque sendEmail(...) call; receipt is injected, templates never evaluated.
function changeSuffix(): (receipt: unknown, voucherAttached: boolean) => { sent: boolean; voucherAttached: boolean } & Record<string, unknown> {
  const src = read('api/_shared/booking-change-emails.js');
  expect(src).toContain("import { isNotificationSuppressed } from './preview-notification-policy.js';");
  const callAt = uniqueIndex(src, 'const receipt = await sendEmail(');
  const suffix = between(src, 'if (isNotificationSuppressed(receipt))', 'return { sent: true, voucherAttached };');
  const suffixAt = src.indexOf(suffix);
  const closeAt = src.lastIndexOf('});', suffixAt);
  expect(closeAt).toBeGreaterThan(callAt);
  expect(src.slice(closeAt + 3, suffixAt).trim()).toBe('');
  expect(src.indexOf('catch', callAt)).toBeGreaterThan(suffixAt);
  const fn = new Function('isNotificationSuppressed', 'receipt', 'voucherAttached', suffix);
  return (receipt, voucherAttached) => fn(isNotificationSuppressed, receipt, voucherAttached);
}

function confirmBody(): string {
  const src = read('api/_shared/booking-confirm.js');
  expect(src).toContain("import { isNotificationSuppressed } from './preview-notification-policy.js';");
  const body = between(src, 'if (isNotificationSuppressed(sent))', "await pendingRef.update({ confirmationEmailState: 'completed' });");
  expect(body).toContain("confirmationEmailState: 'suppressed'");
  expect(body).toContain('sent.ok !== true');
  return body;
}

// Real source fragment; console is injected as a parameter so the global console is never touched.
function confirmFragment(): (sent: unknown, pendingRef: unknown, con?: ConsoleLike) => Promise<unknown> {
  const body = confirmBody();
  const fn = new AsyncFunction('isNotificationSuppressed', 'sent', 'pendingRef', 'console', body);
  return (sent, pendingRef, con = mockConsole()) => fn(isNotificationSuppressed, sent, pendingRef, con);
}

const okRef = () => ({ update: vi.fn().mockResolvedValue(undefined) });
const badRef = () => ({ update: vi.fn().mockRejectedValue(new Error('db-down')) });

describe('booking-change-emails receipt suffix', () => {
  it('preserves the full recognized suppression receipt as not sent', () => {
    const result = changeSuffix()({ ...SUPPRESSED }, true);
    expect(result).toEqual({ ...SUPPRESSED, sent: false, voucherAttached: true });
    expect(isNotificationSuppressed(result)).toBe(true);
  });

  it('suppression takes precedence over ok:true', () => {
    const result = changeSuffix()({ ...SUPPRESSED, ok: true }, false);
    expect(result.sent).toBe(false);
    expect(isNotificationSuppressed(result)).toBe(true);
  });

  it('malformed suppression and legacy receipts keep sent:true', () => {
    const run = changeSuffix();
    const legacy: unknown[] = [{ messageId: 'm' }, undefined, null, false];
    for (const r of MALFORMED.concat(legacy as Record<string, unknown>[])) {
      expect(run(r, false)).toEqual({ sent: true, voucherAttached: false });
    }
  });
});

describe('booking-confirm receipt fragment', () => {
  it('wraps only the suppressed write in a nested try/catch with a fixed, detail-free warning', () => {
    const body = confirmBody();
    const returnAt = body.indexOf('return;');
    expect(returnAt).toBeGreaterThan(-1);
    const head = body.slice(0, returnAt);
    const tail = body.slice(returnAt);
    expect(head.split('try {').length - 1).toBe(1);
    expect(head.indexOf('try {')).toBeLessThan(head.indexOf("confirmationEmailState: 'suppressed'"));
    expect(head).toContain('} catch {');
    expect(head.indexOf('} catch {')).toBeGreaterThan(head.indexOf("confirmationEmailState: 'suppressed'"));
    expect(head).toContain(WARN_CALL);
    expect(body.split('console.').length - 1).toBe(1);
    expect(tail).not.toContain('try');
    expect(tail).not.toContain('catch');
  });

  it('persists suppressed state and returns for a recognized receipt, even with ok:true', async () => {
    const run = confirmFragment();
    for (const sent of [{ ...SUPPRESSED }, { ...SUPPRESSED, ok: true }]) {
      const ref = okRef();
      const con = mockConsole();
      await expect(run(sent, ref, con)).resolves.toBeUndefined();
      expect(ref.update).toHaveBeenCalledTimes(1);
      expect(ref.update).toHaveBeenCalledWith({ confirmationEmailState: 'suppressed' });
      expect(con.warn).not.toHaveBeenCalled();
    }
  });

  it('malformed suppression follows ordinary ok/failure semantics', async () => {
    const run = confirmFragment();
    for (const m of MALFORMED) {
      const ref = okRef();
      await run({ ...m, ok: true }, ref);
      expect(ref.update).toHaveBeenCalledWith({ confirmationEmailState: 'completed' });
      const failRef = okRef();
      await expect(run(m, failRef)).rejects.toThrow();
      expect(failRef.update).not.toHaveBeenCalled();
    }
  });

  it('ordinary success completes; failures throw without writes', async () => {
    const run = confirmFragment();
    const ref = okRef();
    const con = mockConsole();
    await run({ ok: true }, ref, con);
    expect(ref.update).toHaveBeenCalledWith({ confirmationEmailState: 'completed' });
    expect(con.warn).not.toHaveBeenCalled();
    for (const v of [undefined, null, false, { ok: 'true' }]) {
      const r = okRef();
      const c = mockConsole();
      await expect(run(v, r, c)).rejects.toThrow('send-failed');
      expect(r.update).not.toHaveBeenCalled();
      expect(c.warn).not.toHaveBeenCalled();
    }
    await expect(run({ ok: false, reason: 'smtp-rejected' }, okRef())).rejects.toThrow('smtp-rejected');
  });

  it('suppressed DB write failure resolves with one fixed warning and no completed write', async () => {
    const run = confirmFragment();
    for (const sent of [{ ...SUPPRESSED }, { ...SUPPRESSED, ok: true }]) {
      const ref = badRef();
      const con = mockConsole();
      await expect(run(sent, ref, con)).resolves.toBeUndefined();
      expect(ref.update).toHaveBeenCalledTimes(1);
      expect(ref.update).toHaveBeenCalledWith({ confirmationEmailState: 'suppressed' });
      expect(ref.update).not.toHaveBeenCalledWith({ confirmationEmailState: 'completed' });
      expect(con.warn).toHaveBeenCalledTimes(1);
      expect(con.warn.mock.calls[0]).toEqual([WARN_MSG]);
      expect(JSON.stringify(con.warn.mock.calls)).not.toContain('db-down');
    }
  });

  it('completed DB write failure still rejects to the existing caller catch without warning', async () => {
    const run = confirmFragment();
    const ref = badRef();
    const con = mockConsole();
    await expect(run({ ok: true }, ref, con)).rejects.toThrow('db-down');
    expect(ref.update).toHaveBeenCalledTimes(1);
    expect(ref.update).toHaveBeenCalledWith({ confirmationEmailState: 'completed' });
    expect(con.warn).not.toHaveBeenCalled();
  });
});

describe('api/modifyBooking.js receipt gates (read-only)', () => {
  const src = read('api/modifyBooking.js');
  const GUEST_ELSE = '} else if (!isNotificationSuppressed(mail)) {';
  const MEMBER_ELSE = '} else if (!mail.sent && !isNotificationSuppressed(mail)) {';
  const cond = (marker: string) => marker.slice('} else if ('.length, -') {'.length);

  it('imports the common predicate alongside existing imports', () => {
    expect(src).toContain("import { isPreviewSuppressed, operatorSuppressedReceipt, isNotificationSuppressed } from './_shared/preview-notification-policy.js';");
  });

  it('keeps the nested sent guard and guards both failure branches', () => {
    const guestAt = uniqueIndex(src, GUEST_ELSE);
    const memberAt = uniqueIndex(src, MEMBER_ELSE);
    const sentAt = src.lastIndexOf('if (mail.sent) {', guestAt);
    const isGuestAt = src.lastIndexOf('if (isGuest) {', sentAt);
    expect(isGuestAt).toBeGreaterThan(-1);
    expect(sentAt - isGuestAt).toBeLessThan(200);
    expect(src.slice(sentAt, guestAt)).toContain('manageLinkSentAt');
    expect(src.slice(guestAt, guestAt + 120)).toContain('throttledTelegramAlert(');
    expect(memberAt).toBeGreaterThan(guestAt);
    expect(src.slice(memberAt, memberAt + 120)).toContain('console.warn(');
  });

  it('guard conditions skip alert/warn only for recognized suppression', () => {
    const guest = new Function('isNotificationSuppressed', 'mail', 'return ' + cond(GUEST_ELSE));
    const member = new Function('isNotificationSuppressed', 'mail', 'return ' + cond(MEMBER_ELSE));
    const suppressedMail = changeSuffix()({ ...SUPPRESSED }, false);
    expect(suppressedMail.sent).toBe(false);
    expect(guest(isNotificationSuppressed, suppressedMail)).toBe(false);
    expect(member(isNotificationSuppressed, suppressedMail)).toBe(false);
    const failedMail = { sent: false, voucherAttached: false, error: new Error('x') };
    expect(guest(isNotificationSuppressed, failedMail)).toBe(true);
    expect(member(isNotificationSuppressed, failedMail)).toBe(true);
    for (const m of MALFORMED) {
      expect(guest(isNotificationSuppressed, { ...m, sent: false })).toBe(true);
    }
  });
});
