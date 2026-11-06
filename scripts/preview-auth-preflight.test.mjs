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

test('existing deployment credential is sent only to the exact QA host', async () => {
  const secret = 'example-deployment-access';
  const calls = [];
  const result = await preflight({ ...env, VERCEL_AUTOMATION_BYPASS_SECRET: secret }, async (url, options) => {
    calls.push([url, options]);
    if (calls.length === 1) return reply(200, { idToken: token() });
    if (calls.length === 2) return reply(200, { ok: true, data: {} });
    return reply(404);
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0][1].headers['x-vercel-protection-bypass'], undefined);
  assert.equal(calls[1][0], env.BASE_URL + '/api/admin-operational-checks');
  assert.equal(calls[1][1].headers['x-vercel-protection-bypass'], secret);
  assert.equal(calls[2][1].headers['x-vercel-protection-bypass'], undefined);
  assert.equal(JSON.stringify(result).includes(secret), false);
});
test('malformed deployment credential stops before normal login', async () => {
  const result = await preflight({ ...env, VERCEL_AUTOMATION_BYPASS_SECRET: 'bad\r\nheader' }, () => assert.fail('network'));
  assert.equal(result.code, 'INVALID_EXISTING_DEPLOYMENT_CREDENTIAL');
});

test('identity-only diagnostic never retries the forbidden admin resource', async () => {
  const calls = [];
  const result = await preflight({ ...env, VERCEL_AUTOMATION_BYPASS_SECRET: 'example-deployment-access' }, async (url, options) => {
    calls.push([url, options]);
    assert.equal(url.includes('/api/admin-operational-checks'), false);
    if (calls.length === 1) return reply(200, { idToken: token() });
    if (calls.length === 2) return reply(200);
    return reply(404);
  }, Date.now, { identityOnly: true });
  assert.equal(result.ok, true);
  assert.equal(result.adminRequestSkipped, true);
  assert.equal(result.tokenAdminClaim, false);
  assert.equal(result.matchesKnownOperatorEmail, false);
  assert.equal(result.qaRootHttp, 200);
  assert.equal(calls[1][0], env.BASE_URL + '/');
  assert.equal(calls[1][1].headers.Authorization, undefined);
  assert.equal(calls[2][1].headers['x-vercel-protection-bypass'], undefined);
  assert.equal(JSON.stringify(result).includes(env.HEALTH_CHECK_EMAIL), false);
});
test('identity-only root denial stops without trying any privileged route', async () => {
  let calls = 0;
  const result = await preflight(env, async () => {
    calls++;
    return calls === 1 ? reply(200, { idToken: token() }) : reply(403);
  }, Date.now, { identityOnly: true });
  assert.equal(result.code, 'QA_ROOT_ACCESS_NOT_CONFIRMED');
  assert.equal(calls, 2);
});

test('ordinary seven-day meal precheck does not call denied admin or full generator', async () => {
  const calls = [];
  const fixtureSecret = 'example-deployment-access';
  const result = await preflight({ ...env, VERCEL_AUTOMATION_BYPASS_SECRET: fixtureSecret }, async (url, options) => {
    calls.push([url, options]);
    assert.equal(url.includes('/api/admin-operational-checks'), false);
    assert.equal(url.includes('/api/ai-planner-full'), false);
    if (calls.length === 1) return reply(200, { idToken: token() });
    return { ...reply(200, { ok: true, status: 'opening_unconfirmed', draftId: 'private-draft-id', fingerprint: 'private-proof', revision: 'private-revision', referenceMeals: [{}, {}] }), headers: { get: () => 'example-request-id' } };
  }, Date.now, { mealOnly: true });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][0], env.BASE_URL + '/api/meal-plan-draft');
  assert.equal(calls[1][1].headers['x-vercel-protection-bypass'], fixtureSecret);
  assert.equal(calls[1][1].signal.aborted, false);
  const sent = JSON.parse(calls[1][1].body);
  assert.equal(sent.input.durationDays, 7);
  assert.equal(sent.input.pax, 2);
  assert.equal(sent.input.special_request.startsWith('TEST ONLY'), true);
  assert.deepEqual(sent.input.dietaryRestrictions, []);
  assert.equal(result.mealDraftSaved, true);
  assert.equal(result.modelCalls, 0);
  assert.equal(result.planWrites, 0);
  const output = JSON.stringify(result);
  for (const value of [fixtureSecret, 'private-draft-id', 'private-proof', 'private-revision', env.HEALTH_CHECK_EMAIL]) assert.equal(output.includes(value), false);
});
test('route-budget business failure is recorded and never retried', async () => {
  let calls = 0;
  const result = await preflight(env, async () => {
    calls++;
    if (calls === 1) return reply(200, { idToken: token() });
    return reply(200, { ok: true, status: 'route_failed', reason: 'MEAL_ROUTE_BUDGET_EXHAUSTED' });
  }, Date.now, { mealOnly: true });
  assert.equal(result.ok, false);
  assert.equal(result.mealReason, 'MEAL_ROUTE_BUDGET_EXHAUSTED');
  assert.equal(calls, 2);
});

const previewBody = { ok: true, data: { marketingNarrative: 'Example preview narrative', themes: ['culture'], spotDetails: [{}, {}, {}], day1MarkdownTable: '| Time | Place |\n|---|---|\n|09:00|A|\n|12:00|B|\n|15:00|C|' } };
test('quick series makes one request per duration and records Day1 separately', async () => {
  const calls = [], progress = [];
  const result = await preflight({ ...env, VERCEL_AUTOMATION_BYPASS_SECRET: 'example-deployment-access' }, async (url, options) => {
    calls.push([url, options]);
    assert.equal(url.includes('/api/ai-planner-full'), false);
    assert.equal(url.includes('/api/meal-plan-draft'), false);
    assert.equal(url.includes('/api/admin-operational-checks'), false);
    if (calls.length === 1) return reply(200, { idToken: token() });
    return reply(200, previewBody);
  }, Date.now, { quickSeries: true, onProgress: (value) => progress.push(value) });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 10);
  assert.deepEqual(result.cases.map((entry) => entry.days), [7,8,9,10,11,12,13,14,15]);
  assert.deepEqual(result.cases.map((entry) => entry.previewDaysGenerated), Array(9).fill(1));
  assert.equal(result.cases.every((entry) => entry.tableDataRows === 3), true);
  assert.equal(result.cases[0].endDate, '2026-11-25');
  assert.equal(result.cases[8].endDate, '2026-12-03');
  assert.equal(progress[0].cases[0].status, 'requested_outcome_unconfirmed');
  for (const [url, options] of calls.slice(1)) {
    assert.equal(url, env.BASE_URL + '/api/ai-planner-quick');
    assert.equal(options.headers.Origin, env.BASE_URL);
    assert.equal(options.headers['x-vercel-protection-bypass'], 'example-deployment-access');
    assert.equal(JSON.parse(options.body).special_request.startsWith('TEST ONLY'), true);
  }
  for (const privateValue of [env.HEALTH_CHECK_EMAIL, env.HEALTH_CHECK_PASSWORD, token(), 'example-deployment-access']) assert.equal(JSON.stringify(result).includes(privateValue), false);
});
test('quick series stops on rate rejection without changing identity or retrying', async () => {
  let calls = 0;
  const result = await preflight(env, async () => {
    calls++;
    return calls === 1 ? reply(200, { idToken: token() }) : reply(429);
  }, Date.now, { quickSeries: true });
  assert.equal(calls, 2);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].status, 'http_rejected_no_retry');
  assert.equal(result.ok, false);
});
test('unknown preview network outcome is recorded and never resent', async () => {
  let calls = 0;
  const result = await preflight(env, async () => {
    calls++;
    if (calls === 1) return reply(200, { idToken: token() });
    throw new Error('private-response-content');
  }, Date.now, { quickSeries: true });
  assert.equal(calls, 2);
  assert.equal(result.cases[0].status, 'requested_outcome_unconfirmed');
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes('private-response-content'), false);
});
