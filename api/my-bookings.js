/**
 * Vercel API Route: My Bookings (GET)
 * GET /api/my-bookings?tier=...
 * Headers: Authorization: Bearer <Firebase ID token>
 *
 * 로그인한 고객의 예약 목록을 Firestore `bookings` 컬렉션에서 조회.
 * 각 레코드에 취소/변경 가능 여부(canRefund, canModify, refundPercent) 계산 포함.
 *
 * Security (PR #418, Audit W-C1 — 2026-05-13): query `userEmail` 신뢰 종료 —
 * 누구나 남의 이메일로 query 해 PII (booking ref / 항공편 / 픽업주소) 조회
 * 가능했음. 이제 `Authorization: Bearer <ID-token>` 검증 후 `auth.email` 사용.
 */
import { evaluateRefundPolicy } from './_refund-policy.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';
import { verifyUserToken } from './_shared/user-auth.js';

export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

const _ok  = (data) => ({ ok: true, data });
const _err = (error, code = 'UNKNOWN_ERROR') => ({ ok: false, error, code });

function getDb() {
  const db = initAdminDb('my-bookings');
  if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');
  return db;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'GET') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify(_err('Method not allowed', 'METHOD_NOT_ALLOWED')));
  }

  try {
    // PR #418 (Audit W-C1): require Authorization: Bearer <ID-token>.
    // 이전엔 query.userEmail 신뢰 → IDOR (남의 이메일 query 가능).
    const auth = await verifyUserToken(req);
    if (!auth.ok) {
      res.writeHead(auth.status, JSON_CORS);
      return res.end(JSON.stringify(_err(auth.error, 'AUTH_REQUIRED')));
    }
    const userEmail = auth.email;

    const url = new URL(req.url, `https://${req.headers.host}`);
    const tier = url.searchParams.get('tier') || 'Bronze';

    const db = getDb();
    const snap = await db.collection('bookings')
      .where('userEmail', '==', userEmail)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const now = new Date();
    const bookings = snap.docs.map(doc => {
      const data = doc.data();
      const tourDate = data.tourDate || '';
      let policy = null;
      if (tourDate && data.status === 'CONFIRMED') {
        try { policy = evaluateRefundPolicy({ tourDate, tier, now }); } catch { /* ignore */ }
      }
      return {
        id: doc.id,
        bookingRef: data.bookingRef || doc.id,
        orderID: data.orderID,
        status: data.status || 'UNKNOWN',
        productType: data.productType,
        tourDate,
        pickupLocation: data.pickupLocation || '',
        dropoffLocation: data.dropoffLocation || '',
        paxCount: data.paxCount || 0,
        vehicleType: data.vehicleType || '',
        amountKRW: data.amountKRW || 0,
        amountUSD: data.amountUSD || '0',
        currency: data.currency || 'USD',
        createdAt: data.createdAt || null,
        canceledAt: data.canceledAt || null,
        refundedAmount: data.refundedAmount || 0,
        // 실시간 정책 평가
        canRefund: policy?.canRefund || false,
        canModify: policy?.canModify || false,
        refundPercent: policy?.refundPercent || 0,
        hoursUntilTour: policy?.hoursUntilTour ?? null,
        // 2026-05-03 P1 fix: 공항 픽업 정보 (T1/편명/수하물) — UI airportSummary에서
        // 사용. 이전엔 응답에 누락돼 항상 null 반환됐음.
        airport: data.airport || null,
        // 2026-05-03 P1 fix: AI 플래너 booking은 tourDate 없음 — UI에서 분기 표시용
        provider: data.provider || 'paypal',
      };
    });

    res.writeHead(200, JSON_CORS);
    return res.end(JSON.stringify(_ok({ bookings, total: bookings.length })));
  } catch (err) {
    console.error('[my-bookings] Error:', err);
    await captureError(err, { route: '/api/my-bookings', method: req.method });
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify(_err(err.message, 'INTERNAL_ERROR')));
  }
}
