/**
 * 의사결정 큐 — 자가운영 에이전시 P5 capstone. "운영자가 결정할 것만 한곳에" (승인/거절).
 *
 * 2026-06-10. 사무실 직원들이 "사장님 결정이 필요한 일"을 이 큐에 카드로 쌓고(enqueue),
 * 운영자는 웹/텔레그램에서 승인·거절만 한다. (감사 3층의 "사람 승인" 층 = 사장 = 사람.)
 *
 * Firestore `decision_queue`: { type, title, summary, link, status('pending'|'approved'|'rejected'),
 *   dedupeKey, createdAtMs, resolvedAtMs? }.
 * enqueue 는 멱등(같은 dedupeKey 의 pending 이 있으면 중복 추가 안 함) — cron 매일 호출해도 안전.
 *
 * v1 소스: 콘텐츠 직원(content_publish). v2: cs_tickets 응대·ops 알림·환불 검토 등 enqueue 확장.
 */

const COLLECTION = 'decision_queue';
const VALID_STATUS = new Set(['pending', 'approved', 'rejected']);

/**
 * 결정 항목 enqueue (멱등). 같은 dedupeKey 의 pending 항목이 이미 있으면 skip.
 * @param {FirebaseFirestore.Firestore} db
 * @param {{type:string, title:string, summary?:string, link?:string, dedupeKey:string}} item
 */
export async function enqueueDecision(db, item) {
  if (!db || !item || !item.dedupeKey || !item.title) return { ok: false, reason: 'invalid' };
  try {
    const dup = await db.collection(COLLECTION)
      .where('dedupeKey', '==', item.dedupeKey).where('status', '==', 'pending').limit(1).get();
    if (!dup.empty) return { ok: true, skipped: true };
    const ref = await db.collection(COLLECTION).add({
      type: String(item.type || 'general'),
      title: String(item.title),
      summary: String(item.summary || ''),
      link: String(item.link || ''),
      status: 'pending',
      dedupeKey: String(item.dedupeKey),
      createdAtMs: Date.now(),
    });
    return { ok: true, added: true, id: ref.id };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'error' };
  }
}

/** 결정 상태 변경 (승인/거절). status='approved'|'rejected' 만 허용. */
export async function resolveDecision(db, id, status) {
  if (!db || !id || !VALID_STATUS.has(status) || status === 'pending') return { ok: false, reason: 'invalid' };
  try {
    await db.collection(COLLECTION).doc(String(id)).update({ status, resolvedAtMs: Date.now() });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'error' };
  }
}

/** pending 항목 집계 — 모닝브리핑/배지용 (순수). */
export function aggregateDecisionSummary(docs = []) {
  const pending = (Array.isArray(docs) ? docs : []).filter((d) => d && d.status === 'pending');
  const byType = {};
  for (const d of pending) {
    const t = d.type || 'general';
    byType[t] = (byType[t] || 0) + 1;
  }
  const top = [...pending]
    .sort((a, b) => (Number(b.createdAtMs) || 0) - (Number(a.createdAtMs) || 0))
    .slice(0, 3)
    .map((d) => ({ title: d.title || '', type: d.type || 'general' }));
  return { total: pending.length, byType, top };
}

export const DECISION_COLLECTION = COLLECTION;
