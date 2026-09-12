import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors, isAdminCorsOriginAllowed } from './_shared/cors.js';
import { readOwnerNotificationConfig } from './_shared/owner-notification-policy.js';
import { ownerNotificationTestTask, parseOwnerNotificationTestBody } from './_shared/owner-notification-test.js';

const METHODS = 'POST, OPTIONS';
export const config = { runtime: 'nodejs' };
export const maxDuration = 30;
function json(req, res, status, body) {
  res.writeHead(status, { ...buildAdminJsonCors(req, { methods: METHODS, headers: 'Authorization, Content-Type' }),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  return res.end(JSON.stringify(body));
}
function originAllowed(req) {
  const origin = req.headers?.origin || req.headers?.Origin || '';
  return !origin || isAdminCorsOriginAllowed(origin);
}
function status(result) {
  if (result.ok) return 200;
  if (['OWNER_TEST_UNAVAILABLE'].includes(result.code)) return 503;
  return 409;
}
async function defaultLoadDb() {
  const { initAdminDb } = await import('./_shared/firebase-admin.js');
  return initAdminDb('admin-owner-notification-test');
}
export function createAdminOwnerNotificationTestHandler({ authenticate = verifyAdminToken, loadServices, loadDb = defaultLoadDb, env = process.env, now = Date.now, send } = {}) {
  return async (req, res) => {
    if (!originAllowed(req)) return json(req, res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED' });
    if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: METHODS, headers: 'Authorization, Content-Type' })); return res.end(); }
    if (req.method !== 'POST') return json(req, res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    try {
      const auth = await authenticate(req);
      if (!auth?.ok || typeof auth.uid !== 'string' || !auth.uid.trim()) return json(req, res, auth?.status === 403 ? 403 : 401, { ok: false, code: auth?.status === 403 ? 'ADMIN_REQUIRED' : 'AUTH_REQUIRED' });
      const input = parseOwnerNotificationTestBody(req);
      if (!input || [...new URL(req.url || '/', 'https://cocotripkr.com').searchParams].length) return json(req, res, 400, { ok: false, code: 'INVALID_REQUEST' });
      const config = readOwnerNotificationConfig(env);
      if (!config.enabled) return input.action === 'check'
        ? json(req, res, 200, { ok: true, data: { ready: false, code: config.code } })
        : json(req, res, 503, { ok: false, code: config.code });
      if (auth.uid !== config.uid) return json(req, res, 403, { ok: false, code: 'OWNER_MISMATCH' });
      const services = loadServices ? await loadServices() : { db: await loadDb(), auth: { getUser: async (uid) => {
        const { getAuth } = await import('firebase-admin/auth'); return getAuth().getUser(uid);
      } } };
      const db = services?.db;
      if (!db || !services.auth || typeof services.auth.getUser !== 'function') return json(req, res, 503, { ok: false, code: 'OWNER_TEST_UNAVAILABLE' });
      const result = await ownerNotificationTestTask({ db, auth: services.auth, config, input, now, send });
      return json(req, res, status(result), result);
    } catch { return json(req, res, 503, { ok: false, code: 'OWNER_TEST_UNAVAILABLE' }); }
  };
}
export default createAdminOwnerNotificationTestHandler();
