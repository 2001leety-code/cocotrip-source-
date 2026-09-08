import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors, isAdminCorsOriginAllowed } from './_shared/cors.js';
import { externalInboxConfigs, publicExternalInboxMessage } from './_shared/adminExternalInboxRead.js';
import { EXTERNAL_INBOX_MESSAGES_COLLECTION } from './_shared/external-inbox-store.js';
import { INBOX_CASES_COLLECTION, publicInboxCase, transitionInboxCase, validInboxRetentionRequest } from './_shared/external-inbox-retention.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };
const METHODS = 'POST, OPTIONS';
const MAX_BODY_BYTES = 2 * 1024;

function send(req, res, status, body) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...buildAdminJsonCors(req, { methods: METHODS, headers: 'Authorization, Content-Type' }) });
  return res.end(JSON.stringify(body));
}

function originAllowed(req) {
  const origin = req.headers?.origin || req.headers?.Origin || '';
  return !origin || isAdminCorsOriginAllowed(origin);
}

function bodyInput(req) {
  const contentType = req.headers?.['content-type'] || req.headers?.['Content-Type'] || '';
  if (!/^application\/json(?:\s*;|$)/i.test(String(contentType))) return null;
  const contentLength = req.headers?.['content-length'] || req.headers?.['Content-Length'];
  if (contentLength !== undefined && (!/^\d+$/.test(String(contentLength)) || !Number.isSafeInteger(Number(contentLength))
    || Number(contentLength) > MAX_BODY_BYTES)) return null;
  try {
    if (Buffer.isBuffer(req.body) && req.body.length > MAX_BODY_BYTES) return null;
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    if (typeof raw === 'string') {
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return null;
      const parsed = JSON.parse(raw);
      return validInboxRetentionRequest(parsed) ? parsed : null;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_BODY_BYTES) return null;
    return validInboxRetentionRequest(raw) ? raw : null;
  } catch { return null; }
}

async function defaultLoadDb() {
  const { initAdminDb } = await import('./_shared/firebase-admin.js');
  return initAdminDb('admin-external-inbox-retention');
}

function transitionError(error) {
  const code = error && typeof error.code === 'string' ? error.code : '';
  if (code === 'INBOX_CASE_EXPIRED') return { status: 404, code: 'MESSAGE_NOT_AVAILABLE' };
  if (['INBOX_CASE_CONFLICT', 'INBOX_EVIDENCE_REVIEW_REQUIRED', 'INBOX_CLOSURE_CONFIRMATION_REQUIRED', 'INBOX_CASE_ACTION_INVALID'].includes(code)) {
    return { status: 409, code: 'CASE_TRANSITION_CONFLICT' };
  }
  return { status: 503, code: 'INBOX_UNAVAILABLE' };
}

export function createAdminExternalInboxRetentionHandler({ authenticate = verifyAdminToken, loadDb = defaultLoadDb,
  now = Date.now, env = process.env } = {}) {
  return async (req, res) => {
    if (!originAllowed(req)) return send(req, res, 403, { ok: false, error: 'ORIGIN_NOT_ALLOWED' });
    if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: METHODS, headers: 'Authorization, Content-Type' })); return res.end(); }
    if (req.method !== 'POST') return send(req, res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    try {
      const auth = await authenticate(req);
      if (!auth.ok || typeof auth.uid !== 'string' || !auth.uid.trim()) return send(req, res, auth.status || 401, { ok: false, error: 'ADMIN_REQUIRED' });
      const input = bodyInput(req);
      if (!input) return send(req, res, 400, { ok: false, error: 'INVALID_REQUEST' });
      if (env.VERCEL_ENV !== 'production') return send(req, res, 503, { ok: false, error: 'INBOX_UNAVAILABLE' });
      const requestNowMs = now();
      if (!Number.isSafeInteger(requestNowMs) || requestNowMs <= 0) return send(req, res, 503, { ok: false, error: 'INBOX_UNAVAILABLE' });
      const configs = externalInboxConfigs(env, requestNowMs);
      if (!Object.values(configs).some(value => value.ready)) return send(req, res, 404, { ok: false, error: 'MESSAGE_NOT_AVAILABLE' });
      const db = await loadDb();
      if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') return send(req, res, 503, { ok: false, error: 'INBOX_UNAVAILABLE' });
      let result;
      try {
        result = await db.runTransaction(async tx => {
          const messageDoc = await tx.get(db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).doc(input.messageId));
          if (!messageDoc.exists) return { error: 'MESSAGE_NOT_AVAILABLE' };
          const message = messageDoc.data();
          if (message?.retentionPolicyVersion !== 2 || typeof message.caseId !== 'string' || !/^[a-f0-9]{64}$/.test(message.caseId)) {
            return { error: 'MESSAGE_NOT_AVAILABLE' };
          }
          const caseRef = db.collection(INBOX_CASES_COLLECTION).doc(message.caseId);
          const caseDoc = await tx.get(caseRef);
          const inboxCase = caseDoc.exists ? caseDoc.data() : null;
          // The authorization/read gate must be evaluated after both transactional reads.
          // A slow read must not make an already-expired case transitionable again.
          const transactionNowMs = now();
          if (!Number.isSafeInteger(transactionNowMs) || transactionNowMs < requestNowMs) return { error: 'MESSAGE_NOT_AVAILABLE' };
          if (!publicExternalInboxMessage(input.messageId, message, configs, transactionNowMs, false, inboxCase)) return { error: 'MESSAGE_NOT_AVAILABLE' };
          let next;
          try { next = transitionInboxCase(inboxCase, { ...input, nowMs: transactionNowMs }); }
          catch (error) { return { transition: transitionError(error) }; }
          tx.set(caseRef, next);
          const data = publicInboxCase(next, transactionNowMs);
          return data ? { data } : { error: 'MESSAGE_NOT_AVAILABLE' };
        });
      } catch { return send(req, res, 503, { ok: false, error: 'INBOX_UNAVAILABLE' }); }
      if (result.transition) return send(req, res, result.transition.status, { ok: false, error: result.transition.code });
      if (result.error) return send(req, res, 404, { ok: false, error: result.error });
      return send(req, res, 200, { ok: true, data: result.data });
    } catch { return send(req, res, 503, { ok: false, error: 'INBOX_UNAVAILABLE' }); }
  };
}

export default createAdminExternalInboxRetentionHandler();
