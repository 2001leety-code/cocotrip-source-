import { sessionDocId, validateSupportSession, validSupportAccount, validSupportSender, WHATSAPP_SESSIONS_COLLECTION, WHATSAPP_PRIVACY_MODE } from './whatsapp-support-sessions.js';

export const WHATSAPP_PRIVACY_COLLECTION = WHATSAPP_SESSIONS_COLLECTION;
const MAX_SESSIONS = 100;
const FIELDS = ['policyVersion', 'accountId', 'sender', 'status', 'startedAtMs', 'expiresAtMs', 'updatedAtMs', 'closedAtMs', 'lastStartMessageId'];
const validSender = validSupportSender;

/** Allows exclusions BEFORE receiving is enabled. Never reveals credentials or phone IDs. */
export function readWhatsAppPrivacyScope(env = process.env) {
  const production = env.VERCEL_ENV === undefined || env.VERCEL_ENV === 'production';
  const ready = production && env.WHATSAPP_INBOX_PRIVACY_MODE === WHATSAPP_PRIVACY_MODE
    && validSupportAccount(env.WHATSAPP_INBOX_PHONE_NUMBER_ID)
    && validSupportAccount(env.WHATSAPP_INBOX_WABA_ID);
  return { enabled: production && env.WHATSAPP_INBOX_ENABLED === 'true', ready,
    accountId: ready ? env.WHATSAPP_INBOX_PHONE_NUMBER_ID : '' };
}

export function publicWhatsAppPrivacySession(id, data, scope, nowMs) {
  if (!scope.ready || !validSender(data?.sender) || id !== sessionDocId(scope.accountId, data.sender)) return null;
  const session = validateSupportSession(data, { accountId: scope.accountId, sender: data.sender, sessionId: id });
  if (!session || session.updatedAtMs > nowMs || session.startedAtMs > nowMs || session.closedAtMs > nowMs) return null;
  return { id, sender: session.sender,
    status: session.status === 'active' && session.expiresAtMs <= nowMs ? 'closed' : session.status,
    startedAtMs: session.startedAtMs || null, expiresAtMs: session.expiresAtMs || null, updatedAtMs: session.updatedAtMs };
}

export async function loadWhatsAppPrivacy({ db, scope, nowMs, timeoutMs = 3000 }) {
  const base = { generatedAtMs: nowMs, enabled: scope.enabled, ready: scope.ready, sessions: [], possiblyTruncated: false };
  if (!scope.ready) return base;
  let timer;
  try {
    const query = db.collection(WHATSAPP_PRIVACY_COLLECTION).where('accountId', '==', scope.accountId)
      .select(...FIELDS).limit(MAX_SESSIONS + 1);
    const snapshot = await Promise.race([query.get(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('PRIVACY_READ_TIMEOUT')), timeoutMs);
    })]);
    return { ...base, sessions: snapshot.docs.slice(0, MAX_SESSIONS)
      .map(doc => publicWhatsAppPrivacySession(doc.id, doc.data(), scope, nowMs)).filter(Boolean),
    possiblyTruncated: snapshot.docs.length > MAX_SESSIONS };
  } finally { clearTimeout(timer); }
}

export function validateWhatsAppPrivacyAction(body) {
  return body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).length === 2 && Object.hasOwn(body, 'action') && Object.hasOwn(body, 'sender')
    && ['close', 'block', 'unblock'].includes(body.action) && validSender(body.sender);
}

/** No opening override: unblocking leaves a closed session and requires a fresh customer START. */
export async function applyWhatsAppPrivacyAction({ db, scope, action, sender, now = Date.now }) {
  if (!scope.ready || !validateWhatsAppPrivacyAction({ action, sender })) throw new Error('PRIVACY_ACTION_INVALID');
  const id = sessionDocId(scope.accountId, sender);
  const ref = db.collection(WHATSAPP_PRIVACY_COLLECTION).doc(id);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? validateSupportSession(snapshot.data(), { accountId: scope.accountId, sender, sessionId: id }) : null;
    // A damaged existing record must not be converted into an openable session by an unblock.
    if (snapshot.exists && !previous && action !== 'block') throw new Error('PRIVACY_SESSION_INVALID');
    const nowMs = now();
    if (!Number.isSafeInteger(nowMs) || nowMs <= 0
      || (previous && (previous.updatedAtMs > nowMs || previous.closedAtMs > nowMs))) throw new Error('PRIVACY_TIME_INVALID');
    const status = action === 'block' || (action === 'close' && previous?.status === 'blocked') ? 'blocked' : 'closed';
    transaction.set(ref, { policyVersion: 1, accountId: scope.accountId, sender, status,
      startedAtMs: previous?.startedAtMs || 0, expiresAtMs: previous?.expiresAtMs || 0,
      updatedAtMs: nowMs, closedAtMs: Math.max(nowMs, previous?.closedAtMs || 0),
      lastStartMessageId: previous?.lastStartMessageId || '' });
  });
}
