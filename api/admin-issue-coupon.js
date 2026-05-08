/**
 * POST /api/admin-issue-coupon
 *
 * 운영자가 특정 사용자에게 쿠폰을 직접 발행. 5/9 운영자 요청:
 * "어드민은 고객에게 내가 쿠폰주고 싶은 아이디 클릭해서 주게 만들면 되는거고".
 *
 * Admin 인증 필수 (verifyAdminToken — Firebase ID token Bearer).
 *
 * Body:
 *   - targetUid       : 발행 대상 user uid (targetUid 또는 targetEmail 중 하나 필수)
 *   - targetEmail     : 발행 대상 user 이메일 (targetUid 미지정 시 사용 — users 컬렉션 검색)
 *   - type            : 'percent' | 'fixed' (필수)
 *   - value           : number (필수). percent=5/10/15, fixed=5/10 등
 *   - currency        : 'USD' | 'KRW' (fixed type 시 필수, percent 무시)
 *   - label           : 표시 라벨 (선택, 미설정 시 자동 생성)
 *   - expiryDays      : 만료까지 일수 (선택, default 90)
 *   - minOrderUSD     : 최소 결제 금액 (선택, default 0)
 *
 * 멱등성 없음 — 같은 요청 두 번이면 두 개 발행. 어드민 책임.
 *
 * 감사 로그: admin_issued_coupons 컬렉션에 발행 이력 기록.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyAdminToken } from './_shared/admin-auth.js';
import { captureError } from './_shared/sentry.js';

export const maxDuration = 15;
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

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }

  const { targetUid, targetEmail, type, value, currency, label, expiryDays, minOrderUSD } = body;

  if ((!targetUid && !targetEmail) || !type || value === undefined || value === null) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'targetUid 또는 targetEmail, type, value 필수' }));
  }
  if (!['percent', 'fixed'].includes(type)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'type은 percent 또는 fixed' }));
  }
  if (typeof value !== 'number' || value <= 0) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'value는 양의 숫자' }));
  }
  if (type === 'fixed' && !['USD', 'KRW'].includes(currency)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'fixed type은 currency 필수 (USD/KRW)' }));
  }

  try {
    const db = initAdminDb('admin-issue-coupon');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    // targetUid 우선, 없으면 targetEmail 로 users 컬렉션 검색.
    let resolvedUid = targetUid;
    if (!resolvedUid) {
      const emailLower = String(targetEmail).toLowerCase().trim();
      const emailSnap = await db.collection('users').where('email', '==', emailLower).limit(1).get();
      if (emailSnap.empty) {
        res.writeHead(404, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: `이메일로 사용자를 찾지 못함: ${targetEmail}` }));
      }
      resolvedUid = emailSnap.docs[0].id;
    }

    const userSnap = await db.collection('users').doc(resolvedUid).get();
    if (!userSnap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: `User not found: ${resolvedUid}` }));
    }

    const resolvedEmail = userSnap.data().email || '(no email)';

    // 자동 라벨: type 별 기본 형식
    const autoLabel = type === 'percent'
      ? `Admin Issued — ${value}% OFF`
      : `Admin Issued — ${currency === 'KRW' ? '₩' : '$'}${value}`;
    const finalLabel = (label && typeof label === 'string' && label.trim().length > 0) ? label.trim() : autoLabel;

    const days = Number(expiryDays) > 0 ? Number(expiryDays) : 90;
    const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
    const code = `ADMIN-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const couponData = {
      code,
      type,
      value,
      currency: type === 'percent' ? 'USD' : currency,  // percent 도 명목상 USD 키 유지 (UI 분기에 사용 안 함)
      label: finalLabel,
      minOrderUSD: typeof minOrderUSD === 'number' && minOrderUSD >= 0 ? minOrderUSD : 0,
      isUsed: false,
      expiresAt,
      createdAt: Date.now(),
      issuedBy: auth.email,
      issueSource: 'admin-issue-coupon',
    };

    const couponRef = await db.collection('users').doc(resolvedUid).collection('coupons').add(couponData);

    // 감사 로그 (비치명적)
    db.collection('admin_issued_coupons').add({
      adminEmail: auth.email,
      adminUid: auth.uid,
      targetUid: resolvedUid,
      targetEmail: resolvedEmail,
      couponId: couponRef.id,
      ...couponData,
    }).catch((e) => console.warn('[admin-issue-coupon] audit write failed:', e.message));

    console.log('[admin-issue-coupon] issued:', auth.email, '→', resolvedEmail, '|', type, value, '| coupon:', couponRef.id);

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: { couponId: couponRef.id, targetUid: resolvedUid, targetEmail: resolvedEmail, ...couponData },
    }));
  } catch (err) {
    console.error('[admin-issue-coupon] failed:', err.message);
    await captureError(err, { route: '/api/admin-issue-coupon', adminEmail: auth.email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}
