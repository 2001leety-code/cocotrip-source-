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
 */
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
    return '';
  }
}
