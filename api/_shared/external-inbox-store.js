import { createHash } from 'node:crypto';
import { sessionDocId, supportCommand, transitionSupportSession, validateSupportSession,
  validSupportAccount, validSupportMessageId, validSupportSender, START_FRESHNESS_MS, WHATSAPP_SESSIONS_COLLECTION } from './whatsapp-support-sessions.js';
import { INBOX_CASES_COLLECTION, INBOX_CLOSED_RETENTION_DAYS, inboxCaseId, nextInboxCaseOnMessage } from './external-inbox-retention.js';

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
  const v2ReceiptWindowDays = Math.min(retentionDays, INBOX_CLOSED_RETENTION_DAYS);
  const expiresAtMs = sourceAtMs + v2ReceiptWindowDays * DAY_MS;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs > 8_640_000_000_000_000) throw invalid('INBOX_SOURCE_TIME_INVALID');
  if (expiresAtMs <= nowMs) throw invalid('INBOX_MESSAGE_EXPIRED');
  if (typeof message.kind !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(message.kind)) {
    throw invalid('INBOX_KIND_INVALID');
  }
  const sender = limitedText(message.sender, 320);
  const subject = limitedText(message.subject, 256);
  const text = limitedText(message.text, 4000);
  const supportProof = {};
  if (message.channel === 'whatsapp' && (message.whatsappPolicyVersion !== undefined || message.whatsappSessionId !== undefined)) {
    if (message.whatsappPolicyVersion !== 1 || message.whatsappSessionId !== sessionDocId(accountId, message.sender)) throw invalid('INBOX_SESSION_PROOF_INVALID');
    supportProof.whatsappPolicyVersion = 1;
    supportProof.whatsappSessionId = message.whatsappSessionId;
  }
  const docId = createHash('sha256')
    .update(JSON.stringify(['external-inbox.v1', message.channel, accountId, providerMessageId]))
    .digest('hex');
  const caseId = inboxCaseId({ channel: message.channel, accountId, providerThreadId });
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
    // v2 is case-retained. Receipt time never creates a TTL deletion promise.
    retentionPolicyVersion: 2,
    caseId,
    expiresAtMs: 0,
    expiresAt: null,
    ...supportProof,
  } };
}

/** WhatsApp-only state ownership. Gmail uses prepare inside its separate cursor/lease transaction. */
export async function writeExternalInboxMessage({ db, message, nowMs, now, retentionDays, captureStartAtMs }) {
  const result = await writeExternalInboxMessages({ db, messages: [message], nowMs, now, retentionDays, captureStartAtMs });
  return { created: result.created === 1, duplicate: result.duplicate === 1 };
}

/** Session reads and receipt/control writes share one transaction; no private unknown record is prepared. */
export async function writeExternalInboxMessages({ db, messages, nowMs, now = Date.now, retentionDays, captureStartAtMs }) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 1000) throw invalid('INBOX_BATCH_INVALID');
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) throw invalid('INBOX_POLICY_INVALID');
  const accountId = messages[0] && messages[0].accountId;
  if (!validSupportAccount(accountId) || messages.some(item => !item || item.channel !== 'whatsapp' || item.accountId !== accountId)) throw invalid('INBOX_WRITER_CHANNEL_INVALID');
  if (messages.some(item => !validSupportSender(item.sender) || item.providerThreadId !== item.sender || !validSupportMessageId(item.providerMessageId))) throw invalid('INBOX_IDENTIFIER_INVALID');
  if (messages.some(item => !Number.isSafeInteger(item.sourceAtMs) || item.sourceAtMs <= 0 || item.sourceAtMs > nowMs)) throw invalid('INBOX_SOURCE_TIME_FUTURE');
  if (!Number.isSafeInteger(captureStartAtMs) || captureStartAtMs <= 0
    || captureStartAtMs > nowMs || messages.some(item => item.sourceAtMs < captureStartAtMs)) {
    throw invalid('INBOX_CAPTURE_START_INVALID');
  }
  const unique = [...new Map(messages.map(message => [message.providerMessageId, message])).values()];
  // A close anywhere in this received batch is committed before any ordinary message/start.
  // This deliberately discards ambiguous same-batch text instead of briefly reopening a closed chat.
  unique.sort((a, b) => Number(supportCommand(b.kind, b.text) === 'stop') - Number(supportCommand(a.kind, a.text) === 'stop')
    || a.sourceAtMs - b.sourceAtMs);
  const stateRef = db.collection(EXTERNAL_INBOX_STATE_COLLECTION).doc('whatsapp');
  const counts = { created: 0, duplicate: messages.length - unique.length, ignored: 0 };
  for (let index = 0; index < unique.length; index += 200) {
    const chunk = unique.slice(index, index + 200);
    const result = await db.runTransaction(async transaction => {
      const getAll = refs => typeof transaction.getAll === 'function'
        ? transaction.getAll(...refs) : Promise.all(refs.map(ref => transaction.get(ref)));
      const sessionIds = [...new Set(chunk.map(message => sessionDocId(accountId, message.sender)))];
      const sessionRefs = sessionIds.map(id => db.collection(WHATSAPP_SESSIONS_COLLECTION).doc(id));
      const snapshots = await getAll(sessionRefs);
      const sessions = new Map(sessionIds.map((id, position) => [id, snapshots[position].exists ? snapshots[position].data() : null]));
      const corrupt = new Set(sessionIds.filter((id, position) => snapshots[position].exists
        && !validateSupportSession(snapshots[position].data(), { accountId,
          sender: chunk.find(message => sessionDocId(accountId, message.sender) === id).sender, sessionId: id })));
      const changed = new Set();
      const allowed = [];
      let ignored = 0;
      const checkedAtMs = now();
      if (!Number.isSafeInteger(checkedAtMs) || checkedAtMs < nowMs) throw invalid('INBOX_CLOCK_INVALID');
      for (const message of chunk) {
        const sessionId = sessionDocId(accountId, message.sender);
        const current = sessions.get(sessionId);
        if (corrupt.has(sessionId) || (current && !validateSupportSession(current, { accountId, sender: message.sender, sessionId }))
          || message.sourceAtMs > checkedAtMs
          || message.sourceAtMs + Math.min(retentionDays, INBOX_CLOSED_RETENTION_DAYS) * DAY_MS <= checkedAtMs) { ignored++; continue; }
        const next = transitionSupportSession(current, message, { nowMs: checkedAtMs });
        if (next.changed) { sessions.set(sessionId, next.session); changed.add(sessionId); }
        if (!next.allowMessage || current.startedAtMs < captureStartAtMs) { ignored++; continue; }
        allowed.push(prepareExternalInboxMessage({ ...message, whatsappPolicyVersion: 1, whatsappSessionId: sessionId }, { nowMs: checkedAtMs, retentionDays }));
      }
      const messageRefs = allowed.map(item => db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).doc(item.docId));
      const messageSnapshots = messageRefs.length ? await getAll(messageRefs) : [];
      const fresh = allowed.filter((_, position) => !messageSnapshots[position].exists);
      const stateSnapshot = fresh.length ? await transaction.get(stateRef) : null;
      const freshCaseIds = [...new Set(fresh.map(item => item.data.caseId))];
      const caseRefs = freshCaseIds.map(id => db.collection(INBOX_CASES_COLLECTION).doc(id));
      const caseSnapshots = caseRefs.length ? await getAll(caseRefs) : [];
      const cases = new Map(freshCaseIds.map((id, position) => [id, caseSnapshots[position].exists ? caseSnapshots[position].data() : null]));
      // Re-read time after every asynchronous read; a slow read/retry must not authorize expired text.
      const commitAtMs = now();
      if (!Number.isSafeInteger(commitAtMs) || commitAtMs < checkedAtMs) throw invalid('INBOX_CLOCK_INVALID');
      const eligibleFresh = fresh.filter(item => {
        const session = sessions.get(item.data.whatsappSessionId);
        return session && session.status === 'active' && commitAtMs < session.expiresAtMs
          && (!changed.has(item.data.whatsappSessionId) || commitAtMs - session.startedAtMs <= START_FRESHNESS_MS);
      });
      ignored += fresh.length - eligibleFresh.length;
      for (const id of changed) {
        const session = sessions.get(id);
        if (session.status === 'active' && (commitAtMs >= session.expiresAtMs || commitAtMs - session.startedAtMs > START_FRESHNESS_MS)) continue;
        transaction.set(db.collection(WHATSAPP_SESSIONS_COLLECTION).doc(id), session);
      }
      const nextCases = new Map();
      const committedFresh = [];
      for (const item of eligibleFresh) {
        const id = item.data.caseId;
        const previous = nextCases.has(id) ? nextCases.get(id) : cases.get(id);
        const data = { ...item.data, receivedAtMs: commitAtMs };
        committedFresh.push({ ...item, data });
        nextCases.set(id, nextInboxCaseOnMessage(previous, data, commitAtMs));
      }
      for (const item of committedFresh) transaction.set(db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).doc(item.docId), item.data);
      for (const [id, next] of nextCases) transaction.set(db.collection(INBOX_CASES_COLLECTION).doc(id), next);
      if (eligibleFresh.length) {
        const state = stateSnapshot && stateSnapshot.exists ? stateSnapshot.data() : {};
        const previousReceived = state.accountId === accountId && Number.isSafeInteger(state.lastReceivedAtMs) ? state.lastReceivedAtMs : 0;
        transaction.set(stateRef, { status: 'connected', accountId, lastAttemptAtMs: Math.max(commitAtMs, previousReceived),
          lastSuccessAtMs: Math.max(commitAtMs, previousReceived), lastReceivedAtMs: Math.max(commitAtMs, previousReceived),
          lastErrorCode: '', captureStartAtMs, retentionDays }, { merge: true });
      }
      return { created: eligibleFresh.length, duplicate: allowed.length - fresh.length, ignored };
    });
    counts.created += result.created;
    counts.duplicate += result.duplicate;
    counts.ignored += result.ignored;
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
    if (!data || data.retentionPolicyVersion === 2 || !['email', 'whatsapp'].includes(data.channel)
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
