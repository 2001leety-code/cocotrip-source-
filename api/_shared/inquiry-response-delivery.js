/**
 * 검토가 끝난 문의 이메일의 한 번만 발송 상태기계.
 *
 * SMTP는 제공자 멱등 키가 없다. 그래서 발송 전 실패(preSend=true)만 자동
 * 재시도하고, SMTP에 넘긴 뒤 결과를 모르는 실패는 반드시 사람 확인 상태로
 * 격리한다.
 */
import { randomUUID } from 'crypto';
import { sendEmail } from '../_send-email.js';
import { escapeHtml } from './escape.js';

export const INQUIRY_DELIVERY_MAX_ATTEMPTS = 3;
export const INQUIRY_DELIVERY_CLAIM_MS = 10 * 60 * 1000;
const TERMINAL_INQUIRY_STATUSES = new Set(['rejected', 'responded', 'closed', 'converted']);

export function validInquiryResponseEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 200 && /^\S+@\S+\.\S+$/.test(email) ? email : null;
}

export function validateApprovedInquiryResponse(subjectValue, bodyValue) {
  const subject = String(subjectValue || '').replace(/[\r\n]+/g, ' ').trim();
  const body = String(bodyValue || '').replace(/\r\n/g, '\n').trim();
  if (subject.length < 5 || subject.length > 160) return null;
  if (body.length < 20 || body.length > 5000) return null;
  return { subject, body };
}

export function buildInquiryResponseHtml(body) {
  const paragraphs = String(body || '')
    .split(/\n{2,}/)
    .map((part) => `<p style="margin:0 0 16px;line-height:1.7;">${escapeHtml(part).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;color:#1f2937;font-family:Arial,sans-serif;"><div style="max-width:640px;margin:0 auto;padding:28px 18px;"><div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;">${paragraphs}</div><p style="margin:14px 0 0;text-align:center;color:#6b7280;font-size:12px;">CocoTripKR · cocotripkr.com</p></div></body></html>`;
}

function deliveryDelayMs(attempt) {
  return 5 * 60 * 1000 * (2 ** Math.max(0, Math.min(2, Number(attempt || 1) - 1)));
}

function workflowOf(data) {
  return data?.responseWorkflow && typeof data.responseWorkflow === 'object'
    ? data.responseWorkflow
    : {};
}

async function claimDelivery(db, inquiryId, options = {}) {
  const ref = db.collection('charter_inquiries').doc(inquiryId);
  const now = Number(options.now || Date.now());
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND' };
    const data = snap.data() || {};
    const workflow = workflowOf(data);
    if (workflow.deliveryStatus === 'sent') {
      return { ok: true, alreadySent: true, code: 'ALREADY_SENT', workflow };
    }
    if (TERMINAL_INQUIRY_STATUSES.has(String(data.status || '').trim().toLowerCase())) {
      return { ok: false, code: 'INQUIRY_CLOSED', workflow };
    }
    if (workflow.deliveryStatus === 'outcome_unknown') {
      return { ok: false, code: 'OUTCOME_UNKNOWN', workflow };
    }
    const claimedAt = Number(workflow.deliveryClaimedAtMs || 0);
    if (workflow.deliveryStatus === 'sending') {
      if (claimedAt > now - INQUIRY_DELIVERY_CLAIM_MS) {
        return { ok: false, code: 'SEND_IN_PROGRESS', workflow };
      }
      const staleWorkflow = {
        ...workflow,
        deliveryStatus: 'outcome_unknown',
        deliveryClaimedAtMs: null,
        nextDeliveryAttemptAtMs: null,
        lastDeliveryErrorCode: 'STALE_SEND_OUTCOME_UNKNOWN',
        outcomeUnknown: true,
      };
      tx.update(ref, { responseWorkflow: staleWorkflow, updatedAtMs: now });
      return { ok: false, code: 'OUTCOME_UNKNOWN', workflow: staleWorkflow };
    }

    const email = validInquiryResponseEmail(data.email);
    if (!email) {
      const manualWorkflow = {
        ...workflow,
        deliveryStatus: 'manual_required',
        nextDeliveryAttemptAtMs: null,
      };
      if (workflow.deliveryStatus !== 'manual_required') {
        tx.update(ref, { responseWorkflow: manualWorkflow, updatedAtMs: now });
      }
      return { ok: false, code: 'MANUAL_REQUIRED', workflow: manualWorkflow };
    }

    if (Number(workflow.deliveryAttempts || 0) >= INQUIRY_DELIVERY_MAX_ATTEMPTS) {
      const manualWorkflow = {
        ...workflow,
        deliveryStatus: 'manual_required',
        nextDeliveryAttemptAtMs: null,
        lastDeliveryErrorCode: workflow.lastDeliveryErrorCode || 'DELIVERY_ATTEMPTS_EXHAUSTED',
      };
      if (workflow.deliveryStatus !== 'manual_required') {
        tx.update(ref, { responseWorkflow: manualWorkflow, updatedAtMs: now });
      }
      return { ok: false, code: 'MANUAL_REQUIRED', workflow: manualWorkflow };
    }

    let approvedSubject = workflow.approvedSubject;
    let approvedBody = workflow.approvedBody;
    let approvedRevision = Number(workflow.approvedRevision || 0);

    if (options.approve) {
      const draftRevision = Number(workflow.draftRevision || 0);
      if (!draftRevision || draftRevision !== Number(options.expectedDraftRevision)) {
        return { ok: false, code: 'STALE_DRAFT' };
      }
      const approved = validateApprovedInquiryResponse(options.subject, options.body);
      if (!approved) return { ok: false, code: 'INVALID_RESPONSE' };
      approvedSubject = approved.subject;
      approvedBody = approved.body;
      approvedRevision = draftRevision;
    } else {
      const approved = validateApprovedInquiryResponse(approvedSubject, approvedBody);
      if (!approved || workflow.reviewStatus !== 'approved') {
        return { ok: false, code: 'NOT_APPROVED' };
      }
      if (workflow.deliveryStatus !== 'retryable') {
        return { ok: false, code: 'NOT_RETRYABLE' };
      }
      if (Number(workflow.nextDeliveryAttemptAtMs || 0) > now) {
        return { ok: false, code: 'RETRY_NOT_DUE' };
      }
    }

    const attempts = Number(workflow.deliveryAttempts || 0) + 1;
    const attemptId = randomUUID();
    const nextWorkflow = {
      ...workflow,
      reviewStatus: 'approved',
      approvedSubject,
      approvedBody,
      approvedRevision,
      approvedBy: options.approve ? String(options.approvedBy || 'admin') : workflow.approvedBy,
      approvedAtMs: options.approve ? now : workflow.approvedAtMs,
      deliveryStatus: 'sending',
      deliveryAttempts: attempts,
      deliveryAttemptId: attemptId,
      deliveryClaimedAtMs: now,
      nextDeliveryAttemptAtMs: null,
      lastDeliveryErrorCode: null,
    };
    tx.update(ref, { responseWorkflow: nextWorkflow, updatedAtMs: now });
    return {
      ok: true,
      inquiryId,
      ref,
      email,
      subject: approvedSubject,
      body: approvedBody,
      attemptId,
      attempts,
    };
  });
}

async function finishDelivery(db, claim, patch, now) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(claim.ref);
    if (!snap.exists) return false;
    const data = snap.data() || {};
    const workflow = workflowOf(data);
    if (workflow.deliveryAttemptId === claim.attemptId
      && patch.deliveryStatus === 'sent'
      && workflow.deliveryStatus === 'sent') {
      return workflow;
    }
    if (workflow.deliveryAttemptId !== claim.attemptId || workflow.deliveryStatus !== 'sending') {
      return null;
    }
    const terminal = TERMINAL_INQUIRY_STATUSES.has(String(data.status || '').trim().toLowerCase());
    const nextWorkflow = { ...workflow, ...patch };
    tx.update(claim.ref, {
      responseWorkflow: nextWorkflow,
      updatedAtMs: now,
      ...(patch.deliveryStatus === 'sent' && !terminal ? { status: 'responded' } : {}),
    });
    return nextWorkflow;
  });
}

export async function deliverClaimedInquiryResponse(db, claim, options = {}) {
  if (!claim?.ok || claim.alreadySent) return claim;
  const now = Number(options.now || Date.now());
  const sender = options.send || sendEmail;
  let info;
  try {
    info = await sender({
      to: claim.email,
      subject: claim.subject,
      text: claim.body,
      html: buildInquiryResponseHtml(claim.body),
    });
  } catch (error) {
    const preSend = error?.preSend === true;
    const retryable = preSend && claim.attempts < INQUIRY_DELIVERY_MAX_ATTEMPTS;
    const code = String(error?.code || error?.message || 'EMAIL_SEND_FAILED').slice(0, 160);
    let workflow = null;
    try {
      workflow = await finishDelivery(db, claim, {
        deliveryStatus: retryable ? 'retryable' : preSend ? 'manual_required' : 'outcome_unknown',
        deliveryClaimedAtMs: null,
        nextDeliveryAttemptAtMs: retryable ? now + deliveryDelayMs(claim.attempts) : null,
        lastDeliveryErrorCode: code,
        outcomeUnknown: !preSend,
      }, now);
    } catch {
      workflow = null;
    }
    if (!workflow) {
      return { ok: false, code: 'OUTCOME_UNKNOWN', inquiryId: claim.inquiryId };
    }
    return {
      ok: false,
      code: retryable ? 'RETRY_SCHEDULED' : preSend ? 'MANUAL_REQUIRED' : 'OUTCOME_UNKNOWN',
      inquiryId: claim.inquiryId,
      workflow,
    };
  }

  const sentPatch = {
    deliveryStatus: 'sent',
    deliveredAtMs: now,
    deliveryClaimedAtMs: null,
    nextDeliveryAttemptAtMs: null,
    lastDeliveryErrorCode: null,
    providerMessageId: String(info?.messageId || '').slice(0, 200) || null,
  };
  let workflow = null;
  for (let persistAttempt = 0; persistAttempt < 2 && !workflow; persistAttempt += 1) {
    try {
      workflow = await finishDelivery(db, claim, sentPatch, now);
    } catch {
      workflow = null;
    }
  }
  if (!workflow) {
    try {
      workflow = await finishDelivery(db, claim, {
        deliveryStatus: 'outcome_unknown',
        deliveryClaimedAtMs: null,
        nextDeliveryAttemptAtMs: null,
        lastDeliveryErrorCode: 'POST_SEND_STATE_PERSIST_FAILED',
        outcomeUnknown: true,
      }, now);
    } catch {
      workflow = null;
    }
  }
  if (!workflow || workflow.deliveryStatus !== 'sent') {
    return { ok: false, code: 'OUTCOME_UNKNOWN', inquiryId: claim.inquiryId, workflow };
  }
  return { ok: true, code: 'SENT', inquiryId: claim.inquiryId, workflow };
}

export async function approveAndSendInquiryResponse(db, inquiryId, options = {}) {
  const claim = await claimDelivery(db, inquiryId, { ...options, approve: true });
  return deliverClaimedInquiryResponse(db, claim, options);
}

export async function retryApprovedInquiryResponse(db, inquiryId, options = {}) {
  const claim = await claimDelivery(db, inquiryId, { ...options, approve: false });
  return deliverClaimedInquiryResponse(db, claim, options);
}

export async function recoverStaleInquiryDelivery(db, inquiryId, now = Date.now()) {
  const ref = db.collection('charter_inquiries').doc(inquiryId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() || {};
    const workflow = workflowOf(data);
    if (workflow.deliveryStatus !== 'sending') return false;
    if (Number(workflow.deliveryClaimedAtMs || 0) > Number(now) - INQUIRY_DELIVERY_CLAIM_MS) return false;
    tx.update(ref, {
      responseWorkflow: {
        ...workflow,
        deliveryStatus: 'outcome_unknown',
        deliveryClaimedAtMs: null,
        nextDeliveryAttemptAtMs: null,
        lastDeliveryErrorCode: 'STALE_SEND_OUTCOME_UNKNOWN',
        outcomeUnknown: true,
      },
      updatedAtMs: Number(now),
    });
    return true;
  });
}
