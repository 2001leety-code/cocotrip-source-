/**
 * 문의 답변 워커.
 *
 * 1) NEW/pending 견적 문의에 검토용 정책 초안을 만든다.
 * 2) 운영자 승인 뒤 "발송 전 실패"로 확실한 이메일만 제한 재시도한다.
 * 3) 발송 중 프로세스가 끊긴 건 자동 재발송하지 않고 결과 확인 대기로 격리한다.
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

const DEFAULT_BATCH = 3;

function batchSize() {
  const parsed = Number.parseInt(process.env.INQUIRY_RESPONSE_BATCH_SIZE || '', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5, parsed)) : DEFAULT_BATCH;
}

export async function inquiryResponseSweepTask(options = {}) {
  const db = options.db || initAdminDb('cron/inquiry-response-sweep');
  if (!db) return { ok: false, code: 'FIRESTORE_UNAVAILABLE' };
  const now = Number(options.now || Date.now());
  const limit = Number(options.limit || batchSize());
  const enabled = String(process.env.INQUIRY_RESPONSE_WORKER_ENABLED || '').toLowerCase() === 'true';
  const result = { ok: true, disabled: !enabled, drafted: 0, retried: 0, recovered: 0, failed: 0 };

  // 복구는 외부 발송이 아니다. 워커가 꺼져 있어도 SMTP 이후 끊긴 sending
  // 상태를 결과 확인 대기로 옮겨 운영 화면이 영구 잠기지 않게 한다.
  const sendingSnap = await db.collection('charter_inquiries')
    .where('responseWorkflow.deliveryStatus', '==', 'sending')
    .limit(limit)
    .get();
  for (const doc of sendingSnap.docs) {
    if (await recoverStaleInquiryDelivery(db, doc.id, now)) result.recovered += 1;
  }

  if (!enabled) return result;

  const newSnap = await db.collection('charter_inquiries')
    .where('status', 'in', ['NEW', 'pending'])
    .limit(Math.max(limit * 3, limit))
    .get();

  for (const doc of newSnap.docs) {
    if (result.drafted >= limit) break;
    const data = doc.data() || {};
    if (!shouldGenerateInquiryDraft(data, now)) continue;
    const drafted = await generateAndStoreInquiryDraft(db, doc.id, {
      now,
      actor: 'cron:inquiry-response-sweep',
      generate: options.generate,
    });
    if (drafted.ok && !drafted.skipped) result.drafted += 1;
    else if (!drafted.ok) result.failed += 1;
  }

  const deliverySnap = await db.collection('charter_inquiries')
    .where('responseWorkflow.deliveryStatus', '==', 'retryable')
    .limit(limit)
    .get();

  for (const doc of deliverySnap.docs) {
    const workflow = doc.data()?.responseWorkflow || {};
    if (result.retried >= limit) continue;
    if (Number(workflow.nextDeliveryAttemptAtMs || 0) > now) continue;
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
