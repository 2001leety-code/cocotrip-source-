/**
 * CocoTripKR — 운영자 일일 To-do 알림 (PR-G)
 *
 * 매일 KST 10:00 (1회) 실행.
 * vercel.json crons 에서 cron-runner 가 dispatch.
 *
 * 검출 항목 (각 컬렉션별):
 *   a) bookings.couponWarning 가 있는 booking — 쿠폰 race fix 후 자동 환불 못한 케이스 (수동 환불)
 *   b) cs_tickets.status='open' AND createdAt > 24h 경과 — 미답변 CS
 *   c) plan_complaints.status='open' AND createdAt > 24h — 미응답 신고
 *   d) users 가입 후 1h+ AND coupons 0건 AND onboardingCouponsIssued≠true — 가입 쿠폰 0건
 *   e) bookings status='CONFIRMED' AND createdAt > 24h AND voucher 미발송 — booking-processor
 *      처리 누락 (voucher/email 미발송). 1차 시그널: `voucherSentAt` 비어있음 (PR-L 도입).
 *      2차 fallback: 기존 booking (PR-L 이전) 은 `voucherSentAt` 미보유 → `bookingRef`
 *      누락을 backward-compat proxy 로 병행 검출. 둘 다 비면 미발송으로 분류.
 *   f) bookings status='CANCELED' OR 'REFUNDED' AND refundRequestedAt > 24h AND refundedAt 비어있음
 *      — 환불 요청 후 미처리. 현재 자동 환불이라 거의 0건이지만 manual-payment / 결제 누락
 *      케이스 cover.
 *
 * 모두 0건이면 메시지 발송 X (조용한 날).
 *
 * 컬렉션 미존재 시 graceful skip (CLAUDE.md 정신).
 *
 * 운영자 manual trigger:
 *   GET /api/cron-runner?job=operator-todo-reminder
 *   GET /api/cron-runner?job=operator-todo-reminder&dryRun=1
 */

import { initAdminDb } from '../_shared/firebase-admin.js';
import { verifyCronRequest } from '../_shared/cron-auth.js';
import { notifyOperatorLong } from '../_shared/operator-alerts.js';
import { captureError } from '../_shared/sentry.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function todayKSTLabel() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * Firestore Timestamp / Date / string 통합 변환 → ms epoch.
 */
function tsToMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return new Date(v).getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return 0;
}

// ── (a) 쿠폰 race warning — 수동 환불 대상 ──────────────────────────
async function fetchCouponWarnings(db) {
  try {
    const snap = await db.collection('bookings')
      .where('couponWarning', '!=', null)
      .limit(50)
      .get();
    const items = [];
    snap.forEach((doc) => {
      const b = doc.data();
      // 이미 환불 처리된 건은 스킵
      if (b.status === 'REFUNDED' || b.refundedAt) return;
      items.push({
        bookingRef: b.bookingRef || doc.id,
        userEmail: b.userEmail || b.payerEmail || '-',
        couponWarning: b.couponWarning || '-',
        amountUSD: b.amountUSD || '-',
      });
    });
    return { items };
  } catch (err) {
    console.warn('[operator-todo] couponWarning query failed:', err.message);
    return { items: [], error: err.message, skipped: true };
  }
}

// ── (b) 미답변 CS 티켓 (24h+) ──────────────────────────────────────
async function fetchOverdueCSTickets(db) {
  try {
    const cutoffMs = Date.now() - DAY_MS;
    const snap = await db.collection('cs_tickets')
      .where('status', '==', 'open')
      .limit(50)
      .get();
    const items = [];
    snap.forEach((doc) => {
      const t = doc.data();
      const createdMs = tsToMs(t.createdAt);
      if (createdMs && createdMs <= cutoffMs) {
        items.push({
          ticketId: doc.id.slice(0, 12),
          userEmail: t.userEmail || t.email || '-',
          subject: (t.subject || t.title || t.firstMessage || '').slice(0, 60),
          ageHours: Math.round((Date.now() - createdMs) / HOUR_MS),
        });
      }
    });
    return { items };
  } catch (err) {
    console.warn('[operator-todo] cs_tickets query failed:', err.message);
    return { items: [], error: err.message, skipped: true };
  }
}

// ── (c) 미응답 plan 신고 (24h+) ────────────────────────────────────
async function fetchOverdueComplaints(db) {
  try {
    const cutoffMs = Date.now() - DAY_MS;
    const snap = await db.collection('plan_complaints')
      .where('status', '==', 'open')
      .limit(50)
      .get();
    const items = [];
    snap.forEach((doc) => {
      const c = doc.data();
      const createdMs = tsToMs(c.createdAt);
      if (createdMs && createdMs <= cutoffMs) {
        items.push({
          complaintId: doc.id.slice(0, 12),
          planId: (c.planId || '').slice(0, 16),
          reason: c.reason || '-',
          ageHours: Math.round((Date.now() - createdMs) / HOUR_MS),
        });
      }
    });
    return { items };
  } catch (err) {
    console.warn('[operator-todo] plan_complaints query failed:', err.message);
    return { items: [], error: err.message, skipped: true };
  }
}

// ── (d) 가입 쿠폰 0건 신규 회원 ────────────────────────────────────
async function fetchUsersMissingOnboardingCoupons(db) {
  try {
    const cutoffMs = Date.now() - HOUR_MS; // 가입 후 1h+
    // 신규 회원 위주로 최근 200명만 스캔 — 가입 시점 ASC 정렬 시 인덱스 필요해서
    // 단순 fetch + 클라이언트 필터.
    const snap = await db.collection('users')
      .limit(200)
      .get();

    const items = [];
    for (const doc of snap.docs) {
      const u = doc.data();
      if (u.onboardingCouponsIssued === true) continue;
      const createdMs = tsToMs(u.createdAt || u.signupAt);
      if (!createdMs || createdMs > cutoffMs) continue; // 가입한 지 1h 미만이면 시간 더 줌

      // 7일 이상 된 회원은 더 이상 자동 알림 안 함 (큐 누적 방지) — 운영자 backlog
      // 정리는 manually 처리. 최근 7일 내 가입자만 알림 대상.
      const sevenDaysAgoMs = Date.now() - 7 * DAY_MS;
      if (createdMs < sevenDaysAgoMs) continue;

      // coupons 서브컬렉션 카운트
      try {
        const couponsSnap = await doc.ref.collection('coupons').limit(1).get();
        if (!couponsSnap.empty) continue; // 이미 쿠폰 있음
      } catch (subErr) {
        console.warn('[operator-todo] coupons subcollection check failed for', doc.id, subErr.message);
        continue;
      }

      items.push({
        uid: doc.id.slice(0, 12),
        email: u.email || '-',
      });
      if (items.length >= 20) break; // 메시지 길이 cap
    }
    return { items };
  } catch (err) {
    console.warn('[operator-todo] users query failed:', err.message);
    return { items: [], error: err.message, skipped: true };
  }
}

// ── (e) booking-processor 처리 누락 (24h+) ─────────────────────────
// PR-L: 1차 시그널은 `voucherSentAt` 빈 booking. PR-L 이전 booking 은 해당 필드
// 미존재 → `bookingRef` 누락 backward-compat proxy 병행. 둘 중 하나라도 채워져
// 있으면 정상 처리된 booking 으로 간주 (false positive 방지).
async function fetchUnprocessedBookings(db) {
  try {
    const cutoffMs = Date.now() - DAY_MS;
    const snap = await db.collection('bookings')
      .where('status', '==', 'CONFIRMED')
      .limit(100)
      .get();
    const items = [];
    snap.forEach((doc) => {
      const b = doc.data();
      const createdMs = tsToMs(b.createdAt);
      if (!createdMs || createdMs > cutoffMs) return;
      // 1차: voucherSentAt 가 채워져 있으면 정상 처리된 booking
      const hasVoucherSent = !!b.voucherSentAt;
      if (hasVoucherSent) return;
      // 2차 (backward-compat): PR-L 이전 booking 은 voucherSentAt 미존재.
      // bookingRef 가 채워져 있으면 booking-processor 가 돌았다고 간주.
      const hasBookingRef = !!(b.bookingRef && String(b.bookingRef).trim());
      if (hasBookingRef) return;
      items.push({
        orderID: doc.id.slice(0, 16),
        userEmail: b.userEmail || b.payerEmail || '-',
        amountUSD: b.amountUSD || '-',
        ageHours: Math.round((Date.now() - createdMs) / HOUR_MS),
        // 진단용 — 운영자가 voucherFailedAt 조회 시 원인 파악
        voucherError: b.voucherError ? String(b.voucherError).slice(0, 80) : null,
      });
    });
    return { items };
  } catch (err) {
    console.warn('[operator-todo] unprocessed bookings query failed:', err.message);
    return { items: [], error: err.message, skipped: true };
  }
}

// ── (f) 환불 요청 미처리 (24h+) ────────────────────────────────────
async function fetchUnprocessedRefunds(db) {
  try {
    // refundRequestedAt 필드는 manual-payment-request 등에서 향후 추가될 수 있음.
    // 현재는 cancelBooking.js 가 즉시 환불 처리하므로 거의 0건.
    // refundRequestedAt 이 있고 refundedAt 이 없으면 미처리로 분류.
    const cutoffMs = Date.now() - DAY_MS;
    const snap = await db.collection('bookings')
      .where('refundRequestedAt', '!=', null)
      .limit(50)
      .get();
    const items = [];
    snap.forEach((doc) => {
      const b = doc.data();
      if (b.refundedAt) return; // 처리됨
      const reqMs = tsToMs(b.refundRequestedAt);
      if (!reqMs || reqMs > cutoffMs) return;
      items.push({
        bookingRef: b.bookingRef || doc.id,
        userEmail: b.userEmail || b.payerEmail || '-',
        amountUSD: b.amountUSD || '-',
        ageHours: Math.round((Date.now() - reqMs) / HOUR_MS),
      });
    });
    return { items };
  } catch (err) {
    console.warn('[operator-todo] refund requests query failed:', err.message);
    return { items: [], error: err.message, skipped: true };
  }
}

// ── (g) 미답변 차터 문의 (24h+) ────────────────────────────────────
// charter_inquiries 는 cs_tickets 와 별도 컬렉션 (Bus/VIP 견적 상담폼, inquiry-submit.js).
// status 'NEW'|'pending' + createdAt 24h+ = 미답변. 차터는 고단가(₩33k~110k/h)라 방치 = 매출 손실.
// telegram /inquiries 명령은 status 만 보고 24h 게이트가 없어 매일 누적 — 여기서 24h+ 만 to-do 화.
async function fetchOverdueCharterInquiries(db) {
  try {
    const cutoffMs = Date.now() - DAY_MS;
    const snap = await db.collection('charter_inquiries')
      .where('status', 'in', ['NEW', 'pending'])
      .limit(50)
      .get();
    const items = [];
    snap.forEach((doc) => {
      const c = doc.data();
      const createdMs = tsToMs(c.createdAt);
      if (createdMs && createdMs <= cutoffMs) {
        items.push({
          inquiryId: String(c.inquiryId || doc.id).slice(0, 12),
          email: c.email || '-',
          vehicle: c.vehicle || '-',
          eventDate: c.eventDate || '-',
          ageHours: Math.round((Date.now() - createdMs) / HOUR_MS),
        });
      }
    });
    return { items };
  } catch (err) {
    console.warn('[operator-todo] charter_inquiries query failed:', err.message);
    return { items: [], error: err.message, skipped: true };
  }
}

// ── 메시지 빌드 ──────────────────────────────────────────────────────
function buildMessage({
  couponWarnings, csTickets, complaints, missingCoupons, unprocessedBookings, refundRequests,
  charterInquiries,
  collectionMissing,
}) {
  const totalCount =
    (couponWarnings?.length || 0) +
    (csTickets?.length || 0) +
    (complaints?.length || 0) +
    (missingCoupons?.length || 0) +
    (unprocessedBookings?.length || 0) +
    (refundRequests?.length || 0) +
    (charterInquiries?.length || 0);

  if (totalCount === 0 && (!collectionMissing || collectionMissing.length === 0)) {
    return null;
  }

  const lines = [`📋 운영자 To-do (${todayKSTLabel()})`, ''];

  if (collectionMissing && collectionMissing.length > 0) {
    lines.push(`⚠️ 수집 미작동 컬렉션: ${collectionMissing.join(', ')}`);
    lines.push('  → 인덱스/권한 점검 필요');
    lines.push('');
  }

  if (couponWarnings && couponWarnings.length > 0) {
    lines.push(`⚠️ 수동 환불 대상 (couponWarning): ${couponWarnings.length}건`);
    couponWarnings.slice(0, 10).forEach((w) => {
      lines.push(` - <code>${w.bookingRef}</code> ${w.userEmail} 사유: ${w.couponWarning}`);
    });
    if (couponWarnings.length > 10) lines.push(` ... 외 ${couponWarnings.length - 10}건`);
    lines.push('');
  }

  if (csTickets && csTickets.length > 0) {
    lines.push(`💬 미답변 CS 티켓 (24h+): ${csTickets.length}건`);
    csTickets.slice(0, 10).forEach((t) => {
      lines.push(` - <code>${t.ticketId}</code> ${t.userEmail} (${t.ageHours}h) ${t.subject || ''}`);
    });
    if (csTickets.length > 10) lines.push(` ... 외 ${csTickets.length - 10}건`);
    lines.push('');
  }

  if (complaints && complaints.length > 0) {
    lines.push(`🚩 미응답 plan 신고 (24h+): ${complaints.length}건`);
    complaints.slice(0, 10).forEach((c) => {
      lines.push(` - <code>${c.complaintId}</code> plan=${c.planId} 사유=${c.reason} (${c.ageHours}h)`);
    });
    if (complaints.length > 10) lines.push(` ... 외 ${complaints.length - 10}건`);
    lines.push('');
  }

  if (missingCoupons && missingCoupons.length > 0) {
    lines.push(`🎁 가입 쿠폰 0건 회원: ${missingCoupons.length}건`);
    missingCoupons.slice(0, 10).forEach((u) => {
      lines.push(` - ${u.email} (uid ${u.uid})`);
    });
    if (missingCoupons.length > 10) lines.push(` ... 외 ${missingCoupons.length - 10}건`);
    lines.push('  → /admin/claims 또는 admin-coupon-fix endpoint 보정');
    lines.push('');
  }

  if (unprocessedBookings && unprocessedBookings.length > 0) {
    lines.push(`📄 booking-processor 처리 누락 (24h+): ${unprocessedBookings.length}건`);
    unprocessedBookings.slice(0, 10).forEach((b) => {
      const errSuffix = b.voucherError ? ` err=${b.voucherError}` : '';
      lines.push(` - <code>${b.orderID}</code> ${b.userEmail} $${b.amountUSD} (${b.ageHours}h)${errSuffix}`);
    });
    if (unprocessedBookings.length > 10) lines.push(` ... 외 ${unprocessedBookings.length - 10}건`);
    lines.push('  → /api/admin-replay-booking-notifications 재실행 가능');
    lines.push('');
  }

  if (refundRequests && refundRequests.length > 0) {
    lines.push(`💰 환불 요청 미처리 (24h+): ${refundRequests.length}건`);
    refundRequests.slice(0, 10).forEach((r) => {
      lines.push(` - <code>${r.bookingRef}</code> ${r.userEmail} $${r.amountUSD} (${r.ageHours}h)`);
    });
    if (refundRequests.length > 10) lines.push(` ... 외 ${refundRequests.length - 10}건`);
    lines.push('');
  }

  if (charterInquiries && charterInquiries.length > 0) {
    lines.push(`🚐 미답변 차터 문의 (24h+): ${charterInquiries.length}건`);
    charterInquiries.slice(0, 10).forEach((c) => {
      lines.push(` - <code>${c.inquiryId}</code> ${c.email} ${c.vehicle}/${c.eventDate} (${c.ageHours}h)`);
    });
    if (charterInquiries.length > 10) lines.push(` ... 외 ${charterInquiries.length - 10}건`);
    lines.push('  → 텔레그램 /inquiries 또는 /admin 에서 응답');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ── 메인 ─────────────────────────────────────────────────────────────
const operatorTodoTask = async (dryRun = false) => {
  console.log('[operator-todo] 시작 (dryRun=' + dryRun + ')');

  const db = initAdminDb('cron/operator-todo-reminder');
  if (!db) {
    const msg = 'Firestore unavailable — FIREBASE_* env 확인';
    console.error('[operator-todo]', msg);
    return { statusCode: 503, body: { ok: false, error: msg } };
  }

  try {
    // 6 카테고리 병렬 fetch (Promise.allSettled — 일부 실패해도 진행)
    const results = await Promise.allSettled([
      fetchCouponWarnings(db),
      fetchOverdueCSTickets(db),
      fetchOverdueComplaints(db),
      fetchUsersMissingOnboardingCoupons(db),
      fetchUnprocessedBookings(db),
      fetchUnprocessedRefunds(db),
      fetchOverdueCharterInquiries(db),
    ]);

    const labels = ['couponWarnings', 'cs_tickets', 'plan_complaints', 'users', 'unprocessedBookings', 'refundRequests', 'charterInquiries'];
    const collectionMissing = [];
    const data = {};

    results.forEach((r, i) => {
      const label = labels[i];
      if (r.status === 'fulfilled') {
        data[label] = r.value.items || [];
        if (r.value.skipped) collectionMissing.push(label);
      } else {
        data[label] = [];
        collectionMissing.push(label);
        console.warn(`[operator-todo] ${label} fetch rejected:`, r.reason?.message);
      }
    });

    const msg = buildMessage({
      couponWarnings: data.couponWarnings,
      csTickets: data.cs_tickets,
      complaints: data.plan_complaints,
      missingCoupons: data.users,
      unprocessedBookings: data.unprocessedBookings,
      refundRequests: data.refundRequests,
      charterInquiries: data.charterInquiries,
      collectionMissing,
    });

    const totalCount =
      (data.couponWarnings?.length || 0) +
      (data.cs_tickets?.length || 0) +
      (data.plan_complaints?.length || 0) +
      (data.users?.length || 0) +
      (data.unprocessedBookings?.length || 0) +
      (data.refundRequests?.length || 0) +
      (data.charterInquiries?.length || 0);

    console.log(
      `[operator-todo] counts: couponWarnings=${data.couponWarnings?.length || 0} ` +
      `cs=${data.cs_tickets?.length || 0} complaints=${data.plan_complaints?.length || 0} ` +
      `missingCoupons=${data.users?.length || 0} unprocessed=${data.unprocessedBookings?.length || 0} ` +
      `refunds=${data.refundRequests?.length || 0} charter=${data.charterInquiries?.length || 0} missing=[${collectionMissing.join(',')}]`,
    );

    if (!msg) {
      console.log('[operator-todo] 모두 0건 — 알림 스킵 (조용한 날)');
      return { statusCode: 200, body: { ok: true, totalCount: 0, skipped: 'no_pending' } };
    }

    if (dryRun) {
      return {
        statusCode: 200,
        body: { ok: true, dryRun: true, totalCount, message: msg, counts: {
          couponWarnings: data.couponWarnings?.length || 0,
          cs_tickets: data.cs_tickets?.length || 0,
          plan_complaints: data.plan_complaints?.length || 0,
          users: data.users?.length || 0,
          unprocessedBookings: data.unprocessedBookings?.length || 0,
          refundRequests: data.refundRequests?.length || 0,
          charterInquiries: data.charterInquiries?.length || 0,
        }, collectionMissing },
      };
    }

    const result = await notifyOperatorLong('todo', msg);
    if (!result.ok) {
      console.error('[operator-todo] Telegram 발송 실패:', result.error);
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        totalCount,
        notified: result.ok,
        notifyError: result.ok ? null : result.error,
        collectionMissing,
      },
    };
  } catch (err) {
    console.error('[operator-todo] 오류:', err.message);
    try { await captureError(err, { route: 'cron/operator-todo-reminder' }); } catch {}
    return { statusCode: 500, body: { ok: false, error: err.message } };
  }
};

export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = await verifyCronRequest(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, code: 'AUTH_REQUIRED', error: auth.error });
  }

  try {
    const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';
    const r = await operatorTodoTask(dryRun);
    return res.status(r.statusCode || 200).json(r.body);
  } catch (e) {
    console.error('[operator-todo] handler error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
