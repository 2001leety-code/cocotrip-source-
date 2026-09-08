import { createHash } from 'node:crypto';

export const WHATSAPP_SESSIONS_COLLECTION = 'whatsapp_inbox_sessions';
export const SESSION_DURATION_MS = 7_200_000;
export const START_FRESHNESS_MS = 120_000;
export const WHATSAPP_PRIVACY_MODE = 'explicit_sessions_v1';
const SESSION_KEYS = new Set(['policyVersion', 'accountId', 'sender', 'status', 'startedAtMs', 'expiresAtMs', 'updatedAtMs', 'closedAtMs', 'lastStartMessageId']);
const safeTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
export const validSupportAccount = value => typeof value === 'string' && /^\d{1,64}$/.test(value);
export const validSupportSender = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
export const validSupportMessageId = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && value === value.trim() && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

export function sessionDocId(accountId, sender) {
  if (!validSupportAccount(accountId) || !validSupportSender(sender)) throw new Error('SUPPORT_ID_INVALID');
  return createHash('sha256').update(JSON.stringify(['whatsapp-support.v1', accountId, sender])).digest('hex');
}

/** Pure strict schema check. Missing sender is allowed ONLY for an unknown STOP tombstone. */
export function validateSupportSession(data, { accountId, sender, sessionId } = {}) {
  if (!validSupportAccount(accountId) || !validSupportSender(sender)
    || sessionId !== sessionDocId(accountId, sender) || !data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !SESSION_KEYS.has(key)) || data.policyVersion !== 1 || data.accountId !== accountId
    || !['active', 'closed', 'blocked'].includes(data.status)
    || !['startedAtMs', 'expiresAtMs', 'updatedAtMs', 'closedAtMs'].every(key => safeTime(data[key]))
    || data.updatedAtMs <= 0 || data.closedAtMs > data.updatedAtMs || data.startedAtMs > data.updatedAtMs) return null;
  const noStart = data.startedAtMs === 0 && data.expiresAtMs === 0 && data.lastStartMessageId === '';
  const priorStart = data.startedAtMs > 0 && data.expiresAtMs === data.startedAtMs + SESSION_DURATION_MS
    && validSupportMessageId(data.lastStartMessageId);
  if (!noStart && !priorStart) return null;
  if (data.sender !== sender && !(data.sender === undefined && data.status === 'closed' && noStart)) return null;
  if (data.status === 'active' && (!priorStart || data.closedAtMs >= data.startedAtMs)) return null;
  if (data.status !== 'active' && data.closedAtMs <= 0) return null;
  return data;
}

/** Exact original text only: no trimming, case folding, control stripping, or AI classification. */
export function supportCommand(kind, text) {
  if (kind !== 'text') return 'message';
  if (text === 'COCOTRIP SUPPORT START') return 'start';
  if (text === 'COCOTRIP SUPPORT STOP' || text === 'STOP') return 'stop';
  return 'message';
}

/** No reads/writes. A malformed existing session must be rejected by the caller, never reset. */
export function transitionSupportSession(current, message, { nowMs }) {
  const result = { session: current, changed: false, allowMessage: false };
  const { sourceAtMs, accountId, sender, providerMessageId } = message;
  if (!safeTime(nowMs) || !nowMs || !safeTime(sourceAtMs) || !sourceAtMs || sourceAtMs > nowMs
    || !validSupportAccount(accountId) || !validSupportSender(sender) || !validSupportMessageId(providerMessageId)) return result;
  if (current && (current.updatedAtMs > nowMs || !validateSupportSession(current, { accountId, sender, sessionId: sessionDocId(accountId, sender) }))) return result;
  const command = supportCommand(message.kind, message.text);
  if (current && current.status === 'blocked') return result;
  if (command === 'stop') {
    // Receive-time barrier blocks delayed/duplicate STARTs, including STARTs ignored while active.
    if (current && (sourceAtMs <= current.closedAtMs || sourceAtMs < current.startedAtMs)) return result;
    const closed = current ? { ...current } : { policyVersion: 1, accountId,
      startedAtMs: 0, expiresAtMs: 0, lastStartMessageId: '' };
    return { session: { ...closed, status: 'closed', updatedAtMs: nowMs, closedAtMs: nowMs }, changed: true, allowMessage: false };
  }
  if (command === 'start') {
    if (nowMs - sourceAtMs > START_FRESHNESS_MS || (current && (sourceAtMs <= current.closedAtMs
      || providerMessageId === current.lastStartMessageId || (current.status === 'active' && sourceAtMs < current.expiresAtMs)))) return result;
    const session = { policyVersion: 1, accountId, sender, status: 'active', startedAtMs: sourceAtMs,
      expiresAtMs: sourceAtMs + SESSION_DURATION_MS, updatedAtMs: nowMs,
      closedAtMs: current ? current.closedAtMs : 0, lastStartMessageId: providerMessageId };
    if (!validateSupportSession(session, { accountId, sender, sessionId: sessionDocId(accountId, sender) })) return result;
    return { session, changed: true, allowMessage: false };
  }
  // Meta timestamps have second precision: equality cannot prove text followed consent.
  result.allowMessage = Boolean(current && current.status === 'active' && sourceAtMs > current.startedAtMs
    && sourceAtMs < current.expiresAtMs && nowMs < current.expiresAtMs);
  return result;
}
