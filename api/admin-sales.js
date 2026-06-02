/**
 * Vercel API Route: Admin Sales Dashboard
 * GET /api/admin-sales?days=30
 * Headers: Authorization: Bearer <Firebase-ID-token>
 *
 * Firestore `bookings` 컬렉션을 SSOT로 KPI/일별/상품별/최근 집계.
 * 인증: Firebase ID token (verifyIdToken) + ADMIN_EMAIL 검증.
 *
 * Returns:
 *   {
 *     kpi: { today, week, month, ytd },           // { usd, count }
 *     daily: [{ date, usd, count }, ...],         // 최근 N일
 *     byProduct: { '픽업': {usd,count}, ... },
 *     recent: [{ bookingRef, tourDate, productType, paxCount, amountUSD, status, customerEmail, createdAt }, ...],
 *     exchangeRate: 1452,                          // 실시간 (_exchange-rate.js, floor 1450 정책)
 *     generatedAt: ISO,
 *   }
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { aggregateAdminSales } from './_shared/adminSalesAggregate.js';
import { getUsdToKrwRaw } from './_exchange-rate.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

// PR #437 (W-H11): origin allowlist via buildAdminCors — was wildcard '*'.
const CORS_METHODS = 'GET, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

function getDb() {
  const db = initAdminDb('admin-sales');
  if (!db) throw new Error('Firestore unavailable — check FIREBASE_* env vars');
  return db;
}

function todayKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function bookingDateMs(b) {
  // createdAt = Firestore Timestamp | Date string | epoch
  if (!b.createdAt) return null;
  if (typeof b.createdAt.toDate === 'function') return b.createdAt.toDate().getTime();
  if (typeof b.createdAt === 'string') return new Date(b.createdAt).getTime();
  if (b.createdAt._seconds) return b.createdAt._seconds * 1000;
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET') {
    return json(req, res, 405, { error: 'Method Not Allowed' });
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    return json(req, res, auth.status, { error: auth.error, code: 'AUTH_FAILED' });
  }

  const days = Math.min(Math.max(parseInt(req.query?.days || '30', 10), 7), 90);

  try {
    const db = getDb();
    const { Timestamp } = await import('firebase-admin/firestore');

    // 1년치만 fetch — Firestore where 인덱스로 booking 수 무관하게 안전.
    // capturePaypalOrder.js가 createdAt: serverTimestamp() 저장하므로 Timestamp 타입.
    const sinceCutoff = new Date(todayKST());
    sinceCutoff.setUTCDate(sinceCutoff.getUTCDate() - 365);
    const snap = await db.collection('bookings')
      .where('createdAt', '>=', Timestamp.fromDate(sinceCutoff))
      .get();

    const rawAll = [];
    snap.forEach((doc) => {
      const b = doc.data();
      rawAll.push({ id: doc.id, ...b, _createdAtMs: bookingDateMs(b) });
    });

    // A1-7-1 (2026-05-24): 운영자 본인 테스트 결제 (TEST-/ADMIN-BYPASS- prefix) 제외 +
    // KPI / 일별 / 상품별 / 최근 집계는 순수 함수로 추출 (test/admin-financial-coverage,
    // byte-identical). 시계(now) 만 handler 가 주입 — 나머지 계산은 deterministic.
    // SSOT 제외 규칙: _shared/admin-bypass-detector.js.
    const aggregate = aggregateAdminSales(rawAll, { now: todayKST(), days });

    // 실시간 환율 (단일 SSOT: _exchange-rate.js — Firestore 6h 캐시 + 4-소스 폴백,
    // 운영자 floor 1450 정책). 결제(createPaypalOrder)·손익정산(ProfitSettlement)과 동일.
    // getUsdToKrwRaw 자체가 실패 시 FALLBACK_RATE(1450) 반환 — 이전 로컬 래퍼의 stale 1380 제거.
    const exchangeRate = await getUsdToKrwRaw();

    return json(req, res, 200, {
      kpi: aggregate.kpi,
      daily: aggregate.daily,
      byProduct: aggregate.byProduct,
      recent: aggregate.recent,
      exchangeRate,
      totalBookings: aggregate.totalBookings,
      // A1-7-1: 매출 집계에서 제외된 건수 메타 — 운영자가 "왜 KPI 가 줄었는지" 즉시 인지.
      excluded: aggregate.excluded,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin-sales] Error:', err);
    return json(req, res, 500, { error: err.message });
  }
}
