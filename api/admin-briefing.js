/**
 * /api/admin-briefing — 어드민 웹 조종석의 "어제 회사 한 장" JSON.
 *
 * 2026-06-10: 자가운영 에이전시 배치 C. 텔레그램 모닝브리핑과 **같은 집계 함수**(morningBriefingAggregate)
 * 를 호출 → 웹·텔레그램 숫자 일치 보장. AI 0 = $0. verifyAdminToken 인증.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { getUsdToKrwRaw } from './_exchange-rate.js';
import {
  aggregateMorningBriefing, kstYesterdayWindow, kstWeekStartMs, kstMonthStartMs,
} from './_shared/morningBriefingAggregate.js';
import { fetchMarketingMetrics } from './_shared/morningBriefingMarketing.js';

export const config = { maxDuration: 30 };
const CORS_METHODS = 'GET,OPTIONS';
const FALLBACK_RATE = 1450;

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET') return json(req, res, 405, { error: 'Method Not Allowed' });

  const auth = await verifyAdminToken(req);
  if (!auth.ok) return json(req, res, auth.status, { error: auth.error, code: 'AUTH_FAILED' });

  try {
    const db = initAdminDb();
    if (!db) return json(req, res, 503, { error: 'Firestore not configured' });

    const { Timestamp } = await import('firebase-admin/firestore');
    const now = new Date();
    const { yStartMs, todayStartMs } = kstYesterdayWindow(now);
    const weekStartMs = kstWeekStartMs(now);
    const monthStartMs = kstMonthStartMs(now);
    const trendStartMs = Math.min(weekStartMs, monthStartMs);
    const sinceTrend = Timestamp.fromMillis(trendStartMs);
    const sinceY = Timestamp.fromMillis(yStartMs);
    const untilY = Timestamp.fromMillis(todayStartMs);

    const [bk, pl, us, er, cs] = await Promise.allSettled([
      db.collection('bookings').where('createdAt', '>=', sinceTrend).get(),
      db.collection('plans').where('createdAtMs', '>=', yStartMs).where('createdAtMs', '<', todayStartMs).get(),
      db.collection('users').where('createdAt', '>=', sinceY).where('createdAt', '<', untilY).get(),
      db.collection('error_log').where('createdAt', '>=', yStartMs).where('createdAt', '<', todayStartMs).get(), // number
      db.collection('cs_tickets').where('createdAt', '>=', sinceY).where('createdAt', '<', untilY).get(), // Timestamp(serverTimestamp) — number 쿼리시 0건 버그 fix 2026-06-15
    ]);
    const docs = (r) => (r.status === 'fulfilled' ? r.value.docs.map((d) => ({ id: d.id, ...d.data() })) : []);

    const agg = aggregateMorningBriefing({
      bookingDocs: docs(bk), planDocs: docs(pl), userDocs: docs(us), errorDocs: docs(er), cstDocs: docs(cs),
    }, { now });

    const marketing = await fetchMarketingMetrics(yStartMs, todayStartMs).catch(() => ({ skipped: true, reason: 'error' }));

    let rate = FALLBACK_RATE;
    try { const x = await getUsdToKrwRaw(); if (Number.isFinite(x) && x > 0) rate = x; } catch { /* fallback */ }

    return json(req, res, 200, { ...agg, marketing, exchangeRate: rate, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error('[admin-briefing]', e && e.message);
    return json(req, res, 500, { error: e && e.message });
  }
}
