import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWhatsAppReplySender, readWhatsAppReplyConfig } from '../../api/_shared/whatsapp-reply-sender.js';
import { readWhatsAppInboxConfig } from '../../api/_shared/whatsapp-inbox.js';
import { sessionDocId } from '../../api/_shared/whatsapp-support-sessions.js';

const NOW = Date.parse('2026-09-14T00:00:00Z');
const ACCOUNT = '1234567890';
const RECIPIENT = '821012345678';
const KEY = '12345678-1234-4234-8234-123456789abc';
const env = { VERCEL_ENV: 'production', WHATSAPP_INBOX_ENABLED: 'true',
  WHATSAPP_INBOX_PRIVACY_MODE: 'explicit_sessions_v1', WHATSAPP_INBOX_WABA_ID: '9876543210',
  WHATSAPP_INBOX_PHONE_NUMBER_ID: ACCOUNT, WHATSAPP_INBOX_APP_SECRET: 'synthetic-secret',
  WHATSAPP_INBOX_VERIFY_TOKEN: 'synthetic-verify', WHATSAPP_INBOX_CAPTURE_START_AT: '2026-09-01T00:00:00Z',
  WHATSAPP_INBOX_RETENTION_DAYS: '30', WHATSAPP_REPLY_ENABLED: 'true', WHATSAPP_REPLY_SEND_ENABLED: 'true',
  WHATSAPP_REPLY_ACCESS_TOKEN: 'synthetic-access-token-value' };
const config = (overrides = {}) => {
  const next = { ...env, ...overrides };
  return readWhatsAppReplyConfig(next, readWhatsAppInboxConfig(next, NOW));
};
function payload() {
  return { text: 'Synthetic reply\nThank you.', attemptId: KEY, authorizationExpiresAtMs: NOW + 300_000,
    signal: new AbortController().signal,
    envelope: { messageId: 'a'.repeat(64), channel: 'whatsapp', accountId: ACCOUNT, recipient: RECIPIENT,
      providerMessageId: 'wamid.synthetic-source', sourceAtMs: NOW - 1000, receivedAtMs: NOW,
      captureStartAtMs: NOW - 86_400_000, expiresAtMs: 0, consentVersion: 'whatsapp-explicit-reply.v2',
      policy: { version: 'external-inbox-reply.v1', accountId: ACCOUNT, accountVerified: true,
        recipientVerified: true, direction: 'inbound', live: true, isEcho: false,
        retention: { policyVersion: 2, caseId: 'b'.repeat(64), revision: 1, status: 'open', deleteAfterMs: 0 },
        whatsapp: { windowVerified: true, stopped: false, blocked: false, sessionId: sessionDocId(ACCOUNT, RECIPIENT),
          lastCustomerAtMs: NOW - 1000, session: { policyVersion: 1, accountId: ACCOUNT, sender: RECIPIENT,
            status: 'active', startedAtMs: NOW - 60_000, expiresAtMs: NOW - 60_000 + 7_200_000,
            updatedAtMs: NOW - 60_000, closedAtMs: 0, lastStartMessageId: 'wamid.synthetic-start' } } } } };
}
const receipt = { messaging_product: 'whatsapp', contacts: [{ input: RECIPIENT, wa_id: RECIPIENT }],
  messages: [{ id: 'wamid.synthetic-accepted' }] };
const response = (data = receipt, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => vi.useRealTimers());

describe('WhatsApp manual reply sender', () => {
  it.each([{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: undefined }, { WHATSAPP_REPLY_ENABLED: 'false' },
    { WHATSAPP_REPLY_ENABLED: ' true ' }, { WHATSAPP_INBOX_ENABLED: 'false' },
    { WHATSAPP_INBOX_PRIVACY_MODE: 'all' }, { WHATSAPP_REPLY_SEND_ENABLED: 'false' },
    { WHATSAPP_REPLY_ACCESS_TOKEN: '' }, { WHATSAPP_REPLY_ACCESS_TOKEN: 'bad\ntoken' }])('keeps invalid/off config outside network %#', async patch => {
    const fetchImpl = vi.fn();
    expect(config(patch).dispatchEnabled).toBe(false);
    expect(await createWhatsAppReplySender({ env: { ...env, ...patch }, now: () => NOW, fetchImpl })(payload()))
      .toEqual({ status: 'failed_pre_send', preSendVerified: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('permits drafts without send credentials but never reports a verified connection', () => {
    const result = config({ WHATSAPP_REPLY_ACCESS_TOKEN: '', WHATSAPP_REPLY_SEND_ENABLED: 'false' });
    expect(result).toMatchObject({ replyEnabled: true, dispatchEnabled: false, reason: 'DISPATCH_DISABLED' });
    expect(JSON.stringify(config())).not.toContain(env.WHATSAPP_REPLY_ACCESS_TOKEN);
  });
  it('sends the exact bound plain-text reply to the fixed official endpoint once', async () => {
    const fetchImpl = vi.fn(async () => response());
    const result = await createWhatsAppReplySender({ env, now: () => NOW, fetchImpl })(payload());
    expect(result).toEqual({ status: 'provider_accepted', receiptVerified: true, providerMessageId: 'wamid.synthetic-accepted' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(`https://graph.facebook.com/v26.0/${ACCOUNT}/messages`);
    expect(call[1]).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store' });
    expect(JSON.parse(String(call[1].body))).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual',
      to: RECIPIENT, context: { message_id: 'wamid.synthetic-source' }, type: 'text',
      text: { preview_url: false, body: payload().text } });
  });
  it.each(['expired', 'stopped', 'other-account', 'changed-recipient', 'bad-context', 'bad-key', 'aborted'])('blocks %s before send', async scenario => {
    const input = payload();
    if (scenario === 'expired') input.authorizationExpiresAtMs = NOW;
    if (scenario === 'stopped') input.envelope.policy.whatsapp.stopped = true;
    if (scenario === 'other-account') input.envelope.accountId = '999999999';
    if (scenario === 'changed-recipient') input.envelope.recipient = '821012345679';
    if (scenario === 'bad-context') input.envelope.providerMessageId = 'invalid';
    if (scenario === 'bad-key') input.attemptId = 'invalid';
    if (scenario === 'aborted') { const controller = new AbortController(); controller.abort(); input.signal = controller.signal; }
    const fetchImpl = vi.fn();
    expect(await createWhatsAppReplySender({ env, now: () => NOW, fetchImpl })(input)).toEqual({ status: 'failed_pre_send', preSendVerified: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['reject', 'http-error', 'malformed', 'oversized', 'mismatch'])('quarantines %s after an attempted send with no retry', async scenario => {
    const fetchImpl = vi.fn(async () => {
      if (scenario === 'reject') throw new Error('synthetic provider error');
      if (scenario === 'http-error') return response(receipt, 429);
      if (scenario === 'malformed') return new Response('not-json');
      if (scenario === 'oversized') return new Response('x'.repeat(32 * 1024 + 1));
      return response({ ...receipt, contacts: [{ input: RECIPIENT, wa_id: '821012345679' }] });
    });
    expect(await createWhatsAppReplySender({ env, now: () => NOW, fetchImpl })(payload())).toEqual({ status: 'outcome_unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('aborts an in-flight request at the approval deadline, never reclassifying it as safe retry', async () => {
    vi.useFakeTimers();
    const input = payload(); input.authorizationExpiresAtMs = NOW + 50;
    const fetchImpl = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const sent = createWhatsAppReplySender({ env, now: () => NOW, fetchImpl })(input);
    await vi.advanceTimersByTimeAsync(50);
    expect(await sent).toEqual({ status: 'outcome_unknown' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
