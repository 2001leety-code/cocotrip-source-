/**
 * CocoTripKR — 배차 미입력 D-3 알림 (PR-G)
 *
 * 매일 KST 09:00 + 18:00 (2회) 실행.
 * vercel.json crons 에서 cron-runner 가 dispatch.
 *
 * 검출 로직:
 *   bookings where:
 *     status == 'CONFIRMED'
 *     tourDate ∈ [today_KST, today_KST + 3일]
 *     driver / driverChatId / acceptedAt 모두 비어있음 (아직 배차 미입력)
 *   → D-1 / D-2 / D-3 그룹별로 분류해서 텔레그램 단일 메시지로 발송
 *
 * 0건이면 메시지 안 보냄 (admin 인박스 노이즈 줄이기).
 *
 * 운영자 manual trigger:
 *   GET /api/cron-runner?job=dispatch-reminder
 *   GET /api/cron-runner?job=dispatch-reminder&dryRun=1   매칭만 리턴, 발송 안 함
 *
 * 컬렉션 미존재 시 graceful skip (CLAUDE.md 정신).
 */

import { initAdminDb } from '../_shared/firebase-admin.js';
import { notifyOperator, notifyOperatorLong } from '../_shared/operator-alerts.js';
import { captureError } from '../_shared/sentry.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

// ── KST 기준 날짜 유틸 ───────────────────────────────────────────────
function todayKSTISO() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
function addDaysISO(isoStr, days) {
  const d = new Date(isoStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function diffDaysISO(targetISO, baseISO) {
  const t = new Date(targetISO + 'T00:00:00Z').getTime();
  const b = new Date(baseISO + 'T00:00:00Z').getTime();
  return Math.round((t - b) / (24 * 60 * 60 * 1000));
}

/**
 * 배차 미입력 booking 검출.
 * driver / driverChatId / acceptedAt 모두 비어있으면 미배차로 간주.
 */
function isUnassigned(booking) {
  const hasDriver = !!(booking.driver && String(booking.driver).trim());
  const hasDriverChatId = !!booking.driverChatId;
  const hasAcceptedAt = !!booking.acceptedAt;
  // dispatchStatus 가 'accepted' 면 명시적 배차 완료 (상호 검증)
  const explicitlyAccepted = booking.dispatchStatus === 'accepted';
  return !(hasDriver || hasDriverChatId || hasAcceptedAt || explicitlyAccepted);
}

/**
 * Firestore 에서 D-0~D-3 미배차 booking fetch.
 */
async function fetchUnassignedBookings(db) {
  const today = todayKSTISO();
  const dPlus3 = addDaysISO(today, 3);

  let snap;
  try {
    snap = await db.collection('bookings')
      .where('status', '==', 'CONFIRMED')
      .where('tourDate', '>=', today)
      .where('tourDate', '<=', dPlus3)
      .get();
  } catch (err) {
    // 컬렉션 미존재 또는 인덱스 문제 — graceful skip
    console.warn('[dispatch-reminder] bookings query failed:', err.message);
    return { found: [], error: err.message };
  }

  const found = [];
  snap.forEach((doc) => {
    const b = doc.data();
    if (!isUnassigned(b)) return;
    const dDiff = diffDaysISO(b.tourDate, today); // 0=오늘, 1=내일, 3=D-3
    found.push({
      id: doc.id,
      bookingRef: b.bookingRef || doc.id,
      customerName: b.payerName || b.customerName || '-',
      productType: b.productType || b.product || '-',
      tourDate: b.tourDate,
      paxCount: b.paxCount || '-',
      pickupLocation: b.pickupLocation || '-',
      dDiff,
    });
  });

  return { found };
}

/**
 * 메시지 빌드 — D-1/D-2/D-3 그룹화. PR-G spec 메시지 포맷 따름.
 */
function buildMessage(found) {
  if (found.length === 0) return null;

  // D-0 (오늘 출발) 도 포함 — 출발일까지도 미배차면 매우 위급
  const groups = { 0: [], 1: [], 2: [], 3: [] };
  found.forEach((b) => {
    if (b.dDiff >= 0 && b.dDiff <= 3) groups[b.dDiff].push(b);
  });

  const lines = [`🚨 배차 미입력 ${found.length}건`, ''];
  const labels = {
    0: '🔴 D-0 (오늘 출발 — 매우 위급)',
    1: '🔴 D-1 (내일 출발)',
    2: '🟠 D-2',
    3: '🟡 D-3',
  };

  for (const day of [0, 1, 2, 3]) {
    if (groups[day].length === 0) continue;
    lines.push(`${labels[day]}: ${groups[day].length}건`);
    for (const b of groups[day]) {
      lines.push(` - <code>${b.bookingRef}</code> ${b.customerName} ${b.productType} (${b.paxCount}명)`);
    }
    lines.push('');
  }

  lines.push('/admin/calendar 에서 배차 입력하세요.');
  return lines.join('\n');
}

// ── 메인 ─────────────────────────────────────────────────────────────
const dispatchReminderTask = async (dryRun = false) => {
  console.log('[dispatch-reminder] 시작 (dryRun=' + dryRun + ')');

  const db = initAdminDb('cron/dispatch-reminder');
  if (!db) {
    const msg = 'Firestore unavailable — FIREBASE_* env 확인';
    console.error('[dispatch-reminder]', msg);
    return { statusCode: 503, body: { ok: false, error: msg } };
  }

  try {
    const { found, error } = await fetchUnassignedBookings(db);
    if (error) {
      return { statusCode: 200, body: { ok: true, skipped: 'query_failed', error } };
    }

    if (found.length === 0) {
      console.log('[dispatch-reminder] 배차 미입력 0건 — 알림 스킵');
      return { statusCode: 200, body: { ok: true, count: 0, skipped: 'no_pending' } };
    }

    const msg = buildMessage(found);
    console.log(`[dispatch-reminder] 미입력 ${found.length}건 발견`);

    if (dryRun) {
      return {
        statusCode: 200,
        body: { ok: true, dryRun: true, count: found.length, found, message: msg },
      };
    }

    const result = await notifyOperatorLong('dispatch', msg);
    if (!result.ok) {
      console.error('[dispatch-reminder] Telegram 발송 실패:', result.error);
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        count: found.length,
        notified: result.ok,
        notifyError: result.ok ? null : result.error,
      },
    };
  } catch (err) {
    console.error('[dispatch-reminder] 오류:', err.message);
    try { await captureError(err, { route: 'cron/dispatch-reminder' }); } catch {}
    return { statusCode: 500, body: { ok: false, error: err.message } };
  }
};

export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 선택적 인증: CRON_SECRET 설정 시 token 또는 vercel cron 헤더 검증
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const token = req.query?.token || req.headers['x-cron-token'];
    const isVercelCron = !!req.headers['x-vercel-cron'] || !!req.headers['x-vercel-cron-signature'];
    if (!isVercelCron && token !== cronSecret) {
      return res.status(401).json({ ok: false, error: 'Unauthorized cron' });
    }
  }

  try {
    const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';
    const r = await dispatchReminderTask(dryRun);
    return res.status(r.statusCode || 200).json(r.body);
  } catch (e) {
    console.error('[dispatch-reminder] handler error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
