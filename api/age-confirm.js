/**
 * POST /api/age-confirm — 회원이 "만 14세 이상입니다"를 확인한 사실을 users/{uid} 에 남긴다.
 *
 * 2026-11-21 처리방침: 만 14세 미만은 직접 가입하지 않는다(아이 정보는 보호자가 예약할 때 따로 동의).
 * 클라이언트 rules 는 users/{uid} 에 쓸 수 있는 칸을 묶어 두었으므로(firestore.rules) Admin SDK 로 쓴다.
 *
 * - 인증: Bearer ID token(uid 만 신뢰, body 무시). 이메일 없는 LINE·전화 회원도 받는다.
 * - users/{uid} 가 아직 없으면 409 — 가입 기본값(saveUserToFirestore create)보다 먼저 문서를 만들면
 *   그 회원이 "기존 회원"으로 잘못 잡히기 때문(쿠폰·등급 기본값이 빠진다). 클라이언트가 잠시 뒤 다시 보낸다.
 * - 멱등: 이미 확인했으면 첫 시각을 그대로 둔다.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyFirebaseIdentityToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';

export const maxDuration = 10;
export const config = { runtime: 'nodejs' };

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

function reply(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return reply(res, 405, { ok: false, error: 'POST only' });
  try {
    const auth = await verifyFirebaseIdentityToken(req);
    if (!auth.ok) return reply(res, auth.status, { ok: false, error: auth.error });

    const db = initAdminDb('age-confirm');
    if (!db) return reply(res, 500, { ok: false, error: 'Firestore unavailable' });

    const userRef = db.collection('users').doc(auth.uid);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return { status: 409, body: { ok: false, error: 'user-doc-missing' } };
      const existing = (snap.data() || {}).ageOver14ConfirmedAt;
      if (typeof existing === 'string' && existing) {
        return { status: 200, body: { ok: true, alreadyConfirmed: true, confirmedAt: existing } };
      }
      const confirmedAt = new Date().toISOString();
      tx.update(userRef, { ageOver14Confirmed: true, ageOver14ConfirmedAt: confirmedAt });
      return { status: 200, body: { ok: true, alreadyConfirmed: false, confirmedAt } };
    });
    return reply(res, result.status, result.body);
  } catch (err) {
    await captureError(err, { route: '/api/age-confirm' });
    return reply(res, 500, { ok: false, error: 'age-confirm failed' });
  }
}
