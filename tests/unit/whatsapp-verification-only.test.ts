import { describe, it, expect, vi } from 'vitest';
import { createWhatsAppInboxHandler } from '../../api/whatsapp-inbox-webhook.js';

// Spark drafted the case matrix; root aligned the factory/time contract and exact error codes.
const BASE = {
  WHATSAPP_INBOX_VERIFICATION_ENABLED: 'true', VERCEL_ENV: 'production',
  WHATSAPP_INBOX_VERIFY_TOKEN: 'synthetic-only', WHATSAPP_INBOX_ENABLED: 'false',
};
const QUERY = '?hub.mode=subscribe&hub.verify_token=synthetic-only&hub.challenge=123';
function buildHandler(envOverrides: Record<string, string | undefined> = {}) {
  const env = { ...BASE, ...envOverrides };
  const loadDb = vi.fn(async () => { throw new Error('DATABASE_FORBIDDEN'); });
  const readBody = vi.fn(async () => { throw new Error('BODY_FORBIDDEN'); });
  const handler = createWhatsAppInboxHandler({
    getEnv: () => env, now: () => Date.parse('2026-09-13T00:00:00Z'), loadDb, readBody,
  });
  return { handler, loadDb, readBody };
}
async function run(env: Record<string, string | undefined> = {}, query = QUERY, method = 'GET') {
  const context = buildHandler(env);
  const response = await context.handler(new Request(`https://example.invalid/api/whatsapp-inbox-webhook${query}`, { method }));
  expect(context.loadDb).not.toHaveBeenCalled();
  expect(context.readBody).not.toHaveBeenCalled();
  expect(response.headers.get('cache-control')).toBe('no-store');
  return response;
}

describe('WhatsApp verification without inbox activation', () => {
  it('returns a plain challenge with inbox OFF and no account, retention, app secret or privacy configuration', async () => {
    const result = await run();
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('123');
    expect(result.headers.get('content-type')).toContain('text/plain');
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it.each(['preview', 'development', 'staging', '', ' production '])('never verifies outside production (%j)', async deployment => {
    const result = await run({ VERCEL_ENV: deployment });
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false, code: 'INBOX_DISABLED' });
  });

  it.each([undefined, '', 'TRUE', '1', 'true ', ' true'])('requires the exact explicit flag (%j)', async flag => {
    const result = await run({ WHATSAPP_INBOX_VERIFICATION_ENABLED: flag });
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false, code: 'INBOX_DISABLED' });
  });

  it.each([undefined, '', '   ', 'synthetic-only\n'])('requires a valid configured verification token (%j)', async token => {
    const result = await run({ WHATSAPP_INBOX_VERIFY_TOKEN: token });
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false, code: 'INBOX_NOT_CONFIGURED' });
  });

  it.each([
    '?hub.mode=subscribe&hub.verify_token=bad-token&hub.challenge=123',
    '?hub.mode=subscribe&hub.challenge=123',
    QUERY + '&hub.verify_token=other',
    QUERY + '&hub.mode=subscribe',
    QUERY + '&hub.challenge=456',
    '?hub.mode=subscribe&hub.verify_token=synthetic-only&hub.challenge=%3Cscript%3E',
    '?hub.mode=unsubscribe&hub.verify_token=synthetic-only&hub.challenge=123',
  ])('rejects invalid/duplicate callback parameters without reflection (%s)', async query => {
    const result = await run({}, query);
    expect(result.status).toBe(403);
    expect(await result.json()).toEqual({ ok: false, code: 'VERIFICATION_FAILED' });
  });

  it.each(['PUT', 'DELETE', 'PATCH', 'HEAD'])('rejects unsupported method %s before any body or database access', async method => {
    const result = await run({}, QUERY, method);
    expect(result.status).toBe(405);
    expect(await result.json()).toEqual({ ok: false, code: 'METHOD_NOT_ALLOWED' });
  });

  it.each([['false', 'INBOX_DISABLED'], ['true', 'INBOX_NOT_CONFIGURED']])('does not bypass POST enablement/configuration (%s)', async (enabled, code) => {
    const result = await run({ WHATSAPP_INBOX_ENABLED: enabled }, QUERY, 'POST');
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false, code });
  });

  it('retains env-free isolated/self-host compatibility without enabling POST', async () => {
    const result = await run({ VERCEL_ENV: undefined });
    expect(result.status).toBe(200);
    expect(await result.text()).toBe('123');
    expect((await run({ VERCEL_ENV: undefined }, QUERY, 'POST')).status).toBe(503);
  });
});
