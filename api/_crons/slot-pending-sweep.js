/**
 * Cron: tour_availability slot_pending sweep.
 *
 * P108 (2026-05-20). Sister to processor-retry-sweep (PR #436 / P60) and
 * email-retry-sweep (PR #439 / P63).
 *
 * Vercel cron 5분 간격 호출. tour_availability/{tourId}/dates/{date} 의
 * slot_pending 맵에서 expiresAt 지난 항목을 제거. confirmed 는 영향 X — pending
 * 카운터만 정리.
 *
 * 호출 패턴:
 *   1. collectionGroup('dates') 로 모든 tour_availability/*/dates/* 조회 (한도
 *      MAX_DOCS 100).
 *   2. slot_pending 존재 + 만료 항목이 있는 doc 만 sweep 대상으로 분기.
 *   3. 각 doc 에 sweepExpiredPending 호출 — 내부에서 runTransaction (race-safe).
 *
 * 만료 TTL = 10분 (PENDING_TTL_MS, slot-capacity.js). createPaypalOrder.js 의
 * acquireSlotLock 이 expiresAt 을 nowMs + TTL 로 설정 → capturePaypalOrder.js
 * 도달 못 한 결제 시도는 다음 cron tick (max 15분 후) 에 잠금 해제.
 *
 * 로깅: 항상 swept 수 출력. swept > 0 시 운영자 알림 X (정상 흐름).
 *
 * 관련: api/_shared/slot-capacity.js (sweepExpiredPending) +
 *       api/createPaypalOrder.js (acquireSlotLock) +
 *       api/capturePaypalOrder.js (confirmSlotLock)
 */
import { initAdminDb } from '../_shared/firebase-admin.js';
import { sweepExpiredPending } from '../_shared/slot-capacity.js';

const MAX_DOCS = 100;

export default async function handler(req, res) {
  try {
    const db = initAdminDb('slot-pending-sweep');
    if (!db) {
      console.error('[cron:slot-pending-sweep] Firestore unavailable');
      res.status(500).json({ ok: false, error: 'Firestore unavailable' });
      return;
    }

    // collectionGroup 으로 모든 tour_availability/{tourId}/dates 의 doc 조회.
    // slot_pending field 가 존재하는 doc 만 후보 (Firestore where '!= null' 직접
    // 미지원 → client-side filter).
    const snap = await db.collectionGroup('dates').limit(MAX_DOCS).get();
    if (snap.empty) {
      console.log('[cron:slot-pending-sweep] no docs to inspect');
      res.status(200).json({ ok: true, inspected: 0, swept: 0 });
      return;
    }

    let inspected = 0;
    let totalSwept = 0;
    let docsSwept = 0;
    let errors = 0;

    for (const doc of snap.docs) {
      inspected += 1;
      const data = doc.data() || {};
      const slotPending = data.slot_pending;
      if (!slotPending || typeof slotPending !== 'object' || Object.keys(slotPending).length === 0) continue;

      const tourId = data.tourId || doc.ref.parent.parent?.id;
      const date = data.date || doc.id;
      if (!tourId || !date) {
        console.warn('[cron:slot-pending-sweep] doc missing tourId/date — skip:', doc.ref.path);
        continue;
      }

      try {
        const r = await sweepExpiredPending({ adminDb: db, tourId, date });
        if (r.swept > 0) {
          docsSwept += 1;
          totalSwept += r.swept;
        }
      } catch (err) {
        errors += 1;
        console.error('[cron:slot-pending-sweep] sweep failed:', doc.ref.path, err.message);
      }
    }

    console.log(`[cron:slot-pending-sweep] inspected=${inspected} docs_swept=${docsSwept} slots_swept=${totalSwept} errors=${errors}`);
    res.status(200).json({ ok: true, inspected, docsSwept, slotsSwept: totalSwept, errors });
  } catch (err) {
    console.error('[cron:slot-pending-sweep] handler error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
