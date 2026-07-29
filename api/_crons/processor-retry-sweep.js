/**
 * Cron: pending_processor_retries sweep
 *
 * PR #436 (Audit Y-H8 — 2026-05-16).
 *
 * Vercel cron 가 5분 간격으로 호출. status='pending' 인 retry doc 를 최대 maxBatch 개
 * 만큼 가져와 booking-processor 재호출. 성공 시 status='done', attempts++ + sweptAt.
 * 실패 시 attempts++ + lastFailureAt. attempts >= MAX_ATTEMPTS (5) 도달하면
 * status='manual-intervention' 으로 전환 + 운영자에게 escalation 알림 — 이후 sweep
 * 에서 자동 재시도하지 않고 운영자 수동 처리 필요.
 *
 * 멱등성: booking-processor 가 같은 orderID 로 여러 번 호출돼도 google_sheets row
 * 중복 방지 / Telegram dedup / 이메일 dedup 이 작동한다고 가정. 실제 dedup 로직은
 * booking-processor.js 의 idempotency 가드에 의존.
 */
import { initAdminDb } from '../_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from '../_shared/notify.js';
import {
  triggerBookingProcessor,
  PENDING_PROCESSOR_RETRIES_COLLECTION,
} from '../_shared/booking-processor-trigger.js';
import { internalApiBase } from '../_shared/internal-base-url.js';

const MAX_ATTEMPTS = 5;
const MAX_BATCH = 10;

export default async function handler(req, res) {
  try {
    const db = initAdminDb('processor-retry-sweep');
    if (!db) {
      console.error('[cron:processor-retry-sweep] Firestore unavailable');
      res.status(500).json({ ok: false, error: 'Firestore unavailable' });
      return;
    }

    const siteUrl = internalApiBase();

    const snap = await db.collection(PENDING_PROCESSOR_RETRIES_COLLECTION)
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
      const orderID = data.orderID || doc.id;
      const payload = data.payload;
      const attempts = Number(data.attempts || 0);
      if (!payload) {
        // malformed doc — escalate so operator can fix manually
        await doc.ref.update({
          status: 'manual-intervention',
          lastFailureAt: FieldValue.serverTimestamp(),
          lastFailureReason: 'malformed-payload',
        });
        escalated++;
        continue;
      }

      const result = await triggerBookingProcessor({
        db: null,            // skip helper's own persist — we update the existing doc below
        siteUrl,
        payload,
        source: 'retry-sweep',
        // skip notify on each retry — would spam the operator. Only escalation
        // notify fires below when attempts >= MAX.
      });

      // 🔴 2026-07-29 (의미상 성공 계약): result.ok 는 이제 HTTP 200 이 아니라
      //   booking-processor 응답 본문의 outcome==='completed' 를 뜻한다.
      //   즉 시트·메일·적립이 **실제로** 끝났을 때만 done 으로 닫힌다.
      if (result.ok) {
        await doc.ref.update({
          status: 'done',
          attempts: attempts + 1,
          outcome: result.outcome || 'completed',
          sweptAt: FieldValue.serverTimestamp(),
        });
        ok++;
      } else if (result.manual) {
        // outcome_unknown(다시 실행하면 손님에게 메일이 두 번 갈 수 있음) 또는
        // failed_permanent(재시도로는 못 고침). 재시도 횟수를 태우지 말고 즉시 사람에게 넘긴다.
        // 구형 pending 문서가 failed_permanent 를 받아도 여기서 바로 격리된다.
        await doc.ref.update({
          status: result.docStatus || 'manual-intervention',
          attempts: attempts + 1,
          outcome: result.outcome || 'manual_intervention',
          stepStatus: result.stepStatus || null,
          lastFailureAt: FieldValue.serverTimestamp(),
          lastFailureReason: result.reason,
        });
        escalated++;
        notify('booking', [
          `⚠️ <b>booking-processor 결과 미상 — 수동 확인 필요</b>`,
          `<b>예약번호:</b> <code>${orderID}</code>`,
          `<b>결과:</b> ${result.outcome || '-'} / 저장 상태: ${result.docStatus || 'manual-intervention'}`,
          `<b>단계 상태:</b> ${result.bodyExcerpt || '-'}`,
          ``,
          `→ 자동 재시도를 멈췄습니다. 실제 발송 여부·원인을 확인 후 처리하세요.`,
        ].join('\n')).catch(() => {});
      } else {
        const nextAttempts = attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
          await doc.ref.update({
            status: 'manual-intervention',
            attempts: nextAttempts,
            lastFailureAt: FieldValue.serverTimestamp(),
            lastFailureReason: result.reason,
          });
          escalated++;
          notify('booking', [
            `🚨 <b>booking-processor 재시도 ${MAX_ATTEMPTS}회 실패 — 수동 개입 필요</b>`,
            `<b>예약번호:</b> <code>${orderID}</code>`,
            `<b>최종 실패사유:</b> ${result.reason}`,
            ``,
            `→ <code>${PENDING_PROCESSOR_RETRIES_COLLECTION}/${orderID}</code> 점검`,
            `→ 수동 트리거: <code>POST /api/admin-replay-booking-notifications {orderID:"${orderID}"}</code>`,
          ].join('\n')).catch(() => {});
        } else {
          await doc.ref.update({
            attempts: nextAttempts,
            lastFailureAt: FieldValue.serverTimestamp(),
            lastFailureReason: result.reason,
          });
          failed++;
        }
      }
    }

    console.log(`[cron:processor-retry-sweep] swept ok=${ok} fail=${failed} escalated=${escalated} of ${snap.size}`);
    res.status(200).json({ ok: true, swept: snap.size, succeeded: ok, retryAgain: failed, escalated });
  } catch (err) {
    console.error('[cron:processor-retry-sweep] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
