/**
 * Build "AVOID list" prompt clause from user's recent plans.
 *
 * Why: Gemini at temperature 0.7 still tends to repeat top-rated restaurants
 * (e.g. 부근진토 갈비, 광장시장 김밥) for the same user. Querying the
 * caller's last 3 plans for food-category stops and listing them in the
 * prompt as "do NOT use these" forces variation.
 *
 * Non-critical: any Firestore failure here returns an empty string so the
 * planner proceeds without the AVOID clause rather than failing the request.
 *
 * PR #465 (Audit X-H7 — 2026-05-16): Firestore composite-index detection.
 * Pre-fix: missing `plans.uid+createdAt` / `plans.email+createdAt` indexes
 * threw FAILED_PRECONDITION on EVERY user. catch was console.warn-only —
 * operator never knew the AVOID clause was disabled in prod, users got
 * repeat restaurants ("왜 매번 같은 식당 추천?" complaints). Now we
 * detect the index-missing error pattern, fire a once-per-window admin
 * alert with the Firebase-provided index-creation URL, and still return
 * '' (fail-OPEN — AVOID clause is non-critical to plan delivery).
 */
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';

/** Detect Firestore's "the query requires an index" failure mode. */
export function isFirestoreIndexMissingError(err) {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || '');
  // Firestore exposes this as FAILED_PRECONDITION (gRPC code 9) with a
  // message that always contains "requires an index" and a creation URL.
  if (code === 'FAILED_PRECONDITION' || code === '9') return /requires an index/i.test(msg);
  return /requires an index/i.test(msg);
}

/**
 * Pull the "https://console.firebase.google.com/..." index-creation URL
 * out of the error message so the operator can one-click create it.
 * Returns '' if the URL pattern isn't found.
 */
export function extractIndexCreationUrl(err) {
  const msg = String(err?.message || '');
  const match = msg.match(/https:\/\/console\.firebase\.google\.com\/[^\s)]+/);
  return match ? match[0] : '';
}

export async function buildAvoidClause(adminDb, { uid, requestEmail }) {
  if (!adminDb || (!uid && !requestEmail)) return '';
  try {
    let q = adminDb.collection('plans').orderBy('createdAt', 'desc').limit(3);
    if (uid) {
      q = q.where('uid', '==', uid);
    } else {
      q = q.where('email', '==', requestEmail);
    }
    const snap = await q.get();
    const usedNames = new Set();
    snap.forEach((doc) => {
      const plan = doc.data();
      const days = plan.itinerary?.days || [];
      for (const day of days) {
        for (const stop of day.stops || []) {
          if (stop.category === 'food' && stop.name) {
            usedNames.add(stop.name);
          }
        }
      }
    });
    if (usedNames.size === 0) return '';
    const names = [...usedNames].slice(0, 20).join(', ');
    console.log(`[planner] AVOID list: ${usedNames.size} restaurants from ${snap.size} recent plans`);
    return `\n\n[AVOID LIST — DO NOT USE THESE RESTAURANTS]\nThe user has already received plans with these restaurants. Pick DIFFERENT ones:\n${names}`;
  } catch (err) {
    console.warn('[planner] AVOID list query failed:', err.message);

    // PR #465 (X-H7): index-missing path — operator MUST know.
    if (isFirestoreIndexMissingError(err)) {
      const queryKind = uid ? 'uid' : 'email';
      const indexUrl = extractIndexCreationUrl(err);
      throttledTelegramAlert({
        key: `avoid-list-index-missing:${queryKind}`,
        channel: 'admin',
        severity: 'high',
        message: [
          `⚠️ <b>AVOID list Firestore index missing — every plan losing variation</b>`,
          ``,
          `<b>query kind:</b> plans where ${queryKind}==X orderBy createdAt desc`,
          `<b>error:</b> ${String(err.message || '').slice(0, 300).replace(/[<>&]/g, '_')}`,
          ``,
          indexUrl
            ? `→ <b>1-click create:</b> <a href="${indexUrl}">${indexUrl}</a>`
            : `→ firestore.indexes.json 의 plans/${queryKind} 인덱스 확인 + \`firebase deploy --only firestore:indexes\` 실행 필요`,
          ``,
          `→ AVOID clause 가 prompt 에 안 들어가므로 사용자는 반복 식당 추천 받는 중.`,
          `→ 운영자 한 번 인덱스 만들면 자동 회복 — 빌드 ~5분 소요.`,
        ].join('\n'),
        context: {
          errorCode: 'avoid_list_index_missing',
          reason: queryKind,
          step: 'buildAvoidClause',
        },
      }).catch(() => {});
    }

    return '';
  }
}
