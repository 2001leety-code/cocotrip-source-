/**
 * POST /api/admin-issue-onboarding-coupons
 *
 * PR #253 사후 보정용 — 가입 혜택 후보 조회 및 명시적 단건 보정.
 * Admin 인증 필수 (ADMIN_EMAIL Bearer ID-token).
 * Production only. Preview/local requests are rejected before Firebase modules load.
 *
 * 동작:
 *   - dryRun:true: UID 지정 시 문서 존재 조회, 미지정 시 제한된 후보 조회.
 *   - dryRun:false + uid: Auth 사용자 존재 확인 후 해당 1명만 발급 함수 호출.
 *     UID 없는 실발급은 거부. dryRun은 기존 문서 조회만 수행한다.
 *   - pageSize: UID 없는 조회에만 사용, 정수 1~500 (기본 100).
 *
 * 주의: 발급 함수는 marker만 검사한다. 기존 쿠폰 이력 불일치/중복은 별도 검토 필요.
 *
 * 실행 방법 (운영자 직접):
 *   1. 브라우저 콘솔에서 ID-token 획득:
 *      const token = await firebase.auth().currentUser.getIdToken();
 *   2. curl -X POST https://cocotripkr.com/api/admin-issue-onboarding-coupons \
 *        -H "Authorization: Bearer <token>" \
 *        -H "Content-Type: application/json" \
 *        -d '{"dryRun":true,"pageSize":1}' | jq
 *   3. 별도 승인된 특정 UID 1명만 실행: -d '{"uid":"<uid>","dryRun":false}'
 */
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';

export const maxDuration = 60; // 배치 처리 여유
export const config = { runtime: 'nodejs' };

// PR #437 (W-H11): per-request origin allowlist — was wildcard '*'.
const JSON_HEADERS_STATIC = { 'Cache-Control': 'no-store' };
const CORS_METHODS = 'POST, OPTIONS';

export default async function handler(req, res) {
  const JSON_HEADERS = { ...JSON_HEADERS_STATIC, ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  if (process.env.VERCEL_ENV !== 'production') {
    res.writeHead(503, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'Coupon recovery is unavailable outside production', code: 'RECOVERY_PRODUCTION_ONLY' }));
  }

  // Delay the whole Firebase import chain, including the issuer's own bootstrap.
  let initAdminDb, verifyAdminToken, issueOnboardingCouponsForUid;
  try {
    ({ initAdminDb } = await import('./_shared/firebase-admin.js'));
    ({ verifyAdminToken } = await import('./_shared/admin-auth.js'));
    ({ issueOnboardingCouponsForUid } = await import('./onboarding-coupons.js'));
  } catch {
    console.error('[admin-issue-onboarding-coupons] recovery runtime import failed');
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'Coupon recovery runtime unavailable', code: 'RECOVERY_RUNTIME_UNAVAILABLE' }));
  }

  // Admin 인증
  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }

  const badRequest = (error) => {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error }));
  };
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {
      // Do not turn a malformed request into the default bulk issuance request.
      return badRequest('Invalid JSON body');
    }
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return badRequest('JSON object body required');
  if (Object.keys(body).some(key => !['uid', 'dryRun', 'pageSize'].includes(key))) return badRequest('Unknown request field');
  if (typeof body.dryRun !== 'boolean') return badRequest('Explicit boolean dryRun required');
  const hasUid = Object.prototype.hasOwnProperty.call(body, 'uid');
  if (hasUid && typeof body.uid !== 'string') return badRequest('uid must be a string');
  const targetUid = hasUid ? body.uid.trim() : '';
  if (hasUid && (!targetUid || targetUid.length > 128 || targetUid.includes('/'))) return badRequest('Valid single uid required');
  const dryRun = body.dryRun;
  if (!dryRun && !targetUid) return badRequest('Explicit single uid required for issuance');
  const hasPageSize = Object.prototype.hasOwnProperty.call(body, 'pageSize');
  if (hasPageSize && targetUid) return badRequest('pageSize is only supported for read-only candidate scanning');
  const pageSize = hasPageSize ? body.pageSize : 100;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) return badRequest('pageSize must be an integer from 1 to 500');

  try {
    const db = initAdminDb('admin-issue-onboarding-coupons');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    if (!dryRun) {
      try {
        const { getAuth } = await import('firebase-admin/auth');
        await getAuth().getUser(targetUid);
      } catch (lookupErr) {
        if (lookupErr.code === 'auth/user-not-found') {
          res.writeHead(404, JSON_HEADERS);
          return res.end(JSON.stringify({ ok: false, error: `User not found for uid: ${targetUid}`, code: 'USER_NOT_FOUND' }));
        }
        await captureError(lookupErr, { route: '/api/admin-issue-onboarding-coupons' });
        res.writeHead(500, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: lookupErr.message, code: 'INTERNAL_ERROR' }));
      }
    }

    const results = { issued: 0, alreadyIssued: 0, errors: 0, errorDetails: [] };
    if (dryRun === true) results.dryRun = true;

    if (targetUid) {
      // 단일 유저 보정
      if (dryRun === true) {
        // 존재 확인까지만 — 발급 없음.
        const userSnap = await db.collection('users').doc(targetUid).get();
        results.candidates = userSnap.exists ? 1 : 0;
      } else {
      try {
        const r = await issueOnboardingCouponsForUid(db, targetUid);
        if (r.alreadyIssued) results.alreadyIssued++;
        else results.issued += r.issued;
      } catch (err) {
        results.errors++;
        results.errorDetails.push({ uid: targetUid, error: err.message });
      }
      }
    } else {
      // Read-only candidate scan. Missing/null markers are excluded by this query;
      // this count is not a complete recovery inventory.
      const snap = await db.collection('users')
        .where('onboardingCouponsIssued', '!=', true)
        .limit(pageSize)
        .get();

      console.log(`[admin-issue-onboarding-coupons] scan found ${snap.size} candidates${dryRun === true ? ' (dryRun — 발급 생략)' : ''}`);

      results.candidates = snap.size;
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
