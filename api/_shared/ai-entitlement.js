/**
 * ai-entitlement.js — "$9.90 유료 AI 기능" 자격 검증 (운영자 2026-07-07 요금제 개편).
 *
 * 설계: 무료 쿠폰 = AI 플랜 1회 + 수정 OK, 단 AI 도움/추천(코스빌더 AI 동선최적화·주변추천) 없음.
 *       $9.90 구매 = AI 추천/최적화 해금. capturePaypalOrder 가 ai_planner 결제 성공 시
 *       users/{uid}.aiFeaturesUnlocked=true 로 영구 해금. course-ai.js 가 이 자격을 게이트한다.
 *
 * ⚠️ 기존 구매자(플래그 도입 전)는 aiFeaturesUnlocked 미설정 → 최초엔 잠김. 운영자 후속:
 *    admin-backfill-ai-entitlement 1회 실행(paymentSource!=='ai-coupon' 플랜 보유자에 플래그 set).
 */

/** Firebase ID 토큰(Authorization: Bearer …) → uid. 실패/토큰없음 시 null. */
export async function verifyUidFromAuthHeader(authHeader) {
  const m = /^Bearer\s+(.+)$/.exec(authHeader || '');
  if (!m) return null;
  try {
    const { getAuth } = await import('firebase-admin/auth');
    const { getApps } = await import('firebase-admin/app');
    if (!getApps().length) return null;
    const decoded = await getAuth().verifyIdToken(m[1], true);
    return decoded.uid || null;
  } catch {
    return null;
  }
}

/**
 * users/{uid}.aiFeaturesUnlocked === true (=$9.90 구매자) 여부.
 * db/uid 없거나 에러면 false(=잠김, 안전: 유료 기능 무단 개방보다 잠김이 안전).
 */
export async function hasAiFeatureEntitlement(db, uid) {
  if (!db || !uid) return false;
  try {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists && snap.data()?.aiFeaturesUnlocked === true;
  } catch {
    return false;
  }
}
