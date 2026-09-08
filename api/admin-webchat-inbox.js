import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors, isAdminCorsOriginAllowed } from './_shared/cors.js';
import { commitAdminWebchatReply, listAdminWebchatSessions, parseAdminWebchatReply, readAdminWebchatDetail } from './_shared/adminWebchatInbox.js';
export const maxDuration = 15;
export const config = { runtime: 'nodejs' };
const METHODS = 'GET, POST, OPTIONS';
const MAX_BODY_BYTES = 20 * 1024;
function send(req, res, status, body) { res.writeHead(status, { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: METHODS, headers: 'Authorization, Content-Type' }) }); return res.end(JSON.stringify(body)); }
function requestOrigin(req) { return req.headers?.origin || req.headers?.Origin || ''; }
function originAllowed(req) { const origin = requestOrigin(req); return !origin || isAdminCorsOriginAllowed(origin); }
function requestBody(req) {
  const contentType = req.headers?.['content-type'] || req.headers?.['Content-Type'] || '';
  if (!/^application\/json(?:\s*;|$)/i.test(String(contentType))) return null;
  const length = req.headers?.['content-length'] || req.headers?.['Content-Length'];
  if (length !== undefined && (!/^\d+$/.test(String(length)) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_BODY_BYTES)) return null;
  try {
    if (Buffer.isBuffer(req.body) && req.body.length > MAX_BODY_BYTES) return null;
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    if (typeof raw === 'string') {
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return null;
      return parseAdminWebchatReply(JSON.parse(raw));
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    // Vercel may have already decoded JSON. Re-encode solely to apply the same
    // complete UTF-8 byte limit rather than trusting Content-Length.
    if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_BODY_BYTES) return null;
    return parseAdminWebchatReply(raw);
  } catch { return null; }
}
function requestedSessionId(req) {
  try {
    const raw = String(req.url || '/');
    if (!raw.startsWith('/') || raw.startsWith('//')) return { invalid: true };
    const url = new URL(raw, 'https://cocotripkr.com');
    const entries = [...url.searchParams.entries()];
    if (!entries.length) return { sessionId: '' };
    if (entries.length !== 1 || entries[0][0] !== 'sessionId' || !entries[0][1]) return { invalid: true };
    return { sessionId: entries[0][1] };
  } catch { return { invalid: true }; }
}
async function defaultLoadDb() {
  // firebase-admin.js bootstraps a Firestore app while loading. Keep this after
  // verified admin auth and request validation, matching admin-external-inbox.
  const { initAdminDb } = await import('./_shared/firebase-admin.js');
  return initAdminDb('admin-webchat-inbox');
}
export function createAdminWebchatInboxHandler({ authenticate = verifyAdminToken, loadDb = defaultLoadDb, now = Date.now } = {}) {
  return async (req, res) => {
    if (!originAllowed(req)) return send(req, res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED' });
    if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: METHODS, headers: 'Authorization, Content-Type' })); return res.end(); }
    if (!['GET', 'POST'].includes(req.method)) return send(req, res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    try {
      const auth = await authenticate(req);
      if (!auth.ok || typeof auth.uid !== 'string' || !auth.uid.trim()) return send(req, res, auth.status || 401, { ok: false, code: 'ADMIN_REQUIRED' });
      const request = req.method === 'POST' ? requestBody(req) : requestedSessionId(req);
      if (!request || request.invalid) return send(req, res, 400, { ok: false, code: 'INVALID_REQUEST' });
      const db = await loadDb();
      if (!db) return send(req, res, 503, { ok: false, code: 'CHAT_UNAVAILABLE' });
      const nowMs = now();
      if (req.method === 'GET') {
        const result = request.sessionId ? await readAdminWebchatDetail(db, request.sessionId, nowMs) : { ok: true, data: await listAdminWebchatSessions(db, nowMs) };
        return result.ok ? send(req, res, 200, result) : send(req, res, 404, { ok: false, code: result.code });
      }
      const result = await commitAdminWebchatReply({ db, actorUid: auth.uid, input: request, nowMs });
      if (result.ok) return send(req, res, result.replay ? 200 : 201, { ok: true, data: result.data });
      return send(req, res, result.code === 'INVALID_REQUEST' ? 400 : result.code === 'STALE_THREAD' || result.code === 'REQUEST_CONFLICT' ? 409 : 404, { ok: false, code: result.code });
    } catch { return send(req, res, 503, { ok: false, code: 'CHAT_UNAVAILABLE' }); }
  };
}
export default createAdminWebchatInboxHandler();
