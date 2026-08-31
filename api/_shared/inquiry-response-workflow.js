/** 문의 답변 초안 생성의 원자적 claim·재시도 상태 관리. */
import { randomUUID } from 'crypto';
import {
  generateInquiryResponseDraft,
  inquiryDraftRetryDelayMs,
  inquiryDraftSourceHash,
  INQUIRY_DRAFT_MAX_ATTEMPTS,
  INQUIRY_RESPONSE_POLICY_VERSION,
} from './inquiry-response.js';

const DRAFT_CLAIM_MS = 5 * 60 * 1000;
const TERMINAL_INQUIRY_STATUSES = new Set(['rejected', 'responded', 'closed', 'converted']);

function workflowOf(data) {
  return data?.responseWorkflow && typeof data.responseWorkflow === 'object'
    ? data.responseWorkflow
    : {};
}

export function shouldGenerateInquiryDraft(data = {}, now = Date.now()) {
  const workflow = workflowOf(data);
  if (TERMINAL_INQUIRY_STATUSES.has(String(data.status || '').trim().toLowerCase())) return false;
  if (workflow.deliveryStatus === 'sent' || workflow.reviewStatus === 'approved') return false;
  if (!workflow.draftStatus) return true;
  if (workflow.draftStatus === 'drafting') {
    return Number(workflow.draftClaimedAtMs || 0) <= Number(now) - DRAFT_CLAIM_MS;
  }
  if (workflow.policyVersion !== INQUIRY_RESPONSE_POLICY_VERSION) return true;
  return (workflow.draftStatus === 'retry_wait' || workflow.draftSource === 'template_fallback')
    && Number(workflow.draftAttempts || 0) < INQUIRY_DRAFT_MAX_ATTEMPTS
    && Number(workflow.nextDraftAttemptAtMs || 0) > 0
    && Number(workflow.nextDraftAttemptAtMs) <= Number(now);
}

export async function generateAndStoreInquiryDraft(db, inquiryId, options = {}) {
  const ref = db.collection('charter_inquiries').doc(inquiryId);
  const now = Number(options.now || Date.now());
  const claimId = randomUUID();

  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND' };
    const data = snap.data() || {};
    const workflow = workflowOf(data);
    if (TERMINAL_INQUIRY_STATUSES.has(String(data.status || '').trim().toLowerCase())) {
      return { ok: false, code: 'INQUIRY_CLOSED', workflow };
    }
    if (!options.force && !shouldGenerateInquiryDraft(data, now)) {
      return { ok: true, skipped: true, code: 'NOT_DUE', workflow };
    }
    if (workflow.deliveryStatus === 'sent' || workflow.reviewStatus === 'approved') {
      return { ok: false, code: 'ALREADY_APPROVED' };
    }
    if (workflow.draftStatus === 'drafting'
      && Number(workflow.draftClaimedAtMs || 0) > now - DRAFT_CLAIM_MS) {
      return { ok: false, code: 'DRAFT_IN_PROGRESS' };
    }
    const attempts = options.force ? 1 : Number(workflow.draftAttempts || 0) + 1;
    tx.update(ref, {
      responseWorkflow: {
        ...workflow,
        draftStatus: 'drafting',
        draftClaimId: claimId,
        draftClaimedAtMs: now,
        draftAttempts: attempts,
        nextDraftAttemptAtMs: null,
        policyVersion: INQUIRY_RESPONSE_POLICY_VERSION,
      },
      updatedAtMs: now,
    });
    return { ok: true, data, workflow, attempts };
  });

  if (!claim.ok || claim.skipped) return claim;

  let draft;
  try {
    const generator = options.generate || generateInquiryResponseDraft;
    draft = await generator(claim.data, options);
  } catch (error) {
    draft = {
      subject: '', body: '', language: 'en', source: 'failed', model: null,
      retryable: true,
      errorCode: String(error?.message || 'DRAFT_GENERATION_FAILED').slice(0, 120),
    };
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND_AFTER_GENERATE' };
    const latest = snap.data() || {};
    const workflow = workflowOf(latest);
    if (workflow.draftClaimId !== claimId || workflow.draftStatus !== 'drafting') {
      return { ok: false, code: 'DRAFT_CLAIM_LOST' };
    }

    const usable = String(draft.subject || '').trim().length >= 5
      && String(draft.body || '').trim().length >= 20;
    const canRetry = draft.retryable === true && claim.attempts < INQUIRY_DRAFT_MAX_ATTEMPTS;
    const nextWorkflow = {
      ...workflow,
      draftStatus: usable ? 'ready' : canRetry ? 'retry_wait' : 'failed',
      draftSubject: usable ? draft.subject : workflow.draftSubject || null,
      draftBody: usable ? draft.body : workflow.draftBody || null,
      draftLanguage: draft.language || workflow.draftLanguage || 'en',
      draftSource: usable ? draft.source : workflow.draftSource || 'failed',
      draftModel: draft.model || null,
      draftRevision: usable ? Number(workflow.draftRevision || 0) + 1 : Number(workflow.draftRevision || 0),
      draftGeneratedAtMs: usable ? now : workflow.draftGeneratedAtMs || null,
      draftGeneratedBy: String(options.actor || 'cron:inquiry-draft'),
      draftClaimId: null,
      draftClaimedAtMs: null,
      nextDraftAttemptAtMs: canRetry ? now + inquiryDraftRetryDelayMs(claim.attempts) : null,
      lastDraftErrorCode: draft.errorCode || null,
      sourceHash: inquiryDraftSourceHash(latest),
      policyVersion: INQUIRY_RESPONSE_POLICY_VERSION,
      deliveryStatus: workflow.deliveryStatus || (latest.email ? 'not_sent' : 'manual_required'),
    };
    tx.update(ref, { responseWorkflow: nextWorkflow, updatedAtMs: now });
    return {
      ok: true,
      code: usable ? 'DRAFT_READY' : canRetry ? 'DRAFT_RETRY_SCHEDULED' : 'DRAFT_FAILED',
      workflow: nextWorkflow,
    };
  });
}
