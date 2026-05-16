/**
 * AI Planner trigger with failure capture + operator alert + retry queue.
 *
 * PR #453 (Audit Z-H7 — 2026-05-16). Sister to booking-processor-trigger
 * (PR #436 / P60) and customer-email-trigger (PR #439 / P63).
 *
 * Pre-fix pattern in booking-confirm.js's AI Planner branch:
 *   fetch(`${siteUrl}/api/ai-planner-full`, {...})
 *     .catch((e) => console.warn('[booking-confirm] ai-planner-full failed:', e.message));
 *
 * .catch only fires on network errors — HTTP 500/504/etc. return a
 * Response, so non-2xx responses NEVER ran the .catch. User saw
 * "결제 확정" in the app, paid for the AI plan, but no plan was generated
 * because /api/ai-planner-full hit a transient error (Gemini quota /
 * cold start) and the failure silently disappeared. Operator only
 * learned of it from CS escalation hours later.
 *
 * This helper:
 *   - awaits fetch with 60s AbortController timeout (AI planner can take
 *     30-50s for multi-city plans)
 *   - checks response.ok + status (non-2xx treated as failure)
 *   - on ANY failure: persists `pending_ai_planner_retries/{bookingRef}`
 *     (payload + reason + attempts counter) and fires Telegram
 *     booking-channel alert
 *   - always resolves (caller fire-and-forget safe)
 *
 * The retry queue is swept by `ai-planner-retry-sweep` cron (every 5min)
 * up to MAX_ATTEMPTS=3 then escalates to manual-intervention. Lower
 * attempts than booking-processor (5) because AI planner failures are
 * usually deterministic (bad input / quota exhausted) — 3 attempts
 * confirms the issue is real before escalating.
 */

const RETRY_COLLECTION = 'pending_ai_planner_retries';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BODY_LOG = 300;

/**
 * @param {object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {string} args.siteUrl
 * @param {string} args.bookingRef             Used as Firestore doc id for the retry queue (idempotent).
 * @param {object} args.payload                ai-planner-full request body (itineraryData + email + language + uid).
 * @param {string} [args.source]               'booking-confirm' | 'retry-sweep'
 * @param {(channel: string, msg: string) => Promise<unknown>} [args.notify]
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ok: true, status: number} | {ok: false, reason: string, status?: number, bodyExcerpt?: string}>}
 */
export async function triggerAiPlanner({
  db,
  siteUrl,
  bookingRef,
  payload,
  source = 'unknown',
  notify,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!siteUrl || !payload || !bookingRef) {
    return { ok: false, reason: 'invalid-args' };
  }

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  let result;
  try {
    const r = await fetch(`${siteUrl}/api/ai-planner-full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (r.ok) {
      result = { ok: true, status: r.status };
    } else {
      let bodyExcerpt = '';
      try {
        bodyExcerpt = (await r.text()).slice(0, MAX_BODY_LOG);
      } catch { /* unreadable */ }
      result = { ok: false, reason: `http-${r.status}`, status: r.status, bodyExcerpt };
    }
  } catch (err) {
    clearTimeout(tid);
    const reason = err.name === 'AbortError' ? `timeout-${timeoutMs}ms` : `network: ${err.message}`;
    result = { ok: false, reason };
  }

  if (result.ok) {
    console.log(`[ai-planner-trigger] ok bookingRef=${bookingRef} source=${source}`);
    return result;
  }

  console.error(`[ai-planner-trigger] FAIL bookingRef=${bookingRef} source=${source} reason=${result.reason}`);

  if (db) {
    try {
      const { FieldValue } = await import('firebase-admin/firestore');
      await db.collection(RETRY_COLLECTION).doc(bookingRef).set({
        bookingRef,
        payload,
        source,
        firstFailureAt: FieldValue.serverTimestamp(),
        lastFailureAt: FieldValue.serverTimestamp(),
        lastFailureReason: result.reason,
        status: 'pending',
        attempts: 0,
      }, { merge: false });
    } catch (persistErr) {
      console.error('[ai-planner-trigger] retry persist failed:', persistErr.message);
    }
  }

  if (notify) {
    const msg = [
      `⚠️ <b>AI Planner 생성 실패 — user 결제 완료됨</b>`,
      `<b>예약번호:</b> <code>${bookingRef}</code>`,
      `<b>호출자:</b> ${source}`,
      `<b>실패사유:</b> ${result.reason}`,
      result.bodyExcerpt ? `<b>응답 본문(앞 ${MAX_BODY_LOG}자):</b>\n<code>${result.bodyExcerpt.replace(/[<>&]/g, '_')}</code>` : '',
      ``,
      `→ <code>${RETRY_COLLECTION}/${bookingRef}</code> 등록. 5분 cron 자동 재시도.`,
      `→ 즉시 수동: <code>POST /api/ai-planner-full</code> 의 payload 재전송 (admin debug)`,
    ].filter(Boolean).join('\n');
    notify('booking', msg).catch((alertErr) => {
      console.error('[ai-planner-trigger] notify failed:', alertErr.message);
    });
  }

  return result;
}

export const PENDING_AI_PLANNER_RETRIES_COLLECTION = RETRY_COLLECTION;

export default triggerAiPlanner;
