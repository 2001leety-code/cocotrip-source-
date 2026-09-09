import { createHash } from 'node:crypto';
import { companyGmailInboxConfigForAccount, readCompanyGmailInboxConfigs } from './company-gmail-inbox-registry.js';
import { readWhatsAppInboxConfig } from './whatsapp-inbox.js';
import { EXTERNAL_INBOX_MESSAGES_COLLECTION, EXTERNAL_INBOX_STATE_COLLECTION } from './external-inbox-store.js';
import {
  INBOX_CASES_COLLECTION, inboxCaseAllowsRead, inboxCaseId, publicInboxCase, validInboxCase,
} from './external-inbox-retention.js';
import { sessionDocId, validSupportAccount, validSupportSender } from './whatsapp-support-sessions.js';

const DAY_MS = 86_400_000;
const MAX_MESSAGES = 100;
const SUMMARY_FIELDS = ['channel', 'accountId', 'providerMessageId', 'providerThreadId', 'sourceAtMs', 'receivedAtMs', 'sender', 'subject', 'kind', 'truncated', 'expiresAtMs', 'whatsappPolicyVersion', 'whatsappSessionId', 'retentionPolicyVersion', 'caseId'];
const STATE_FIELDS = ['accountId', 'status', 'captureStartAtMs', 'retentionDays', 'workLabelId', 'lastSuccessAtMs', 'lastReceivedAtMs'];
const RETENTION_STATE_FIELDS = ['ok', 'code', 'checkedAtMs', 'copies.purged', 'drafts.purged'];
const positiveTime = value => Number.isSafeInteger(value) && value > 0;
const isControl = character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127;
const clean = (value, max) => typeof value === 'string'
  ? Array.from(value).filter(character => !isControl(character) || ['\t', '\n', '\r'].includes(character)).slice(0, max).join('') : '';

export function externalInboxConfigs(env = process.env, nowMs = Date.now()) {
  return { ...readCompanyGmailInboxConfigs(env, nowMs), whatsapp: readWhatsAppInboxConfig(env, nowMs) };
}

export function externalInboxChannelStatus(channel, config, state, nowMs, failed = false) {
  const base = { channel: config.channel || channel, status: config.status, lastSuccessAtMs: null, lastReceivedAtMs: null,
    ...(config.channel === 'email' ? { accountId: config.accountId } : {}) };
  if (!config.ready) return base;
  if (failed) return { ...base, status: 'unknown' };
  if (!state) return { ...base, status: 'awaiting' };
  if (state.accountId !== config.accountId || state.captureStartAtMs !== config.captureStartAtMs
    || state.retentionDays !== config.retentionDays
    || (config.stateId === 'secondary_gmail' && state.workLabelId !== config.labelId)) return { ...base, status: 'resync_required' };
  if (!['connected', 'syncing', 'error', 'resync_required'].includes(state.status)) return { ...base, status: 'unknown' };
  const lastSuccessAtMs = positiveTime(state.lastSuccessAtMs) && state.lastSuccessAtMs <= nowMs ? state.lastSuccessAtMs : null;
  const lastReceivedAtMs = positiveTime(state.lastReceivedAtMs) && state.lastReceivedAtMs <= nowMs ? state.lastReceivedAtMs : null;
  if (state.status === 'resync_required') return { ...base, status: 'resync_required', lastSuccessAtMs, lastReceivedAtMs };
  if (state.status === 'error') return { ...base, status: 'error', lastSuccessAtMs, lastReceivedAtMs };
  if (channel === 'whatsapp') return { ...base, status: lastReceivedAtMs ? 'received' : 'awaiting', lastSuccessAtMs, lastReceivedAtMs };
  return { ...base, status: !lastSuccessAtMs ? 'awaiting' : nowMs - lastSuccessAtMs > 20 * 60_000 ? 'delayed' : 'synced', lastSuccessAtMs, lastReceivedAtMs };
}

/** Recheck company/channel/date ownership for every list AND direct-id lookup. Never spread source objects. */
export function publicExternalInboxMessage(id, data, configs, nowMs, detail = false, inboxCase = null) {
  if (!data || !/^[a-f0-9]{64}$/.test(id) || !['email', 'whatsapp'].includes(data.channel)) return null;
  const config = data.channel === 'email'
    ? companyGmailInboxConfigForAccount(configs, data.accountId) : configs.whatsapp;
  if (!config?.ready || data.accountId !== config.accountId || typeof data.providerMessageId !== 'string'
    || !data.providerMessageId || data.providerMessageId.length > 512 || Array.from(data.providerMessageId).some(isControl)) return null;
  // Legacy/unscoped receipts are NOT proof of customer consent. Do not display their bodies or summaries.
  if (data.channel === 'whatsapp' && (data.whatsappPolicyVersion !== 1 || !validSupportAccount(config.accountId)
    || !validSupportSender(data.sender) || data.whatsappSessionId !== sessionDocId(config.accountId, data.sender))) return null;
  const expectedId = createHash('sha256').update(JSON.stringify(['external-inbox.v1', data.channel, data.accountId, data.providerMessageId])).digest('hex');
  if (expectedId !== id || !positiveTime(data.sourceAtMs) || data.sourceAtMs < config.captureStartAtMs || data.sourceAtMs > nowMs
    || !positiveTime(data.receivedAtMs) || data.receivedAtMs > nowMs) return null;
  const v2 = data.retentionPolicyVersion === 2;
  if (!v2 && (!positiveTime(data.expiresAtMs) || data.expiresAtMs <= nowMs
    || data.expiresAtMs !== data.sourceAtMs + config.retentionDays * DAY_MS)) return null;
  if (v2 && data.expiresAtMs !== 0) return null;
  let retention = null;
  if (v2) {
    let expectedCaseId;
    try { expectedCaseId = inboxCaseId(data); } catch { return null; }
    if (data.caseId !== expectedCaseId || !validInboxCase(inboxCase, expectedCaseId)
      || !inboxCaseAllowsRead(inboxCase, expectedCaseId, nowMs, data)) return null;
    retention = publicInboxCase(inboxCase, nowMs);
    if (!retention) return null;
  } else if (data.retentionPolicyVersion !== undefined) return null;
  const result = { id, channel: data.channel, sourceAtMs: data.sourceAtMs, receivedAtMs: data.receivedAtMs,
    sender: clean(data.sender, 320), subject: clean(data.subject, 256),
    kind: typeof data.kind === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(data.kind) ? data.kind : 'unknown', truncated: data.truncated === true,
    ...(data.channel === 'email' ? { accountId: data.accountId, replySupported: config.replySupported === true } : {}),
    ...(retention ? { retention } : {}) };
  return detail ? { ...result, text: clean(data.text, 4000) } : result;
}

function retentionMaintenance(state, nowMs, failed = false) {
  const base = { status: 'unknown', checkedAtMs: null, copiesPurged: null, draftsPurged: null };
  if (failed || !state || !positiveTime(state.checkedAtMs) || state.checkedAtMs > nowMs
    || !Number.isSafeInteger(state.copies?.purged) || state.copies.purged < 0
    || !Number.isSafeInteger(state.drafts?.purged) || state.drafts.purged < 0) return base;
  const result = { checkedAtMs: state.checkedAtMs, copiesPurged: state.copies.purged, draftsPurged: state.drafts.purged };
  if (state.ok === true && state.code === 'RETENTION_COMPLETED') {
    return { ...result, status: nowMs - state.checkedAtMs <= 2 * 60 * 60_000 ? 'ok' : 'delayed' };
  }
  if (state.ok === false || state.code === 'RETENTION_REVIEW_REQUIRED') return { ...result, status: 'attention' };
  return { ...result, status: 'unknown' };
}

async function loadRetentionMaintenance(db, nowMs, timeoutMs) {
  try {
    const snapshot = await bounded(db.collection(EXTERNAL_INBOX_STATE_COLLECTION).where('__name__', '==', 'retention')
      .select(...RETENTION_STATE_FIELDS).limit(1).get(), timeoutMs);
    return retentionMaintenance(snapshot.docs[0]?.data(), nowMs);
  } catch { return retentionMaintenance(null, nowMs, true); }
}

function caseIds(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (row?.retentionPolicyVersion !== 2) continue;
    try {
      const id = inboxCaseId(row);
      if (row.caseId === id) ids.add(id);
    } catch { /* The message-level gate safely hides malformed v2 records. */ }
  }
  return [...ids];
}

async function loadInboxCases(db, rows, timeoutMs) {
  const ids = caseIds(rows);
  if (!ids.length) return new Map();
  const docs = await bounded(Promise.all(ids.map(id => db.collection(INBOX_CASES_COLLECTION).doc(id).get())), timeoutMs);
  return new Map(docs.filter(doc => doc.exists).map(doc => [doc.id, doc.data()]));
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
        .where('__name__', '==', config.stateId || channel).select(...STATE_FIELDS).limit(1).get(), timeoutMs);
      return externalInboxChannelStatus(channel, config, state.docs[0]?.data(), nowMs);
    } catch { return externalInboxChannelStatus(channel, config, null, nowMs, true); }
  }));
  const base = { generatedAtMs: nowMs, channels, messages: [], possiblyTruncated: false, listStatus: 'not_connected',
    retentionMaintenance: { status: 'not_active', checkedAtMs: null, copiesPurged: null, draftsPurged: null } };
  if (!Object.values(configs).some(config => config.ready)) return base;
  const maintenance = loadRetentionMaintenance(db, nowMs, timeoutMs);
  try {
    const snapshot = await bounded(db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).orderBy('receivedAtMs', 'desc')
      .select(...SUMMARY_FIELDS).limit(MAX_MESSAGES + 1).get(), timeoutMs);
    const docs = snapshot.docs.slice(0, MAX_MESSAGES);
    const rows = docs.map(doc => ({ id: doc.id, data: doc.data() }));
    const cases = await loadInboxCases(db, rows.map(row => row.data), timeoutMs);
    const messages = rows.map(row => publicExternalInboxMessage(row.id, row.data, configs, nowMs, false, cases.get(row.data.caseId))).filter(Boolean);
    return { ...base, messages, possiblyTruncated: snapshot.docs.length > MAX_MESSAGES, listStatus: 'ok', retentionMaintenance: await maintenance };
  } catch { return { ...base, listStatus: 'unknown', retentionMaintenance: await maintenance }; }
}

export async function loadExternalInboxDetail({ db, id, configs, nowMs, timeoutMs = 3000 }) {
  const doc = await bounded(db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).doc(id).get(), timeoutMs);
  if (!doc.exists) return null;
  const data = doc.data();
  let inboxCase = null;
  if (data?.retentionPolicyVersion === 2) {
    try {
      const caseId = inboxCaseId(data);
      if (data.caseId !== caseId) return null;
      const caseDoc = await bounded(db.collection(INBOX_CASES_COLLECTION).doc(caseId).get(), timeoutMs);
      inboxCase = caseDoc.exists ? caseDoc.data() : null;
    } catch { return null; }
  }
  return publicExternalInboxMessage(doc.id, data, configs, nowMs, true, inboxCase);
}
