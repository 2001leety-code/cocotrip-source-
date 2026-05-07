/**
 * POST /api/admin-issue-onboarding-coupons
 *
 * PR #253 사후 보정용 — 회원가입 시 쿠폰 발급 silent fail 로 누락된 유저를 일괄 보정.
 * Admin 인증 필수 (ADMIN_EMAIL Bearer ID-token).
 *
 * 동작:
 *   - body.uid 지정 시: 해당 1명만 보정
 *   - body.uid 미지정 시: users 컬렉션 전체 스캔 → onboardingCouponsIssued != true 인 유저 일괄 보정
 *     (단, pageSize 기본 100, body.pageSize 로 override 가능 — 대량 실행 주의)
 *
 * 멱등성: issueOnboardingCouponsForUid() 내부 트랜잭션이 보장 (이미 발급된 유저는 skip).
 *
 * 실행 방법 (운영자 직접):
 *   1. 브라우저 콘솔에서 ID-token 획득:
 *      const token = await firebase.auth().currentUser.getIdToken();
 *   2. curl -X POST https://cocotripkr.com/api/admin-issue-onboarding-coupons \
 *        -H "Authorization: Bearer <token>" \
 *        -H "Content-Type: application/json" \
 *        -d '{}' | jq
 *   3. 특정 UID 1명만: -d '{"uid":"<uid>"}'
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyAdminToken } from './_shared/admin-auth.js';
import { captureError } from './_shared/sentry.js';
import { issueOnboardingCouponsForUid } from './onboarding-coupons.js';

export const maxDuration = 60; // 배치 처리 여유
export const config = { runtime: 'nodejs' };

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  // Admin 인증
  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const { uid: targetUid, pageSize = 100 } = body;

  try {
    const db = initAdminDb('admin-issue-onboarding-coupons');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const results = { issued: 0, alreadyIssued: 0, errors: 0, errorDetails: [] };

    if (targetUid) {
      // 단일 유저 보정
      try {
        const r = await issueOnboardingCouponsForUid(db, targetUid);
        if (r.alreadyIssued) results.alreadyIssued++;
        else results.issued += r.issued;
      } catch (err) {
        results.errors++;
        results.errorDetails.push({ uid: targetUid, error: err.message });
      }
    } else {
      // 전체 스캔 — onboardingCouponsIssued != true 인 유저
      // Firestore 쿼리: field 가 존재하지 않거나 false 인 경우
      const snap = await db.collection('users')
        .where('onboardingCouponsIssued', '!=', true)
        .limit(Math.min(Number(pageSize) || 100, 500))
        .get();

      console.log(`[admin-issue-onboarding-coupons] scan found ${snap.size} candidates`);

      for (const docSnap of snap.docs) {
        const uid = docSnap.id;
        try {
          const r = await issueOnboardingCouponsForUid(db, uid);
          if (r.alreadyIssued) results.alreadyIssued++;
          else results.issued += r.issued;
        } catch (err) {
          results.errors++;
          results.errorDetails.push({ uid, error: err.message });
          console.error(`[admin-issue-onboarding-coupons] uid=${uid} failed:`, err.message);
        }
      }
    }

    console.log('[admin-issue-onboarding-coupons] done. results=', results, 'by=', auth.email);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: true, results }));
  } catch (err) {
    console.error('[admin-issue-onboarding-coupons] fatal:', err.message);
    await captureError(err, { route: '/api/admin-issue-onboarding-coupons' });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
