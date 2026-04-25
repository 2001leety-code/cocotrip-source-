/**
 * Vercel API Route: Admin Sales Dashboard
 * GET /api/admin-sales?email=<admin-email>&days=30
 *
 * Firestore `bookings` 컬렉션을 SSOT로 KPI/일별/상품별/최근 집계.
 * 인증: ADMIN_EMAIL 환경변수와 query.email 일치. (admin-bookings.js와 동일 수준 — 별도 PR로 ID token 검증 강화 예정)
 *
 * Returns:
 *   {
 *     kpi: { today, week, month, ytd },           // { usd, count }
 *     daily: [{ date, usd, count }, ...],         // 최근 N일
 *     byProduct: { '픽업': {usd,count}, ... },
 *     recent: [{ bookingRef, tourDate, productType, paxCount, amountUSD, status, customerEmail, createdAt }, ...],
 *     exchangeRate: 1380,
 *     generatedAt: ISO,
 *   }
 */
import { Buffer } from 'buffer';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json' };

function json(res, status, body) {
  res.writeHead(status, JSON_CORS);
  return res.end(JSON.stringify(body));
}

async function getDb() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  if (!getApps().length) {
    const sa = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '', 'base64').toString('utf8'));
    initializeApp({ credential: cert(sa) });
  }
  return getFirestore();
}

function todayKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeekKST(date) {
  const d = new Date(date);
  const day = d.getUTCDay();  // 0=Sunday
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfMonthKST(date) {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfYearKST(date) {
  const d = new Date(date);
  d.setUTCMonth(0, 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function classifyProduct(productType = '') {
  const p = productType.toString();
  if (/픽업|pickup/i.test(p)) return '픽업';
  if (/셔틀|shuttle/i.test(p)) return '셔틀';
  if (/planner|ai/i.test(p)) return 'AI플래너';
  if (/tour-/i.test(p)) return '투어';
  return '전세';
}

function bookingDateMs(b) {
  // createdAt = Firestore Timestamp | Date string | epoch
  if (!b.createdAt) return null;
  if (typeof b.createdAt.toDate === 'function') return b.createdAt.toDate().getTime();
  if (typeof b.createdAt === 'string') return new Date(b.createdAt).getTime();
  if (b.createdAt._seconds) return b.createdAt._seconds * 1000;
  return null;
}

async function getExchangeRate() {
  try {
    const { getUsdToKrwRaw } = await import('./_exchange-rate.js');
    return await getUsdToKrwRaw();
  } catch {
    return 1380;
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'GET') {
    return json(res, 405, { error: 'Method Not Allowed' });
  }

  const email = (req.query?.email || '').toString().toLowerCase().trim();
  const adminEmail = (process.env.ADMIN_EMAIL || process.env.VITE_ADMIN_EMAIL || '').toLowerCase().trim();
  if (!adminEmail) {
    return json(res, 500, { error: 'ADMIN_EMAIL not configured' });
  }
  if (email !== adminEmail) {
    return json(res, 403, { error: 'Forbidden' });
  }

  const days = Math.min(Math.max(parseInt(req.query?.days || '30', 10), 7), 90);

  try {
    const db = await getDb();

    // 충분한 윈도우로 한 번에 가져온 뒤 메모리에서 집계 (booking 수 적어 안전, <10k)
    const sinceCutoff = new Date(todayKST());
    sinceCutoff.setUTCDate(sinceCutoff.getUTCDate() - 365);  // 1년치
    const snap = await db.collection('bookings').get();

    const all = [];
    snap.forEach((doc) => {
      const b = doc.data();
      all.push({ id: doc.id, ...b, _createdAtMs: bookingDateMs(b) });
    });

    const now = todayKST();
    const todayStart = new Date(now); todayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = startOfWeekKST(now);
    const monthStart = startOfMonthKST(now);
    const yearStart = startOfYearKST(now);

    const inWindow = (b, fromTs) => {
      if (!b._createdAtMs) return false;
      return b._createdAtMs >= fromTs;
    };

    const sumBucket = (rows) => {
      let usd = 0, count = 0;
      for (const b of rows) {
        if (b.status === 'CANCELED') continue;  // 취소 제외
        const a = parseFloat(b.amountUSD || '0') || 0;
        usd += a;
        count++;
      }
      return { usd: Math.round(usd * 100) / 100, count };
    };

    const kpi = {
      today: sumBucket(all.filter((b) => inWindow(b, todayStart.getTime()))),
      week:  sumBucket(all.filter((b) => inWindow(b, weekStart.getTime()))),
      month: sumBucket(all.filter((b) => inWindow(b, monthStart.getTime()))),
      ytd:   sumBucket(all.filter((b) => inWindow(b, yearStart.getTime()))),
    };

    // 일별 (최근 N일)
    const dailyMap = new Map();
    for (let i = 0; i < days; i++) {
      const d = new Date(now); d.setUTCDate(d.getUTCDate() - i); d.setUTCHours(0, 0, 0, 0);
      dailyMap.set(isoDay(d), { date: isoDay(d), usd: 0, count: 0 });
    }
    for (const b of all) {
      if (b.status === 'CANCELED') continue;
      if (!b._createdAtMs) continue;
      const d = new Date(b._createdAtMs); d.setUTCHours(0, 0, 0, 0);
      const key = isoDay(d);
      const entry = dailyMap.get(key);
      if (entry) {
        entry.usd += parseFloat(b.amountUSD || '0') || 0;
        entry.count++;
      }
    }
    const daily = Array.from(dailyMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => ({ ...e, usd: Math.round(e.usd * 100) / 100 }));

    // 상품별 (이번달 기준)
    const byProductMap = {};
    for (const b of all) {
      if (b.status === 'CANCELED') continue;
      if (!inWindow(b, monthStart.getTime())) continue;
      const cat = classifyProduct(b.productType);
      if (!byProductMap[cat]) byProductMap[cat] = { usd: 0, count: 0 };
      byProductMap[cat].usd += parseFloat(b.amountUSD || '0') || 0;
      byProductMap[cat].count++;
    }
    for (const k of Object.keys(byProductMap)) {
      byProductMap[k].usd = Math.round(byProductMap[k].usd * 100) / 100;
    }

    // 최근 20건
    const recent = all
      .filter((b) => b._createdAtMs)
      .sort((a, b) => b._createdAtMs - a._createdAtMs)
      .slice(0, 20)
      .map((b) => ({
        bookingRef: b.bookingRef || b.id,
        tourDate: b.tourDate || '',
        productType: b.productType || '',
        paxCount: b.paxCount || 0,
        amountUSD: parseFloat(b.amountUSD || '0') || 0,
        status: b.status || 'UNKNOWN',
        customerEmail: b.userEmail || b.payerEmail || '',
        createdAt: b._createdAtMs ? new Date(b._createdAtMs).toISOString() : null,
      }));

    const exchangeRate = await getExchangeRate();

    return json(res, 200, {
      kpi,
      daily,
      byProduct: byProductMap,
      recent,
      exchangeRate,
      totalBookings: all.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin-sales] Error:', err);
    return json(res, 500, { error: err.message });
  }
}
