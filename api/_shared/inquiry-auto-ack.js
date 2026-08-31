/**
 * 문의 자동 접수 확인 전용 상태기계.
 *
 * 최종 상담 답변의 responseWorkflow와 문의 status를 절대 바꾸지 않는다.
 * SMTP 제공자는 멱등 키가 없으므로 발송 전 실패만 재시도하고, 발송 결과가
 * 불명확하면 사람 확인 상태로 격리한다.
 */
import { createHash, randomUUID } from 'crypto';
import { sendEmail } from '../_send-email.js';
import {
  INQUIRY_AUTO_ACK_ELIGIBILITY_VERSION,
  INQUIRY_AUTO_ACK_POLICY_VERSION,
  INQUIRY_SUBMISSION_PROVENANCE,
} from './inquiry-auto-ack-constants.js';
import { buildAutomaticInquiryAckTemplate } from './inquiry-auto-ack-template.js';
import {
  buildInquiryResponseHtml,
} from './inquiry-response-delivery.js';
import { validInquiryResponseEmail } from './inquiry-email.js';

export const AUTO_ACK_DELIVERY_MAX_ATTEMPTS = 3;
export const AUTO_ACK_DELIVERY_CLAIM_MS = 10 * 60 * 1000;

const AUTO_ACK_INQUIRY_TYPES = new Set(['charter', 'bus', 'tour_custom']);
const AUTO_ACK_LANGUAGES = new Set(['ko', 'en', 'ja', 'zh']);
const TERMINAL_INQUIRY_STATUSES = new Set(['rejected', 'responded', 'closed', 'converted']);
const EXPECTED_CONTRACT = {
  charter: 'inquiry.v2',
  bus: 'inquiry.v1',
  tour_custom: 'inquiry.v1',
};
const EXPECTED_SOURCE = {
  charter: 'plan_detail_charter_inquiry',
  bus: 'charter_wizard',
  tour_custom: 'tour_custom_modal',
};

function timestampToMs(value) {
  if (value && typeof value.toMillis === 'function') {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : null;
  }
  const seconds = Number(value && (value.seconds || value._seconds));
  const nanoseconds = Number(value && (value.nanoseconds || value._nanoseconds || 0));
  if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) return null;
  return (seconds * 1000) + Math.trunc(nanoseconds / 1_000_000);
}

function ackWorkflowOf(data) {
  return data && data.ackWorkflow && typeof data.ackWorkflow === 'object'
    ? data.ackWorkflow
    : {};
}

function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function recipientHash(email) {
  return createHash('sha256').update(email).digest('hex');
}

export function automaticAckSourceHash(data = {}) {
  const createdAtMs = timestampToMs(data.createdAt);
  const email = validInquiryResponseEmail(data.email);
  return createHash('sha256').update(JSON.stringify({
    email,
    vehicle: String(data.vehicle || '').trim(),
    language: String(data.language || '').trim().toLowerCase(),
    contractVersion: String(data.contractVersion || '').trim(),
    source: String(data.source || '').trim(),
    createdAtMs,
    submissionProvenance: String(data.submissionProvenance || ''),
    autoAckEligibilityVersion: String(data.autoAckEligibilityVersion || ''),
    rateLimitVerifiedForAutoAck: data.rateLimitVerifiedForAutoAck === true,
    recipientVerifiedForAutoAck: data.recipientVerifiedForAutoAck === true,
  })).digest('hex');
}

/** 생성형 문구나 과거 문의가 섞이면 발송하지 않는 fail-closed 판정. */
export function automaticInquiryAckEligibility(data = {}, options = {}) {
  if (options.gateEnabled !== true) return { ok: false, code: 'AUTO_ACK_DISABLED' };

  const now = Number(options.now || Date.now());
  const activationAtMs = Number(options.activationAtMs);
  const maxAgeMs = Number(options.maxAgeMs);
  const dailyCap = Number(options.dailyCap);
  if (!Number.isFinite(now) || now <= 0) return { ok: false, code: 'AUTO_ACK_NOW_INVALID' };
  if (!Number.isFinite(activationAtMs) || activationAtMs <= 0) {
    return { ok: false, code: 'AUTO_ACK_ACTIVATION_REQUIRED' };
  }
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 5 * 60 * 1000 || maxAgeMs > 24 * 60 * 60 * 1000) {
    return { ok: false, code: 'AUTO_ACK_MAX_AGE_INVALID' };
  }
  if (!Number.isSafeInteger(dailyCap) || dailyCap < 1 || dailyCap > 100) {
    return { ok: false, code: 'AUTO_ACK_DAILY_CAP_INVALID' };
  }

  const createdAtMs = timestampToMs(data.createdAt);
  if (!Number.isFinite(createdAtMs)) return { ok: false, code: 'AUTO_ACK_CREATED_AT_REQUIRED' };
  if (createdAtMs < activationAtMs || createdAtMs > now + 60 * 1000 || now - createdAtMs > maxAgeMs) {
    return { ok: false, code: 'AUTO_ACK_OUTSIDE_TIME_WINDOW' };
  }

  const inquiryType = String(data.vehicle || '').trim();
  const language = String(data.language || '').trim().toLowerCase();
  const status = String(data.status || '').trim().toLowerCase();
  if (!AUTO_ACK_INQUIRY_TYPES.has(inquiryType)) return { ok: false, code: 'AUTO_ACK_TYPE_NOT_ALLOWED' };
  if (!AUTO_ACK_LANGUAGES.has(language)) return { ok: false, code: 'AUTO_ACK_LANGUAGE_NOT_ALLOWED' };
  if (!['new', 'pending'].includes(status)) return { ok: false, code: 'AUTO_ACK_STATUS_NOT_ALLOWED' };
  if (data.contractVersion !== EXPECTED_CONTRACT[inquiryType]) {
    return { ok: false, code: 'AUTO_ACK_CONTRACT_NOT_ALLOWED' };
  }
  if (data.source !== EXPECTED_SOURCE[inquiryType]) return { ok: false, code: 'AUTO_ACK_SOURCE_NOT_ALLOWED' };
  if (data.submissionProvenance !== INQUIRY_SUBMISSION_PROVENANCE
    || data.autoAckEligibilityVersion !== INQUIRY_AUTO_ACK_ELIGIBILITY_VERSION
    || data.rateLimitVerifiedForAutoAck !== true
    || data.recipientVerifiedForAutoAck !== true) {
    return { ok: false, code: 'AUTO_ACK_SERVER_PROVENANCE_REQUIRED' };
  }

  const email = validInquiryResponseEmail(data.email);
  if (!email) return { ok: false, code: 'AUTO_ACK_EMAIL_REQUIRED' };
  const responseWorkflow = data.responseWorkflow && typeof data.responseWorkflow === 'object'
    ? data.responseWorkflow
    : {};
  const finalDeliveryStatus = String(responseWorkflow.deliveryStatus || '').trim();
  if (responseWorkflow.reviewStatus === 'approved'
    || (finalDeliveryStatus && finalDeliveryStatus !== 'not_sent')) {
    return { ok: false, code: 'AUTO_ACK_FINAL_RESPONSE_ACTIVE' };
  }
  const template = buildAutomaticInquiryAckTemplate(data);
  if (!template || !template.subject || !template.body || template.language !== language) {
    return { ok: false, code: 'AUTO_ACK_TEMPLATE_INVALID' };
  }
  return {
    ok: true,
    code: 'AUTO_ACK_ELIGIBLE',
    email,
    subject: template.subject,
    body: template.body,
    language: template.language,
    sourceHash: automaticAckSourceHash(data),
  };
}

function deliveryDelayMs(attempt) {
  return 5 * 60 * 1000 * (2 ** Math.max(0, Math.min(1, Number(attempt || 1) - 1)));
}

async function claimAutomaticInquiryAck(db, inquiryId, options = {}) {
  const ref = db.collection('charter_inquiries').doc(inquiryId);
  const now = Number(options.now || Date.now());
  const retry = options.retry === true;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, code: 'NOT_FOUND' };
    const data = snap.data() || {};
    const workflow = ackWorkflowOf(data);

    if (workflow.deliveryStatus === 'sent') {
      return { ok: true, alreadySent: true, code: 'ALREADY_ACKNOWLEDGED', workflow };
    }
    if (TERMINAL_INQUIRY_STATUSES.has(String(data.status || '').trim().toLowerCase())) {
      if (!workflow.deliveryStatus || ['not_sent', 'retryable'].includes(workflow.deliveryStatus)) {
        const cancelledWorkflow = {
          ...workflow,
          deliveryStatus: 'cancelled',
          nextDeliveryAttemptAtMs: null,
          lastDeliveryErrorCode: 'INQUIRY_CLOSED',
        };
        tx.update(ref, { ackWorkflow: cancelledWorkflow, autoAckCandidate: false, updatedAtMs: now });
        return { ok: false, code: 'INQUIRY_CLOSED', workflow: cancelledWorkflow };
      }
      return { ok: false, code: 'INQUIRY_CLOSED', workflow };
    }
    if (workflow.deliveryStatus === 'outcome_unknown') {
      return { ok: false, code: 'OUTCOME_UNKNOWN', workflow };
    }
    if (workflow.deliveryStatus === 'manual_required') {
      return { ok: false, code: 'MANUAL_REQUIRED', workflow };
    }

    const claimedAt = Number(workflow.deliveryClaimedAtMs || 0);
    if (workflow.deliveryStatus === 'sending') {
      if (claimedAt > now - AUTO_ACK_DELIVERY_CLAIM_MS) {
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
      tx.update(ref, { ackWorkflow: staleWorkflow, updatedAtMs: now });
      return { ok: false, code: 'OUTCOME_UNKNOWN', workflow: staleWorkflow };
    }

    if (retry) {
      if (workflow.deliveryStatus !== 'retryable') {
        return { ok: false, code: 'AUTO_ACK_NOT_RETRYABLE', workflow };
      }
      if (Number(workflow.nextDeliveryAttemptAtMs || 0) > now) {
        return { ok: false, code: 'AUTO_ACK_RETRY_NOT_DUE', workflow };
      }
      if (workflow.reservationDay !== utcDay(now)) {
        const manualWorkflow = {
          ...workflow,
          deliveryStatus: 'manual_required',
          nextDeliveryAttemptAtMs: null,
          lastDeliveryErrorCode: 'AUTO_ACK_RETRY_DAY_CHANGED',
        };
        tx.update(ref, { ackWorkflow: manualWorkflow, autoAckCandidate: false, updatedAtMs: now });
        return { ok: false, code: 'MANUAL_REQUIRED', reason: 'AUTO_ACK_RETRY_DAY_CHANGED', workflow: manualWorkflow };
      }
      if (Number(workflow.configuredDailyCap) !== Number(options.dailyCap)) {
        const manualWorkflow = {
          ...workflow,
          deliveryStatus: 'manual_required',
          nextDeliveryAttemptAtMs: null,
          lastDeliveryErrorCode: 'AUTO_ACK_RETRY_CAP_CHANGED',
        };
        tx.update(ref, { ackWorkflow: manualWorkflow, autoAckCandidate: false, updatedAtMs: now });
        return { ok: false, code: 'MANUAL_REQUIRED', reason: 'AUTO_ACK_RETRY_CAP_CHANGED', workflow: manualWorkflow };
      }
    } else if (workflow.deliveryStatus && workflow.deliveryStatus !== 'not_sent') {
      return { ok: false, code: 'AUTO_ACK_STATE_NOT_ALLOWED', workflow };
    }

    if (Number(workflow.deliveryAttempts || 0) >= AUTO_ACK_DELIVERY_MAX_ATTEMPTS) {
      const manualWorkflow = {
        ...workflow,
        deliveryStatus: 'manual_required',
        nextDeliveryAttemptAtMs: null,
        lastDeliveryErrorCode: workflow.lastDeliveryErrorCode || 'DELIVERY_ATTEMPTS_EXHAUSTED',
      };
      tx.update(ref, { ackWorkflow: manualWorkflow, updatedAtMs: now });
      return { ok: false, code: 'MANUAL_REQUIRED', workflow: manualWorkflow };
    }

    if (!retry && data.autoAckCandidate !== true) {
      return { ok: false, code: 'AUTO_ACK_NOT_CANDIDATE', workflow };
    }

    const eligible = automaticInquiryAckEligibility(data, options);
    if (!eligible.ok) {
      if (retry && eligible.code !== 'AUTO_ACK_DISABLED') {
        const manualWorkflow = {
          ...workflow,
          deliveryStatus: 'manual_required',
          nextDeliveryAttemptAtMs: null,
          lastDeliveryErrorCode: eligible.code,
        };
        tx.update(ref, { ackWorkflow: manualWorkflow, updatedAtMs: now });
        return { ok: false, code: 'MANUAL_REQUIRED', reason: eligible.code, workflow: manualWorkflow };
      }
      if (!retry && eligible.code !== 'AUTO_ACK_DISABLED' && data.autoAckCandidate === true) {
        tx.update(ref, { autoAckCandidate: false, updatedAtMs: now });
      }
      return eligible;
    }

    let reservationDay = workflow.reservationDay || null;
    if (retry) {
      if (workflow.policyVersion !== INQUIRY_AUTO_ACK_POLICY_VERSION
        || workflow.sourceHash !== eligible.sourceHash
        || workflow.recipientEmail !== eligible.email
        || workflow.subject !== eligible.subject
        || workflow.body !== eligible.body
        || workflow.language !== eligible.language) {
        const manualWorkflow = {
          ...workflow,
          deliveryStatus: 'manual_required',
          nextDeliveryAttemptAtMs: null,
          lastDeliveryErrorCode: 'AUTO_ACK_RETRY_SNAPSHOT_CHANGED',
        };
        tx.update(ref, { ackWorkflow: manualWorkflow, autoAckCandidate: false, updatedAtMs: now });
        return { ok: false, code: 'AUTO_ACK_RETRY_SNAPSHOT_CHANGED', workflow: manualWorkflow };
      }
    } else {
      const day = utcDay(now);
      reservationDay = day;
      const limitRef = db.collection('inquiry_auto_ack_limits').doc(day);
      const recipientRef = db.collection('inquiry_auto_ack_recipients')
        .doc(`${day}-${recipientHash(eligible.email)}`);
      const [limitSnap, recipientSnap] = await Promise.all([tx.get(limitRef), tx.get(recipientRef)]);
      const limitData = limitSnap.exists ? limitSnap.data() || {} : {};
      const currentCount = limitSnap.exists ? Number(limitData.count) : 0;
      if (!Number.isSafeInteger(currentCount) || currentCount < 0) {
        const manualWorkflow = {
          ...workflow,
          deliveryStatus: 'manual_required',
          nextDeliveryAttemptAtMs: null,
          lastDeliveryErrorCode: 'AUTO_ACK_DAILY_COUNTER_INVALID',
        };
        tx.update(ref, { ackWorkflow: manualWorkflow, autoAckCandidate: false, updatedAtMs: now });
        return { ok: false, code: 'MANUAL_REQUIRED', reason: 'AUTO_ACK_DAILY_COUNTER_INVALID', workflow: manualWorkflow };
      }
      if (currentCount >= Number(options.dailyCap)) {
        const manualWorkflow = {
          ...workflow,
          deliveryStatus: 'manual_required',
          nextDeliveryAttemptAtMs: null,
          lastDeliveryErrorCode: 'AUTO_ACK_DAILY_CAP_REACHED',
        };
        tx.update(ref, { ackWorkflow: manualWorkflow, autoAckCandidate: false, updatedAtMs: now });
        return { ok: false, code: 'MANUAL_REQUIRED', reason: 'AUTO_ACK_DAILY_CAP_REACHED', workflow: manualWorkflow };
      }
      if (recipientSnap.exists) {
        const manualWorkflow = {
          ...workflow,
          deliveryStatus: 'manual_required',
          nextDeliveryAttemptAtMs: null,
          lastDeliveryErrorCode: 'AUTO_ACK_RECIPIENT_DAILY_CAP_REACHED',
        };
        tx.update(ref, { ackWorkflow: manualWorkflow, autoAckCandidate: false, updatedAtMs: now });
        return { ok: false, code: 'MANUAL_REQUIRED', reason: 'AUTO_ACK_RECIPIENT_DAILY_CAP_REACHED', workflow: manualWorkflow };
      }
      tx.set(limitRef, {
        day,
        count: currentCount + 1,
        configuredCap: Number(options.dailyCap),
        updatedAtMs: now,
      }, { merge: true });
      tx.set(recipientRef, {
        day,
        reservedAtMs: now,
      });
    }

    const attempts = Number(workflow.deliveryAttempts || 0) + 1;
    const attemptId = randomUUID();
    const nextWorkflow = {
      ...workflow,
      policyVersion: INQUIRY_AUTO_ACK_POLICY_VERSION,
      sourceHash: eligible.sourceHash,
      recipientEmail: eligible.email,
      subject: eligible.subject,
      body: eligible.body,
      language: eligible.language,
      deliveryStatus: 'sending',
      deliveryAttempts: attempts,
      deliveryAttemptId: attemptId,
      deliveryClaimedAtMs: now,
      nextDeliveryAttemptAtMs: null,
      lastDeliveryErrorCode: null,
      outcomeUnknown: false,
      reservationDay,
      configuredDailyCap: Number(options.dailyCap),
    };
    tx.update(ref, { ackWorkflow: nextWorkflow, autoAckCandidate: false, updatedAtMs: now });
    return {
      ok: true,
      inquiryId,
      ref,
      email: eligible.email,
      subject: eligible.subject,
      body: eligible.body,
      attemptId,
      attempts,
    };
  });
}

async function finishAutomaticInquiryAck(db, claim, patch, now) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(claim.ref);
    if (!snap.exists) return false;
    const data = snap.data() || {};
    const workflow = ackWorkflowOf(data);
    if (workflow.deliveryAttemptId === claim.attemptId
      && patch.deliveryStatus === 'sent'
      && workflow.deliveryStatus === 'sent') {
      return workflow;
    }
    if (workflow.deliveryAttemptId !== claim.attemptId || workflow.deliveryStatus !== 'sending') {
      return null;
    }
    const nextWorkflow = { ...workflow, ...patch };
    tx.update(claim.ref, { ackWorkflow: nextWorkflow, updatedAtMs: now });
    return nextWorkflow;
  });
}

async function deliverClaimedAutomaticInquiryAck(db, claim, options = {}) {
  if (!claim || !claim.ok || claim.alreadySent) return claim;
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
    const preSend = error && error.preSend === true;
    const retryable = preSend && claim.attempts < AUTO_ACK_DELIVERY_MAX_ATTEMPTS;
    const code = String((error && (error.code || error.message)) || 'EMAIL_SEND_FAILED').slice(0, 160);
    let workflow = null;
    try {
      workflow = await finishAutomaticInquiryAck(db, claim, {
        deliveryStatus: retryable ? 'retryable' : preSend ? 'manual_required' : 'outcome_unknown',
        deliveryClaimedAtMs: null,
        nextDeliveryAttemptAtMs: retryable ? now + deliveryDelayMs(claim.attempts) : null,
        lastDeliveryErrorCode: code,
        outcomeUnknown: !preSend,
      }, now);
    } catch {
      workflow = null;
    }
    if (!workflow) return { ok: false, code: 'OUTCOME_UNKNOWN', inquiryId: claim.inquiryId };
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
    providerMessageId: String((info && info.messageId) || '').slice(0, 200) || null,
  };
  let workflow = null;
  for (let persistAttempt = 0; persistAttempt < 2 && !workflow; persistAttempt += 1) {
    try {
      workflow = await finishAutomaticInquiryAck(db, claim, sentPatch, now);
    } catch {
      workflow = null;
    }
  }
  if (!workflow) {
    try {
      workflow = await finishAutomaticInquiryAck(db, claim, {
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

export async function automaticallyAcknowledgeInquiry(db, inquiryId, options = {}) {
  let claim;
  try {
    claim = await claimAutomaticInquiryAck(db, inquiryId, { ...options, retry: false });
  } catch {
    return { ok: false, code: 'AUTO_ACK_GUARD_UNAVAILABLE', inquiryId };
  }
  return deliverClaimedAutomaticInquiryAck(db, claim, options);
}

export async function retryAutomaticInquiryAck(db, inquiryId, options = {}) {
  let claim;
  try {
    claim = await claimAutomaticInquiryAck(db, inquiryId, { ...options, retry: true });
  } catch {
    return { ok: false, code: 'AUTO_ACK_GUARD_UNAVAILABLE', inquiryId };
  }
  return deliverClaimedAutomaticInquiryAck(db, claim, options);
}

export async function recoverStaleAutomaticInquiryAck(db, inquiryId, now = Date.now()) {
  const ref = db.collection('charter_inquiries').doc(inquiryId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() || {};
    const workflow = ackWorkflowOf(data);
    if (workflow.deliveryStatus !== 'sending') return false;
    if (Number(workflow.deliveryClaimedAtMs || 0) > Number(now) - AUTO_ACK_DELIVERY_CLAIM_MS) return false;
    tx.update(ref, {
      ackWorkflow: {
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
