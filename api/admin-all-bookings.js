/**
 * GET /api/admin-all-bookings — 통합 예약 뷰 (무드 + 코코트립 한 곳에)
 *
 * 운영자 어드민에서 두 사업의 예약을 한 리스트로 보기 위한 집계 엔드포인트.
 *   - 코코트립: `pending_bookings` 컬렉션 (PayPal 결제 흐름 — AdminPayments 가 보는 그것).
 *   - 무드:     `mood_bookings` 컬렉션 (B2B 선불 매니저/차량 예약).
 *
 * 각 항목을 공통 스키마로 정규화 후 출처 라벨을 붙여 합치고 최신순 정렬:
 *   { source:'cocotrip'|'mood', label, date, amountKRW, status, detail, createdAtMs, id }
 *
 * 인증: Authorization: Bearer <Firebase ID token> + verifyAdminToken (ADMIN_EMAIL / admin claim).
 *   - mood_bookings 는 firestore.rules 가 client read:false → 반드시 백엔드 admin SDK 로만 읽음.
 *
 * Query: ?limit=N (각 출처별 최대 N건, 기본 100, 상한 300).
 *
 * 읽기 전용 — 어떤 write 도 하지 않음.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, OPTIONS';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

function json(req, res, status, body) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS }) });
  return res.end(JSON.stringify(body));
}

// Firestore Timestamp | epoch number | seconds-obj | Date | ISO string → epoch ms (0 if none)
function toMillis(v) {
  if (!v) return 0;
  try {
    if (typeof v === 'number') return v;                       // mood: Date.now()
    if (typeof v.toMillis === 'function') return v.toMillis(); // Firestore Timestamp
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (typeof v._seconds === 'number') return v._seconds * 1000;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
  } catch {
    return 0;
  }
  return 0;
}

// YYYY-MM-DD (KST) 로 표시용 날짜 — date 필드 우선, 없으면 createdAt 에서 유도.
function ymdKst(ms) {
  if (!ms) return '';
  // KST = UTC+9. 운영자 한국 기준 날짜.
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ── 코코트립 (pending_bookings) → 공통 스키마 ──────────────────────────
// AdminPayments 와 동일 컬렉션. 상품명·금액·고객 정보 보유.
function normalizeCocotrip(id, b) {
  const productType = String(b.productType || '예약');
  const priceKRW = Number(b.priceKRW) || 0;
  const createdAtMs = toMillis(b.createdAt);
  const dateStart = b.dateStart || '';
  const detailParts = [];
  if (b.customerEmail) detailParts.push(String(b.customerEmail));
  if (Number(b.passengers) > 0) detailParts.push(`${b.passengers}인`);
  if (b.pickupLocation) detailParts.push(String(b.pickupLocation));

  return {
    source: 'cocotrip',
    id,
    bookingRef: b.bookingRef || id,
    // "코코트립 — 서울시티투어" 식 라벨 (출처 prefix 는 프론트가 뱃지로 표시).
    label: productType,
    date: dateStart || ymdKst(createdAtMs),
    amountKRW: priceKRW,
    priceUSD: b.priceUSD || null,
    status: String(b.status || ''),
    detail: detailParts.join(' · '),
    createdAtMs,
    // 어드민 테스트(결제 우회) 표식 — 프론트 필터용.
    isTest: b.paymentMethod === 'admin-bypass'
      || String(b.paypalTransactionId || '').startsWith('ADMIN-BYPASS-')
      || String(id || '').startsWith('ADMIN-BYPASS-'),
  };
}

// ── 무드 (mood_bookings) → 공통 스키마 ────────────────────────────────
// mood-book.js 가 기록: { clientId, date, startTime, durationHours, serviceType, amountKRW, status, createdByEmail, createdAt(=Date.now()) }
function normalizeMood(id, b, clientNameById) {
  const serviceLabel = b.serviceType === 'vehicle' ? '차량' : b.serviceType === 'manager' ? '매니저' : String(b.serviceType || '서비스');
  const hours = Number(b.durationHours) || 0;
  // 완료(정산 확정)된 예약은 최종금액(finalAmountKRW) 이 진짜 청구액 — booked amountKRW 는
  // 예약 시 선결제 예상액이라 정산 후 그대로 쓰면 실제 청구와 다른 금액을 보여준다.
  const amountKRW = b.status === 'completed' && Number.isSafeInteger(b.finalAmountKRW) && b.finalAmountKRW >= 0
    ? b.finalAmountKRW
    : (Number.isSafeInteger(b.amountKRW) && b.amountKRW >= 0 ? b.amountKRW : 0);
  const createdAtMs = toMillis(b.createdAt);
  const clientName = clientNameById[b.clientId] || b.clientId || '';
  const detailParts = [];
  if (clientName) detailParts.push(clientName);
  if (b.startTime) detailParts.push(String(b.startTime));
  if (b.createdByEmail) detailParts.push(String(b.createdByEmail));

  return {
    source: 'mood',
    id,
    bookingRef: id,
    // "무드 — 매니저 3시간" 식 라벨.
    label: hours > 0 ? `${serviceLabel} ${hours}시간` : serviceLabel,
    date: b.date || ymdKst(createdAtMs),
    amountKRW,
    priceUSD: null,
    status: String(b.status || ''),
    detail: detailParts.join(' · '),
    createdAtMs,
    isTest: false,
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS })); return res.end(); }
  if (req.method !== 'GET') {
    return json(req, res, 405, { ok: false, error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    return json(req, res, auth.status, { ok: false, error: auth.error, code: 'AUTH_FAILED' });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const db = initAdminDb('admin-all-bookings');
    if (!db) {
      return json(req, res, 500, { ok: false, error: 'Firestore unavailable — check FIREBASE_* env vars', code: 'DB_UNAVAILABLE' });
    }

    // 두 컬렉션 병렬 읽기. 각각 createdAt desc 단일 필드 정렬 (자동 인덱스로 충분, composite 불필요).
    // 한쪽이 실패해도 다른 쪽은 살리기 위해 allSettled.
    const [cocoRes, moodRes] = await Promise.allSettled([
      db.collection('pending_bookings').orderBy('createdAt', 'desc').limit(limit).get(),
      db.collection('mood_bookings').orderBy('createdAt', 'desc').limit(limit).get(),
    ]);

    const items = [];
    const errors = {};

    if (cocoRes.status === 'fulfilled') {
      cocoRes.value.forEach((doc) => items.push(normalizeCocotrip(doc.id, doc.data() || {})));
    } else {
      errors.cocotrip = cocoRes.reason?.message || 'failed';
      console.error('[admin-all-bookings] cocotrip read failed:', errors.cocotrip);
    }

    if (moodRes.status === 'fulfilled') {
      const moodDocs = moodRes.value.docs;
      // mood client 이름 매핑 (예약 detail 에 회사명 표시). 중복 clientId 는 한 번만 조회.
      const clientNameById = {};
      const uniqueClientIds = [...new Set(moodDocs.map((d) => (d.data() || {}).clientId).filter(Boolean))];
      if (uniqueClientIds.length > 0) {
        const clientSnaps = await Promise.allSettled(
          uniqueClientIds.map((cid) => db.collection('mood_clients').doc(cid).get()),
        );
        clientSnaps.forEach((s, i) => {
          if (s.status === 'fulfilled' && s.value.exists) {
            clientNameById[uniqueClientIds[i]] = (s.value.data() || {}).name || uniqueClientIds[i];
          }
        });
      }
      moodDocs.forEach((doc) => items.push(normalizeMood(doc.id, doc.data() || {}, clientNameById)));
    } else {
      errors.mood = moodRes.reason?.message || 'failed';
      console.error('[admin-all-bookings] mood read failed:', errors.mood);
    }

    // 최신순 통합 정렬.
    items.sort((a, b) => b.createdAtMs - a.createdAtMs);

    return json(req, res, 200, {
      ok: true,
      data: {
        items,
        total: items.length,
        counts: {
          cocotrip: items.filter((x) => x.source === 'cocotrip').length,
          mood: items.filter((x) => x.source === 'mood').length,
        },
        ...(Object.keys(errors).length ? { partialErrors: errors } : {}),
      },
    });
  } catch (error) {
    console.error('[admin-all-bookings] Error:', error.message);
    await captureError(error, { route: '/api/admin-all-bookings', method: req.method });
    return json(req, res, 500, { ok: false, error: 'Failed to fetch bookings', code: 'FETCH_ERROR' });
  }
}
