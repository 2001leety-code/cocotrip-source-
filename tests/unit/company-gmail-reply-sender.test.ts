import { describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { buildCompanyGmailReplyRaw, createCompanyGmailSender, readCompanyGmailReplyConfig } from '../../api/_shared/company-gmail-reply-sender.js';

const NOW = 1_800_000_000_000;
const env = { VERCEL_ENV: 'production', COMPANY_GMAIL_REPLY_ENABLED: 'true', COMPANY_GMAIL_REPLY_SEND_ENABLED: 'true', COMPANY_GMAIL_REPLY_EMAIL: 'cocotripkr@gmail.com', COMPANY_GMAIL_REPLY_CLIENT_ID: 'id', COMPANY_GMAIL_REPLY_CLIENT_SECRET: 'secret', COMPANY_GMAIL_REPLY_REFRESH_TOKEN: 'refresh', COMPANY_GMAIL_INBOX_ENABLED: 'true', COMPANY_GMAIL_INBOX_EMAIL: 'cocotripkr@gmail.com', COMPANY_GMAIL_INBOX_CLIENT_ID: 'i', COMPANY_GMAIL_INBOX_CLIENT_SECRET: 's', COMPANY_GMAIL_INBOX_REFRESH_TOKEN: 'r', COMPANY_GMAIL_INBOX_CAPTURE_START_AT: '2026-01-01T00:00:00.000Z', COMPANY_GMAIL_INBOX_RETENTION_DAYS: '30' };
const envelope = { messageId: 'a'.repeat(64), channel: 'email', accountId: 'cocotripkr@gmail.com', providerMessageId: 'mail123', providerThreadId: 'thread123', consentVersion: 'consent-v1', recipient: 'guest@example.invalid', sourceAtMs: NOW - 1000, receivedAtMs: NOW - 500, expiresAtMs: NOW + 86_400_000, captureStartAtMs: NOW - 86_400_000, policy: { version: 'external-inbox-reply.v1', accountId: 'cocotripkr@gmail.com', email: { accountId: 'cocotripkr@gmail.com', contextVerified: true, singleMailbox: true, headerControls: false, autoSubmitted: false, listHeader: false, noReply: false, ambiguous: false, threadId: 'thread123', rfcMessageId: '<mail123@example.invalid>', subject: 'Travel inquiry', references: [] }, recipientVerified: true, accountVerified: true, direction: 'inbound', live: true, isEcho: false } };
const attemptId = '11111111-1111-4111-8111-111111111111';
const response = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-length': String(JSON.stringify(value).length) } });
const inbox = { ready: true, accountId: 'cocotripkr@gmail.com' };
const baseFetch = () => vi.fn(async (url: string) => url.includes('oauth2') ? response(200, { access_token: 'token', token_type: 'Bearer', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata' }) : url.includes('profile') ? response(200, { emailAddress: 'cocotripkr@gmail.com' }) : response(200, { id: 'sent1', threadId: 'thread123' }));
const decodeBase64Part = (raw: string, contentType: string) => {
  const contentStart = raw.toLowerCase().indexOf(`content-type: ${contentType.toLowerCase()}`);
  const headerEnd = contentStart < 0 ? -1 : raw.indexOf('\r\n\r\n', contentStart);
  if (headerEnd < 0 || !/Content-Transfer-Encoding:\s*base64/i.test(raw.slice(0, headerEnd))) return '';
  const remainder = raw.slice(headerEnd + 4);
  const boundary = remainder.search(/\r?\n--/);
  const encoded = boundary < 0 ? remainder : remainder.slice(0, boundary);
  return encoded ? Buffer.from(encoded.replace(/\s/g, ''), 'base64').toString('utf8') : '';
};
const decodeBase64Subject = (raw: string) => {
  const subject = raw.match(/^Subject:\s*([^\r\n]+(?:\r?\n[ \t][^\r\n]+)*)/im)?.[1]?.replace(/\r?\n[ \t]+/g, ' ') || '';
  return [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/gi)].map((part) => Buffer.from(part[1], 'base64').toString('utf8')).join('');
};

describe('company Gmail reply sender', () => {
  it.each([
    [{ ...env, VERCEL_ENV: 'preview' }, 'REPLY_DISABLED'],
    [{ ...env, COMPANY_GMAIL_REPLY_EMAIL: 'other@example.com' }, 'COMPANY_ACCOUNT_REQUIRED'],
    [{ ...env, COMPANY_GMAIL_REPLY_CLIENT_SECRET: '' }, 'SENDER_CONFIGURATION_REQUIRED'],
  ])('gates configuration', (input, reason) => expect(readCompanyGmailReplyConfig(input, inbox).reason).toBe(reason));
  it('requires inbox readiness', () => expect(readCompanyGmailReplyConfig(env, { ready: false, accountId: 'cocotripkr@gmail.com' }).reason).toBe('INBOX_CONNECTION_REQUIRED'));
  it('sends token then profile then one Gmail send', async () => {
    const fetchImpl = baseFetch(); const result = await createCompanyGmailSender({ env, fetchImpl, now: () => NOW })({ envelope, text: 'Thanks', attemptId, authorizationExpiresAtMs: NOW + 300_000, signal: new AbortController().signal });
    expect(result.status).toBe('provider_accepted'); expect(fetchImpl.mock.calls.map(call => call[0])).toEqual(['https://oauth2.googleapis.com/token', 'https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send']);
  });
  it.each([
    { scope: 'https://www.googleapis.com/auth/gmail.send', profile: 'cocotripkr@gmail.com' },
    { scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata', profile: 'other@example.com' },
  ])('blocks wrong OAuth scope or profile before send', async ({ scope, profile }) => {
    const fetchImpl = vi.fn(async (url: string) => url.includes('oauth2') ? response(200, { access_token: 'token', token_type: 'Bearer', expires_in: 3600, scope }) : response(200, { emailAddress: profile }));
    const result = await createCompanyGmailSender({ env, fetchImpl, now: () => NOW })({ envelope, text: 'Thanks', attemptId, authorizationExpiresAtMs: NOW + 300_000, signal: new AbortController().signal });
    expect(result.status).toBe('failed_pre_send'); expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining('/messages/send'), expect.anything());
  });
  it('blocks expired human approval before token exchange', async () => { const fetchImpl = baseFetch(); const result = await createCompanyGmailSender({ env, fetchImpl, now: () => NOW })({ envelope, text: 'Thanks', attemptId, authorizationExpiresAtMs: NOW, signal: new AbortController().signal }); expect(result.status).toBe('failed_pre_send'); expect(fetchImpl).not.toHaveBeenCalled(); });
  it('returns outcome_unknown for send HTTP failure and never retries', async () => { const calls: string[] = []; const fetchImpl = vi.fn(async (url: string) => { calls.push(url); return url.includes('oauth2') ? response(200, { access_token: 'token', token_type: 'Bearer', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.metadata' }) : url.includes('profile') ? response(200, { emailAddress: 'cocotripkr@gmail.com' }) : response(500, { error: 'x' }); }); const result = await createCompanyGmailSender({ env, fetchImpl, now: () => NOW })({ envelope, text: 'Thanks', attemptId, authorizationExpiresAtMs: NOW + 300_000, signal: new AbortController().signal }); expect(result.status).toBe('outcome_unknown'); expect(calls.filter(url => url.includes('/messages/send'))).toHaveLength(1); });
  it('decodes MIME with fixed sender, one recipient, reply headers and no cc/bcc', async () => { const raw = await buildCompanyGmailReplyRaw({ envelope, text: 'Body text', attemptId, nowMs: NOW }); const decoded = Buffer.from(raw, 'base64url').toString(); expect(decoded).toMatch(/From: cocotripkr@gmail.com/i); expect(decoded).toMatch(/To: guest@example.invalid/i); expect(decoded).toMatch(/In-Reply-To:/i); expect(decoded).toMatch(/References:/i); expect(decoded).toContain('Body text'); expect(decoded).not.toMatch(/^(cc|bcc):/im); });
  it('assembles a UTF-8 message with the installed Nodemailer stream transport without network access', async () => {
    const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await transporter.sendMail({
      from: 'CocoTrip <cocotripkr@gmail.com>',
      to: '손님 <guest@example.invalid>',
      subject: '예약 확인 — 여행 일정',
      text: '부산 해운대 여행 안내입니다.',
      html: '<p>예약이 확인되었습니다.</p>',
    });
    const raw = info.message.toString('utf8');
    expect(raw).toMatch(/To: =\?UTF-8\?/i);
    expect(raw).toContain('guest@example.invalid');
    expect(raw).toMatch(/Subject: =\?UTF-8\?[BQ]\?/i);
    expect(decodeBase64Part(raw, 'text/plain; charset=utf-8')).toBe('부산 해운대 여행 안내입니다.');
    expect(decodeBase64Part(raw, 'text/html; charset=utf-8')).toBe('<p>예약이 확인되었습니다.</p>');
    expect(info.envelope.to).toEqual(['guest@example.invalid']);
  });
  it('Gmail MailComposer assembles a Korean subject and body as valid UTF-8 MIME', async () => {
    const koreanEnvelope = { ...envelope, policy: { ...envelope.policy,
      email: { ...envelope.policy.email, subject: '부산 여행 문의 — 예약 확인', references: [] } } };
    const raw = Buffer.from(await buildCompanyGmailReplyRaw({ envelope: koreanEnvelope, text: '안녕하세요. 해운대 여행 안내를 보내드립니다.', attemptId, nowMs: NOW }), 'base64url').toString('utf8');
    expect(raw).toMatch(/Subject: =\?UTF-8\?[BQ]\?/i);
    expect(raw).toContain('To: guest@example.invalid');
    expect(decodeBase64Part(raw, 'text/plain; charset=utf-8')).toBe('안녕하세요. 해운대 여행 안내를 보내드립니다.');
    expect(decodeBase64Subject(raw)).toBe('부산 여행 문의 — 예약 확인');
  });
  it('does not send without an AbortSignal', async () => { const fetchImpl = baseFetch(); const result = await createCompanyGmailSender({ env, fetchImpl, now: () => NOW })({ envelope, text: 'Thanks', attemptId, authorizationExpiresAtMs: NOW + 300_000 }); expect(result.status).toBe('failed_pre_send'); expect(fetchImpl).not.toHaveBeenCalled(); });
});
