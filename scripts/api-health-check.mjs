import { pathToFileURL } from 'node:url';

export const REQUIRED_ADMIN_SOURCES = Object.freeze([
  'bookings',
  'pending_bookings',
  'mood_bookings',
  'charter_inquiries',
  'pending_free_claims',
  'cs_tickets',
  'payment_reviews',
  'decision_queue',
  'runtime_flags',
  'pending_processor_retries',
  'pending_email_retries',
  'pending_ai_planner_retries',
]);

const ROUTES = Object.freeze([
  '/',
  '/about',
  '/charter',
  '/tours',
  '/planner',
  '/tours/seoul-night',
]);

const SW_MARKERS = Object.freeze([
  'addEventListener("push"',
  'showNotification',
  'notificationclick',
]);

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeSourceKeys(values) {
  if (!Array.isArray(values)) return [];
  const allowed = new Set(REQUIRED_ADMIN_SOURCES);
  return [...new Set(values.filter((value) => typeof value === 'string' && allowed.has(value)))].sort();
}

export function validateAdminOpsPayload(payload) {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.data)) {
    return { ok: false, reason: 'invalid success envelope' };
  }

  const partialErrors = payload.data.partialErrors;
  if (!Array.isArray(partialErrors)) {
    return { ok: false, reason: 'partialErrors is not an array' };
  }
  if (partialErrors.length > 0) {
    const failed = safeSourceKeys(partialErrors);
    return {
      ok: false,
      reason: failed.length ? `source failure: ${failed.join(',')}` : 'source failure',
    };
  }

  const sources = payload.data.sources;
  if (!Array.isArray(sources)) {
    return { ok: false, reason: 'sources is not an array' };
  }

  const actualKeys = sources.map((source) => (isRecord(source) ? source.key : null));
  const expectedSorted = [...REQUIRED_ADMIN_SOURCES].sort();
  const actualSorted = actualKeys.filter((key) => typeof key === 'string').sort();
  const exactSourceSet = actualSorted.length === expectedSorted.length
    && actualSorted.every((key, index) => key === expectedSorted[index]);
  if (!exactSourceSet) {
    const actualSet = new Set(actualSorted);
    const missing = REQUIRED_ADMIN_SOURCES.filter((key) => !actualSet.has(key));
    return {
      ok: false,
      reason: missing.length ? `source set mismatch; missing: ${missing.join(',')}` : 'source set mismatch',
    };
  }

  const failedSources = sources
    .filter((source) => !isRecord(source) || source.ok !== true)
    .map((source) => (isRecord(source) ? source.key : null));
  if (failedSources.length > 0) {
    const failed = safeSourceKeys(failedSources);
    return {
      ok: false,
      reason: failed.length ? `source not healthy: ${failed.join(',')}` : 'source not healthy',
    };
  }

  return { ok: true, reason: '' };
}

export function validateErrorPayload(payload, expectedCode) {
  if (!isRecord(payload) || payload.ok !== false || payload.code !== expectedCode) {
    return { ok: false, reason: `expected exact ${expectedCode} error contract` };
  }
  return { ok: true, reason: '' };
}

function requiredEnv(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`${name} secret is required`);
  return value;
}

async function fetchWithTimeout(url, options, label, timeoutMs = 15_000) {
  try {
    return await fetch(url, {
      ...options,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`${label}: network failure or timeout`);
  }
}

async function readJson(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label}: invalid JSON response`);
  }
}

async function signInHealthAccount({ apiKey, email, password }) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // URL contains the web API key, so never forward the fetch error message.
    throw new Error('Firebase health account sign-in network failure');
  }
  if (response.status !== 200) {
    throw new Error(`Firebase health account sign-in failed (HTTP ${response.status})`);
  }
  const payload = await readJson(response, 'Firebase health account sign-in');
  const idToken = typeof payload.idToken === 'string' ? payload.idToken.trim() : '';
  if (!idToken) throw new Error('Firebase health account response has no ID token');
  return idToken;
}

async function probeJson({ name, url, expectedStatus, token, validate }) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetchWithTimeout(url, { method: 'GET', headers }, name);
  if (response.status !== expectedStatus) {
    throw new Error(`${name}: HTTP ${response.status} (expected ${expectedStatus})`);
  }
  const payload = await readJson(response, name);
  const verdict = validate(payload);
  if (!verdict.ok) throw new Error(`${name}: ${verdict.reason}`);
  console.log(`PASS ${name} — HTTP ${response.status}`);
}

async function probeRoute(baseUrl, path) {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, { method: 'HEAD' }, `route ${path}`, 10_000);
  if (response.status !== 200) {
    throw new Error(`route ${path}: HTTP ${response.status} (expected 200)`);
  }
  console.log(`PASS route ${path} — HTTP 200`);
}

async function probeServiceWorker(baseUrl) {
  const response = await fetchWithTimeout(`${baseUrl}/sw.js`, { method: 'GET' }, 'sw.js', 10_000);
  if (response.status !== 200) throw new Error(`sw.js: HTTP ${response.status} (expected 200)`);
  const source = await response.text();
  const missing = SW_MARKERS.filter((marker) => !source.includes(marker));
  if (missing.length > 0) throw new Error('sw.js: required push handlers missing');
  console.log('PASS sw.js push handlers');
}

export async function runApiHealthCheck({
  env = process.env,
  baseUrl = 'https://cocotripkr.com',
} = {}) {
  const apiKey = requiredEnv(env, 'FIREBASE_WEB_API_KEY');
  const email = requiredEnv(env, 'HEALTH_CHECK_EMAIL');
  const password = requiredEnv(env, 'HEALTH_CHECK_PASSWORD');
  const token = await signInHealthAccount({ apiKey, email, password });

  await probeJson({
    name: 'admin-ai-ops-center',
    url: `${baseUrl}/api/admin-ai-ops-center?limit=1`,
    expectedStatus: 200,
    token,
    validate: validateAdminOpsPayload,
  });
  await probeJson({
    name: 'my-bookings-auth-guard',
    url: `${baseUrl}/api/my-bookings`,
    expectedStatus: 401,
    validate: (payload) => validateErrorPayload(payload, 'AUTH_REQUIRED'),
  });
  await probeJson({
    name: 'plan-status',
    url: `${baseUrl}/api/plan-status?planId=health-check-noexist`,
    expectedStatus: 404,
    validate: (payload) => validateErrorPayload(payload, 'NOT_FOUND'),
  });

  for (const path of ROUTES) await probeRoute(baseUrl, path);
  await probeServiceWorker(baseUrl);
  console.log('All API health probes PASS.');
}

async function main() {
  try {
    await runApiHealthCheck();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown health-check failure';
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
