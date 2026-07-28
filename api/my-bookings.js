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
    let tier = 'Bronze'; // 🔴 #9: tier 는 query 신뢰 종료 — 아래에서 서버 조회(조작 차단).

    const db = getDb();
    // 🔴 #9 (버그헌트 2026-06-19): tier 쿼리파라미터 신뢰 → Bronze 가 ?tier=Platinum 으로 UI 환불%
    //   표시 조작 가능(cancelBooking 은 이미 서버조회 fix). 인증 uid 의 users/{uid}.tier 사용.
    try {
      if (auth.uid) {
        const uSnap = await db.collection('users').doc(auth.uid).get();
        if (uSnap.exists && uSnap.data() && uSnap.data().tier) tier = uSnap.data().tier;
      }
    } catch { /* tier 조회 실패 → Bronze(보수적) */ }
    // 🔴 #13 (버그헌트 2026-06-19): 게스트 차터 결제(#972)는 userEmail='' + payerEmail=실이메일 저장
    //   → userEmail 쿼리만으론 게스트가 같은 이메일로 가입해도 조회 단절. payerEmail 폴백(단일필드
    //   인덱스, orderBy 없이) + dedup. 정상 userEmail 결과는 정렬 유지, 게스트분만 뒤에 추가.
    const [snapByEmail, snapByPayer] = await Promise.all([
      db.collection('bookings').where('userEmail', '==', userEmail).orderBy('createdAt', 'desc').limit(50).get(),
      db.collection('bookings').where('payerEmail', '==', userEmail).limit(50).get(),
    ]);
    const _seenIds = new Set(snapByEmail.docs.map(d => d.id));
    const snap = { docs: [...snapByEmail.docs, ...snapByPayer.docs.filter(d => !_seenIds.has(d.id))] };

    // 🔴 2026-07-28: AI 플래너 예약의 "플랜 보기"가 목록(/my-plans)으로만 갔다.
    //   해당 플랜으로 바로 가려면 planId 가 필요한데, 그 값은 발급 시점에
    //   plan_issued_orders/{payPalOrderId} 에 기록된다(bookings doc id == orderId).
    //   AI 플래너 행에 대해서만 조회한다(추가 읽기 최소화).
    const planIdByBookingId = new Map();
    try {
      const aiDocIds = snap.docs
        .filter(d => String((d.data() || {}).productType || '').startsWith('ai-planner'))
        .map(d => d.id);
      if (aiDocIds.length) {
        const refs = aiDocIds.map(id => db.collection('plan_issued_orders').doc(id));
        const issued = await db.getAll(...refs);
        issued.forEach((snapDoc, i) => {
          const pid = snapDoc.exists ? (snapDoc.data() || {}).planId : null;
          if (pid) planIdByBookingId.set(aiDocIds[i], pid);
        });
      }
    } catch (e) {
      // 조회 실패해도 예약 목록은 떠야 한다 — 링크만 목록으로 폴백된다.
      console.warn('[my-bookings] planId lookup failed (non-fatal):', e && e.message);
    }

    const now = new Date();
    const bookings = snap.docs.map(doc => {
      const data = doc.data();
      const tourDate = data.tourDate || '';
      // PR #426 (Audit CY3 — 2026-05-14): pass tourTime so the refund-window
      // calculation isn't always anchored at 00:00 KST. Pre-fix a 6 PM tour
      // showed "refund window closed" 6+ hours earlier than the actual cutoff,
      // and a 09:00 tour got an extra free-cancel window. Bookings written
      // before this PR don't have tourTime — evaluateRefundPolicy falls back
      // to '00:00' for those (legacy behaviour preserved).
      const tourTime = data.tourTime || undefined;
      let policy = null;
      if (tourDate && data.status === 'CONFIRMED') {
        try { policy = evaluateRefundPolicy({ tourDate, tourTime, tier, now }); } catch { /* ignore */ }
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
        // AI 플래너 예약에서 해당 플랜 상세로 바로 가기 위한 값 (없으면 목록으로 폴백).
        planId: planIdByBookingId.get(doc.id) || null,
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
