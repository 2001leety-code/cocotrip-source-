/**
 * Cron: pending_email_retries sweep.
 *
 * PR #439 (Audit Z-H16 — 2026-05-16). Sister to processor-retry-sweep
 * (PR #436 / P60).
 *
 * Vercel cron 가 5분 간격으로 호출. status='pending' 인 retry doc 를 최대
 * maxBatch 개 가져와서 sendEmail 재시도. 성공 시 status='done', 실패 시
 * attempts++ + lastFailureAt. attempts >= MAX_ATTEMPTS (5) 도달하면
 * status='manual-intervention' 으로 전환 + 운영자 escalation 알림.
 *
 * sendEmail 자체는 booking-processor 호출과 달리 Gmail SMTP 직접 호출 →
 * AbortController 불필요. 5분 cron 호출당 최대 10건 처리.
 */
import { initAdminDb } from '../_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from '../_shared/notify.js';
import { sendEmail } from '../_send-email.js';
import { PENDING_EMAIL_RETRIES_COLLECTION } from '../_shared/customer-email-trigger.js';

const MAX_ATTEMPTS = 5;
const MAX_BATCH = 10;

export default async function handler(req, res) {
  try {
    const db = initAdminDb('email-retry-sweep');
    if (!db) {
      console.error('[cron:email-retry-sweep] Firestore unavailable');
      res.status(500).json({ ok: false, error: 'Firestore unavailable' });
      return;
    }

    const snap = await db.collection(PENDING_EMAIL_RETRIES_COLLECTION)
      .where('status', '==', 'pending')
      .limit(MAX_BATCH)
      .get();

    if (snap.empty) {
      res.status(200).json({ ok: true, swept: 0 });
      return;
    }

    let ok = 0;
    let failed = 0;
    let escalated = 0;

    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const attempts = Number(data.attempts || 0);

      if (!data.to || !data.subject) {
        await doc.ref.update({
          status: 'manual-intervention',
          lastFailureAt: FieldValue.serverTimestamp(),
          lastFailureReason: 'malformed-payload',
        });
        escalated++;
        continue;
      }

      try {
        await sendEmail({
          to: data.to,
          subject: data.subject,
          html: data.html,
          text: data.text,
        });
        await doc.ref.update({
          status: 'done',
          attempts: attempts + 1,
          sweptAt: FieldValue.serverTimestamp(),
        });
        ok++;
      } catch (sendErr) {
        const nextAttempts = attempts + 1;
        const reason = sendErr?.message || 'unknown';
        if (nextAttempts >= MAX_ATTEMPTS) {
          await doc.ref.update({
            status: 'manual-intervention',
            attempts: nextAttempts,
            lastFailureAt: FieldValue.serverTimestamp(),
            lastFailureReason: reason,
          });
          escalated++;
          const ctx = data.context || {};
          notify('booking', [
            `🚨 <b>고객 이메일 재시도 ${MAX_ATTEMPTS}회 실패 — 수동 개입 필요</b>`,
            `<b>받는 사람:</b> ${String(data.to).replace(/[<>&]/g, '_')}`,
            ctx.bookingRef ? `<b>예약:</b> <code>${String(ctx.bookingRef).replace(/[<>&]/g, '_')}</code>` : '',
            ctx.emailType ? `<b>종류:</b> ${ctx.emailType}` : '',
            `<b>최종 사유:</b> ${reason.replace(/[<>&]/g, '_').slice(0, 250)}`,
            ``,
            `→ Firestore <code>${PENDING_EMAIL_RETRIES_COLLECTION}/${doc.id}</code> 점검`,
            `→ 운영자가 직접 이메일 발송하거나 사용자에게 채팅 안내`,
          ].filter(Boolean).join('\n')).catch(() => {});
        } else {
          await doc.ref.update({
            attempts: nextAttempts,
            lastFailureAt: FieldValue.serverTimestamp(),
            lastFailureReason: reason,
          });
          failed++;
        }
      }
    }

    console.log(`[cron:email-retry-sweep] swept ok=${ok} fail=${failed} escalated=${escalated} of ${snap.size}`);
    res.status(200).json({ ok: true, swept: snap.size, succeeded: ok, retryAgain: failed, escalated });
  } catch (err) {
    console.error('[cron:email-retry-sweep] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
