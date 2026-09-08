import { createHash } from 'node:crypto';

export const EXTERNAL_INBOX_MESSAGES_COLLECTION = 'external_inbox_messages';
export const EXTERNAL_INBOX_STATE_COLLECTION = 'external_inbox_state';
const DAY_MS = 86_400_000;

function containsControl(value) {
  return Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function invalid(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function identifier(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()
    || value.length > 512 || containsControl(value)) {
    throw invalid('INBOX_IDENTIFIER_INVALID');
  }
  return value;
}

function limitedText(value, limit) {
  if (typeof value !== 'string') throw invalid('INBOX_TEXT_INVALID');
  const cleaned = Array.from(value).filter(character => {
    const code = character.charCodeAt(0);
    return (code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13;
  }).join('');
  const characters = Array.from(cleaned);
  return { value: characters.slice(0, limit).join(''), truncated: characters.length > limit || cleaned !== value };
}

/** No SDK, environment access or writes. Only these selected fields can reach storage. */
export function prepareExternalInboxMessage(message, { nowMs, retentionDays }) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0
    || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) {
    throw invalid('INBOX_POLICY_INVALID');
  }
  if (!message || !['email', 'whatsapp'].includes(message.channel)) throw invalid('INBOX_CHANNEL_INVALID');
  const accountId = identifier(message.accountId);
  const providerMessageId = identifier(message.providerMessageId);
  const providerThreadId = identifier(message.providerThreadId);
  const sourceAtMs = message.sourceAtMs;
  if (!Number.isSafeInteger(sourceAtMs) || sourceAtMs <= 0) throw invalid('INBOX_SOURCE_TIME_INVALID');
  if (sourceAtMs > nowMs) throw invalid('INBOX_SOURCE_TIME_FUTURE');
  const expiresAtMs = sourceAtMs + retentionDays * DAY_MS;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs > 8_640_000_000_000_000) throw invalid('INBOX_SOURCE_TIME_INVALID');
  if (expiresAtMs <= nowMs) throw invalid('INBOX_MESSAGE_EXPIRED');
  if (typeof message.kind !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(message.kind)) {
    throw invalid('INBOX_KIND_INVALID');
  }
  const sender = limitedText(message.sender, 320);
  const subject = limitedText(message.subject, 256);
  const text = limitedText(message.text, 4000);
  const docId = createHash('sha256')
    .update(JSON.stringify(['external-inbox.v1', message.channel, accountId, providerMessageId]))
    .digest('hex');
  return { docId, data: {
    channel: message.channel,
    accountId,
    providerMessageId,
    providerThreadId,
    sourceAtMs,
    receivedAtMs: nowMs,
    sender: sender.value,
    subject: subject.value,
    text: text.value,
    kind: message.kind,
    truncated: message.truncated === true || sender.truncated || subject.truncated || text.truncated,
    expiresAtMs,
    // A TTL-compatible field is NOT a promise of deletion: the operator must enable Firestore TTL separately.
    expiresAt: new Date(expiresAtMs),
  } };
}

/** WhatsApp-only state ownership. Gmail uses prepare inside its separate cursor/lease transaction. */
export async function writeExternalInboxMessage({ db, message, nowMs, retentionDays, captureStartAtMs }) {
  const result = await writeExternalInboxMessages({ db, messages: [message], nowMs, retentionDays, captureStartAtMs });
  return { created: result.created === 1, duplicate: result.duplicate === 1 };
}

/** At most 200 selected records per transaction, avoiding a network round trip for every message. */
export async function writeExternalInboxMessages({ db, messages, nowMs, retentionDays, captureStartAtMs }) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 1000) throw invalid('INBOX_BATCH_INVALID');
  const prepared = messages.map(message => prepareExternalInboxMessage(message, { nowMs, retentionDays }));
  const accountId = prepared[0].data.accountId;
  if (prepared.some(item => item.data.channel !== 'whatsapp' || item.data.accountId !== accountId)) throw invalid('INBOX_WRITER_CHANNEL_INVALID');
  if (!Number.isSafeInteger(captureStartAtMs) || captureStartAtMs <= 0
    || captureStartAtMs > nowMs || prepared.some(item => item.data.sourceAtMs < captureStartAtMs)) {
    throw invalid('INBOX_CAPTURE_START_INVALID');
  }
  const unique = [...new Map(prepared.map(item => [item.docId, item])).values()];
  const stateRef = db.collection(EXTERNAL_INBOX_STATE_COLLECTION).doc('whatsapp');
  const counts = { created: 0, duplicate: prepared.length - unique.length };
  for (let index = 0; index < unique.length; index += 200) {
    const chunk = unique.slice(index, index + 200);
    const refs = chunk.map(item => db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).doc(item.docId));
    const result = await db.runTransaction(async transaction => {
      // Real Admin Firestore provides getAll. The injected race fake tracks individual reads instead.
      const snapshots = typeof transaction.getAll === 'function'
        ? await transaction.getAll(...refs) : await Promise.all(refs.map(ref => transaction.get(ref)));
      const fresh = chunk.filter((_, position) => !snapshots[position].exists);
      if (!fresh.length) return { created: 0, duplicate: chunk.length };
      const stateSnapshot = await transaction.get(stateRef);
      const state = stateSnapshot.exists ? stateSnapshot.data() : {};
      const previousReceived = state.accountId === accountId && Number.isSafeInteger(state.lastReceivedAtMs)
        ? state.lastReceivedAtMs : 0;
      chunk.forEach((item, position) => { if (!snapshots[position].exists) transaction.set(refs[position], item.data); });
      transaction.set(stateRef, {
        status: 'connected', accountId,
        lastAttemptAtMs: Math.max(nowMs, previousReceived),
        lastSuccessAtMs: Math.max(nowMs, previousReceived),
        lastReceivedAtMs: Math.max(nowMs, previousReceived),
        lastErrorCode: '', captureStartAtMs, retentionDays,
      }, { merge: true });
      return { created: fresh.length, duplicate: chunk.length - fresh.length };
    });
    counts.created += result.created;
    counts.duplicate += result.duplicate;
  }
  return counts;
}

/** Pure cleanup plan only: never queries or deletes anything, and never accepts an arbitrary collection path. */
export function planExpiredExternalInboxCleanup(documents, { nowMs, limit = 100 }) {
  if (!Array.isArray(documents) || !Number.isSafeInteger(nowMs) || nowMs <= 0
    || !Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('INBOX_CLEANUP_POLICY_INVALID');
  const ids = new Set();
  for (const document of documents) {
    const data = document && document.data;
    if (!data || !['email', 'whatsapp'].includes(data.channel)
      || !Number.isSafeInteger(data.expiresAtMs) || data.expiresAtMs <= 0 || data.expiresAtMs > nowMs) continue;
    try {
      const expectedId = createHash('sha256')
        .update(JSON.stringify(['external-inbox.v1', data.channel, identifier(data.accountId), identifier(data.providerMessageId)]))
        .digest('hex');
      if (document.id === expectedId) ids.add(expectedId);
    } catch { /* Malformed records need operator review, not an expanded deletion target. */ }
    if (ids.size >= limit) break;
  }
  return { collection: EXTERNAL_INBOX_MESSAGES_COLLECTION, docIds: [...ids], executed: false };
}
