/**
 * Customer email send with failure capture + operator alert + retry queue.
 *
 * PR #439 (Audit Z-H16 — 2026-05-16). Sister to booking-processor-trigger
 * (PR #436 / P60).
 *
 * Pre-fix pattern (silent loss):
 *   sendCustomerConfirmEmail(pending).catch(() => {});
 *
 * The inner function's try/catch logged failures to stderr only — no
 * operator alert, no retry. User got "결제 확정" success in the app,
 * never received the confirmation email, then asked support "did my
 * payment go through?". Operator had to manually outreach.
 *
 * This helper:
 *   - wraps sendEmail with try/catch
 *   - on failure: writes `pending_email_retries/{autoId}` (payload +
 *     reason + attempts counter) and fires a Telegram `booking` alert
 *   - always resolves (caller fire-and-forget safe)
 *
 * The retry queue is swept by the `email-retry-sweep` cron (5 minutes)
 * up to MAX_ATTEMPTS=5, then escalates to manual-intervention.
 */

import { sendEmail } from '../_send-email.js';
import { notify } from './notify.js';

const RETRY_COLLECTION = 'pending_email_retries';
const MAX_BODY_LOG = 200;

/**
 * @param {object} args
 * @param {FirebaseFirestore.Firestore | null} args.db
 * @param {string} args.to                     Recipient address.
 * @param {string} args.subject
 * @param {string} args.html
 * @param {string} args.text
 * @param {object} [args.context]              Free-form metadata: { bookingRef, emailType, language, source }
 * @returns {Promise<{ok: true} | {ok: false, reason: string}>}
 */
export async function sendCustomerEmailWithAlert({ db, to, subject, html, text, context = {} }) {
  if (!to || !subject) {
    console.warn('[customer-email] invalid args:', { to, hasSubject: !!subject });
    return { ok: false, reason: 'invalid-args' };
  }

  const ctxStr = JSON.stringify(context).slice(0, MAX_BODY_LOG);

  try {
    await sendEmail({ to, subject, html, text });
    console.log(`[customer-email] ok to=${to} ${ctxStr}`);
    return { ok: true };
  } catch (e) {
    const reason = e?.message || String(e) || 'unknown';
    console.error(`[customer-email] FAIL to=${to} reason=${reason} ${ctxStr}`);

    // 1) Persist for cron retry — autoId because the same booking may have
    //    multiple email touches (confirm, refund, modify).
    if (db) {
      try {
        const { FieldValue } = await import('firebase-admin/firestore');
        await db.collection(RETRY_COLLECTION).add({
          to,
          subject,
          html,
          text,
          context,
          firstFailureAt: FieldValue.serverTimestamp(),
          lastFailureAt: FieldValue.serverTimestamp(),
          lastFailureReason: reason,
          status: 'pending',
          attempts: 0,
        });
      } catch (persistErr) {
        console.error('[customer-email] retry persist failed:', persistErr.message);
      }
    }

    // 2) Operator alert — make the silent failure loud.
    const alertLines = [
      `⚠️ <b>고객 이메일 발송 실패</b>`,
      `<b>받는 사람:</b> ${to.replace(/[<>&]/g, '_')}`,
      context.bookingRef ? `<b>예약번호:</b> <code>${String(context.bookingRef).replace(/[<>&]/g, '_')}</code>` : '',
      context.emailType ? `<b>종류:</b> ${context.emailType}` : '',
      `<b>실패사유:</b> ${reason.replace(/[<>&]/g, '_').slice(0, 250)}`,
      ``,
      `→ <code>${RETRY_COLLECTION}</code> 등록됨, 5분 cron 자동 재시도`,
      `→ 즉시 수동: 운영자가 직접 이메일 발송 / 사용자 채팅 안내`,
    ].filter(Boolean).join('\n');
    notify('booking', alertLines).catch((alertErr) => {
      console.error('[customer-email] notify failed:', alertErr.message);
    });

    return { ok: false, reason };
  }
}

export const PENDING_EMAIL_RETRIES_COLLECTION = RETRY_COLLECTION;

export default sendCustomerEmailWithAlert;
