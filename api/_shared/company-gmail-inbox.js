import { createHash, randomUUID } from 'node:crypto';
import {
  EXTERNAL_INBOX_MESSAGES_COLLECTION, EXTERNAL_INBOX_STATE_COLLECTION, prepareExternalInboxMessage,
} from './external-inbox-store.js';
import { INBOX_CASES_COLLECTION, INBOX_CLOSED_RETENTION_DAYS, nextInboxCaseOnMessage } from './external-inbox-retention.js';

export const COMPANY_GMAIL_ACCOUNT = 'cocotripkr@gmail.com';
export const COMPANY_GMAIL_STATE_ID = 'company_gmail';
const PREFIX = 'COMPANY_GMAIL_INBOX_';
const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const DAY_MS = 86_400_000;
const LEASE_MS = 65_000;
const RUN_MS = 40_000;
const REQUEST_MS = 8_000;
const PAGE_SIZE = 10;
const MAX_PAGES = 3;
const MAX_MESSAGES = 20;
const MAX_PENDING_IDS = 500;

class InboxError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function fail(code) { throw new InboxError(code); }
function value(env, key) { return typeof env[PREFIX + key] === 'string' ? env[PREFIX + key].trim() : ''; }
function validId(input) { return typeof input === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input); }
function validHistory(input) { return typeof input === 'string' && /^[1-9][0-9]{0,39}$/.test(input); }
function validPage(input) { return input === null || (typeof input === 'string' && input.length > 0 && input.length <= 4096); }
function safeTime(input) { return Number.isSafeInteger(input) && input > 0; }

/** Configuration presence is NOT a verified connection. Never return credentials to the admin API. */
export function readCompanyGmailInboxConfig(env = process.env, nowMs = Date.now()) {
  const productionOnly = env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== 'production';
  const enabled = value(env, 'ENABLED') === 'true' && !productionOnly;
  const missing = ['EMAIL', 'CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN', 'CAPTURE_START_AT', 'RETENTION_DAYS']
    .filter((key) => !value(env, key)).map((key) => PREFIX + key);
  const start = value(env, 'CAPTURE_START_AT');
  const parsedStart = Date.parse(start);
  const validStart = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(start)
    && safeTime(parsedStart) && parsedStart <= nowMs
    && new Date(parsedStart).toISOString() === start.replace(/(?<!\.\d{3})Z$/, '.000Z');
  const retention = value(env, 'RETENTION_DAYS');
  const retentionDays = /^[1-9][0-9]?$/.test(retention) && Number(retention) <= 90 ? Number(retention) : null;
  let reason = null;
  if (productionOnly) reason = 'PRODUCTION_ONLY';
  else if (!enabled) reason = 'DISABLED';
  else if (missing.length) reason = 'CONFIGURATION_REQUIRED';
  else if (value(env, 'EMAIL').toLowerCase() !== COMPANY_GMAIL_ACCOUNT) reason = 'COMPANY_ACCOUNT_REQUIRED';
  else if (!validStart) reason = 'CAPTURE_START_INVALID';
  else if (!retentionDays) reason = 'RETENTION_INVALID';
  return { enabled, ready: enabled && !reason, status: !enabled ? 'disabled' : reason ? 'not_configured' : 'ready',
    reason, accountId: COMPANY_GMAIL_ACCOUNT, captureStartAtMs: validStart ? parsedStart : null, retentionDays, missing };
}

function fingerprint(config) {
  return createHash('sha256').update(JSON.stringify([1, config.accountId, config.captureStartAtMs, config.retentionDays])).digest('hex');
}

function validateState(state) {
  if (state.version !== 1 || !['bootstrap', 'history'].includes(state.phase)
    || !['syncing', 'connected', 'error', 'resync_required'].includes(state.status)
    || !Number.isSafeInteger(state.fence) || state.fence < 1 || !Number.isSafeInteger(state.leaseUntilMs)
    || state.leaseUntilMs < 0 || (state.lastSuccessAtMs !== null && !safeTime(state.lastSuccessAtMs))
    || !validPage(state.pageToken) || (state.baselineHistoryId !== null && !validHistory(state.baselineHistoryId))
    || (state.cursorHistoryId !== null && !validHistory(state.cursorHistoryId))
    || (state.phase === 'bootstrap' && state.cursorHistoryId !== null)
    || ((!state.baselineHistoryId) && (state.pageToken !== null || state.pending !== null))
    || (state.phase === 'history' && !validHistory(state.cursorHistoryId || state.baselineHistoryId))) fail('STATE_INVALID');
  if (state.pending !== null) {
    const pending = state.pending;
    if (!pending || !Array.isArray(pending.ids) || pending.ids.length > MAX_PENDING_IDS
      || pending.ids.some((id) => !validId(id)) || new Set(pending.ids).size !== pending.ids.length
      || !Number.isSafeInteger(pending.index) || pending.index < 0 || pending.index > pending.ids.length
      || !validPage(pending.nextPageToken)
      || (state.phase === 'history' && !validHistory(pending.finalHistoryId))) fail('STATE_INVALID');
  }
}

async function acquire(db, config, nowMs, owner) {
  const ref = db.collection(EXTERNAL_INBOX_STATE_COLLECTION).doc(COMPANY_GMAIL_STATE_ID);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const prior = snap.exists ? snap.data() : null;
    if (prior && (prior.configFingerprint !== fingerprint(config) || prior.accountId !== config.accountId
      || prior.captureStartAtMs !== config.captureStartAtMs || prior.retentionDays !== config.retentionDays)) return { code: 'CONFIGURATION_CHANGED' };
    if (prior) validateState(prior);
    if (prior?.status === 'resync_required') return { code: 'RESYNC_REQUIRED' };
    if (prior && prior.leaseUntilMs > nowMs) return { code: 'BUSY' };
    const state = { ...(prior || { version: 1, phase: 'bootstrap', cursorHistoryId: null, baselineHistoryId: null,
      pageToken: null, pending: null, lastSuccessAtMs: null }),
    configFingerprint: fingerprint(config), accountId: config.accountId, captureStartAtMs: config.captureStartAtMs,
    retentionDays: config.retentionDays, status: 'syncing', lastAttemptAtMs: nowMs, lastErrorCode: null,
    leaseOwner: owner, leaseUntilMs: nowMs + LEASE_MS, fence: (prior?.fence || 0) + 1 };
    tx.set(ref, state);
    return { code: 'ACQUIRED', ref, state, owner, fence: state.fence };
  });
}

/** Every message write and cursor movement is fenced in the same transaction. */
async function commit(db, control, now, change, prepared = null) {
  const messageRef = prepared ? db.collection(EXTERNAL_INBOX_MESSAGES_COLLECTION).doc(prepared.docId) : null;
  const inboxCaseRef = prepared ? db.collection(INBOX_CASES_COLLECTION).doc(prepared.data.caseId) : null;
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(control.ref);
    const current = snap.data();
    if (!snap.exists || current.leaseOwner !== control.owner || current.fence !== control.fence
      || current.leaseUntilMs <= now()) fail('LEASE_LOST');
    const priorMessage = messageRef ? await tx.get(messageRef) : null;
    const priorCase = inboxCaseRef ? await tx.get(inboxCaseRef) : null;
    // Firestore reads may wait/retry; test the fence again at the write boundary.
    const commitAtMs = now();
    if (current.leaseUntilMs <= commitAtMs) fail('LEASE_LOST');
    const patch = change(current);
    const created = Boolean(messageRef && !priorMessage.exists);
    const messageData = created ? { ...prepared.data, receivedAtMs: commitAtMs } : null;
    if (created) tx.create(messageRef, messageData);
    if (created) tx.set(inboxCaseRef, nextInboxCaseOnMessage(priorCase.exists ? priorCase.data() : null, messageData, commitAtMs));
    tx.update(control.ref, patch);
    return { state: { ...current, ...patch }, created };
  });
  control.state = result.state;
  return result;
}

/** Fixed provider URLs only; redirects, refresh-token persistence and raw error logging are forbidden. */
async function requestJson(fetchImpl, url, init, context, purpose) {
  const remaining = context.deadline - context.now();
  if (remaining <= 0) fail('RUN_BUDGET_REACHED');
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal });
        if (!response.ok) {
          if (response.status === 404 && purpose === 'history') fail('RESYNC_REQUIRED');
          if (response.status === 404 && purpose === 'message') return null; // Removed after listing: do not store stale content.
          if (response.status === 400 && purpose === 'page') fail('PAGE_TOKEN_INVALID');
          if (response.status === 401 || response.status === 403 || (response.status === 400 && purpose === 'token')) fail('GMAIL_AUTH_REQUIRED');
          if (response.status === 429) fail('GMAIL_RATE_LIMITED');
          fail('GMAIL_UNAVAILABLE');
        }
        const raw = await response.text();
        if (raw.length > 512_000) fail('GMAIL_RESPONSE_INVALID');
        let data;
        try { data = JSON.parse(raw); } catch { fail('GMAIL_RESPONSE_INVALID'); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) fail('GMAIL_RESPONSE_INVALID');
        return data;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new InboxError('GMAIL_TIMEOUT'));
      }, Math.min(REQUEST_MS, remaining)); }),
    ]);
  } catch (error) {
    if (error instanceof InboxError) throw error;
    fail('GMAIL_UNAVAILABLE');
  } finally { clearTimeout(timer); }
}

async function gmailClient(env, fetchImpl, context) {
  const token = await requestJson(fetchImpl, 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: value(env, 'CLIENT_ID'),
      client_secret: value(env, 'CLIENT_SECRET'), refresh_token: value(env, 'REFRESH_TOKEN') }).toString(),
  }, context, 'token');
  const scopes = typeof token.scope === 'string' ? token.scope.split(/\s+/).filter(Boolean) : [];
  if (!scopes.includes(READ_SCOPE) || scopes.some((scope) => /gmail\.|^https:\/\/mail.google.com\//.test(scope) && scope !== READ_SCOPE)) fail('READONLY_SCOPE_REQUIRED');
  if (typeof token.access_token !== 'string' || !token.access_token || /[\r\n]/.test(token.access_token)
    || String(token.token_type || '').toLowerCase() !== 'bearer') fail('GMAIL_AUTH_REQUIRED');
  return async (path, params, purpose) => {
    const url = new URL(path, GMAIL_BASE);
    for (const [key, val] of params) if (val !== null) url.searchParams.append(key, String(val));
    return requestJson(fetchImpl, url.toString(), { method: 'GET', headers: { Authorization: `Bearer ${token.access_token}` } }, context, purpose);
  };
}

function nextPage(data) {
  const page = data.nextPageToken === undefined ? null : data.nextPageToken;
  if (!validPage(page)) fail('GMAIL_RESPONSE_INVALID');
  return page;
}

function messageIds(data, phase) {
  let entries;
  if (phase === 'bootstrap') {
    entries = data.messages === undefined ? [] : data.messages;
    if (!Array.isArray(entries)) fail('GMAIL_RESPONSE_INVALID');
  } else {
    const history = data.history === undefined ? [] : data.history;
    if (!Array.isArray(history)) fail('GMAIL_RESPONSE_INVALID');
    entries = [];
    for (const item of history) {
      if (!item || !validHistory(item.id)) fail('GMAIL_RESPONSE_INVALID');
      for (const field of ['messagesAdded', 'labelsAdded']) {
        const changes = item[field] === undefined ? [] : item[field];
        if (!Array.isArray(changes)) fail('GMAIL_RESPONSE_INVALID');
        for (const change of changes) {
          if (!change?.message || !validId(change.message.id)) fail('GMAIL_RESPONSE_INVALID');
          if (field === 'labelsAdded' && (!Array.isArray(change.labelIds) || change.labelIds.some((label) => typeof label !== 'string'))) fail('GMAIL_RESPONSE_INVALID');
          if (field === 'messagesAdded' && change.message.labelIds !== undefined) {
            if (!Array.isArray(change.message.labelIds) || change.message.labelIds.some((label) => typeof label !== 'string')) fail('GMAIL_RESPONSE_INVALID');
            if (!change.message.labelIds.includes('INBOX')) continue;
          }
          if (field === 'messagesAdded' || (Array.isArray(change.labelIds) && change.labelIds.includes('INBOX'))) entries.push(change.message);
        }
      }
    }
  }
  if (entries.some((entry) => !entry || !validId(entry.id))) fail('GMAIL_RESPONSE_INVALID');
  const ids = [...new Set(entries.map((entry) => entry.id))];
  if (ids.length > MAX_PENDING_IDS) fail('GMAIL_PAGE_TOO_LARGE');
  return ids;
}

async function loadPage(get, state, config) {
  const bootstrap = state.phase === 'bootstrap';
  const params = bootstrap
    ? [['maxResults', PAGE_SIZE], ['labelIds', 'INBOX'], ['includeSpamTrash', 'false'],
      // One second overlap plus exact internalDate filtering preserves the cutover boundary.
      ['q', `after:${Math.max(0, Math.floor(config.captureStartAtMs / 1000) - 1)}`],
      ['fields', 'messages(id),nextPageToken']]
    : [['maxResults', PAGE_SIZE], ['startHistoryId', state.cursorHistoryId || state.baselineHistoryId], ['labelId', 'INBOX'],
      ['historyTypes', 'messageAdded'], ['historyTypes', 'labelAdded'],
      ['fields', 'history(id,messagesAdded(message(id,labelIds)),labelsAdded(message(id),labelIds)),nextPageToken,historyId']];
  params.push(['pageToken', state.pageToken]);
  const page = await get(bootstrap ? 'messages' : 'history', params, bootstrap ? 'page' : 'history');
  const nextPageToken = nextPage(page);
  if (nextPageToken && nextPageToken === state.pageToken) fail('PAGE_TOKEN_INVALID');
  if (!bootstrap && (!validHistory(page.historyId) || BigInt(page.historyId) < BigInt(state.cursorHistoryId || state.baselineHistoryId))) fail('GMAIL_RESPONSE_INVALID');
  return { ids: messageIds(page, state.phase), index: 0, nextPageToken,
    finalHistoryId: bootstrap ? null : page.historyId };
}

async function prepareMessage(get, id, config, now) {
  const message = await get(`messages/${encodeURIComponent(id)}`, [['format', 'metadata'], ['metadataHeaders', 'From'],
    ['metadataHeaders', 'Subject'], ['fields', 'id,threadId,internalDate,labelIds,snippet,payload/headers']], 'message');
  if (!message) return null;
  const nowMs = now();
  if (message.id !== id || !validId(message.threadId) || !Array.isArray(message.labelIds)) fail('GMAIL_MESSAGE_INVALID');
  const sourceAtMs = typeof message.internalDate === 'string' && /^\d+$/.test(message.internalDate) ? Number(message.internalDate) : NaN;
  if (!safeTime(sourceAtMs) || sourceAtMs > nowMs) fail('GMAIL_MESSAGE_INVALID');
  if (!message.labelIds.includes('INBOX') || sourceAtMs < config.captureStartAtMs
    || sourceAtMs + Math.min(config.retentionDays, INBOX_CLOSED_RETENTION_DAYS) * DAY_MS <= nowMs) return null;
  const headers = message.payload?.headers;
  if (!Array.isArray(headers) || headers.some((header) => !header || typeof header.name !== 'string' || typeof header.value !== 'string')
    || (message.snippet !== undefined && typeof message.snippet !== 'string')) fail('GMAIL_MESSAGE_INVALID');
  const header = (name) => headers.find((item) => item.name.toLowerCase() === name)?.value || '';
  return prepareExternalInboxMessage({ channel: 'email', accountId: config.accountId, providerMessageId: id,
    providerThreadId: message.threadId, sourceAtMs, sender: header('from'), subject: header('subject'),
    text: message.snippet || '', kind: 'email', truncated: true }, { nowMs, retentionDays: config.retentionDays });
}

async function defaultServices() {
  const { initAdminDb } = await import('./firebase-admin.js');
  const db = initAdminDb('company-gmail-inbox');
  if (!db) fail('STORE_UNAVAILABLE');
  return { db };
}

/** Receive only. No send, label change, mark-read, HTML/body/attachment fetch, AI call or local-token access. */
export async function companyGmailInboxSweepTask(options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const started = now();
  const config = readCompanyGmailInboxConfig(env, started);
  if (!config.ready) return { ok: !config.enabled, code: config.reason, enabled: config.enabled, status: config.status };
  const result = { ok: true, code: 'SYNC_IN_PROGRESS', enabled: true, status: 'syncing', scanned: 0, created: 0, duplicates: 0, skipped: 0, pages: 0 };
  let services;
  let control;
  try {
    services = await (options.loadServices || defaultServices)();
    control = await acquire(services.db, config, now(), randomUUID());
    if (control.code !== 'ACQUIRED') return { ...result, ok: control.code === 'BUSY', code: control.code,
      status: control.code === 'RESYNC_REQUIRED' ? 'resync_required' : control.code === 'BUSY' ? 'syncing' : 'error' };
    const get = await gmailClient(env, options.fetchImpl || globalThis.fetch, { now, deadline: started + RUN_MS });
    const profile = await get('profile', [['fields', 'emailAddress,historyId']], 'profile');
    if (typeof profile.emailAddress !== 'string' || profile.emailAddress.trim().toLowerCase() !== COMPANY_GMAIL_ACCOUNT) fail('COMPANY_ACCOUNT_MISMATCH');
    if (!validHistory(profile.historyId)) fail('GMAIL_RESPONSE_INVALID');
    if (!control.state.baselineHistoryId) await commit(services.db, control, now, () => ({ baselineHistoryId: profile.historyId }));

    while (now() - started < RUN_MS && result.scanned < MAX_MESSAGES) {
      if (!control.state.pending) {
        if (result.pages >= MAX_PAGES) break;
        const pending = await loadPage(get, control.state, config);
        await commit(services.db, control, now, () => ({ pending }));
        result.pages++;
      }
      while (control.state.pending.index < control.state.pending.ids.length && result.scanned < MAX_MESSAGES && now() - started < RUN_MS) {
        const index = control.state.pending.index;
        const id = control.state.pending.ids[index];
        const prepared = await prepareMessage(get, id, config, now);
        const committed = await commit(services.db, control, now, (current) => {
          if (current.pending?.index !== index || current.pending.ids[index] !== id) fail('STATE_INVALID');
          return { pending: { ...current.pending, index: index + 1 } };
        }, prepared);
        result.scanned++;
        if (!prepared) result.skipped++;
        else if (committed.created) result.created++;
        else result.duplicates++;
      }
      if (control.state.pending.index < control.state.pending.ids.length) break;
      const pending = control.state.pending;
      if (pending.nextPageToken) {
        await commit(services.db, control, now, () => ({ pageToken: pending.nextPageToken, pending: null }));
      } else if (control.state.phase === 'bootstrap') {
        // Never promote the initial profile to a completed cursor until its catch-up history is consumed.
        await commit(services.db, control, now, () => ({ phase: 'history', pageToken: null, pending: null }));
      } else {
        await commit(services.db, control, now, () => ({ cursorHistoryId: pending.finalHistoryId,
          pageToken: null, pending: null, status: 'connected', lastSuccessAtMs: now(), lastErrorCode: null }));
        return { ...result, code: 'SYNC_COMPLETE', status: 'connected' };
      }
    }
    return result;
  } catch (error) {
    const code = error instanceof InboxError ? error.code : 'INBOX_SYNC_FAILED';
    const status = code === 'RESYNC_REQUIRED' || code === 'PAGE_TOKEN_INVALID' ? 'resync_required' : 'error';
    if (control?.ref && services) {
      try { await commit(services.db, control, now, () => ({ status, lastErrorCode: code })); } catch { /* Lost fence never writes over another run. */ }
    }
    return { ...result, ok: false, code, status };
  } finally {
    if (control?.ref && services) {
      try {
        await services.db.runTransaction(async (tx) => {
          const snap = await tx.get(control.ref);
          if (snap.data()?.leaseOwner === control.owner && snap.data()?.fence === control.fence) tx.update(control.ref, { leaseUntilMs: 0 });
        });
      } catch { /* The lease expires; never log provider or database errors containing private values. */ }
    }
  }
}
