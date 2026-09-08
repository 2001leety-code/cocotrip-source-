import { createHash } from 'node:crypto';

export const WEBCHAT_REPLY_RECEIPTS = 'admin_webchat_reply_receipts';
const SESSION = /^sess_[A-Za-z0-9_-]{24,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_FINGERPRINT = /^[a-f0-9]{32}$/;
const MAX = 50;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const READ_QUERY_TIMEOUT_MS = 3 * 1000;

function timeMs(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (value && typeof value.toMillis === 'function') return timeMs(value.toMillis());
  if (value instanceof Date) return timeMs(value.getTime());
  if (Number.isSafeInteger(value?.seconds) && Number.isInteger(value?.nanoseconds)
    && value.nanoseconds >= 0 && value.nanoseconds < 1_000_000_000) {
    return timeMs(value.seconds * 1000 + Math.floor(value.nanoseconds / 1e6));
  }
  return null;
}
function validCurrentTime(value) { return Number.isSafeInteger(value) && value > 0; }
function isFuture(value, nowMs) { return value > nowMs + FUTURE_CLOCK_SKEW_MS; }
function validOwnerUid(value) {
  return typeof value === 'string' && Array.from(value).length > 0 && Array.from(value).length <= 128
    && value.trim().length > 0 && !/[\p{Cc}]/u.test(value);
}
function validAdminActor(value) { return validOwnerUid(value); }
function validMessageId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1500 && !value.includes('/') && !/[\p{Cc}]/u.test(value);
}
function boundedRead(read) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('WEBCHAT_READ_TIMEOUT')), READ_QUERY_TIMEOUT_MS);
  });
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
}
function clean(value, limit) {
  const raw = typeof value === 'string' ? value : '';
  const valueWithoutControls = Array.from(raw).filter(char => { const code = char.charCodeAt(0); return (code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13; }).join('');
  const chars = Array.from(valueWithoutControls);
  return { text: chars.slice(0, limit).join(''), truncated: chars.length > limit || raw !== valueWithoutControls };
}
function language(value) { return ['ko', 'en', 'ja', 'zh'].includes(value) ? value : null; }
function publicSessionShape(data, nowMs) {
  const lastMessageAtMs = timeMs(data?.lastMessageAtMs);
  if (!data || !SESSION.test(String(data.sessionId || '')) || !['user', 'guest'].includes(data.ownerType)
    || !validCurrentTime(nowMs) || !lastMessageAtMs || isFuture(lastMessageAtMs, nowMs)) return null;
  return { sessionId: data.sessionId, ownerType: data.ownerType, language: language(data.language), lastMessageAtMs,
    lastMessageFrom: ['customer', 'ai', 'admin'].includes(data.lastMessageFrom) ? data.lastMessageFrom : 'unknown' };
}

export function validWebchatSession(id, data) {
  return SESSION.test(String(id || '')) && data && (data.ownerType === 'user'
    ? validOwnerUid(data.ownerUid)
    : data.ownerType === 'guest' && OWNER_FINGERPRINT.test(String(data.ownerFingerprint || '')));
}
export function publicWebchatSession(id, data, nowMs = Date.now()) {
  if (!validWebchatSession(id, data)) return null;
  if (!validCurrentTime(nowMs)) return null;
  // `lastMessageAt` is the existing chat-relay canonical head. Do not prefer a
  // stale auxiliary millisecond field after a later customer message.
  const lastMessageAtMs = timeMs(data.lastMessageAt);
  if (!lastMessageAtMs || isFuture(lastMessageAtMs, nowMs)) return null;
  return publicSessionShape({ sessionId: id, ownerType: data.ownerType, language: data.language, lastMessageAtMs,
    lastMessageFrom: data.lastMessageFrom }, nowMs);
}
export function publicWebchatMessage(id, data, nowMs = Date.now()) {
  if (!data || !['customer', 'ai', 'admin'].includes(data.from)) return null;
  if (!validMessageId(id) || !validCurrentTime(nowMs)) return null;
  const ts = timeMs(data.ts);
  if (!ts || isFuture(ts, nowMs)) return null;
  const body = clean(data.text, 4000);
  return { id, from: data.from, text: body.text, truncated: body.truncated || data.truncated === true,
    language: language(data.language), ts };
}
export function parseAdminWebchatReply(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(body))) return null;
  const keys = Object.keys(body);
  const allowed = new Set(['requestId', 'sessionId', 'text', 'expectedLastMessageAtMs']);
  if (keys.length !== allowed.size || keys.some(key => !allowed.has(key))) return null;
  const requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  const text = typeof body?.text === 'string' ? body.text : '';
  const expectedLastMessageAtMs = body?.expectedLastMessageAtMs;
  if (!UUID.test(requestId) || !SESSION.test(sessionId) || !Number.isSafeInteger(expectedLastMessageAtMs) || expectedLastMessageAtMs <= 0
    || !text || Array.from(text).length > 4000 || Array.from(text).some(char => char.charCodeAt(0) < 32 && !['\t', '\n', '\r'].includes(char))) return null;
  return { requestId, sessionId, text, expectedLastMessageAtMs };
}
function fingerprint(actorUid, input) { return createHash('sha256').update(JSON.stringify([actorUid, input.sessionId, input.text, input.expectedLastMessageAtMs])).digest('hex'); }
function receiptResult(data, input, actorUid, nowMs) {
  const response = data?.response;
  const session = publicSessionShape(response?.session, nowMs);
  const message = publicWebchatMessage(response?.message?.id, response?.message, nowMs);
  if (!data || data.version !== 1 || data.fingerprint !== input.fingerprint || data.sessionId !== input.sessionId
    || data.actorUid !== actorUid || !session || !message || response.requestId !== input.requestId
    || response.translated !== false || message.from !== 'admin' || message.text !== input.text
    || message.language !== session.language || message.ts !== session.lastMessageAtMs) return { code: 'REQUEST_CONFLICT' };
  return { ok: true, replay: true, data: { session, requestId: response.requestId, translated: false, message } };
}

export async function listAdminWebchatSessions(db, nowMs) {
  const snap = await boundedRead(db.collection('chat_sessions').orderBy('lastMessageAt', 'desc').limit(MAX + 1).get());
  const mapped = snap.docs.map(doc => publicWebchatSession(doc.id, doc.data(), nowMs));
  const sessions = mapped.filter(Boolean).slice(0, MAX);
  // Invalid/legacy rows are intentionally withheld. They also mean this query
  // cannot honestly claim the returned zero/short list is the complete inbox.
  return { generatedAtMs: nowMs, sessions, possiblyTruncated: snap.docs.length > MAX || mapped.some(session => !session) };
}
export async function readAdminWebchatDetail(db, sessionId, nowMs) {
  if (!SESSION.test(sessionId)) return { code: 'CHAT_NOT_AVAILABLE' };
  const sessionSnap = await boundedRead(db.collection('chat_sessions').doc(sessionId).get());
  const session = sessionSnap.exists ? publicWebchatSession(sessionSnap.id, sessionSnap.data(), nowMs) : null;
  if (!session) return { code: 'CHAT_NOT_AVAILABLE' };
  const messagesSnap = await boundedRead(db.collection('chat_sessions').doc(sessionId).collection('messages').orderBy('ts', 'desc').limit(MAX + 1).get());
  const mapped = messagesSnap.docs.slice(0, MAX).map(doc => publicWebchatMessage(doc.id, doc.data(), nowMs));
  const messages = mapped.filter(Boolean).reverse();
  return { ok: true, data: { generatedAtMs: nowMs, session, messages,
    messagesPossiblyTruncated: messagesSnap.docs.length > MAX || mapped.some(message => !message) } };
}
export async function commitAdminWebchatReply({ db, actorUid, input, nowMs }) {
  if (!db || !validAdminActor(actorUid) || !validCurrentTime(nowMs) || !parseAdminWebchatReply(input)
    || input.expectedLastMessageAtMs > nowMs + FUTURE_CLOCK_SKEW_MS) return { code: 'INVALID_REQUEST' };
  const receiptRef = db.collection(WEBCHAT_REPLY_RECEIPTS).doc(input.requestId);
  const sessionRef = db.collection('chat_sessions').doc(input.sessionId);
  const messageRef = sessionRef.collection('messages').doc();
  const fingerprintValue = fingerprint(actorUid, input);
  const result = await db.runTransaction(async tx => {
    const [receipt, sessionSnap] = await Promise.all([tx.get(receiptRef), tx.get(sessionRef)]);
    const session = sessionSnap.exists ? publicWebchatSession(sessionSnap.id, sessionSnap.data(), nowMs) : null;
    if (!session) return { code: 'CHAT_NOT_AVAILABLE' };
    const saved = receipt.exists ? receiptResult(receipt.data(), { ...input, fingerprint: fingerprintValue }, actorUid, nowMs) : null;
    if (saved) return saved;
    if (session.lastMessageAtMs !== input.expectedLastMessageAtMs) return { code: 'STALE_THREAD' };
    const message = { id: messageRef.id, from: 'admin', text: input.text, truncated: false, language: session.language, ts: nowMs };
    const nextSession = { ...session, lastMessageAtMs: nowMs, lastMessageFrom: 'admin' };
    const response = { session: nextSession, requestId: input.requestId, translated: false, message };
    // Both documents were read in this transaction. `set` is therefore safe
    // here: a concurrent receipt/session change retries and re-checks first.
    tx.set(receiptRef, { version: 1, actorUid, sessionId: input.sessionId, fingerprint: fingerprintValue, response, createdAtMs: nowMs });
    tx.set(messageRef, { from: 'admin', text: input.text, language: session.language, ts: new Date(nowMs) });
    tx.update(sessionRef, { lastMessageAt: new Date(nowMs), lastMessageFrom: 'admin' });
    return { ok: true, data: response };
  });
  return result;
}
