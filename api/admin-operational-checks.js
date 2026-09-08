import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { getOperationalChecks } from './_shared/operational-checks.js';

export const config = { runtime: 'nodejs' };
const METHODS = 'GET, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: METHODS }) });
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, buildAdminCors(req, { methods: METHODS }));
    return res.end();
  }
  if (req.method !== 'GET') return json(req, res, 405, { ok: false, error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
  try {
    const auth = await verifyAdminToken(req);
    if (!auth.ok) {
      const status = auth.status === 401 || auth.status === 403 ? auth.status : 502;
      return json(req, res, status, { ok: false, error: status === 502 ? 'Admin authentication unavailable' : 'Admin authentication required', code: status === 502 ? 'AUTH_UNAVAILABLE' : 'ADMIN_REQUIRED' });
    }
    return json(req, res, 200, { ok: true, data: await getOperationalChecks() });
  } catch {
    return json(req, res, 502, { ok: false, error: 'Operational checks unavailable', code: 'UPSTREAM_UNAVAILABLE' });
  }
}
