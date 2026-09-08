import { createHash, randomUUID } from 'node:crypto';

export const TELEGRAM_REPLY_RECEIPTS = 'telegram_chat_reply_receipts';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const MAX_CONFIRMATION_ATTEMPTS = 3;
const failure = code => Object.assign(new Error(code), { code });
const validDocumentId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && value === value.trim() && !value.includes('/') && value !== '.' && value !== '..'
  && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export function telegramReplyIdentity({ botNamespace, updateId, replyToMessageId, text, adminName }) {
  if (typeof botNamespace !== 'string' || !/^[a-z][a-z0-9:_-]{0,95}$/.test(botNamespace)
    || !Number.isSafeInteger(updateId) || updateId < 0 || !Number.isSafeInteger(replyToMessageId) || replyToMessageId <= 0
    || typeof text !== 'string' || !text || text.length > 16_384 || typeof adminName !== 'string') throw failure('RELAY_INPUT_INVALID');
  return { id: hash(['telegram-chat-reply.v1', botNamespace, updateId]),
    fingerprint: hash([replyToMessageId, text, adminName]), mapId: String(replyToMessageId) };
}

function receiptResult(data, identity) {
  if (!data || data.version !== 1 || data.fingerprint !== identity.fingerprint || !validDocumentId(data.sessionId)
    || !['ko', 'en', 'ja', 'zh'].includes(data.targetLang) || typeof data.translated !== 'boolean'
    || typeof data.translationFailed !== 'boolean' || data.status !== 'delivered') throw failure('RELAY_RECEIPT_CONFLICT');
  return { relayed: true, sessionId: data.sessionId, targetLang: data.targetLang,
    translated: data.translated, translationFailed: data.translationFailed, duplicate: true };
}

export async function readTelegramReplyReceipt(db, identity) {
  const snapshot = await db.collection(TELEGRAM_REPLY_RECEIPTS).doc(identity.id).get();
  return snapshot.exists ? receiptResult(snapshot.data(), identity) : null;
}

/** Mapping, one deterministic chat message, session head and receipt commit together. */
export async function commitTelegramReply({ db, identity, sessionId, targetLang, payload, outcome, timestamp }) {
  if (!validDocumentId(sessionId)) throw failure('RELAY_MAPPING_INVALID');
  const receiptRef = db.collection(TELEGRAM_REPLY_RECEIPTS).doc(identity.id);
  const mapRef = db.collection('inquiry_messages').doc(identity.mapId);
  const sessionRef = db.collection('chat_sessions').doc(sessionId);
  const messageRef = sessionRef.collection('messages').doc('telegram-' + identity.id);
  return db.runTransaction(async transaction => {
    const receipt = await transaction.get(receiptRef);
    if (receipt.exists) return receiptResult(receipt.data(), identity);
    const mapping = await transaction.get(mapRef);
    const map = mapping.exists ? mapping.data() : null;
    const currentLanguage = map && ['ko', 'en', 'ja', 'zh'].includes(map.language) ? map.language : 'en';
    if (!map || map.sessionId !== sessionId || currentLanguage !== targetLang) throw failure('RELAY_MAPPING_CHANGED');
    const existing = await transaction.get(messageRef);
    if (existing.exists) throw failure('RELAY_RECEIPT_CONFLICT');
    transaction.set(messageRef, payload);
    transaction.set(sessionRef, { lastMessageAt: timestamp(), lastMessageFrom: 'admin' }, { merge: true });
    transaction.set(receiptRef, { version: 1, status: 'delivered', fingerprint: identity.fingerprint,
      sessionId, targetLang, translated: outcome.translated, translationFailed: outcome.translationFailed,
      deliveredAt: timestamp(), confirmation: 'pending', confirmationAttempts: 0 });
    return { relayed: true, sessionId, targetLang, ...outcome, duplicate: false };
  });
}

/**
 * At most one outstanding send. An indeterminate send/claim is never blindly retried.
 * Only callBot's explicit Telegram rejection can retry (max 3); no timer reclaims a send.
 * A crash after the claim may lose the optional notice, but cannot duplicate the web reply.
 */
export async function sendTelegramReplyConfirmation({ db, identity, send, timestamp }) {
  const receiptRef = db.collection(TELEGRAM_REPLY_RECEIPTS).doc(identity.id);
  const attemptToken = randomUUID();
  const claim = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(receiptRef);
    if (!snapshot.exists) throw failure('RELAY_RECEIPT_MISSING');
    const data = snapshot.data();
    receiptResult(data, identity);
    if (!Number.isInteger(data.confirmationAttempts) || data.confirmationAttempts < 0 || data.confirmationAttempts > MAX_CONFIRMATION_ATTEMPTS
      || !['pending', 'sending', 'sent', 'uncertain', 'failed'].includes(data.confirmation)) throw failure('RELAY_RECEIPT_CONFLICT');
    if (data.confirmation !== 'pending') return { claimed: false, status: data.confirmation === 'sending' ? 'uncertain' : data.confirmation };
    if (data.confirmationAttempts >= MAX_CONFIRMATION_ATTEMPTS) return { claimed: false, status: 'failed' };
    transaction.set(receiptRef, { confirmation: 'sending', confirmationAttemptToken: attemptToken,
      confirmationAttempts: data.confirmationAttempts + 1, confirmationUpdatedAt: timestamp() }, { merge: true });
    return { claimed: true, attempts: data.confirmationAttempts + 1 };
  });
  if (!claim.claimed) return { status: claim.status, retry: false };
  let status = 'sent';
  try {
    const result = await send();
    if (!result || result.ok !== true) status = 'uncertain';
  } catch (error) {
    // Existing callBot constructs this prefix only after parsing a provider ok:false reply.
    const rejected = error instanceof Error && error.message.startsWith('Telegram sendMessage failed: ');
    status = rejected ? (claim.attempts < MAX_CONFIRMATION_ATTEMPTS ? 'pending' : 'failed') : 'uncertain';
  }
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(receiptRef);
    const data = snapshot.exists ? snapshot.data() : null;
    receiptResult(data, identity);
    if (data.confirmation !== 'sending' || data.confirmationAttemptToken !== attemptToken) throw failure('RELAY_CONFIRMATION_CONFLICT');
    transaction.set(receiptRef, { confirmation: status, confirmationUpdatedAt: timestamp() }, { merge: true });
  });
  return { status, retry: status === 'pending' };
}
