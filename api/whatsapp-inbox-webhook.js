import {
  extractWhatsAppInboxMessages, readWhatsAppInboxConfig, readWhatsAppInboxRawBody,
  verifyWhatsAppInboxChallenge, verifyWhatsAppInboxSignature,
} from './_shared/whatsapp-inbox.js';
import { writeExternalInboxMessages } from './_shared/external-inbox-store.js';

function response(status, code, counts = {}) {
  return Response.json({ ok: status === 200, code, ...counts }, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function loadDatabase() {
  // Importing the existing SDK module initializes it: keep this after every ingress gate.
  const { initAdminDb } = await import('./_shared/firebase-admin.js');
  const db = initAdminDb('whatsapp-inbox');
  if (!db) throw new Error('INBOX_DATABASE_UNAVAILABLE');
  return db;
}

export function createWhatsAppInboxHandler({ getEnv = () => process.env, now = Date.now, loadDb = loadDatabase, readBody = readWhatsAppInboxRawBody } = {}) {
  return async request => {
    if (!['GET', 'POST'].includes(request.method)) return response(405, 'METHOD_NOT_ALLOWED');
    const env = getEnv();
    const nowMs = now();
    const config = readWhatsAppInboxConfig(env, nowMs);
    if (!config.enabled) return response(503, 'INBOX_DISABLED');
    if (!config.ready) return response(503, 'INBOX_NOT_CONFIGURED');
    if (request.method === 'GET') {
      const challenge = verifyWhatsAppInboxChallenge(request.url, env.WHATSAPP_INBOX_VERIFY_TOKEN);
      return challenge === null ? response(403, 'VERIFICATION_FAILED') : new Response(challenge, {
        status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    const signature = request.headers.get('x-hub-signature-256') || '';
    if (!/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return response(401, 'SIGNATURE_INVALID');
    let rawBody;
    try { rawBody = await readBody(request); } catch (error) {
      if (error.code === 'BODY_TOO_LARGE') return response(413, 'BODY_TOO_LARGE');
      if (error.code === 'BODY_TIMEOUT') return response(408, 'BODY_TIMEOUT');
      return response(400, 'RAW_BODY_UNAVAILABLE');
    }
    if (!verifyWhatsAppInboxSignature(rawBody, signature, env.WHATSAPP_INBOX_APP_SECRET)) return response(401, 'SIGNATURE_INVALID');
    let batch;
    try {
      batch = extractWhatsAppInboxMessages(JSON.parse(rawBody.toString('utf8')), {
        config, wabaId: env.WHATSAPP_INBOX_WABA_ID, nowMs,
      });
    } catch (error) {
      return response(error.code === 'BATCH_TOO_LARGE' ? 413 : 400, error.code === 'BATCH_TOO_LARGE' ? 'BATCH_TOO_LARGE' : 'PAYLOAD_INVALID');
    }
    if (!batch.messages.length) return response(200, 'NO_NEW_MESSAGES', { created: 0, duplicate: 0, ignored: batch.ignored });
    try {
      const db = await loadDb();
      const counts = await writeExternalInboxMessages({
        db, messages: batch.messages, nowMs, now, retentionDays: config.retentionDays, captureStartAtMs: config.captureStartAtMs,
      });
      return response(200, counts.created ? 'RECEIVED' : 'NO_NEW_MESSAGES', { ...counts, ignored: batch.ignored + counts.ignored });
    } catch {
      // No 200 on failed storage. Provider retries are absorbed by the transaction's stable message ID.
      return response(503, 'INBOX_STORAGE_FAILED');
    }
  };
}

// Web Standard entrypoint prevents Vercel's Node request helper from parsing the signed body first.
export default { fetch: createWhatsAppInboxHandler() };
