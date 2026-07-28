/**
 * Cron: pending_ai_planner_retries sweep.
 *
 * PR #453 (Audit Z-H7 — 2026-05-16). Sister to processor-retry-sweep
 * (PR #436 / P60) and email-retry-sweep (PR #439 / P63).
 *
 * Vercel cron 5분 간격 호출. status='pending' retry doc 를 최대 maxBatch
 * 개 가져와서 ai-planner-full 재시도. 성공 시 status='done'. 실패 시
 * attempts++ + lastFailureAt. attempts >= MAX_ATTEMPTS (3) 도달 시
 * status='manual-intervention' 으로 전환 + 운영자 escalation 알림.
 *
 * MAX_ATTEMPTS=3 (booking-processor 5 보다 낮음): AI Planner 실패는 보통
 * deterministic (bad input / Gemini quota / cold start). 3 번 시도면 일시적인
 * 문제 vs 영구적인 문제 구분 충분.
 */
import { initAdminDb } from '../_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from '../_shared/notify.js';
import {
  triggerAiPlanner,
  PENDING_AI_PLANNER_RETRIES_COLLECTION,
} from '../_shared/ai-planner-trigger.js';
import { internalApiBase } from '../_shared/internal-base-url.js';

const MAX_ATTEMPTS = 3;
const MAX_BATCH = 5;

export default async function handler(req, res) {
  try {
    const db = initAdminDb('ai-planner-retry-sweep');
    if (!db) {
      console.error('[cron:ai-planner-retry-sweep] Firestore unavailable');
      res.status(500).json({ ok: false, error: 'Firestore unavailable' });
      return;
    }

    const siteUrl = internalApiBase();

    const snap = await db.collection(PENDING_AI_PLANNER_RETRIES_COLLECTION)
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
      const bookingRef = data.bookingRef || doc.id;
      const payload = data.payload;
      const attempts = Number(data.attempts || 0);
      if (!payload) {
        await doc.ref.update({
          status: 'manual-intervention',
          lastFailureAt: FieldValue.serverTimestamp(),
          lastFailureReason: 'malformed-payload',
        });
        escalated++;
        continue;
      }

      const result = await triggerAiPlanner({
        db: null,
        siteUrl,
        bookingRef,
        payload,
        source: 'retry-sweep',
        // skip notify per retry — escalation alert below is what operator needs
      });

      if (result.ok) {
        await doc.ref.update({
          status: 'done',
          attempts: attempts + 1,
          sweptAt: FieldValue.serverTimestamp(),
        });
        ok++;
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
            `🚨 <b>AI Planner 재시도 ${MAX_ATTEMPTS}회 실패 — 수동 개입 필요</b>`,
            `<b>예약번호:</b> <code>${bookingRef}</code>`,
            `<b>최종 사유:</b> ${result.reason}`,
            ``,
            `→ <code>${PENDING_AI_PLANNER_RETRIES_COLLECTION}/${bookingRef}</code> 점검`,
            `→ Gemini quota / ai-planner-full input 검증 후 수동 재시도`,
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

    console.log(`[cron:ai-planner-retry-sweep] swept ok=${ok} fail=${failed} escalated=${escalated} of ${snap.size}`);
    res.status(200).json({ ok: true, swept: snap.size, succeeded: ok, retryAgain: failed, escalated });
  } catch (err) {
    console.error('[cron:ai-planner-retry-sweep] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
