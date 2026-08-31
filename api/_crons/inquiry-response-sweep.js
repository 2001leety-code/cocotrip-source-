/**
 * 문의 답변 워커.
 *
 * 1) NEW/pending 견적 문의에 결정론 정책 초안을 만든다.
 * 2) 환경변수+런타임 스위치+정확일치 게이트를 모두 통과한 새 문의만 접수 확인을 보낸다.
 * 3) 최종 답변과 자동 접수 확인은 서로 다른 상태기계로 재시도한다.
 * 4) SMTP 이후 결과를 모르는 발송은 자동 재발송하지 않고 사람 확인으로 격리한다.
 *
 * 초안·재발송은 INQUIRY_RESPONSE_WORKER_ENABLED=true 일 때만 동작한다(기본 OFF).
 * 외부 발송이 없는 오래된 sending 상태 복구는 플래그와 무관하게 동작한다.
 */
import { initAdminDb } from '../_shared/firebase-admin.js';
import { verifyCronRequest } from '../_shared/cron-auth.js';
import {
  generateAndStoreInquiryDraft,
  shouldGenerateInquiryDraft,
} from '../_shared/inquiry-response-workflow.js';
import {
  recoverStaleInquiryDelivery,
  retryApprovedInquiryResponse,
} from '../_shared/inquiry-response-delivery.js';
import {
  automaticallyAcknowledgeInquiry,
  recoverStaleAutomaticInquiryAck,
  retryAutomaticInquiryAck,
} from '../_shared/inquiry-auto-ack.js';
import { getFailClosedRuntimeFlag } from '../_shared/runtime-flags.js';

const DEFAULT_BATCH = 3;
const AUTO_ACK_SAFE_SKIP_CODES = new Set([
  'ALREADY_ACKNOWLEDGED',
  'INQUIRY_CLOSED',
  'SEND_IN_PROGRESS',
  'AUTO_ACK_CREATED_AT_REQUIRED',
  'AUTO_ACK_OUTSIDE_TIME_WINDOW',
  'AUTO_ACK_TYPE_NOT_ALLOWED',
  'AUTO_ACK_LANGUAGE_NOT_ALLOWED',
  'AUTO_ACK_STATUS_NOT_ALLOWED',
  'AUTO_ACK_CONTRACT_NOT_ALLOWED',
  'AUTO_ACK_SOURCE_NOT_ALLOWED',
  'AUTO_ACK_SERVER_PROVENANCE_REQUIRED',
  'AUTO_ACK_NOT_CANDIDATE',
  'AUTO_ACK_EMAIL_REQUIRED',
  'AUTO_ACK_FINAL_RESPONSE_ACTIVE',
  'AUTO_ACK_NOT_RETRYABLE',
  'AUTO_ACK_RETRY_NOT_DUE',
]);

function accountAutomaticResult(result, automatic) {
  if (automatic.ok && automatic.code === 'SENT') result.autoSent += 1;
  else if (automatic.code === 'RETRY_SCHEDULED') result.autoDeferred += 1;
  else if (['OUTCOME_UNKNOWN', 'MANUAL_REQUIRED'].includes(automatic.code)) result.needsOperator += 1;
  else if (automatic.workflow?.deliveryStatus === 'manual_required') result.needsOperator += 1;
  else if (AUTO_ACK_SAFE_SKIP_CODES.has(automatic.code)) result.autoSkipped += 1;
  else result.failed += 1;
}

function recordAutomaticAckFailure(result, code) {
  if (!result.autoAckError) result.autoAckError = code;
  result.failed += 1;
  console.error('[inquiry-auto-ack]', code);
}

function batchSize() {
  const parsed = Number.parseInt(process.env.INQUIRY_RESPONSE_BATCH_SIZE || '', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5, parsed)) : DEFAULT_BATCH;
}

function enabled(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

export function strictAutomaticAckActivationAtMs(value = process.env.INQUIRY_RESPONSE_AUTO_ACK_NOT_BEFORE) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === raw ? parsed : null;
}

function automaticAckMaxAgeMs() {
  const raw = String(process.env.INQUIRY_RESPONSE_AUTO_ACK_MAX_AGE_MINUTES || '').trim();
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 5 && parsed <= 1440
    ? parsed * 60 * 1000
    : null;
}

function automaticAckDailyCap() {
  const raw = String(process.env.INQUIRY_RESPONSE_AUTO_ACK_DAILY_CAP || '').trim();
  const parsed = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : null;
}

function resolveAutomaticAckConfigurationError({ activationAtMs, maxAgeMs, dailyCap }) {
  if (!Number.isFinite(activationAtMs)) return 'AUTO_ACK_ACTIVATION_INVALID';
  if (!Number.isFinite(maxAgeMs)) return 'AUTO_ACK_MAX_AGE_INVALID';
  if (!Number.isSafeInteger(dailyCap)) return 'AUTO_ACK_DAILY_CAP_INVALID';
  return null;
}

export async function inquiryResponseSweepTask(options = {}) {
  const db = options.db || initAdminDb('cron/inquiry-response-sweep');
  if (!db) return { ok: false, code: 'FIRESTORE_UNAVAILABLE' };
  const now = Number(options.now || Date.now());
  const limit = Number(options.limit || batchSize());
  const workerEnabled = enabled('INQUIRY_RESPONSE_WORKER_ENABLED');
  const autoAckRequested = enabled('INQUIRY_RESPONSE_AUTO_ACK_ENABLED');
  const activationAtMs = strictAutomaticAckActivationAtMs();
  const maxAgeMs = automaticAckMaxAgeMs();
  const dailyCap = automaticAckDailyCap();
  const autoAckConfigurationError = autoAckRequested
    ? resolveAutomaticAckConfigurationError({ activationAtMs, maxAgeMs, dailyCap })
    : null;
  const runtimeAutoAckEnabled = workerEnabled && autoAckRequested && !autoAckConfigurationError
    ? await getFailClosedRuntimeFlag(db, 'inquiry_auto_ack_enabled')
    : false;
  const autoAckEnabled = workerEnabled
    && autoAckRequested
    && !autoAckConfigurationError
    && runtimeAutoAckEnabled;
  const result = {
    ok: true,
    disabled: !workerEnabled,
    autoAckRequested,
    autoAckEnabled,
    autoAckRuntimeEnabled: runtimeAutoAckEnabled,
    autoAckConfigurationError,
    autoAckError: null,
    drafted: 0,
    autoAttempted: 0,
    autoSent: 0,
    autoDeferred: 0,
    autoSkipped: 0,
    needsOperator: 0,
    retried: 0,
    recovered: 0,
    autoRecovered: 0,
    failed: 0,
  };
  if (autoAckConfigurationError) {
    console.error('[inquiry-auto-ack]', autoAckConfigurationError);
  }

  // 복구는 외부 발송이 아니다. 워커가 꺼져 있어도 SMTP 이후 끊긴 sending
  // 상태를 결과 확인 대기로 옮겨 운영 화면이 영구 잠기지 않게 한다.
  const sendingSnap = await db.collection('charter_inquiries')
    .where('responseWorkflow.deliveryStatus', '==', 'sending')
    .limit(limit)
    .get();
  for (const doc of sendingSnap.docs) {
    if (await recoverStaleInquiryDelivery(db, doc.id, now)) result.recovered += 1;
  }

  try {
    const ackSendingSnap = await db.collection('charter_inquiries')
      .where('ackWorkflow.deliveryStatus', '==', 'sending')
      .limit(limit)
      .get();
    for (const doc of ackSendingSnap.docs) {
      if (await recoverStaleAutomaticInquiryAck(db, doc.id, now)) result.autoRecovered += 1;
    }
  } catch {
    // 자동 접수 복구용 색인·쿼리 장애가 기존 최종 답변 흐름을 막지 않게 격리한다.
    recordAutomaticAckFailure(result, 'AUTO_ACK_RECOVERY_FAILED');
  }

  if (!workerEnabled) return result;

  const newSnap = await db.collection('charter_inquiries')
    .where('status', 'in', ['NEW', 'pending'])
    .limit(Math.max(limit * 3, limit))
    .get();

  for (const doc of newSnap.docs) {
    const data = doc.data() || {};
    if (result.drafted < limit && shouldGenerateInquiryDraft(data, now)) {
      const drafted = await generateAndStoreInquiryDraft(db, doc.id, {
        now,
        actor: 'cron:inquiry-response-sweep',
        generate: options.generate,
      });
      if (drafted.ok && !drafted.skipped) result.drafted += 1;
      else if (!drafted.ok) result.failed += 1;
    }

  }

  if (autoAckEnabled) {
    try {
      const ackRetrySnap = await db.collection('charter_inquiries')
        .where('ackWorkflow.deliveryStatus', '==', 'retryable')
        .where('ackWorkflow.nextDeliveryAttemptAtMs', '<=', now)
        .orderBy('ackWorkflow.nextDeliveryAttemptAtMs', 'asc')
        .limit(limit)
        .get();
      for (const doc of ackRetrySnap.docs) {
        if (result.autoSent + result.autoDeferred + result.needsOperator >= limit) break;
        const workflow = doc.data()?.ackWorkflow || {};
        if (Number(workflow.nextDeliveryAttemptAtMs || 0) > now) continue;
        result.autoAttempted += 1;
        const automatic = await retryAutomaticInquiryAck(db, doc.id, {
          gateEnabled: true,
          now,
          activationAtMs,
          maxAgeMs,
          dailyCap,
          send: options.send,
        });
        accountAutomaticResult(result, automatic);
      }

      const lowerBoundMs = Math.max(Number(activationAtMs), now - Number(maxAgeMs));
      const recentSnap = await db.collection('charter_inquiries')
        .where('autoAckCandidate', '==', true)
        .where('createdAt', '>=', new Date(lowerBoundMs))
        .orderBy('createdAt', 'desc')
        .limit(Math.max(25, Math.min(100, limit * 10)))
        .get();
      for (const doc of recentSnap.docs) {
        if (result.autoSent + result.autoDeferred + result.needsOperator >= limit) break;
        result.autoAttempted += 1;
        const automatic = await automaticallyAcknowledgeInquiry(db, doc.id, {
          gateEnabled: true,
          now,
          activationAtMs,
          maxAgeMs,
          dailyCap,
          send: options.send,
        });
        accountAutomaticResult(result, automatic);
      }
    } catch {
      // 자동 접수용 색인·쿼리 장애가 기존 최종 답변 재시도를 막지 않게 격리한다.
      recordAutomaticAckFailure(result, 'AUTO_ACK_SWEEP_FAILED');
    }
  }

  const deliverySnap = await db.collection('charter_inquiries')
    .where('responseWorkflow.deliveryStatus', '==', 'retryable')
    .limit(Math.max(25, Math.min(100, limit * 20)))
    .get();

  const dueFinalRetries = [...deliverySnap.docs].sort((left, right) => (
    Number(left.data()?.responseWorkflow?.nextDeliveryAttemptAtMs || 0)
    - Number(right.data()?.responseWorkflow?.nextDeliveryAttemptAtMs || 0)
  ));
  for (const doc of dueFinalRetries) {
    const data = doc.data() || {};
    const workflow = data.responseWorkflow || {};
    if (result.retried >= limit) continue;
    const terminal = ['rejected', 'responded', 'closed', 'converted']
      .includes(String(data.status || '').trim().toLowerCase());
    if (!terminal && Number(workflow.nextDeliveryAttemptAtMs || 0) > now) continue;
    const retry = await retryApprovedInquiryResponse(db, doc.id, { now, send: options.send });
    if (retry.ok || retry.code === 'RETRY_SCHEDULED') result.retried += 1;
    else result.failed += 1;
  }

  return result;
}

export default async function handler(req, res) {
  const auth = await verifyCronRequest(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, code: 'AUTH_REQUIRED', error: auth.error });
  }
  try {
    const result = await inquiryResponseSweepTask();
    return res.status(result.ok ? 200 : 503).json(result);
  } catch (error) {
    console.error('[inquiry-response-sweep]', error?.message);
    return res.status(500).json({ ok: false, code: 'INTERNAL_ERROR' });
  }
}
