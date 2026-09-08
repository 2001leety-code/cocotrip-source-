import { createHash } from 'node:crypto';
import { readCompanyGmailInboxConfig } from './company-gmail-inbox.js';
import { readWhatsAppInboxConfig } from './whatsapp-inbox.js';
import { EXTERNAL_INBOX_MESSAGES_COLLECTION, EXTERNAL_INBOX_STATE_COLLECTION } from './external-inbox-store.js';

const DAY_MS = 86_400_000;
const MAX_MESSAGES = 100;
const SUMMARY_FIELDS = ['channel', 'accountId', 'providerMessageId', 'sourceAtMs', 'receivedAtMs', 'sender', 'subject', 'kind', 'truncated', 'expiresAtMs'];
const STATE_FIELDS = ['accountId', 'status', 'captureStartAtMs', 'retentionDays', 'lastSuccessAtMs', 'lastReceivedAtMs'];
const positiveTime = value => Number.isSafeInteger(value) && value > 0;
const isControl = character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127;
const clean = (value, max) => typeof value === 'string'
  ? Array.from(value).filter(character => !isControl(character) || ['\t', '\n', '\r'].includes(character)).slice(0, max).join('') : '';

export function externalInboxConfigs(env = process.env, nowMs = Date.now()) {
  return { email: readCompanyGmailInboxConfig(env, nowMs), whatsapp: readWhatsAppInboxConfig(env, nowMs) };
}

export function externalInboxChannelStatus(channel, config, state, nowMs, failed = false) {
  const base = { channel, status: config.status, lastSuccessAtMs: null, lastReceivedAtMs: null };
  if (!config.ready) return base;
  if (failed) return { ...base, status: 'unknown' };
  if (!state) return { ...base, status: 'awaiting' };
  if (state.accountId !== config.accountId || state.captureStartAtMs !== config.captureStartAtMs
    || state.retentionDays !== config.retentionDays) return { ...base, status: 'resync_required' };
  if (!['connected', 'syncing', 'error', 'resync_required'].includes(state.status)) return { ...base, status: 'unknown' };
  const lastSuccessAtMs = positiveTime(state.lastSuccessAtMs) && state.lastSuccessAtMs <= nowMs ? state.lastSuccessAtMs : null;
  const lastReceivedAtMs = positiveTime(state.lastReceivedAtMs) && state.lastReceivedAtMs <= nowMs ? state.lastReceivedAtMs : null;
  if (state.status === 'resync_required') return { ...base, status: 'resync_required', lastSuccessAtMs, lastReceivedAtMs };
  if (state.status === 'error') return { ...base, status: 'error', lastSuccessAtMs, lastReceivedAtMs };
  if (channel === 'whatsapp') return { ...base, status: lastReceivedAtMs ? 'received' : 'awaiting', lastSuccessAtMs, lastReceivedAtMs };
  return { ...base, status: !lastSuccessAtMs ? 'awaiting' : nowMs - lastSuccessAtMs > 20 * 60_000 ? 'delayed' : 'synced', lastSuccessAtMs, lastReceivedAtMs };
}

/** Recheck company/channel/date ownership for every list AND direct-id lookup. Never spread source objects. */
export function publicExternalInboxMessage(id, data, configs, nowMs, detail = false) {
  if (!data || !/^[a-f0-9]{64}$/.test(id) || !['email', 'whatsapp'].includes(data.channel)) return null;
  const config = configs[data.channel];
  if (!config?.ready || data.accountId !== config.accountId || typeof data.providerMessageId !== 'string'
    || !data.providerMessageId || data.providerMessageId.length > 512 || Array.from(data.providerMessageId).some(isControl)) return null;
  const expectedId = createHash('sha256').update(JSON.stringify(['external-inbox.v1', data.channel, data.accountId, data.providerMessageId])).digest('hex');
  if (expectedId !== id || !positiveTime(data.sourceAtMs) || data.sourceAtMs < config.captureStartAtMs || data.sourceAtMs > nowMs
    || !positiveTime(data.receivedAtMs) || data.receivedAtMs > nowMs
    || !positiveTime(data.expiresAtMs) || data.expiresAtMs <= nowMs
    || data.expiresAtMs !== data.sourceAtMs + config.retentionDays * DAY_MS) return null;
  const result = { id, channel: data.channel, sourceAtMs: data.sourceAtMs, receivedAtMs: data.receivedAtMs,
    sender: clean(data.sender, 320), subject: clean(data.subject, 256),
    kind: typeof data.kind === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(data.kind) ? data.kind : 'unknown', truncated: data.truncated === true };
  return detail ? { ...result, text: clean(data.text, 4000) } : result;
}

async function bounded(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('INBOX_READ_TIMEOUT')), timeoutMs); })]);
  } finally { clearTimeout(timer); }
}

export async function loadExternalInbox({ db, configs, nowMs, timeoutMs = 3000 }) {
  const channels = await Promise.all(Object.entries(configs).map(async ([channel, config]) => {
    if (!config.ready) return externalInboxChannelStatus(channel, config, null, nowMs);
    try {
      const state = await bounded(db.collection(EXTERNAL_INBOX_STATE_COLLECTION)
        .where('__name__', '==', channel === 'email' ? 'company_gmail' : 'whatsapp').select(...STATE_FIELDS).limit(1).get(), timeoutMs);
      return externalInboxChannelStatus(channel, config, state.docs[0]?.data(), nowMs);
    } catch { return externalInboxChannelStatus(channel, config, null, nowMs, true); }
  }));
  const base = { generatedAtMs: nowMs, channels, messages: [], possiblyTruncated: false, listStatus: 'not_connected' };
  if (!Object.values(configs).some(config => config.ready)) return base;
  try {
    const snapshot = await bounded(db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).orderBy('receivedAtMs', 'desc')
      .select(...SUMMARY_FIELDS).limit(MAX_MESSAGES + 1).get(), timeoutMs);
    const messages = snapshot.docs.slice(0, MAX_MESSAGES).map(doc => publicExternalInboxMessage(doc.id, doc.data(), configs, nowMs)).filter(Boolean);
    return { ...base, messages, possiblyTruncated: snapshot.docs.length > MAX_MESSAGES, listStatus: 'ok' };
  } catch { return { ...base, listStatus: 'unknown' }; }
}

export async function loadExternalInboxDetail({ db, id, configs, nowMs, timeoutMs = 3000 }) {
  const doc = await bounded(db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).doc(id).get(), timeoutMs);
  return doc.exists ? publicExternalInboxMessage(doc.id, doc.data(), configs, nowMs, true) : null;
}
