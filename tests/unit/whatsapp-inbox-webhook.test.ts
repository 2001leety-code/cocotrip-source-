import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore, makeBarrier } from '../helpers/fake-firestore.js';
import {
  extractWhatsAppInboxMessages, readWhatsAppInboxConfig, readWhatsAppInboxRawBody,
  verifyWhatsAppInboxSignature, WHATSAPP_INBOX_BODY_LIMIT,
} from '../../api/_shared/whatsapp-inbox.js';
const imports = vi.hoisted(() => ({ initialized: vi.fn(), imported: vi.fn() }));
vi.mock('../../api/_shared/firebase-admin.js', () => {
  imports.imported();
  return { initAdminDb: imports.initialized };
});
import webhook, { createWhatsAppInboxHandler } from '../../api/whatsapp-inbox-webhook.js';
import { sessionDocId, SESSION_DURATION_MS } from '../../api/_shared/whatsapp-support-sessions.js';

const NOW = Date.parse('2026-09-08T02:00:00Z');
const ENV = {
  WHATSAPP_INBOX_ENABLED: 'true', WHATSAPP_INBOX_WABA_ID: '111', WHATSAPP_INBOX_PHONE_NUMBER_ID: '222',
  WHATSAPP_INBOX_APP_SECRET: 'synthetic-app-secret-only', WHATSAPP_INBOX_VERIFY_TOKEN: 'synthetic-verify-token-only',
  WHATSAPP_INBOX_CAPTURE_START_AT: '2026-09-08T00:00:00Z', WHATSAPP_INBOX_RETENTION_DAYS: '7',
  WHATSAPP_INBOX_PRIVACY_MODE: 'explicit_sessions_v1',
};
const MESSAGE = { id: 'wamid.synthetic', from: '821012345678', timestamp: String((NOW - 1000) / 1000), type: 'text', text: { body: 'A synthetic question' } };
function payload(messages: unknown[] = [MESSAGE], waba = '111', phone = '222') {
  return { object: 'whatsapp_business_account', entry: [{ id: waba, changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { phone_number_id: phone, display_phone_number: 'do not store' },
    contacts: [{ profile: { name: 'do not store profile' } }], messages,
  } }] }] };
}
function signedRequest(body: string | Buffer = JSON.stringify(payload()), signature?: string) {
  const raw = Buffer.from(body);
  return new Request('https://example.invalid/api/whatsapp-inbox-webhook', {
    method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature || `sha256=${createHmac('sha256', ENV.WHATSAPP_INBOX_APP_SECRET).update(raw).digest('hex')}` },
  });
}
function setup(env = ENV, active = false) {
  const db = createFakeFirestore(active ? { [`whatsapp_inbox_sessions/${sessionDocId('222', MESSAGE.from)}`]: {
    policyVersion: 1, accountId: '222', sender: MESSAGE.from, status: 'active', startedAtMs: NOW - 60_000,
    expiresAtMs: NOW - 60_000 + SESSION_DURATION_MS, updatedAtMs: NOW - 60_000, closedAtMs: 0, lastStartMessageId: 'prior-explicit-start',
  } } : {});
  const loadDb = vi.fn(async () => db);
  const handler = createWhatsAppInboxHandler({ getEnv: () => env, now: () => NOW, loadDb });
  return { handler, db, loadDb };
}
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK_FORBIDDEN'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('WhatsApp mandatory company configuration', () => {
  it.each(['preview', 'development', 'staging', '', ' production '])('never receives or verifies on a non-production Vercel environment (%s)', async deployment => {
    const env = { ...ENV, VERCEL_ENV: deployment };
    expect(readWhatsAppInboxConfig(env, NOW)).toMatchObject({ enabled: false, ready: false, status: 'disabled', reason: 'PRODUCTION_ONLY' });
    const context = setup(env);
    expect((await context.handler(signedRequest())).status).toBe(503);
    const verification = new Request(`https://example.invalid/api/whatsapp-inbox-webhook?hub.mode=subscribe&hub.verify_token=${ENV.WHATSAPP_INBOX_VERIFY_TOKEN}&hub.challenge=123`);
    expect((await context.handler(verification)).status).toBe(503);
    expect(context.loadDb).not.toHaveBeenCalled();
    expect(context.db.__stats.reads).toBe(0);
    expect(context.db.__dump()).toEqual({});
  });
  it('keeps explicit production and env-free synthetic/VPS configurations available', () => {
    expect(readWhatsAppInboxConfig({ ...ENV, VERCEL_ENV: 'production' }, NOW).ready).toBe(true);
    expect(readWhatsAppInboxConfig(ENV, NOW).ready).toBe(true);
  });
  it('is OFF by default and exposes no secret in safe config', () => {
    expect(readWhatsAppInboxConfig({}, NOW)).toMatchObject({ enabled: false, ready: false, status: 'disabled' });
    const config = readWhatsAppInboxConfig(ENV, NOW);
    expect(config).toMatchObject({ enabled: true, ready: true, status: 'ready', accountId: '222', captureStartAtMs: Date.parse(ENV.WHATSAPP_INBOX_CAPTURE_START_AT), retentionDays: 7, missing: [] });
    expect(JSON.stringify(config)).not.toContain(ENV.WHATSAPP_INBOX_APP_SECRET);
    expect(JSON.stringify(config)).not.toContain(ENV.WHATSAPP_INBOX_VERIFY_TOKEN);
    expect(config).not.toHaveProperty('wabaId');
  });
  it.each(Object.keys(ENV).filter(key => key !== 'WHATSAPP_INBOX_ENABLED'))('requires %s with DB access zero when missing', async key => {
    const env = { ...ENV, [key]: '' };
    expect(readWhatsAppInboxConfig(env, NOW)).toMatchObject({ ready: false, status: 'not_configured' });
    const context = setup(env);
    expect((await context.handler(signedRequest())).status).toBe(503);
    expect(context.loadDb).not.toHaveBeenCalled();
  });
  it.each(['0', '91', '7.5', ' 7', '07'])('rejects invalid explicit retention %s', value => {
    expect(readWhatsAppInboxConfig({ ...ENV, WHATSAPP_INBOX_RETENTION_DAYS: value }, NOW).ready).toBe(false);
  });
  it.each(['2026-09-08', '2026-02-30T00:00:00Z', '2026-09-09T00:00:00Z', 'not a date'])('rejects malformed/future capture start %s', value => {
    expect(readWhatsAppInboxConfig({ ...ENV, WHATSAPP_INBOX_CAPTURE_START_AT: value }, NOW).ready).toBe(false);
  });
  it('accepts ISO UTC millisecond precision without changing its exact instant', () => {
    expect(readWhatsAppInboxConfig({ ...ENV, WHATSAPP_INBOX_CAPTURE_START_AT: '2026-09-08T00:00:00.123Z' }, NOW).captureStartAtMs).toBe(Date.parse('2026-09-08T00:00:00.123Z'));
  });
  it.each(['', 'legacy', ' explicit_sessions_v1', 'explicit_sessions_v1\n'])('requires the exact privacy mode before raw body/DB access (%j)', async mode => {
    const loadDb = vi.fn();
    const readBody = vi.fn();
    const handler = createWhatsAppInboxHandler({ getEnv: () => ({ ...ENV, WHATSAPP_INBOX_PRIVACY_MODE: mode }), now: () => NOW, loadDb, readBody });
    expect((await handler(signedRequest())).status).toBe(503);
    expect(loadDb).not.toHaveBeenCalled();
    expect(readBody).not.toHaveBeenCalled();
  });
});

describe('raw bytes and callback verification, before any database import', () => {
  it('default entrypoint leaves Firebase unimported on unsigned POST, disabled and GET verification', async () => {
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect((await webhook.fetch(new Request('https://example.invalid/api/whatsapp-inbox-webhook', { method: 'POST', body: '{}' }))).status).toBe(401);
    const request = new Request(`https://example.invalid/api/whatsapp-inbox-webhook?hub.mode=subscribe&hub.verify_token=${ENV.WHATSAPP_INBOX_VERIFY_TOKEN}&hub.challenge=123456`);
    const result = await webhook.fetch(request);
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('123456');
    expect(result.headers.get('content-type')).toContain('text/plain');
    vi.stubEnv('WHATSAPP_INBOX_ENABLED', 'false');
    expect((await webhook.fetch(signedRequest())).status).toBe(503);
    expect(imports.imported).not.toHaveBeenCalled();
    expect(imports.initialized).not.toHaveBeenCalled();
  });
  it.each(['bad-token', '', 'synthetic-verify-token-only&hub.verify_token=duplicate'])('rejects an invalid or duplicate verification token without reflecting private values', async token => {
    const context = setup();
    const result = await context.handler(new Request(`https://example.invalid/api/whatsapp-inbox-webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=123`));
    expect(result.status).toBe(403);
    expect(await result.text()).toBe('{"ok":false,"code":"VERIFICATION_FAILED"}');
    expect(context.loadDb).not.toHaveBeenCalled();
  });
  it('does not turn arbitrary challenge HTML into a response', async () => {
    const context = setup();
    const result = await context.handler(new Request(`https://example.invalid/api/whatsapp-inbox-webhook?hub.mode=subscribe&hub.verify_token=${ENV.WHATSAPP_INBOX_VERIFY_TOKEN}&hub.challenge=%3Cscript%3E`));
    expect(result.status).toBe(403);
    expect(await result.text()).not.toContain('script');
  });
  it('verifies the received pretty-printed bytes, never a reserialized object', async () => {
    const raw = JSON.stringify(payload(), null, 2);
    const canonicalSignature = `sha256=${createHmac('sha256', ENV.WHATSAPP_INBOX_APP_SECRET).update(JSON.stringify(payload())).digest('hex')}`;
    const context = setup();
    expect((await context.handler(signedRequest(raw, canonicalSignature))).status).toBe(401);
    expect(context.loadDb).not.toHaveBeenCalled();
    expect((await context.handler(signedRequest(raw))).status).toBe(200);
    expect(context.loadDb).toHaveBeenCalledTimes(1);
  });
  it('rejects parsed objects and malformed signatures rather than inventing raw bytes', () => {
    expect(verifyWhatsAppInboxSignature(payload(), 'sha256=' + '0'.repeat(64), ENV.WHATSAPP_INBOX_APP_SECRET)).toBe(false);
    expect(verifyWhatsAppInboxSignature(Buffer.from('{}'), 'sha256=short', ENV.WHATSAPP_INBOX_APP_SECRET)).toBe(false);
    expect(verifyWhatsAppInboxSignature(Buffer.from('{}'), 'sha256=' + '0'.repeat(64), 123)).toBe(false);
  });
  it('rejects malformed signed JSON without importing DB or disclosing body', async () => {
    const context = setup();
    const response = await context.handler(signedRequest('{private synthetic invalid json'));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private');
    expect(context.loadDb).not.toHaveBeenCalled();
  });
  it('rejects oversized declared and streamed body without DB access', async () => {
    const context = setup();
    const request = signedRequest();
    request.headers.set('content-length', String(WHATSAPP_INBOX_BODY_LIMIT + 1));
    expect((await context.handler(request)).status).toBe(413);
    expect((await context.handler(signedRequest(Buffer.alloc(WHATSAPP_INBOX_BODY_LIMIT + 1)))).status).toBe(413);
    expect(context.loadDb).not.toHaveBeenCalled();
  });
  it('times out a stalled raw stream and cancels it, without DB or secret logging', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream({ pull: () => new Promise(() => {}), cancel });
    const request = new Request('https://example.invalid/api/whatsapp-inbox-webhook', {
      method: 'POST', body, duplex: 'half', headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
    } as RequestInit);
    const context = setup();
    const pending = context.handler(request);
    await vi.advanceTimersByTimeAsync(5001);
    const result = await pending;
    expect(result.status).toBe(408);
    expect(await result.text()).toBe('{"ok":false,"code":"BODY_TIMEOUT"}');
    expect(cancel).toHaveBeenCalled();
    expect(context.loadDb).not.toHaveBeenCalled();
  });
  it('refuses consumed body and preserves bytes split across chunks', async () => {
    const consumed = signedRequest();
    await consumed.text();
    await expect(readWhatsAppInboxRawBody(consumed)).rejects.toThrow('RAW_BODY_UNAVAILABLE');
    const raw = Buffer.from('한글 😀');
    const body = new ReadableStream({ start(controller) { controller.enqueue(raw.subarray(0, 2)); controller.enqueue(raw.subarray(2)); controller.close(); } });
    const request = new Request('https://example.invalid', { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(await readWhatsAppInboxRawBody(request)).toEqual(raw);
  });
});

describe('pinned inbound receipts and retries', () => {
  it('valid signed private conversation without an explicit session reads only the hashed session and writes nothing', async () => {
    const context = setup();
    expect(await (await context.handler(signedRequest())).json()).toMatchObject({ code: 'NO_NEW_MESSAGES', created: 0, ignored: 1 });
    expect(context.db.__stats.reads).toBe(1);
    expect(context.db.__dump()).toEqual({});
  });
  it.each(['history', 'smb_app_state_sync', 'smb_message_echoes'])('never opens a session from historical/contact/echo field %s', async field => {
    const input = payload([{ ...MESSAGE, text: { body: 'COCOTRIP SUPPORT START' } }]);
    input.entry[0].changes[0].field = field;
    const context = setup();
    expect((await context.handler(signedRequest(JSON.stringify(input)))).status).toBe(200);
    expect(context.loadDb).not.toHaveBeenCalled();
    expect(context.db.__dump()).toEqual({});
  });
  it.each(['echo', 'is_echo', 'history', 'is_history'])('ignores explicit replay/echo metadata %s before database access', async key => {
    const context = setup();
    const input = payload([{ ...MESSAGE, [key]: true, text: { body: 'COCOTRIP SUPPORT START' } }]);
    expect((await context.handler(signedRequest(JSON.stringify(input)))).status).toBe(200);
    expect(context.loadDb).not.toHaveBeenCalled();
  });
  it('rejects stale START before loading the database and accepts only the original exact command', async () => {
    const context = setup();
    const start = { ...MESSAGE, text: { body: 'COCOTRIP SUPPORT START' }, timestamp: String((NOW - 121_000) / 1000) };
    await context.handler(signedRequest(JSON.stringify(payload([start]))));
    expect(context.loadDb).not.toHaveBeenCalled();
    for (const body of ['COCOTRIP SUPPORT START\0', 'COCOTRIP SUPPORT START\n', ' COCOTRIP SUPPORT START']) {
      await context.handler(signedRequest(JSON.stringify(payload([{ ...MESSAGE, text: { body } }]))));
      expect(context.db.__dump()).toEqual({});
    }
    const response = await context.handler(signedRequest(JSON.stringify(payload([{ ...MESSAGE, text: { body: 'COCOTRIP SUPPORT START' } }]))));
    expect(await response.json()).toMatchObject({ created: 0 });
    expect(Object.keys(context.db.__dump())).toHaveLength(1);
    expect(JSON.stringify(context.db.__dump())).not.toContain('COCOTRIP SUPPORT START');
  });
  it.each([['999', '222'], ['111', '999']])('ignores another WABA/phone (%s/%s) with DB access zero', async (waba, phone) => {
    const context = setup();
    const result = await context.handler(signedRequest(JSON.stringify(payload([MESSAGE], waba, phone))));
    expect(result.status).toBe(200);
    expect(context.loadDb).not.toHaveBeenCalled();
  });
  it('excludes pre-start, future and expired receipts before SDK access', async () => {
    const env = { ...ENV, WHATSAPP_INBOX_CAPTURE_START_AT: '2026-08-01T00:00:00Z' };
    const context = setup(env);
    const messages = [Date.parse('2026-07-31T00:00:00Z'), NOW + 1000, NOW - 8 * 86_400_000]
      .map((timestamp, index) => ({ ...MESSAGE, id: String(index), timestamp: String(timestamp / 1000) }));
    const result = await context.handler(signedRequest(JSON.stringify(payload(messages))));
    expect(result.status).toBe(200);
    expect(context.loadDb).not.toHaveBeenCalled();
  });
  it('stores text or unsupported-media kind only, not profile, raw metadata, caption or download URL', async () => {
    const context = setup(ENV, true);
    const messages = [MESSAGE, { ...MESSAGE, id: 'image-1', type: 'image', text: { body: 'do not store mismatched text' }, image: { id: 'media-token', caption: 'private caption', url: 'https://example.invalid/download' } }];
    const result = await context.handler(signedRequest(JSON.stringify(payload(messages))));
    expect(await result.json()).toMatchObject({ created: 2 });
    const values = Object.entries(context.db.__dump()).filter(([path]) => path.startsWith('external_inbox_messages/')).map(([, data]) => data);
    expect(values).toHaveLength(2);
    expect(values.find(data => data.kind === 'image').text).toBe('');
    expect(JSON.stringify(values)).not.toMatch(/profile|do not store|media-token|caption|download/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('handles duplicates within one batch and replay without refreshing lastReceived', async () => {
    const context = setup(ENV, true);
    const raw = JSON.stringify(payload([MESSAGE, MESSAGE, { ...MESSAGE, id: 'second' }]));
    expect(await (await context.handler(signedRequest(raw))).json()).toMatchObject({ created: 2, ignored: 1 });
    const original = context.db.__dump();
    expect(await (await context.handler(signedRequest(raw))).json()).toMatchObject({ created: 0, duplicate: 2 });
    expect(context.db.__dump()).toEqual(original);
  });
  it('concurrent same webhook commits one message and absorbs the competing delivery', async () => {
    const context = setup(ENV, true);
    const barrier = makeBarrier(2);
    context.db.__beforeCommit = async ({ attempt }: { attempt: number }) => { if (attempt === 1) await barrier.wait(); };
    const responses = await Promise.all([context.handler(signedRequest()), context.handler(signedRequest())]);
    const results = await Promise.all(responses.map(result => result.json()));
    expect(results.reduce((total, result) => total + result.created, 0)).toBe(1);
    expect(results.reduce((total, result) => total + result.duplicate, 0)).toBe(1);
    expect(context.db.__version('external_inbox_state/whatsapp')).toBe(1);
  });
  it('accepts 1,000 one-message updates, then safely acknowledges their full replay', async () => {
    const context = setup(ENV, true);
    const batchedPayload = { object: 'whatsapp_business_account', entry: Array.from({ length: 1000 }, (_, index) => payload([{ ...MESSAGE, id: String(index) }]).entry[0]) };
    const raw = JSON.stringify(batchedPayload);
    expect(await (await context.handler(signedRequest(raw))).json()).toMatchObject({ created: 1000, duplicate: 0 });
    expect(context.db.__stats.transactions).toBe(5);
    expect(await (await context.handler(signedRequest(raw))).json()).toMatchObject({ created: 0, duplicate: 1000 });
  });
  it('returns 503 for partial batch save failure and retries only the unsaved item', async () => {
    const context = setup(ENV, true);
    let commits = 0;
    context.db.__beforeCommit = async () => { commits += 1; if (commits === 2) throw new Error('private diagnostic body'); };
    const raw = JSON.stringify(payload(Array.from({ length: 201 }, (_, index) => ({ ...MESSAGE, id: String(index) }))));
    const failed = await context.handler(signedRequest(raw));
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe('{"ok":false,"code":"INBOX_STORAGE_FAILED"}');
    context.db.__beforeCommit = null;
    expect(await (await context.handler(signedRequest(raw))).json()).toMatchObject({ created: 1, duplicate: 200 });
    expect(Object.keys(context.db.__dump()).filter(path => path.startsWith('external_inbox_messages/'))).toHaveLength(201);
  });
  it('returns 503, not receipt success, when the database is unavailable', async () => {
    const loadDb = vi.fn(async () => { throw new Error('synthetic private details'); });
    const handler = createWhatsAppInboxHandler({ getEnv: () => ENV, now: () => NOW, loadDb });
    const result = await handler(signedRequest());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('private');
  });
  it('rejects oversized batches before any message is committed', async () => {
    const context = setup();
    const result = await context.handler(signedRequest(JSON.stringify(payload(Array.from({ length: 1001 }, (_, index) => ({ ...MESSAGE, id: String(index) }))))));
    expect(result.status).toBe(413);
    expect(context.loadDb).not.toHaveBeenCalled();
  });
  it('status-only callbacks do not count as a received inquiry or mark connection healthy', async () => {
    const context = setup();
    const result = await context.handler(signedRequest(JSON.stringify(payload([]))));
    expect(result.status).toBe(200);
    expect(context.db.__dump()).toEqual({});
    expect(context.loadDb).not.toHaveBeenCalled();
  });
  it('extractor never grants unsupported record provenance to the existing auto-reply workflow', () => {
    const extracted = extractWhatsAppInboxMessages(payload(), { config: readWhatsAppInboxConfig(ENV, NOW), wabaId: '111', nowMs: NOW });
    expect(extracted.messages[0]).not.toHaveProperty('autoAck');
    expect(extracted.messages[0]).not.toHaveProperty('eligibility');
    expect(extracted.messages[0]).not.toHaveProperty('vehicle');
  });
  it('never logs or returns private callback, message or diagnostic values', async () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const context = setup();
    const result = await context.handler(signedRequest());
    const text = await result.text();
    for (const privateValue of [ENV.WHATSAPP_INBOX_APP_SECRET, ENV.WHATSAPP_INBOX_VERIFY_TOKEN, MESSAGE.from, MESSAGE.text.body]) {
      expect(text).not.toContain(privateValue);
    }
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
