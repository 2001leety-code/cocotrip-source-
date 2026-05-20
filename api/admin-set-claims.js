/**
 * Vercel API Route: Admin Set Custom Claims (P110, 2026-05-20)
 *
 * POST /api/admin-set-claims
 * Headers: Authorization: Bearer <Firebase-ID-token>  (super-admin only)
 *
 * Body:
 *   { targetUid: string, claims: { admin?: boolean, roles?: string[] } }
 *
 *   - targetUid: 대상 사용자 Firebase UID (auth.uid)
 *   - claims.admin: true 면 admin gate 통과. false 면 admin 권한 회수.
 *   - claims.roles: ['super-admin' | 'product-manager' | 'cs' | 'finance' | 'driver-ops']
 *     (whitelist 외 값은 자동 제거).
 *
 * Response: { ok: true, data: { uid, claims, message } }
 *
 * 보안:
 *   1. verifyAdminToken — Firebase ID token 검증 + admin gate.
 *   2. requireRole('super-admin') — super-admin claim 보유자만 통과.
 *      ADMIN_EMAIL 만 보유한 운영자는 grant-super-admin.mjs 로 먼저 자신에게
 *      super-admin claim 부여 (one-time bootstrap).
 *   3. self-locked-out 방지: caller 가 자신의 super-admin role 회수 시 reject.
 *   4. Audit log: admin_actions 컬렉션에 { action:'set_claims', caller, target,
 *      newClaims, timestamp } 기록.
 *
 * 정책: ID token refresh 까지 ~1시간 (자동) 또는 client 가 getIdToken(true)
 * 호출 시 즉시. 응답 message 에 안내 포함.
 */
import { verifyAdminToken, requireRole, extractRoles } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { initAdminDb } from './_shared/firebase-admin.js';

const VALID_ROLES = new Set(['super-admin', 'product-manager', 'cs', 'finance', 'driver-ops']);

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

export const config = { runtime: 'nodejs', maxDuration: 10 };

const CORS_METHODS = 'POST, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

/**
 * Sanitize incoming roles list — whitelist + dedupe + lowercase.
 * Exported for unit-test introspection.
 */
export function sanitizeRoles(raw) {
  const normalized = extractRoles(raw);
  const set = new Set();
  for (const r of normalized) {
    if (VALID_ROLES.has(r)) set.add(r);
  }
  return [...set];
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS }));
    return res.end();
  }
  if (req.method !== 'POST') {
    return json(req, res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) return json(req, res, tokenAuth.status, _err(tokenAuth.error, 'AUTH_FAILED'));

  // P110: super-admin role 보유자만 set_claims 가능.
  if (!requireRole(tokenAuth.roles, 'super-admin')) {
    return json(req, res, 403, _err(
      'super-admin role required. Bootstrap with scripts/grant-super-admin.mjs first.',
      'INSUFFICIENT_ROLE',
    ));
  }

  const body = req.body || {};
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';
  if (!targetUid) {
    return json(req, res, 400, _err('targetUid is required', 'INVALID_INPUT'));
  }
  if (targetUid.length > 128) {
    return json(req, res, 400, _err('targetUid too long', 'INVALID_INPUT'));
  }

  const claims = body.claims && typeof body.claims === 'object' ? body.claims : {};
  const adminFlag = claims.admin === true;
  const newRoles = sanitizeRoles(claims.roles);

  // self-locked-out 방지: caller 가 자신의 super-admin role 을 회수하려 하면 거부.
  // tokenAuth.uid 는 verifyAdminToken decoded.uid — 같은 uid 면 self-modify.
  if (tokenAuth.uid === targetUid && tokenAuth.roles.includes('super-admin')
      && !newRoles.includes('super-admin')) {
    return json(req, res, 400, _err(
      'Cannot revoke own super-admin role (lockout protection)',
      'SELF_LOCKOUT_BLOCKED',
    ));
  }

  // Firebase Auth setCustomUserClaims — 빈 객체 {} 전달 시 모든 claim 제거.
  // claims.admin === true 면 admin: true, 아니면 false (명시적 제거).
  const newClaims = { admin: !!adminFlag, roles: newRoles };

  try {
    const { getAuth } = await import('firebase-admin/auth');
    await getAuth().setCustomUserClaims(targetUid, newClaims);
  } catch (e) {
    console.error('[admin-set-claims] setCustomUserClaims failed:', e.message);
    return json(req, res, 500, _err(`Failed to set claims: ${e.message}`, 'CLAIM_WRITE_FAILED'));
  }

  // Audit log (non-blocking — claim 부여 성공 후 기록 실패해도 응답 200).
  try {
    const adminDb = initAdminDb('admin-set-claims');
    if (adminDb) {
      await adminDb.collection('admin_actions').add({
        action: 'set_claims',
        callerUid: tokenAuth.uid,
        callerEmail: tokenAuth.email,
        targetUid,
        newClaims,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn('[admin-set-claims] audit log write failed (non-fatal):', e.message);
  }

  return json(req, res, 200, _ok({
    uid: targetUid,
    claims: newClaims,
    message: '권한 변경됨. 대상 사용자는 다음 로그인 또는 getIdToken(true) refresh 후 적용.',
  }));
}
