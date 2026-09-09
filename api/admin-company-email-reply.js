import { createHash } from 'node:crypto';
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors, isAdminCorsOriginAllowed } from './_shared/cors.js';
import { readCompanyGmailInboxConfig } from './_shared/company-gmail-inbox.js';
import { createCompanyGmailReplyResolver } from './_shared/company-gmail-reply-source.js';
import { createCompanyGmailSender, readCompanyGmailReplyConfig } from './_shared/company-gmail-reply-sender.js';
import { prepareApprovedExternalInboxReply, validateExternalInboxReplyRequest } from './_shared/external-inbox-reply-policy.js';
import { EXTERNAL_INBOX_REPLY_WORKFLOWS, EXTERNAL_INBOX_DRAFT_RETENTION_MS, prepareExternalInboxReplyDraft,
  approveExternalInboxReplyDraft, dispatchExternalInboxReply, validExternalInboxReplyWorkflowRecord } from './_shared/external-inbox-reply-workflow.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };
const METHODS = 'GET, POST, OPTIONS';
const MAX_BODY_BYTES = 20 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const plain = input => Boolean(input && typeof input === 'object' && !Array.isArray(input)
  && [Object.prototype, null].includes(Object.getPrototypeOf(input)));
const hash = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const time = input => Number.isSafeInteger(input) && input > 0 && input <= 8_640_000_000_000_000;
const editable = ['draft', 'draft_only'];
const locked = ['sending', 'provider_accepted', 'outcome_unknown', 'cancelled'];

function send(req, res, status, body) {
  res.writeHead(status, { ...buildAdminJsonCors(req, { methods: METHODS, headers: 'Authorization, Content-Type' }),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  return res.end(JSON.stringify(body));
}

function originAllowed(req) {
  const origin = req.headers?.origin || req.headers?.Origin || '';
  return !origin || isAdminCorsOriginAllowed(origin);
}

export function validCompanyEmailReplyAction(input) {
  if (!plain(input) || !validateExternalInboxReplyRequest(input.request).ok || input.request.channel !== 'email') return false;
  const keys = Object.keys(input);
  if (input.action === 'draft') {
    if (keys.some(key => !['action', 'request', 'expectedRevision', 'expectedDraftHash'].includes(key))) return false;
    const revision = Object.hasOwn(input, 'expectedRevision');
    const draftHash = Object.hasOwn(input, 'expectedDraftHash');
    return revision === draftHash && (!revision || (Number.isSafeInteger(input.expectedRevision)
      && input.expectedRevision > 0 && typeof input.expectedDraftHash === 'string' && HASH.test(input.expectedDraftHash)));
  }
  const retry = Object.hasOwn(input, 'expectedFailedAttemptId');
  return input.action === 'send' && keys.length === (retry ? 7 : 6)
    && (!retry || (typeof input.expectedFailedAttemptId === 'string' && UUID.test(input.expectedFailedAttemptId)))
    && ['action', 'request', 'expectedRevision', 'expectedDraftHash', 'expectedApprovalExpiresAtMs', 'confirmed'].every(key => Object.hasOwn(input, key))
    && input.confirmed === true && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0
    && typeof input.expectedDraftHash === 'string' && HASH.test(input.expectedDraftHash)
    && (input.expectedApprovalExpiresAtMs === 0 || time(input.expectedApprovalExpiresAtMs));
}

function bodyInput(req) {
  const type = req.headers?.['content-type'] || req.headers?.['Content-Type'] || '';
  const length = req.headers?.['content-length'] || req.headers?.['Content-Length'];
  if (!/^application\/json(?:\s*;|$)/i.test(String(type))) return null;
  if (length !== undefined && (!/^\d+$/.test(String(length)) || !Number.isSafeInteger(Number(length)) || Number(length) > MAX_BODY_BYTES)) return null;
  try {
    if (Buffer.isBuffer(req.body) && req.body.length > MAX_BODY_BYTES) return null;
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    if (Buffer.byteLength(typeof raw === 'string' ? raw : JSON.stringify(raw), 'utf8') > MAX_BODY_BYTES) return null;
    const input = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return validCompanyEmailReplyAction(input) ? input : null;
  } catch { return null; }
}

async function defaultLoadDb() {
  const { initAdminDb } = await import('./_shared/firebase-admin.js');
  return initAdminDb('admin-company-email-reply');
}

function inactiveView(id, reason) {
  return { messageId: id, sourceAtMs: 0, recipient: '', canCompose: false, canSend: false, reason, workflow: null };
}

function draftDeadline(record) {
  return record.draftExpiresAtMs || Math.min(record.createdAtMs + EXTERNAL_INBOX_DRAFT_RETENTION_MS,
    record.expiresAtMs > 0 ? record.expiresAtMs : record.createdAtMs + EXTERNAL_INBOX_DRAFT_RETENTION_MS);
}

function publicWorkflow(record) {
  return { request: { ...record.request }, status: record.status, revision: record.revision, draftHash: record.draftHash,
    approvalExpiresAtMs: record.approval?.expiresAtMs || 0, draftExpiresAtMs: draftDeadline(record),
    failedAttemptId: record.status === 'failed_pre_send' && record.retryAllowed === true && record.attempts === 1 ? record.attemptId : '',
    providerAccepted: Boolean(record.providerReceiptHash), deliveryVerified: false };
}

function validPurgedRecord(record, source, actor, at) {
  return plain(record) && record.schemaVersion === 1 && record.kind === 'reply_purged'
    && record.status === 'purged' && record.sourceHash === source && record.actorHash === actor
    && record.retentionVersion === 1 && [record.createdAtMs, record.draftExpiresAtMs, record.purgedAtMs].every(time)
    && record.createdAtMs < record.draftExpiresAtMs && record.draftExpiresAtMs <= record.purgedAtMs
    && record.purgedAtMs <= at && Object.keys(record).every(key => ['schemaVersion', 'kind', 'status', 'sourceHash',
      'actorHash', 'createdAtMs', 'draftExpiresAtMs', 'purgedAtMs', 'retentionVersion'].includes(key));
}

async function loadView({ db, id, actorUid, resolveEnvelope, replyConfig, now }) {
  const source = hash(['external-inbox-reply.source.v1', 'email', id]);
  const actor = hash(['external-inbox-reply.actor.v1', actorUid]);
  return db.runTransaction(async tx => {
    const recordDoc = await tx.get(db.collection(EXTERNAL_INBOX_REPLY_WORKFLOWS).doc(`reply-${source}`));
    const envelope = await resolveEnvelope(tx, { messageId: id, channel: 'email' });
    const at = now();
    if (!envelope || !time(at) || envelope.sourceAtMs > at || envelope.receivedAtMs > at
      || (envelope.expiresAtMs > 0 && envelope.expiresAtMs <= at)) return null;
    const record = recordDoc.exists ? recordDoc.data() : null;
    if (record?.kind === 'reply_purged') {
      if (!validPurgedRecord(record, source, actor, at)) throw new Error('REPLY_LEDGER_INVALID');
      return inactiveView(id, 'DRAFT_EXPIRED');
    }
    if (record && (!validExternalInboxReplyWorkflowRecord(record, { source, actor })
      || record.createdAtMs > at || record.updatedAtMs > at)) throw new Error('REPLY_LEDGER_INVALID');
    const expiredDraft = record && !locked.includes(record.status) && at >= draftDeadline(record);
    if (expiredDraft) return inactiveView(id, 'DRAFT_EXPIRED');
    const eligibility = prepareApprovedExternalInboxReply({ envelope, actorUid, nowMs: at,
      flags: { replyEnabled: true }, humanApproved: false, request: { messageId: id, channel: 'email',
        expectedSourceAtMs: envelope.sourceAtMs, key: '00000000-0000-4000-8000-000000000000', text: 'eligibility-check' } });
    const eligible = eligibility.code === 'HUMAN_APPROVAL_REQUIRED';
    const canCompose = (!record || editable.includes(record.status)) && (eligible || eligibility.code === 'REPLY_CONTEXT_MISSING');
    const canSend = replyConfig.dispatchEnabled && eligible && Boolean(record)
      && (['draft', 'approved'].includes(record.status)
        || (record.status === 'failed_pre_send' && record.retryAllowed === true && record.attempts === 1));
    return { messageId: id, sourceAtMs: envelope.sourceAtMs, recipient: envelope.recipient,
      canCompose, canSend, reason: !eligible ? eligibility.code : replyConfig.reason,
      workflow: record ? publicWorkflow(record) : null };
  });
}

function statusFor(result) {
  if (result.ok) return 200;
  if (/UNAVAILABLE|DEPENDENCY/.test(result.code || '')) return 503;
  if (result.code === 'SOURCE_CONTEXT_INVALID') return 404;
  return 409;
}

/** Human-confirmed company email replies only. Never an autonomous/customer-neutral send API. */
export function createAdminCompanyEmailReplyHandler({ authenticate = verifyAdminToken, loadDb = defaultLoadDb,
  now = Date.now, env = process.env, resolverFactory = createCompanyGmailReplyResolver,
  senderFactory = createCompanyGmailSender } = {}) {
  return async (req, res) => {
    if (!originAllowed(req)) return send(req, res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED' });
    if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: METHODS, headers: 'Authorization, Content-Type' })); return res.end(); }
    if (!['GET', 'POST'].includes(req.method)) return send(req, res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
    try {
      const auth = await authenticate(req);
      if (!auth.ok || typeof auth.uid !== 'string' || !auth.uid.trim()) return send(req, res, auth.status === 403 ? 403 : 401, { ok: false, code: 'ADMIN_REQUIRED' });
      const url = new URL(req.url || '/', 'https://cocotripkr.com');
      const input = req.method === 'POST' ? bodyInput(req) : null;
      const id = req.method === 'GET' ? url.searchParams.get('id') : input?.request.messageId;
      if (typeof id !== 'string' || !HASH.test(id) || (req.method === 'POST' && (!input || [...url.searchParams].length))
        || (req.method === 'GET' && (url.searchParams.getAll('id').length !== 1 || [...url.searchParams.keys()].some(key => key !== 'id')))) {
        return send(req, res, 400, { ok: false, code: 'INVALID_REQUEST' });
      }
      const at = now();
      if (!time(at)) return send(req, res, 503, { ok: false, code: 'REPLY_UNAVAILABLE' });
      const inboxConfig = readCompanyGmailInboxConfig(env, at);
      const replyConfig = readCompanyGmailReplyConfig(env, inboxConfig);
      if (!replyConfig.replyEnabled) return req.method === 'GET'
        ? send(req, res, 200, { ok: true, data: inactiveView(id, replyConfig.reason) })
        : send(req, res, 503, { ok: false, code: replyConfig.reason });
      if (input?.action === 'send' && !replyConfig.dispatchEnabled) return send(req, res, 503, { ok: false, code: replyConfig.reason });
      const db = await loadDb();
      if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') return send(req, res, 503, { ok: false, code: 'REPLY_UNAVAILABLE' });
      const resolveEnvelope = resolverFactory({ db, inboxConfig, now });
      if (req.method === 'GET') {
        const data = await loadView({ db, id, actorUid: auth.uid, resolveEnvelope, replyConfig, now });
        return data ? send(req, res, 200, { ok: true, data }) : send(req, res, 404, { ok: false, code: 'SOURCE_CONTEXT_INVALID' });
      }
      const options = { db, now, resolveEnvelope, request: input.request, actorUid: auth.uid,
        expectedRevision: input.expectedRevision, expectedDraftHash: input.expectedDraftHash,
        flags: { replyEnabled: true, dispatchEnabled: replyConfig.dispatchEnabled } };
      if (input.action === 'draft') {
        const result = await prepareExternalInboxReplyDraft(options);
        return send(req, res, statusFor(result), result);
      }
      const approval = await approveExternalInboxReplyDraft({ ...options, humanApproved: true,
        retryPreSend: Boolean(input.expectedFailedAttemptId), expectedFailedAttemptId: input.expectedFailedAttemptId,
        renewApproval: true, expectedApprovalExpiresAtMs: input.expectedApprovalExpiresAtMs });
      if (!approval.ok) return send(req, res, statusFor(approval), approval);
      const result = await dispatchExternalInboxReply({ ...options, send: senderFactory({ env, now }) });
      return send(req, res, statusFor(result), result);
    } catch { return send(req, res, 503, { ok: false, code: 'REPLY_UNAVAILABLE' }); }
  };
}

export default createAdminCompanyEmailReplyHandler();
