import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { prepareExternalInboxMessage } from './external-inbox-store.js';

export const WHATSAPP_INBOX_BODY_LIMIT = 4_194_304;
export const WHATSAPP_INBOX_BODY_TIMEOUT_MS = 5000;
const MAX_BATCH_MESSAGES = 1000;
const ENV_PREFIX = 'WHATSAPP_INBOX_';
const TYPES = new Set(['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts', 'interactive', 'button', 'reaction', 'unknown', 'unsupported', 'order', 'system']);

function configuredString(env, suffix) {
  const value = env[ENV_PREFIX + suffix];
  return typeof value === 'string' ? value : '';
}

function isoTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isSafeInteger(ms) || ms <= 0) return null;
  const normalized = value.includes('.') ? value : value.replace('Z', '.000Z');
  return new Date(ms).toISOString() === normalized ? ms : null;
}

function secretConfigured(value) {
  return Boolean(typeof value === 'string' && value && value === value.trim() && value.length <= 4096
    && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127));
}

/** Safe for admin summaries: no secret or verification-token values are returned. */
export function readWhatsAppInboxConfig(env = process.env, nowMs = Date.now()) {
  const productionOnly = env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== 'production';
  const enabled = !productionOnly && configuredString(env, 'ENABLED') === 'true';
  const base = { enabled, ready: false, status: 'disabled', reason: productionOnly ? 'PRODUCTION_ONLY' : 'DISABLED', accountId: '', captureStartAtMs: null, retentionDays: null, missing: [] };
  if (!enabled) return base;
  const missing = [];
  for (const key of ['WABA_ID', 'PHONE_NUMBER_ID']) {
    if (!/^\d{1,64}$/.test(configuredString(env, key))) missing.push(ENV_PREFIX + key);
  }
  for (const key of ['APP_SECRET', 'VERIFY_TOKEN']) {
    if (!secretConfigured(configuredString(env, key))) missing.push(ENV_PREFIX + key);
  }
  const captureStartAtMs = isoTime(configuredString(env, 'CAPTURE_START_AT'));
  if (!captureStartAtMs || !Number.isSafeInteger(nowMs) || captureStartAtMs > nowMs) missing.push(ENV_PREFIX + 'CAPTURE_START_AT');
  const retentionRaw = configuredString(env, 'RETENTION_DAYS');
  const retentionDays = /^[1-9]\d?$/.test(retentionRaw) ? Number(retentionRaw) : null;
  if (!retentionDays || retentionDays > 90) missing.push(ENV_PREFIX + 'RETENTION_DAYS');
  return {
    enabled, ready: missing.length === 0,
    status: missing.length ? 'not_configured' : 'ready',
    reason: missing.length ? 'MISSING_OR_INVALID_CONFIG' : 'READY',
    accountId: /^\d{1,64}$/.test(configuredString(env, 'PHONE_NUMBER_ID')) ? configuredString(env, 'PHONE_NUMBER_ID') : '',
    captureStartAtMs, retentionDays, missing,
  };
}

export function verifyWhatsAppInboxSignature(rawBody, signature, appSecret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)
    || !secretConfigured(appSecret)) return false;
  const actual = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return timingSafeEqual(actual, expected);
}

export function verifyWhatsAppInboxChallenge(url, verifyToken) {
  const parameters = new URL(url).searchParams;
  if (['hub.mode', 'hub.verify_token', 'hub.challenge'].some(key => parameters.getAll(key).length !== 1)) return null;
  const token = parameters.get('hub.verify_token') || '';
  const challenge = parameters.get('hub.challenge') || '';
  if (parameters.get('hub.mode') !== 'subscribe' || !secretConfigured(verifyToken)
    || token.length > 4096 || !/^\d{1,256}$/.test(challenge)) return null;
  const supplied = createHash('sha256').update(token).digest();
  const expected = createHash('sha256').update(verifyToken).digest();
  return timingSafeEqual(supplied, expected) ? challenge : null;
}

function inputError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** Read the original Web Request bytes. Parsed request.body is deliberately not supported. */
export async function readWhatsAppInboxRawBody(request, { timeoutMs = WHATSAPP_INBOX_BODY_TIMEOUT_MS, maxBytes = WHATSAPP_INBOX_BODY_LIMIT } = {}) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) throw inputError('BODY_TOO_LARGE');
  if (!request.body || typeof request.body.getReader !== 'function' || request.bodyUsed) throw inputError('RAW_BODY_UNAVAILABLE');
  const reader = request.body.getReader();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(inputError('BODY_TIMEOUT'));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  try {
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw inputError('RAW_BODY_UNAVAILABLE');
      length += value.byteLength;
      if (length > maxBytes) throw inputError('BODY_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

/** After signature verification only. Discards profiles, media metadata, replies, HTML and raw objects. */
export function extractWhatsAppInboxMessages(payload, { config, wabaId, nowMs }) {
  if (!config.ready) throw inputError('CONFIG_NOT_READY');
  if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) throw inputError('PAYLOAD_INVALID');
  const messages = [];
  const seen = new Set();
  let ignored = 0;
  let inspected = 0;
  for (const entry of payload.entry) {
    if (!entry || entry.id !== wabaId || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const value = change && change.value;
      if (change.field !== 'messages' || !value || value.messaging_product !== 'whatsapp'
        || !value.metadata || value.metadata.phone_number_id !== config.accountId || !Array.isArray(value.messages)) continue;
      for (const incoming of value.messages) {
        inspected += 1;
        if (inspected > MAX_BATCH_MESSAGES) throw inputError('BATCH_TOO_LARGE');
        if (!incoming || typeof incoming.timestamp !== 'string' || !/^\d{1,16}$/.test(incoming.timestamp)
          || typeof incoming.from !== 'string' || !/^\d{1,20}$/.test(incoming.from)) { ignored += 1; continue; }
        const sourceAtMs = Number(incoming.timestamp) * 1000;
        if (!Number.isSafeInteger(sourceAtMs) || sourceAtMs < config.captureStartAtMs || sourceAtMs > nowMs
          || sourceAtMs + config.retentionDays * 86_400_000 <= nowMs) { ignored += 1; continue; }
        const kind = TYPES.has(incoming.type) ? incoming.type : 'unknown';
        const message = {
          channel: 'whatsapp', accountId: config.accountId,
          providerMessageId: incoming.id, providerThreadId: incoming.from,
          sourceAtMs, sender: incoming.from, subject: '',
          text: kind === 'text' && typeof incoming.text?.body === 'string' ? incoming.text.body : '',
          kind, truncated: false,
        };
        try {
          const prepared = prepareExternalInboxMessage(message, { nowMs, retentionDays: config.retentionDays });
          if (seen.has(prepared.docId)) { ignored += 1; continue; }
          seen.add(prepared.docId);
          messages.push(prepared.data);
        } catch { ignored += 1; }
      }
    }
  }
  return { messages, ignored };
}
