/**
 * Cron: plans.status='streaming' stuck sweep (P292, 2026-05-29).
 *
 * 배경 — 5/29 P287 cycle:
 *   P280 v1 (dietary critical retry) 가 무한 retry loop → plan 1466ced3 1h30m+
 *   status='streaming' stuck → 사용자 결제 후 plan 안 받음 (SAFETY-CRITICAL).
 *   P287 cycle 에서 P280 v1 revert + P280 v2 (severity=warning) 적용으로 root cause
 *   해소했지만, 미래 회귀 차단 위해 정리 cron 추가.
 *
 * 본 cron 의 역할:
 *   - Vercel cron 5분 간격 호출. plans where status='streaming' AND
 *     _streaming_started_at < cutoff 의 stuck doc 을 status='error' 로 정리.
 *   - threshold: STUCK_THRESHOLD_MS = 30분 (Vercel maxDuration 800s = 13.3분 의
 *     2.25배 안전마진). legacy streaming 정상 처리 시간 < 5분, 30분 = "확실히 stuck".
 *   - dispatch-timeout-sweep (dispatch_messages 처리) 와 별개. 본 cron 은
 *     plans collection 만 처리.
 *
 * 처리:
 *   - status='error' + _streaming_in_progress=false + _streaming_error='streaming_timeout_sweep_p292'
 *     + _swept_at=now (planPersister.js:1001 동일 패턴)
 *   - PlanDetailPage 가 status='error' 감지 → 사용자 fallback UI 표시
 *   - Telegram admin alert (운영자 환불 안내 의무 — 사용자 결제 후 처리 SAFETY)
 *
 * 박제 의무 (5/29 P287 cycle lesson):
 *   - silent throw 금지 (사용자 결제 후 plan 안 받음 회피)
 *   - retry trigger 없음 (P280 v1 무한 loop 회피 — sweep 1회 처리 후 status='error' 종료)
 *   - alert 운영자 escalation (manual 환불 안내)
 */
import { initAdminDb } from '../_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { notify } from '../_shared/notify.js';

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30분
const MAX_BATCH = 10;

export default async function handler(req, res) {
  try {
    const db = initAdminDb('plan-streaming-sweep');
    if (!db) {
      console.error('[cron:plan-streaming-sweep] Firestore unavailable');
      res.status(500).json({ ok: false, error: 'Firestore unavailable' });
      return;
    }

    const cutoffMs = Date.now() - STUCK_THRESHOLD_MS;
    const snap = await db.collection('plans')
      .where('status', '==', 'streaming')
      .limit(MAX_BATCH * 4)  // streaming 전체 가져온 후 cutoff filter (Firestore composite index 회피)
      .get();

    if (snap.empty) {
      res.status(200).json({ ok: true, swept: 0 });
      return;
    }

    let swept = 0;
    const alertSamples = [];

    for (const doc of snap.docs) {
      if (swept >= MAX_BATCH) break;
      const data = doc.data() || {};
      // _streaming_started_at (planPersister.js:918 / backgroundPipelines.js:142/257) 또는
      // createdAtMs fallback. 둘 다 없으면 보수적 skip (legacy/malformed doc).
      const startedMs = Number(data._streaming_started_at) || Number(data.createdAtMs) || 0;
      if (!startedMs || startedMs > cutoffMs) continue; // stuck 아님

      const elapsedMin = Math.round((Date.now() - startedMs) / 60000);
      await doc.ref.update({
        status: 'error',
        _streaming_in_progress: false,
        _streaming_error: 'streaming_timeout_sweep_p292',
        _swept_at: FieldValue.serverTimestamp(),
        _swept_elapsed_min: elapsedMin,
      });
      swept++;
      if (alertSamples.length < 3) {
        alertSamples.push({ planId: doc.id, elapsedMin, uid: data.uid || null, email: data.guestEmail || null });
      }
    }

    if (swept > 0) {
      const lines = [
        `🚨 <b>plan-streaming-sweep (P292) — ${swept} stuck plan 정리</b>`,
        ``,
        `<b>threshold:</b> ${STUCK_THRESHOLD_MS / 60000}분 (Vercel max 800s × 2.25)`,
        `<b>처리:</b> status='streaming' → 'error' (PlanDetailPage fallback UI)`,
        ``,
        `<b>샘플 (최대 3):</b>`,
        ...alertSamples.map((s) =>
          `• <code>${s.planId.slice(0, 8)}</code> (${s.elapsedMin}분 stuck, ${s.uid ? `uid=${s.uid.slice(0,6)}` : `email=${s.email || '?'}`})`
        ),
        ``,
        `→ <b>운영자 manual</b>: 사용자 환불 안내 + 원인 분석 (Vercel logs / Inngest run).`,
      ];
      notify('booking', lines.join('\n')).catch(() => {});
    }

    console.log(`[cron:plan-streaming-sweep] swept ${swept} of ${snap.size} (threshold ${STUCK_THRESHOLD_MS / 60000}분)`);
    res.status(200).json({ ok: true, swept, scanned: snap.size, thresholdMin: STUCK_THRESHOLD_MS / 60000 });
  } catch (err) {
    console.error('[cron:plan-streaming-sweep] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
}
