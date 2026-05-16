/**
 * Vercel API Route: Admin Bookings List
 * GET /api/admin-bookings
 * Headers: Authorization: Bearer <Firebase-ID-token>
 *
 * Firestore `bookings` 컬렉션에서 최근 예약 50건을 createdAt desc 로 읽어 JSON 으로 반환.
 * 인증: Firebase ID token (verifyIdToken) + ADMIN_EMAIL 검증.
 *
 * 2026-05-07: Google Sheets → Firestore 이관 (W3).
 *   - 기존 admin-bookings.js 는 'Bookings' 시트 A:Z 를 읽어 헤더 자동 추출했으나
 *     5/2 batch 의 "어드민 5탭 실데이터 100% Firestore" 정책과 모순되어 prod 에서
 *     "예약 목록 로딩에 실패했습니다" 배너를 띄우는 구조적 문제 발생.
 *   - admin-sales.js 와 동일한 Firestore 패턴 (initAdminDb + bookings 컬렉션) 으로 통일.
 *   - Admin.tsx fetchBookings() 응답 호환: { ok: true, data: { bookings, total } }
 *     bookings 는 한국어 키를 가진 평탄한 객체로, Admin.tsx 가 Object.keys 로 헤더를
 *     자동 추출하므로 키 이름이 그대로 컬럼 헤더가 된다.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';

// response.js 는 CommonJS — Vercel ESM 런타임 named import 불안정해서 inline 정의.
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

// PR #437 (W-H11): origin allowlist via buildAdminCors — was wildcard '*'.
const CORS_METHODS = 'GET, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

// Firestore Timestamp | Date string | epoch | seconds-obj → ISO string ('' if none)
function toIsoString(v) {
  if (!v) return '';
  try {
    if (typeof v === 'string') return v;
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number') return new Date(v).toISOString();
  } catch {
    return '';
  }
  return '';
}

// 한국 운영자 보기 기준으로 핵심 필드만 평탄화.
// Admin.tsx 가 Object.keys(list[0]) 로 헤더 자동 추출 → 키 이름이 컬럼 헤더가 된다.
// 단, Admin.tsx 는 처음 8개 키만 표시하고 'memo|메모' 키만 추가로 끼워넣으므로
// 우선순위 높은 8개를 앞쪽에 배치.
function flattenBooking(id, b) {
  const tourDate = b.tourDate || '';
  const status = b.status || '';
  const product = b.productType || '';
  const email = b.userEmail || b.payerEmail || '';
  const pax = b.paxCount || 0;
  const amountUSD = parseFloat(b.amountUSD || '0') || 0;
  const phone = b.customerPhone || '';
  const vehicle = b.vehicleType || '';
  const memo = b.memo || '';
  const airportLabel = (() => {
    if (!b.airport) return '';
    if (typeof b.airport === 'string') return b.airport;
    // airport 가 객체면 주요 필드 펼침 (terminal/flightNo/arrivalTime 등)
    try {
      const parts = [];
      if (b.airport.terminal) parts.push(`T${b.airport.terminal}`);
      if (b.airport.flightNo) parts.push(b.airport.flightNo);
      if (b.airport.arrivalTime) parts.push(b.airport.arrivalTime);
      return parts.join(' ');
    } catch {
      return '';
    }
  })();

  return {
    id,
    bookingRef: b.bookingRef || id,
    status,
    productType: product,
    tourDate,
    paxCount: pax,
    amountUSD,
    email,
    phone,
    vehicle,
    pickupLocation: b.pickupLocation || '',
    dropoffLocation: b.dropoffLocation || '',
    paymentMethod: b.paymentMethod || '',
    couponApplied: b.couponApplied ? 'Y' : '',
    driverAssigned: b.driverAssigned ? 'Y' : '',
    createdAt: toIsoString(b.createdAt),
    memo: airportLabel ? `${memo} | ${airportLabel}`.trim().replace(/^\|\s*/, '') : memo,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET') {
    return json(req, res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) {
    return json(req, res, tokenAuth.status, { ok: false, error: tokenAuth.error, code: 'AUTH_FAILED' });
  }

  try {
    const db = initAdminDb('admin-bookings');
    if (!db) {
      return json(req, res, 500, _err('Firestore unavailable — check FIREBASE_* env vars', 'DB_UNAVAILABLE'));
    }

    // createdAt desc + limit 50 — 단일 필드 인덱스(자동 생성)로 충분.
    // composite index 불필요 (where 조건 없음).
    const snap = await db.collection('bookings')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    if (snap.empty) {
      return json(req, res, 200, _ok({ bookings: [], total: 0 }));
    }

    const bookings = [];
    snap.forEach((doc) => {
      bookings.push(flattenBooking(doc.id, doc.data()));
    });

    return json(req, res, 200, _ok({ bookings, total: bookings.length }));

  } catch (error) {
    console.error('[admin-bookings] Error:', error.message);
    await captureError(error, { route: '/api/admin-bookings', method: req.method });
    // createdAt 필드가 없는 legacy 문서 때문에 orderBy 가 빈 결과를 줄 수 있다 —
    // 단순 query 로 fallback (운영 안정성 우선).
    try {
      const db = initAdminDb('admin-bookings-fallback');
      if (!db) {
        return json(req, res, 500, _err('Failed to fetch bookings', 'FETCH_ERROR'));
      }
      const snap = await db.collection('bookings').limit(50).get();
      const bookings = [];
      snap.forEach((doc) => bookings.push(flattenBooking(doc.id, doc.data())));
      return json(req, res, 200, _ok({ bookings, total: bookings.length }));
    } catch {
      return json(req, res, 500, _err('Failed to fetch bookings', 'FETCH_ERROR'));
    }
  }
}
