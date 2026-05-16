/**
 * Vercel API Route: Admin Scan Suspect Bookings
 * GET  /api/admin-scan-suspect-bookings  (list only)
 * POST /api/admin-scan-suspect-bookings  (list + batch replay if dryRun=false)
 * Headers: Authorization: Bearer <Firebase-ID-token>
 *
 * 2026-05-04 ~ 2026-05-07: 알림 누락 booking 일괄 복구 도구. 원래 PR #221~PR #223
 * 사이 (Braintree 통합 시점) booking-processor 호출이 ReferenceError 로 죽어 Firestore
 * 에는 booking 이 저장됐지만 텔레그램·이메일·Sheets 알림이 빠진 booking 을 식별하기 위해
 * 도입. 2026-05-07 Braintree 제거 후에도 PayPal capture 직후 booking-processor 호출이
 * fire-and-forget 이라 동일 패턴 (네트워크 장애 등) 의 누락 가능성이 있어 유지.
 *
 * GET  → 후보 목록만 반환 (dryRun)
 * POST → 후보 목록 + Optional 일괄 replay (body.dryRun=false 일 때만 실 발송)
 *
 * Body (POST):
 *   {
 *     since?:  ISO 8601 (default: 2026-05-03T11:51:00Z = PR #221 머지 시점)
 *     until?:  ISO 8601 (default: now)
 *     provider?: 'paypal' | 'braintree' | null (default: null = 모든 provider)
 *     dryRun?: boolean (default: true) — true 면 list 만, false 면 booking-processor 재호출
 *     limit?:  number (default: 50, max 100)
 *   }
 *
 * 멱등성 주의: 같은 booking 을 두 번 replay 하면 텔레그램·이메일·Sheets 모두 중복.
 * dryRun=false 신중히 사용. 한 번 replay 한 booking 은 Firestore booking doc 의
 * `replayedAt` 필드로 표시 → 다음 호출 시 자동 skip.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { productDisplayLabel, isCustomEstimateProduct } from './_shared/pricing.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

// PR #437 (W-H11): origin allowlist via buildAdminCors — was wildcard '*'.
const CORS_METHODS = 'GET, POST, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR') => ({ ok: false, error: msg, code });

// PR #221 머지 시점 (UTC) — 이전 booking 은 다른 buggy state 일 수도 있어 별도 처리.
const DEFAULT_SINCE = '2026-05-03T11:51:00Z';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(req, res, 405, _err('Method Not Allowed', 'METHOD_NOT_ALLOWED'));
  }

  const tokenAuth = await verifyAdminToken(req);
  if (!tokenAuth.ok) {
    return json(req, res, tokenAuth.status, _err(tokenAuth.error, 'AUTH_FAILED'));
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // GET 은 항상 dryRun. POST 만 dryRun=false 가능.
  const dryRun = req.method === 'GET' ? true : (body.dryRun !== false);
  const since = new Date(body.since || DEFAULT_SINCE);
  const until = new Date(body.until || Date.now());
  // 2026-05-07: Braintree 제거 후 default = null (모든 provider 검색).
  // 호출자가 명시적으로 'paypal' / 'braintree' (legacy) 지정 가능.
  const provider = body.provider !== undefined ? body.provider : null;
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));

  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    return json(req, res, 400, _err('Invalid since/until ISO date', 'INVALID_DATE'));
  }

  try {
    const db = initAdminDb('admin-scan-suspect-bookings');
    if (!db) {
      return json(req, res, 500, _err('Firestore unavailable — check FIREBASE_* env vars', 'DB_UNAVAILABLE'));
    }

    // 후보 booking: createdAt in [since, until] + status=CONFIRMED + (provider 일치 시).
    // 이미 replay 된 건 (replayedAt 존재) 제외.
    let query = db.collection('bookings')
      .where('createdAt', '>=', since)
      .where('createdAt', '<=', until)
      .where('status', '==', 'CONFIRMED')
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (provider) {
      query = query.where('provider', '==', provider);
    }

    const snap = await query.get();
    const candidates = [];
    snap.forEach((doc) => {
      const d = doc.data();
      if (d.replayedAt) return;  // 이미 복구됨 — skip
      candidates.push({
        bookingId: doc.id,
        bookingRef: d.bookingRef || null,
        productType: d.productType || null,
        productLabel: productDisplayLabel(d.productType),
        amountKRW: d.amountKRW || null,
        amountUSD: d.amountUSD || null,
        userEmail: d.userEmail || null,
        tourDate: d.tourDate || null,
        provider: d.provider || null,
        captureID: d.captureID || null,
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() || null,
        requiresReconciliation: !!d.requiresReconciliation || isCustomEstimateProduct(d.productType),
      });
    });

    if (dryRun || candidates.length === 0) {
      return json(req, res, 200, _ok({
        mode: 'dryRun',
        scanned: snap.size,
        candidatesCount: candidates.length,
        candidates,
        rangeSince: since.toISOString(),
        rangeUntil: until.toISOString(),
        hint: candidates.length > 0
          ? 'Re-call with POST + body { "dryRun": false } to actually replay all candidates.'
          : 'No suspect bookings in range.',
      }));
    }

    // 실제 replay — booking-processor 를 sequence 로 호출 (Telegram rate limit 회피).
    const siteUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://cocotripkr.com';
    const results = [];
    for (const c of candidates) {
      const docRef = db.collection('bookings').doc(c.bookingId);
      const fresh = await docRef.get();
      if (!fresh.exists) { results.push({ bookingId: c.bookingId, ok: false, error: 'NOT_FOUND' }); continue; }
      const b = fresh.data();
      if (b.replayedAt) { results.push({ bookingId: c.bookingId, ok: false, error: 'ALREADY_REPLAYED' }); continue; }

      const payload = {
        orderID: b.captureID || c.bookingId,
        payerEmail: b.userEmail || '',
        payerName: b.payerName || (b.userEmail || '').split('@')[0],
        amount: String(b.amountUSD || '0'),
        product: productDisplayLabel(b.productType),
        tourDate: b.tourDate || '',
        pickupLocation: b.pickupLocation || '',
        dropoffLocation: b.dropoffLocation || '',
        paxCount: b.paxCount || 1,
        vehicleType: b.vehicleType || '',
        customerPhone: b.customerPhone || undefined,
        couponApplied: !!b.couponDocId,
        memo: b.memo || '',
        itineraryData: b.itineraryData || null,
        airport: b.airport || null,
        userEmail: b.userEmail || '',
        bookingRef: b.bookingRef || undefined,
        requiresReconciliation: !!b.requiresReconciliation || isCustomEstimateProduct(b.productType),
      };

      try {
        const procRes = await fetch(`${siteUrl}/api/booking-processor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const procJson = await procRes.json().catch(() => null);
        if (procRes.ok) {
          await docRef.update({ replayedAt: FieldValue.serverTimestamp(), replayedBy: tokenAuth.email || 'admin' });
        }
        results.push({
          bookingId: c.bookingId,
          ok: procRes.ok,
          status: procRes.status,
          steps: procJson?.data?.steps || null,
        });
      } catch (err) {
        results.push({ bookingId: c.bookingId, ok: false, error: err.message });
      }

      // Telegram bot rate limit (~30 msg/sec) + Sheets API 안정 — 1초 간격
      await new Promise((r) => setTimeout(r, 1000));
    }

    return json(req, res, 200, _ok({
      mode: 'replay',
      scanned: snap.size,
      candidatesCount: candidates.length,
      replayed: results.filter((r) => r.ok).length,
      failed:   results.filter((r) => !r.ok).length,
      results,
      rangeSince: since.toISOString(),
      rangeUntil: until.toISOString(),
    }));
  } catch (err) {
    console.error('[admin-scan-suspect-bookings]', err);
    await captureError(err, { route: '/api/admin-scan-suspect-bookings', method: req.method });
    return json(req, res, 500, _err(err.message, 'INTERNAL_ERROR'));
  }
}
