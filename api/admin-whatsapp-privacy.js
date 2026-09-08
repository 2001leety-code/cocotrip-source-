/** Owner-only session closure/exclusion. No Meta API, message-body reads, deletion, or replies. */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors, isAdminCorsOriginAllowed } from './_shared/cors.js';
import { applyWhatsAppPrivacyAction, loadWhatsAppPrivacy, readWhatsAppPrivacyScope, validateWhatsAppPrivacyAction } from './_shared/adminWhatsAppPrivacy.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };
const METHODS = 'GET, POST, OPTIONS';
function send(req, res, status, body) {
  res.writeHead(status, { ...buildAdminJsonCors(req, { methods: METHODS }), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function requestBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) return null;
  const length = req.headers?.['content-length'];
  if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > 1024)) return null;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    if (typeof raw === 'string' && Buffer.byteLength(raw) > 1024) return null;
    const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return validateWhatsAppPrivacyAction(body) ? body : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: METHODS })); res.end(); return; }
  if (!['GET', 'POST'].includes(req.method)) return send(req, res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  try {
    const auth = await verifyAdminToken(req);
    if (!auth.ok) return send(req, res, auth.status === 403 ? 403 : 401, { ok: false, error: 'ADMIN_REQUIRED' });
    const url = new URL(req.url || '/', 'https://cocotripkr.com');
    if ([...url.searchParams].length) return send(req, res, 400, { ok: false, error: 'INVALID_REQUEST' });
    const origin = req.headers?.origin || req.headers?.Origin || '';
    if (req.method === 'POST' && origin && !isAdminCorsOriginAllowed(origin)) return send(req, res, 403, { ok: false, error: 'ORIGIN_NOT_ALLOWED' });
    const body = req.method === 'POST' ? requestBody(req) : null;
    if (req.method === 'POST' && !body) return send(req, res, 400, { ok: false, error: 'INVALID_REQUEST' });
    const scope = readWhatsAppPrivacyScope(process.env);
    if (req.method === 'POST' && !scope.ready) return send(req, res, 503, { ok: false, error: 'PRIVACY_NOT_CONFIGURED' });
    const db = scope.ready ? (await import('./_shared/firebase-admin.js')).initAdminDb('admin-whatsapp-privacy') : null;
    if (scope.ready && !db) return send(req, res, 503, { ok: false, error: 'PRIVACY_UNAVAILABLE' });
    if (req.method === 'GET') return send(req, res, 200, { ok: true, data: await loadWhatsAppPrivacy({ db, scope, nowMs: Date.now() }) });
    await applyWhatsAppPrivacyAction({ db, scope, action: body.action, sender: body.sender });
    return send(req, res, 200, { ok: true });
  } catch { return send(req, res, 503, { ok: false, error: 'PRIVACY_UNAVAILABLE' }); }
}
