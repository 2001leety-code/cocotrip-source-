/**
 * GET /api/admin-all-bookings — 통합 예약 뷰 (무드 + 코코트립 한 곳에)
 *
 * 운영자 어드민에서 두 사업의 예약을 한 리스트로 보기 위한 집계 엔드포인트.
 *   - 코코트립: `pending_bookings` 컬렉션 (PayPal 결제 흐름 — AdminPayments 가 보는 그것).
 *   - 무드:     `mood_bookings` 컬렉션 (B2B 선불 매니저/차량 예약).
 *
 *   - PayPal:   `bookings` 컬렉션 (2026-10-23 — PayPal 직접 결제 예약. kind:'paypal', 관리자 전액 환불 대상).
 *               같은 예약의 pending_bookings 문서가 있으면(동일 id 또는 paypalTransactionId) pending 행이
 *               대표하고 PayPal 행은 빠진다(2줄 방지). 그 pending 은 목록 limit 밖이어도 포함한다.
 *
 * 각 항목을 공통 스키마로 정규화 후 출처 라벨을 붙여 합치고 최신순 정렬:
 *   { source:'cocotrip'|'mood', kind:'pending'|'paypal'|'mood', label, date, amountKRW, status, detail, createdAtMs, id }
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
import { hasExplicitTestSignal, isAutoRefundBlocked } from './_shared/booking-test-flags.js';

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
    kind: 'pending',
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
    kind: 'mood',
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

// ── PayPal (bookings) → 공통 스키마 (2026-10-23) ──────────────────────────
// isTest = 명시적 테스트 신호만. paymentVerified 미검증은 환불 가능 여부(refundable)에만 반영한다 —
//   정상 수동·웹훅 확정 예약은 paymentVerified 없이 생성된다(booking-confirm.js).
function normalizePaypalBooking(id, b) {
  const createdAtMs = toMillis(b.createdAt);
  const pax = Number(b.paxCount || b.passengers) > 0 ? `${b.paxCount || b.passengers}인` : '';
  const hasRefundHistory = Boolean(b.refundID) || Boolean(b.lastRefundId) || Object.keys(b.refundEvents || {}).length > 0;
  return {
    source: 'cocotrip',
    kind: 'paypal',
    id,
    bookingRef: id,
    label: String(b.productName || b.productType || 'PayPal 예약'),
    date: b.tourDate || ymdKst(createdAtMs),
    amountKRW: Number(b.amountKRW) || 0,
    priceUSD: b.amountUSD ? Number(b.amountUSD) : null,
    status: String(b.status || ''),
    detail: [b.payerName, b.userEmail || b.payerEmail, pax].filter(Boolean).join(' · '),
    createdAtMs,
    isTest: hasExplicitTestSignal(id, b),
    captureID: b.captureID || null,
    parentOrderID: b.parentOrderID || null,
    linkedPendingRef: null,
    refundable: b.status === 'CONFIRMED'
      && Boolean(b.captureID)
      && !b.parentOrderID
      && b.provider !== 'braintree'
      && !isAutoRefundBlocked(id, b)
      && !hasRefundHistory,
  };
}

const IN_QUERY_CHUNK = 30;

/**
 * PayPal 행 ↔ pending_bookings 연결 — 목록 limit 와 **독립** 조회.
 *   (a) 같은 id 의 pending_bookings/{id}  (b) pending_bookings.paypalTransactionId in [ids]
 * @returns {Promise<{ ok: boolean, links: Map<string, { pendingId: string, data: object }>, error?: string }>}
 */
async function findLinkedPending(db, paypalIds) {
  const links = new Map();
  if (paypalIds.length === 0) return { ok: true, links };
  const chunks = [];
  for (let i = 0; i < paypalIds.length; i += IN_QUERY_CHUNK) chunks.push(paypalIds.slice(i, i + IN_QUERY_CHUNK));
  const settled = await Promise.allSettled([
    db.getAll(...paypalIds.map((pid) => db.collection('pending_bookings').doc(pid))),
    ...chunks.map((chunk) => db.collection('pending_bookings').where('paypalTransactionId', 'in', chunk).get()),
  ]);
  const failed = settled.find((s) => s.status === 'rejected');
  if (failed) return { ok: false, links, error: failed.reason?.message || 'failed' };
  const [sameIdRes, ...txResults] = settled;
  (sameIdRes.value || []).forEach((snap, i) => {
    if (snap && snap.exists) links.set(paypalIds[i], { pendingId: snap.id || paypalIds[i], data: snap.data() || {} });
  });
  txResults.forEach((r) => {
    r.value.forEach((doc) => {
      const data = doc.data() || {};
      const pid = String(data.paypalTransactionId || '');
      if (pid && !links.has(pid)) links.set(pid, { pendingId: doc.id, data });
    });
  });
  return { ok: true, links };
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

    // 세 컬렉션 병렬 읽기. 각각 createdAt desc 단일 필드 정렬 (자동 인덱스로 충분, composite 불필요).
    // 한쪽이 실패해도 다른 쪽은 살리기 위해 allSettled.
    const [cocoRes, moodRes, paypalRes] = await Promise.allSettled([
      db.collection('pending_bookings').orderBy('createdAt', 'desc').limit(limit).get(),
      db.collection('mood_bookings').orderBy('createdAt', 'desc').limit(limit).get(),
      db.collection('bookings').orderBy('createdAt', 'desc').limit(limit).get(),
    ]);

    const items = [];
    const errors = {};

    if (cocoRes.status === 'fulfilled') {
      cocoRes.value.forEach((doc) => items.push(normalizeCocotrip(doc.id, doc.data() || {})));
    } else {
      errors.cocotrip = cocoRes.reason?.message || 'failed';
      console.error('[admin-all-bookings] cocotrip read failed:', errors.cocotrip);
    }

    // PayPal 예약 — 연결된 pending 이 있으면 pending 이 대표 행(목록 limit 밖이어도 포함), PayPal 행은 제외.
    if (paypalRes.status === 'fulfilled') {
      const paypalDocs = paypalRes.value.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
      const linkResult = await findLinkedPending(db, paypalDocs.map((d) => d.id));
      if (!linkResult.ok) {
        // 연결 여부를 모르면 PayPal 자동환불을 전부 막는다(2줄·이중 흐름 위험).
        errors.pendingLink = linkResult.error;
        console.error('[admin-all-bookings] pending link lookup failed:', errors.pendingLink);
      }
      const pendingIndexById = new Map();
      items.forEach((item, idx) => { if (item.kind === 'pending') pendingIndexById.set(item.id, idx); });
      for (const { id, data } of paypalDocs) {
        const link = linkResult.links.get(id);
        if (link) {
          // 명시적 테스트 신호만 OR — paymentVerified 미전파(정상 연결 예약이 기본 목록에 남아야 한다).
          const paypalTest = hasExplicitTestSignal(id, data);
          const existing = pendingIndexById.get(link.pendingId);
          if (existing !== undefined) {
            items[existing] = { ...items[existing], isTest: items[existing].isTest || paypalTest };
          } else {
            const row = normalizeCocotrip(link.pendingId, link.data);
            pendingIndexById.set(link.pendingId, items.length);
            items.push({ ...row, isTest: row.isTest || paypalTest });
          }
          continue;
        }
        const row = normalizePaypalBooking(id, data);
        items.push(linkResult.ok ? row : { ...row, refundable: false, linkLookupFailed: true });
      }
    } else {
      errors.paypal = paypalRes.reason?.message || 'failed';
      console.error('[admin-all-bookings] paypal bookings read failed:', errors.paypal);
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
          paypal: items.filter((x) => x.kind === 'paypal').length,
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
