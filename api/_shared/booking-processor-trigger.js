/**
 * Booking-processor fire-and-forget trigger with failure capture.
 *
 * PR #436 (Audit Y-H8 — 2026-05-16): the previous pattern was
 *
 *   fetch(`${siteUrl}/api/booking-processor`, { ... })
 *     .catch(err => console.error(...));
 *
 * Two silent-failure modes that killed real bookings on prod:
 *   1. fetch().catch only fires on network errors. HTTP 500/504 from
 *      booking-processor (timeout, downstream stack trace, etc.) returns
 *      a Response object — the .catch never runs. We log nothing, the
 *      user sees "예약 확정" success, but the downstream side-effects
 *      (Google Sheets row, customer confirmation email, voucher PDF,
 *      Telegram channel #2 alert) NEVER ran.
 *   2. No retry. Even when we did catch a transient blip, the booking
 *      side-effects were just lost. Operator had to manually run
 *      /api/admin-replay-booking-notifications.
 *
 * This helper:
 *   - awaits the fetch with a 25s AbortController timeout (Vercel
 *     hobby/pro both have 60s function timeouts — leave headroom).
 *   - checks response.ok + status, treating any non-2xx as failure.
 *   - on ANY failure path (timeout, network, non-2xx): writes to
 *     `pending_processor_retries/{orderID}` with the payload + reason +
 *     attempts counter, AND fires a Telegram booking-channel alert so
 *     the operator can intervene immediately if needed.
 *   - ALWAYS resolves (never throws) so the caller's fire-and-forget
 *     pattern stays safe.
 *
 * The retry queue is swept by the new `processor-retry-sweep` cron
 * (every 5 minutes — see api/_crons/processor-retry-sweep.js).
 */

import { vercelBypassHeaders } from './internal-base-url.js';
import {
  outcomeFromResponseBody, isSemanticallyDone, needsManualIntervention,
  shouldRetry, retryDocStatusFor, RETRY_DOC_STATUS, OUTCOME,
} from './processor-outcome.js';

const RETRY_COLLECTION = 'pending_processor_retries';
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_BODY_LOG = 300; // chars — error response body excerpt

/**
 * @param {object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {string} args.siteUrl                 e.g. https://cocotrip-source...vercel.app
 * @param {object} args.payload                 booking-processor request body
 * @param {string} [args.source]                'capturePaypalOrder' | 'booking-confirm' | 'retry-sweep'
 * @param {(channel: string, msg: string) => Promise<unknown>} [args.notify]   notify('booking', msg) callback
 * @param {(orderID: string, payload: object, reason: string) => Promise<void>} [args.persistRetry]
 *        Optional override for the Firestore persistence (used by retry-sweep to update existing doc).
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ok: true, status: number} | {ok: false, reason: string, status?: number, bodyExcerpt?: string}>}
 */
export async function triggerBookingProcessor({
  db,
  siteUrl,
  payload,
  source = 'unknown',
  notify,
  persistRetry,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDocId,
}) {
  if (!siteUrl || !payload || !payload.orderID) {
    return { ok: false, reason: 'invalid-args' };
  }

  const orderID = String(payload.orderID);
  // retry 큐 doc id — 단건은 orderID(기존 동작 불변), cart fan-out 은 orderID__lineId 전달해
  // 라인별 독립 retry (단일 doc 충돌/덮어쓰기 회피). 미전달 시 orderID 폴백.
  const retryQueueDocId = retryDocId || orderID;

  // 1. Call booking-processor with abort timeout.
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  let result;
  try {
    const r = await fetch(`${siteUrl}/api/booking-processor`, {
      method: 'POST',
      // booking-processor 는 내부 전용(2026-07-29 인증 게이트) — 서비스 토큰 동봉 필수.
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': (process.env.INTERNAL_API_TOKEN || '').trim(),
        ...vercelBypassHeaders(),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (r.ok) {
      // 🔴 2026-07-29 (의미상 성공 계약): HTTP 200 만 보고 성공으로 기록하면 안 된다.
      //   booking-processor 는 내부 단계가 실패해도 200 을 준다(PayPal/Vercel 재시도 제어 목적).
      //   본문의 outcome 이 진실이다. completed 가 아니면 retry 큐를 유지한다.
      let body = null;
      try { body = JSON.parse((await r.text()).slice(0, MAX_BODY_LOG * 4)); } catch { /* 본문 못 읽음 */ }
      const outcome = outcomeFromResponseBody(body);
      if (isSemanticallyDone(outcome)) {
        result = { ok: true, status: r.status, outcome };
      } else {
        result = {
          ok: false,
          reason: `outcome-${outcome}`,
          status: r.status,
          outcome,
          manual: needsManualIntervention(outcome),
          retryable: shouldRetry(outcome),
          docStatus: retryDocStatusFor(outcome),
          stepStatus: (body && body.data && body.data.stepStatus) || null,
          bodyExcerpt: JSON.stringify((body && body.data && body.data.stepStatus) || {}).slice(0, MAX_BODY_LOG),
        };
      }
    } else {
      // Non-2xx — record the failure with a body excerpt for diagnosis.
      let bodyExcerpt = '';
      try {
        bodyExcerpt = (await r.text()).slice(0, MAX_BODY_LOG);
      } catch { /* body unreadable — leave empty */ }
      // 네트워크/HTTP 실패는 일시적으로 본다 → 자동 재시도 대상.
      result = {
        ok: false, reason: `http-${r.status}`, status: r.status, bodyExcerpt,
        outcome: OUTCOME.RETRYABLE, retryable: true, manual: false,
        docStatus: RETRY_DOC_STATUS.PENDING,
      };
    }
  } catch (err) {
    clearTimeout(tid);
    const reason = err.name === 'AbortError' ? `timeout-${timeoutMs}ms` : `network: ${err.message}`;
    result = {
      ok: false, reason,
      outcome: OUTCOME.RETRYABLE, retryable: true, manual: false,
      docStatus: RETRY_DOC_STATUS.PENDING,
    };
  }

  if (result.ok) {
    console.log(`[booking-processor-trigger] ok orderID=${orderID} source=${source}`);
    return result;
  }

  // 2. Persist failure → retry queue.
  console.error(`[booking-processor-trigger] FAIL orderID=${orderID} source=${source} reason=${result.reason}`);
  if (db) {
    try {
      // 2026-07-29: outcome 에 맞는 status 로 저장한다.
      //   이전에는 전부 'pending' 이라 manual/permanent 도 다음 cron 이 다시 실행했다.
      const docStatus = result.docStatus || RETRY_DOC_STATUS.PENDING;
      if (persistRetry) {
        // 커스텀 콜백에도 outcome/status 를 넘긴다 — reason 만 받으면
        // 호출처가 무조건 pending 으로 기록해 같은 구멍이 다시 생긴다.
        await persistRetry(orderID, payload, result.reason, {
          outcome: result.outcome || OUTCOME.RETRYABLE,
          status: docStatus,
          stepStatus: result.stepStatus || null,
          source,
          retryDocId: retryQueueDocId,
        });
      } else {
        const { FieldValue } = await import('firebase-admin/firestore');
        await db.collection(RETRY_COLLECTION).doc(retryQueueDocId).set({
          orderID,
          retryDocId: retryQueueDocId,
          payload,
          source,
          firstFailureAt: FieldValue.serverTimestamp(),
          lastFailureAt: FieldValue.serverTimestamp(),
          lastFailureReason: result.reason,
          outcome: result.outcome || OUTCOME.RETRYABLE,
          stepStatus: result.stepStatus || null,
          status: docStatus,
          attempts: 0,
        }, { merge: false });
      }
    } catch (persistErr) {
      console.error('[booking-processor-trigger] retry persist failed:', persistErr.message);
    }
  }

  // 3. Operator alert — make the silent-failure loud.
  if (notify) {
    const msg = [
      `⚠️ <b>booking-processor 실패</b>`,
      `<b>예약번호:</b> <code>${orderID}</code>`,
      `<b>호출자:</b> ${source}`,
      `<b>실패사유:</b> ${result.reason}`,
      result.bodyExcerpt ? `<b>응답 본문(앞 ${MAX_BODY_LOG}자):</b>\n<code>${result.bodyExcerpt.replace(/[<>&]/g, '_')}</code>` : '',
      ``,
      result.retryable === false
        ? `→ <code>${RETRY_COLLECTION}/${orderID}</code> 상태=${result.docStatus}. <b>자동 재시도 없음</b> — 수동 확인 필요.`
        : `→ <code>${RETRY_COLLECTION}/${orderID}</code> 등록됨. 5분 cron 이 자동 재시도.`,
      `→ 즉시 강제 재시도: <code>POST /api/admin-replay-booking-notifications {orderID:"${orderID}"}</code>`,
    ].filter(Boolean).join('\n');
    notify('booking', msg).catch((alertErr) => {
      console.error('[booking-processor-trigger] notify failed:', alertErr.message);
    });
  }

  return result;
}

export const PENDING_PROCESSOR_RETRIES_COLLECTION = RETRY_COLLECTION;

export default triggerBookingProcessor;
