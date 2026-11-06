import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from './preview-auth-preflight.mjs';

const env = { BASE_URL: 'https://cocotrip-planner-qa-20261105-2001leety.vercel.app',
  FIREBASE_WEB_API_KEY: 'example-key', HEALTH_CHECK_EMAIL: 'fixture@example.test',
  HEALTH_CHECK_PASSWORD: 'example-secret' };
const claims = { aud: 'cocotrip-preview-2026', iss: 'https://securetoken.google.com/cocotrip-preview-2026',
  exp: 2000000000, email_verified: true, email: env.HEALTH_CHECK_EMAIL };
const token = (overrides = {}) => 'x.' + Buffer.from(JSON.stringify({ ...claims, ...overrides })).toString('base64url') + '.x';
const reply = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('production origin stops before any network or credential use', async () => {
  const result = await preflight({ ...env, BASE_URL: 'https://cocotripkr.com' }, () => assert.fail('network'));
  assert.equal(result.code, 'EXACT_QA_ORIGIN_REQUIRED');
});
test('missing normal login configuration stops without a default account', async () => {
  const result = await preflight({ ...env, HEALTH_CHECK_PASSWORD: '' }, () => assert.fail('network'));
  assert.equal(result.code, 'EXISTING_PREVIEW_LOGIN_CONFIGURATION_MISSING');
});
test('different Firebase project cannot reach the application', async () => {
  let calls = 0;
  const result = await preflight(env, async () => { calls++; return reply(200, { idToken: token({ aud: 'production-project' }) }); });
  assert.equal(calls, 1);
  assert.equal(result.code, 'PREVIEW_TOKEN_PROJECT_MISMATCH');
});
test('server permission denial stops before Firestore or generation', async () => {
  const calls = [];
  const result = await preflight(env, async (url, options) => {
    calls.push([url, options.method]);
    return calls.length === 1 ? reply(200, { idToken: token() }) : reply(403);
  });
  assert.equal(result.code, 'AUTHENTICATED_ADMIN_READ_NOT_CONFIRMED');
  assert.equal(calls.length, 2);
  assert.ok(calls[1][0].endsWith('/api/admin-operational-checks'));
});
test('successful check uses only normal login and two read endpoints', async () => {
  const calls = [];
  const result = await preflight(env, async (url, options) => {
    calls.push([url, options]);
    if (calls.length === 1) return reply(200, { idToken: token() });
    if (calls.length === 2) return reply(200, { ok: true, data: {} });
    return reply(200, { name: 'projects/cocotrip-preview-2026/databases/(default)/documents/zone_courses/TEST_CLAUDE_20261105_JONGNO_01' });
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map(([, o]) => o.method), ['POST', 'GET', 'GET']);
  assert.equal(result.generationPermission, 'not_checked');
  const output = JSON.stringify(result);
  for (const secret of [env.HEALTH_CHECK_EMAIL, env.HEALTH_CHECK_PASSWORD, env.FIREBASE_WEB_API_KEY, token()]) {
    assert.equal(output.includes(secret), false);
  }
});
test('HTTP200 without the actual admin contract cannot pass readiness', async () => {
  let calls = 0;
  const result = await preflight(env, async () => {
    calls++;
    return calls === 1 ? reply(200, { idToken: token() }) : reply(200, { ok: false });
  });
  assert.equal(result.code, 'ADMIN_READ_RESPONSE_NOT_CONFIRMED');
  assert.equal(calls, 2);
});
