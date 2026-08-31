/**
 * 관리자 문의 답변 API.
 *
 * POST action:
 * - generate: 검토용 정책 초안 생성/재생성
 * - send: 현재 초안을 운영자가 검토한 본문으로 확정하고 저장된 이메일에 발송
 * - retry: 발송 전 실패로 확실한 건만 즉시 재시도
 * - resolve-outcome: 결과 불명 발송을 사람이 실제 메일함에서 확인해 해소
 * - mark-manual-sent: 이메일이 없는 문의를 전화/WhatsApp으로 수동 답변 완료 처리
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';
import { generateAndStoreInquiryDraft } from './_shared/inquiry-response-workflow.js';
import {
  approveAndSendInquiryResponse,
  retryApprovedInquiryResponse,
  validInquiryResponseEmail,
} from './_shared/inquiry-response-delivery.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };
const METHODS = 'POST,OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: METHODS }));
  return res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function validInquiryId(value) {
  const id = String(value || '').trim();
  return id && id.length <= 200 && !id.includes('/') ? id : null;
}

function publicWorkflow(workflow = {}) {
  return {
    draftStatus: workflow.draftStatus || null,
    draftSubject: workflow.draftSubject || null,
    draftBody: workflow.draftBody || null,
    draftLanguage: workflow.draftLanguage || null,
    draftSource: workflow.draftSource || null,
    draftRevision: Number(workflow.draftRevision || 0),
    draftAttempts: Number(workflow.draftAttempts || 0),
    nextDraftAttemptAtMs: workflow.nextDraftAttemptAtMs || null,
    lastDraftErrorCode: workflow.lastDraftErrorCode || null,
    reviewStatus: workflow.reviewStatus || null,
    approvedSubject: workflow.approvedSubject || null,
    approvedBody: workflow.approvedBody || null,
    approvedRevision: Number(workflow.approvedRevision || 0),
    deliveryStatus: workflow.deliveryStatus || null,
    deliveryAttempts: Number(workflow.deliveryAttempts || 0),
    nextDeliveryAttemptAtMs: workflow.nextDeliveryAttemptAtMs || null,
    lastDeliveryErrorCode: workflow.lastDeliveryErrorCode || null,
    deliveredAtMs: workflow.deliveredAtMs || null,
    policyVersion: workflow.policyVersion || null,
  };
}

function publicActionResult(result = {}) {
  return {
    ok: result.ok === true,
    code: result.code || 'UNKNOWN_RESULT',
    workflow: result.workflow ? publicWorkflow(result.workflow) : null,
  };
}

export async function resolveOutcome(db, inquiryId, auth, resolution, now) {
  const ref = db.collection('charter_inquiries').doc(inquiryId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND' };
    const data = snap.data() || {};
    const workflow = data.responseWorkflow && typeof data.responseWorkflow === 'object'
      ? data.responseWorkflow
      : {};
    if (['rejected', 'responded', 'closed', 'converted'].includes(String(data.status || '').trim().toLowerCase())) {
      return { ok: false, code: 'INQUIRY_CLOSED', workflow };
    }
    if (workflow.deliveryStatus !== 'outcome_unknown') {
      return { ok: false, code: 'NOT_OUTCOME_UNKNOWN' };
    }
    const sent = resolution === 'sent';
    const nextWorkflow = {
      ...workflow,
      deliveryStatus: sent ? 'sent' : 'not_sent',
      outcomeUnknown: false,
      outcomeResolvedBy: auth.email,
      outcomeResolvedAtMs: now,
      deliveredAtMs: sent ? workflow.deliveredAtMs || now : null,
      deliveryAttemptId: null,
      deliveryClaimedAtMs: null,
      nextDeliveryAttemptAtMs: null,
      lastDeliveryErrorCode: sent ? null : 'OPERATOR_CONFIRMED_NOT_SENT',
    };
    tx.update(ref, {
      responseWorkflow: nextWorkflow,
      updatedAtMs: now,
      ...(sent ? { status: 'responded' } : {}),
    });
    return { ok: true, code: sent ? 'SENT_CONFIRMED' : 'NOT_SENT_CONFIRMED', workflow: nextWorkflow };
  });
}

export async function markManualSent(db, inquiryId, auth, now) {
  const ref = db.collection('charter_inquiries').doc(inquiryId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND' };
    const data = snap.data() || {};
    const workflow = data.responseWorkflow && typeof data.responseWorkflow === 'object'
      ? data.responseWorkflow
      : {};
    if (workflow.deliveryStatus === 'sent') return { ok: true, code: 'ALREADY_SENT', workflow };
    if (['rejected', 'responded', 'closed', 'converted'].includes(String(data.status || '').trim().toLowerCase())) {
      return { ok: false, code: 'INQUIRY_CLOSED', workflow };
    }
    if (workflow.deliveryStatus === 'sending') return { ok: false, code: 'SEND_IN_PROGRESS', workflow };
    if (workflow.deliveryStatus === 'outcome_unknown') return { ok: false, code: 'OUTCOME_UNKNOWN', workflow };
    if (validInquiryResponseEmail(data.email) && workflow.deliveryStatus !== 'manual_required') {
      return { ok: false, code: 'MANUAL_NOT_ALLOWED', workflow };
    }
    const nextWorkflow = {
      ...workflow,
      deliveryStatus: 'sent',
      manualChannel: 'operator-confirmed',
      deliveredAtMs: now,
      manualConfirmedBy: auth.email,
      manualConfirmedAtMs: now,
      outcomeUnknown: false,
      deliveryAttemptId: null,
      deliveryClaimedAtMs: null,
      nextDeliveryAttemptAtMs: null,
    };
    tx.update(ref, { responseWorkflow: nextWorkflow, status: 'responded', updatedAtMs: now });
    return { ok: true, code: 'MANUAL_SENT_CONFIRMED', workflow: nextWorkflow };
  });
}

function statusForCode(code, fallback = 409) {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'INVALID_RESPONSE' || code === 'STALE_DRAFT') return 400;
  if (code === 'MANUAL_REQUIRED') return 422;
  if (code === 'AUTH_FAILED') return 401;
  return fallback;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, buildAdminCors(req, { methods: METHODS }));
    return res.end();
  }
  if (req.method !== 'POST') return json(req, res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });

  const auth = await verifyAdminToken(req);
  if (!auth.ok) return json(req, res, auth.status, { ok: false, code: 'AUTH_FAILED', error: auth.error });

  const body = parseBody(req);
  const inquiryId = validInquiryId(body.inquiryId);
  const action = String(body.action || '').trim();
  if (!inquiryId || !action) return json(req, res, 400, { ok: false, code: 'INVALID_REQUEST' });

  const db = initAdminDb('admin-inquiry-response');
  if (!db) return json(req, res, 503, { ok: false, code: 'FIRESTORE_UNAVAILABLE' });
  const now = Date.now();

  try {
    if (action === 'generate') {
      const result = await generateAndStoreInquiryDraft(db, inquiryId, {
        force: true,
        actor: `admin:${auth.email}`,
        now,
      });
      const status = result.ok ? 200 : statusForCode(result.code);
      return json(req, res, status, {
        ok: result.ok,
        code: result.code,
        workflow: result.workflow ? publicWorkflow(result.workflow) : null,
      });
    }

    if (action === 'send') {
      const result = await approveAndSendInquiryResponse(db, inquiryId, {
        expectedDraftRevision: Number(body.expectedDraftRevision),
        subject: body.subject,
        body: body.body,
        approvedBy: auth.email,
        now,
      });
      const status = result.ok
        ? 200
        : ['RETRY_SCHEDULED', 'OUTCOME_UNKNOWN'].includes(result.code) ? 202 : statusForCode(result.code, 409);
      return json(req, res, status, publicActionResult(result));
    }

    if (action === 'retry') {
      const result = await retryApprovedInquiryResponse(db, inquiryId, { now });
      const status = result.ok
        ? 200
        : ['RETRY_SCHEDULED', 'OUTCOME_UNKNOWN'].includes(result.code) ? 202 : statusForCode(result.code, 409);
      return json(req, res, status, publicActionResult(result));
    }

    if (action === 'resolve-outcome') {
      const resolution = body.resolution === 'sent' ? 'sent' : body.resolution === 'not_sent' ? 'not_sent' : null;
      if (!resolution) return json(req, res, 400, { ok: false, code: 'INVALID_RESOLUTION' });
      const result = await resolveOutcome(db, inquiryId, auth, resolution, now);
      return json(req, res, result.ok ? 200 : statusForCode(result.code), {
        ok: result.ok,
        code: result.code,
        workflow: result.workflow ? publicWorkflow(result.workflow) : null,
      });
    }

    if (action === 'mark-manual-sent') {
      const result = await markManualSent(db, inquiryId, auth, now);
      return json(req, res, result.ok ? 200 : statusForCode(result.code), {
        ok: result.ok,
        code: result.code,
        workflow: result.workflow ? publicWorkflow(result.workflow) : null,
      });
    }

    return json(req, res, 400, { ok: false, code: 'UNKNOWN_ACTION' });
  } catch (error) {
    console.error('[admin-inquiry-response]', action, inquiryId, error?.message);
    await captureError(error, { route: '/api/admin-inquiry-response', action, inquiryId });
    return json(req, res, 500, { ok: false, code: 'INTERNAL_ERROR' });
  }
}
