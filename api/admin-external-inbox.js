/** Company inbox only. GET is read-only; never calls Gmail/Meta or the AI/reply pipeline. */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { externalInboxConfigs, loadExternalInbox, loadExternalInboxDetail } from './_shared/adminExternalInboxRead.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };
const METHODS = 'GET, OPTIONS';

function send(req, res, status, body) {
  res.writeHead(status, { ...buildAdminJsonCors(req, { methods: METHODS }), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: METHODS })); res.end(); return; }
  if (req.method !== 'GET') return send(req, res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  try {
    const auth = await verifyAdminToken(req);
    if (!auth.ok) return send(req, res, auth.status === 403 ? 403 : 401, { ok: false, error: 'ADMIN_REQUIRED' });
    const url = new URL(req.url || '/', 'https://cocotripkr.com');
    const id = url.searchParams.get('id');
    if ([...url.searchParams.keys()].some(key => key !== 'id') || url.searchParams.getAll('id').length > 1
      || (id !== null && !/^[a-f0-9]{64}$/.test(id))) return send(req, res, 400, { ok: false, error: 'INVALID_REQUEST' });
    const nowMs = Date.now();
    const configs = externalInboxConfigs(process.env, nowMs);
    const ready = Object.values(configs).some(value => value.ready);
    if (id !== null && !ready) return send(req, res, 404, { ok: false, error: 'MESSAGE_NOT_AVAILABLE' });
    // This module bootstraps on import. Authentication/configuration MUST precede it.
    const db = ready ? (await import('./_shared/firebase-admin.js')).initAdminDb('admin-external-inbox') : null;
    if (ready && !db) return send(req, res, 503, { ok: false, error: 'INBOX_UNAVAILABLE' });
    if (id !== null) {
      const data = await loadExternalInboxDetail({ db, id, configs, nowMs });
      return data ? send(req, res, 200, { ok: true, data }) : send(req, res, 404, { ok: false, error: 'MESSAGE_NOT_AVAILABLE' });
    }
    return send(req, res, 200, { ok: true, data: await loadExternalInbox({ db, configs, nowMs }) });
  } catch { return send(req, res, 503, { ok: false, error: 'INBOX_UNAVAILABLE' }); }
}
