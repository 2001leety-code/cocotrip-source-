/**
 * POST /api/mood-settle-preview — MOOD 운행 종료 정산 "미리보기" (운영자 전용, 쓰기 없음)
 *
 * mood-settle.js 와 정확히 같은 입력·같은 검증·같은 computeMoodTotalKRW 로 금액을 계산하되
 * Firestore 에 아무것도 쓰지 않는다(잔액/예약 문서 전부 read-only). 정산 확정 전 "이 입력대로
 * 커밋하면 최종 얼마·잔액 얼마" 를 보여줘 실수를 막는 용도.
 *
 * 응답의 revision 을 그대로 mood-settle 요청의 expectedRevision 으로 보내면, 미리보기 이후
 * 예약이 바뀌었을 때(다른 관리자가 먼저 정산·변경) 커밋이 STALE_REVISION 으로 막힌다 —
 * "입력이 바뀌면 미리보기 무효" 를 서버가 강제하는 지점.
 *
 * 🔴 이 파일은 mood-settle.js 의 검증/가격 로직을 그대로 미러링한다. 규칙이 바뀌면 두 파일을
 *    함께 고칠 것 (mood-settle-handler-safety.test.ts 가 mood-settle.js 소스 문자열을 정규식으로
 *    검사하므로 mood-settle.js 자체는 공유 모듈로 추출하지 않았다 — 상세는 그 테스트 헤더 참조).
 *
 * 인증: Bearer Firebase ID token, allowlist.admins.
 * Body: mood-settle.js 와 동일 스키마 (bookingId, actualHours, tollMode/actualTollKRW/tollEntries,
 *       actualTotalKm/excludedKm, origin/destination/waypoints, manualAdjustmentKRW, settlementReason).
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';
import { computeMoodTotalKRW, fixedPriceFor, MOOD_MAX_DURATION_HOURS } from './_shared/mood-pricing.js';
import {
  buildSettlementPreviewHash,
  calculateMoodCorrection,
  MOOD_COURSE_SHARE_SCHEMA_VERSION,
  normalizeRequestedMoodCourseShare,
  normalizeStoredMoodCourseShare,
  normalizeTollEntries,
  validateActualDistance,
} from './_shared/mood-settle-calc.js';
import { computeRoute } from './_shared/mood-route.js';

function normalizeWaypoints(raw) {
  if (Array.isArray(raw)) return raw.map((w) => String(w || '').trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split('|').map((w) => w.trim()).filter(Boolean);
  return [];
}

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';

async function handleCorrectionPreview({ body, email, res, headers }) {
  const bookingId = String(body.bookingId || '').trim();
  const expectedRevision = Number(body.expectedRevision);
  const reason = String(body.reason || '').trim();
  if (!bookingId) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: 'bookingId 필수' }));
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_EXPECTED_REVISION' }));
  }
  if (!reason || reason.length > 500) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: reason ? 'CORRECTION_REASON_TOO_LONG' : 'CORRECTION_REASON_REQUIRED' }));
  }
  if (body.origin !== undefined || body.destination !== undefined || body.waypoints !== undefined) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: 'ROUTE_EDIT_NOT_SUPPORTED_IN_CORRECTION' }));
  }

  const hasActualHours = body.actualHours !== undefined && body.actualHours !== null;
  const actualHours = hasActualHours ? Number(body.actualHours) : null;
  if (hasActualHours && (!Number.isFinite(actualHours) || actualHours <= 0 || actualHours > MOOD_MAX_DURATION_HOURS)) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: `actualHours 는 0 초과 ${MOOD_MAX_DURATION_HOURS} 이하` }));
  }
  const hasTollMode = body.tollMode !== undefined && body.tollMode !== null && body.tollMode !== '';
  const tollMode = hasTollMode ? String(body.tollMode) : null;
  if (hasTollMode && !['estimated', 'none', 'actual', 'itemized'].includes(tollMode)) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_TOLL_MODE' }));
  }
  const hasActualTollKRW = body.actualTollKRW !== undefined
    && body.actualTollKRW !== null
    && String(body.actualTollKRW).trim() !== '';
  const actualTollKRW = hasActualTollKRW ? Number(body.actualTollKRW) : Number.NaN;
  if (tollMode === 'actual' && (!hasActualTollKRW || !Number.isInteger(actualTollKRW) || actualTollKRW < 0 || actualTollKRW > 1000000)) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_ACTUAL_TOLL' }));
  }
  let tollEntries = [];
  let itemizedTollKRW = 0;
  let pendingIncludedTollCount = 0;
  if (tollMode === 'itemized') {
    const normalizedEntries = normalizeTollEntries(body.tollEntries);
    if (!normalizedEntries.ok) {
      res.writeHead(400, headers);
      return res.end(JSON.stringify({ ok: false, error: normalizedEntries.error }));
    }
    tollEntries = normalizedEntries.entries;
    itemizedTollKRW = normalizedEntries.includedTollKRW;
    pendingIncludedTollCount = normalizedEntries.pendingIncludedCount;
  } else if (body.tollEntries !== undefined) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_TOLL_ENTRIES' }));
  }
  const acknowledgedPendingTolls = body.acknowledgePendingTolls === true;
  if (pendingIncludedTollCount > 0 && !acknowledgedPendingTolls) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: 'PENDING_TOLL_ACK_REQUIRED' }));
  }

  const hasManualDistance = body.actualTotalKm !== undefined && body.actualTotalKm !== null;
  let manualDistance = null;
  if (hasManualDistance) {
    const validated = validateActualDistance({ actualTotalKm: body.actualTotalKm, excludedKm: body.excludedKm });
    if (!validated.ok) {
      res.writeHead(400, headers);
      return res.end(JSON.stringify({ ok: false, error: validated.error }));
    }
    manualDistance = validated;
  } else if (body.excludedKm !== undefined) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_EXCLUDED_KM' }));
  }
  const hasManualAdjustment = body.manualAdjustmentKRW !== undefined && body.manualAdjustmentKRW !== null;
  const manualAdjustmentKRW = hasManualAdjustment ? Number(body.manualAdjustmentKRW) : null;
  if (hasManualAdjustment && (!Number.isInteger(manualAdjustmentKRW) || Math.abs(manualAdjustmentKRW) > 10000000)) {
    res.writeHead(400, headers);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_MANUAL_ADJUSTMENT' }));
  }

  try {
    const db = initAdminDb('mood-settle-preview-correction');
    if (!db) {
      res.writeHead(500, headers);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }
    const allowlist = await getMoodAllowlist(db);
    if (!isAdminEmail(allowlist, email)) {
      res.writeHead(403, headers);
      return res.end(JSON.stringify({ ok: false, error: '권한 없음 (운영자 전용)' }));
    }
    const bookingRef = db.collection('mood_bookings').doc(bookingId);
    const result = await db.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef);
      if (!bookingSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
      const booking = bookingSnap.data() || {};
      if (booking.status !== 'completed') return { ok: false, status: 409, error: 'NOT_SETTLED' };
      const revision = Number.isInteger(booking.revision) ? booking.revision : 0;
      if (revision !== expectedRevision) return { ok: false, status: 409, error: 'STALE_REVISION' };
      const calculated = calculateMoodCorrection({
        booking,
        bookingId,
        expectedRevision: revision,
        reason,
        hasActualHours,
        actualHours,
        hasManualDistance,
        manualDistance,
        hasTollMode,
        tollMode,
        actualTollKRW,
        tollEntries,
        itemizedTollKRW,
        acknowledgedPendingTolls,
        hasManualAdjustment,
        manualAdjustmentKRW,
      });
      if (!calculated.ok) return calculated;
      const quote = calculated.value;
      const clientRef = db.collection('mood_clients').doc(String(booking.clientId || ''));
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
      const client = clientSnap.data() || {};
      const balance = client.balanceKRW;
      if (!Number.isSafeInteger(balance)) return { ok: false, status: 409, error: 'INVALID_CLIENT_BALANCE' };
      const resultingBalanceKRW = balance - quote.deltaKRW;
      if (!Number.isSafeInteger(resultingBalanceKRW)) return { ok: false, status: 409, error: 'INVALID_CALCULATED_BALANCE' };
      const creditLimitKRW = client.creditLimitKRW;
      if (creditLimitKRW !== undefined && creditLimitKRW !== null) {
        if (!Number.isSafeInteger(creditLimitKRW) || creditLimitKRW <= 0) {
          return { ok: false, status: 409, error: 'INVALID_CREDIT_LIMIT' };
        }
        if (quote.deltaKRW > 0 && resultingBalanceKRW < -creditLimitKRW) {
          return { ok: false, status: 409, error: 'CREDIT_LIMIT_EXCEEDED' };
        }
      }
      return {
        ok: true,
        data: {
          mode: 'correction',
          bookingId,
          revision,
          actualHours: quote.effectiveActualHours,
          km: quote.finalPriced.km,
          distanceSource: quote.distanceSource,
          actualTotalKm: quote.effectiveActualTotalKm,
          excludedKm: quote.effectiveExcludedKm,
          baseKRW: quote.finalPriced.baseKRW,
          distanceSurchargeKRW: quote.finalPriced.distanceSurchargeKRW,
          estimatedTollKRW: quote.estimatedTollKRW,
          tollKRW: quote.finalPriced.tollKRW,
          tollEntries: quote.effectiveTollMode === 'itemized' ? quote.effectiveTollEntries : null,
          manualAdjustmentKRW: quote.effectiveManualAdjustmentKRW,
          correctionReason: reason,
          bookedAmountKRW: quote.originalAmount,
          previousFinalAmountKRW: quote.currentFinalAmount,
          finalAmountKRW: quote.newFinalAmount,
          deltaKRW: quote.deltaKRW,
          currentBalanceKRW: balance,
          resultingBalanceKRW,
          previewHash: quote.previewHash,
        },
      };
    });
    if (!result.ok) {
      res.writeHead(result.status || 409, headers);
      return res.end(JSON.stringify({ ok: false, error: result.error || 'PREVIEW_FAILED' }));
    }
    res.writeHead(200, headers);
    return res.end(JSON.stringify({ ok: true, data: result.data }));
  } catch (err) {
    console.error('[mood-settle-preview-correction] failed:', err.message);
    await captureError(err, { route: '/api/mood-settle-preview', email, mode: 'correction' });
    res.writeHead(500, headers);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') { res.writeHead(200, JSON_HEADERS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '이메일 미검증' }));
  }
  const email = auth.email;

  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const mode = body.mode === undefined || body.mode === null || body.mode === '' ? 'initial' : String(body.mode);
  if (!['initial', 'correction'].includes(mode)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_PREVIEW_MODE' }));
  }
  if (mode === 'correction') {
    return handleCorrectionPreview({ body, email, res, headers: JSON_HEADERS });
  }

  const bookingId = String(body.bookingId || '').trim();
  if (!bookingId) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'bookingId 필수' }));
  }
  const actualHours = Number(body.actualHours);
  if (!Number.isFinite(actualHours) || actualHours <= 0 || actualHours > MOOD_MAX_DURATION_HOURS) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: `actualHours 는 0 초과 ${MOOD_MAX_DURATION_HOURS} 이하` }));
  }

  const rawTollMode = body.tollMode === undefined || body.tollMode === null || body.tollMode === ''
    ? 'estimated'
    : String(body.tollMode);
  if (!['estimated', 'none', 'actual', 'itemized'].includes(rawTollMode)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_TOLL_MODE' }));
  }
  const tollMode = rawTollMode;
  const hasActualTollKRW = body.actualTollKRW !== undefined
    && body.actualTollKRW !== null
    && String(body.actualTollKRW).trim() !== '';
  const actualTollKRW = hasActualTollKRW ? Number(body.actualTollKRW) : Number.NaN;
  const manualAdjustmentKRW = Number(body.manualAdjustmentKRW || 0);
  const settlementReason = String(body.settlementReason || '').trim();
  if (tollMode === 'actual' && (!hasActualTollKRW || !Number.isInteger(actualTollKRW) || actualTollKRW < 0 || actualTollKRW > 1000000)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_ACTUAL_TOLL' }));
  }
  let tollEntries = [];
  let itemizedTollKRW = 0;
  let pendingIncludedTollCount = 0;
  if (tollMode === 'itemized') {
    const normalizedEntries = normalizeTollEntries(body.tollEntries);
    if (!normalizedEntries.ok) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: normalizedEntries.error }));
    }
    tollEntries = normalizedEntries.entries;
    itemizedTollKRW = normalizedEntries.includedTollKRW;
    pendingIncludedTollCount = normalizedEntries.pendingIncludedCount;
  } else if (body.tollEntries !== undefined) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_TOLL_ENTRIES' }));
  }
  const acknowledgedPendingTolls = body.acknowledgePendingTolls === true;
  if (pendingIncludedTollCount > 0 && !acknowledgedPendingTolls) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'PENDING_TOLL_ACK_REQUIRED' }));
  }
  const hasManualDistance = body.actualTotalKm !== undefined && body.actualTotalKm !== null;
  let manualDistance = null;
  if (hasManualDistance) {
    const validated = validateActualDistance({ actualTotalKm: body.actualTotalKm, excludedKm: body.excludedKm });
    if (!validated.ok) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: validated.error }));
    }
    manualDistance = validated;
  } else if (body.excludedKm !== undefined) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_EXCLUDED_KM' }));
  }
  if (!Number.isInteger(manualAdjustmentKRW) || Math.abs(manualAdjustmentKRW) > 10000000) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_MANUAL_ADJUSTMENT' }));
  }
  if ((tollMode !== 'estimated' || manualAdjustmentKRW !== 0 || hasManualDistance) && !settlementReason) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'SETTLEMENT_REASON_REQUIRED' }));
  }
  if (settlementReason.length > 500) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'SETTLEMENT_REASON_TOO_LONG' }));
  }

  try {
    const db = initAdminDb('mood-settle-preview');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const allowlist = await getMoodAllowlist(db);
    if (!isAdminEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '권한 없음 (운영자 전용)' }));
    }

    const bookingRef = db.collection('mood_bookings').doc(bookingId);
    const preSnap = await bookingRef.get();
    if (!preSnap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'BOOKING_NOT_FOUND' }));
    }
    const pre = preSnap.data() || {};
    if (pre.status !== 'confirmed') {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'ALREADY_SETTLED' }));
    }
    const preRevision = Number.isInteger(pre.revision) ? pre.revision : 0;
    if (fixedPriceFor(pre.serviceType) !== null) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'AIRPORT_NO_SETTLE' }));
    }
    const preBd = pre.breakdown || {};
    const hasStoredRate = pre.ratePerHour !== undefined && pre.ratePerHour !== null;
    if (hasStoredRate && (!Number.isSafeInteger(pre.ratePerHour) || pre.ratePerHour <= 0)) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_BOOKING_RATE' }));
    }

    const newOrigin = String(body.origin || '').trim();
    const newDest = String(body.destination || '').trim();
    const newWaypoints = normalizeWaypoints(body.waypoints);
    if (!!newOrigin !== !!newDest) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'ROUTE_PAIR_REQUIRED' }));
    }
    if (newWaypoints.length > 5 || newOrigin.length > 300 || newDest.length > 300 || newWaypoints.some((waypoint) => waypoint.length > 300)) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_ROUTE_INPUT' }));
    }
    const hasRouteOverride = !!(newOrigin && newDest);
    if (hasRouteOverride && hasManualDistance) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'CONFLICTING_DISTANCE_SOURCE' }));
    }
    let settledCourseMoodPercentages = null;
    if (hasRouteOverride) {
      const normalizedRequestedCourseShare = normalizeRequestedMoodCourseShare({
        courseMoodPercentages: body.courseMoodPercentages,
        courseShareSchemaVersion: body.courseShareSchemaVersion,
        stopCount: newWaypoints.length + 2,
      });
      if (!normalizedRequestedCourseShare.ok) {
        res.writeHead(400, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: normalizedRequestedCourseShare.error }));
      }
      settledCourseMoodPercentages = normalizedRequestedCourseShare.percentages;
    } else if (
      body.courseMoodPercentages !== undefined
      || body.courseShareSchemaVersion !== undefined
      || body.coursePayers !== undefined
    ) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_COURSE_MOOD_PERCENTAGES' }));
    }
    if (body.coursePayers !== undefined) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_COURSE_MOOD_PERCENTAGES' }));
    }

    if (!hasRouteOverride && (
      (!hasManualDistance && (
        typeof preBd.km !== 'number' || !Number.isFinite(preBd.km) || preBd.km < 0
      ))
      || typeof preBd.tollKRW !== 'number'
      || !Number.isFinite(preBd.tollKRW)
      || preBd.tollKRW < 0
    )) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_BOOKING_BREAKDOWN' }));
    }
    if (!normalizeStoredMoodCourseShare(pre).ok) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_STORED_COURSE_SHARE' }));
    }

    let km = preBd.km;
    let tollKRW = preBd.tollKRW;
    let recomputed = false;
    let routeError = null;
    if (hasRouteOverride) {
      const route = await computeRoute({ origin: newOrigin, destination: newDest, waypoints: newWaypoints });
      if (
        route.ok
        && typeof route.km === 'number' && Number.isFinite(route.km) && route.km >= 0
        && Number.isSafeInteger(route.tollKRW) && route.tollKRW >= 0
        && typeof route.durationMin === 'number' && Number.isFinite(route.durationMin) && route.durationMin >= 0
      ) {
        km = route.km;
        tollKRW = route.tollKRW;
        recomputed = true;
      } else {
        routeError = route.error || 'INVALID_ROUTE_RESULT';
      }
    }
    if (routeError) {
      res.writeHead(422, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'ROUTE_RECALCULATION_FAILED', detail: routeError }));
    }
    if (hasManualDistance) km = manualDistance.billableKm;
    const distanceSource = hasManualDistance ? 'manual' : (hasRouteOverride ? 'route' : 'booked');

    const estimatedTollKRW = tollKRW;
    if (tollMode === 'none') tollKRW = 0;
    if (tollMode === 'actual') tollKRW = actualTollKRW;
    if (tollMode === 'itemized') tollKRW = itemizedTollKRW;

    const finalPriced = computeMoodTotalKRW({
      serviceType: pre.serviceType,
      durationHours: actualHours,
      km,
      tollKRW,
      ratePerHourOverride: hasStoredRate ? pre.ratePerHour : undefined,
    });
    if (!finalPriced.ok) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: finalPriced.error }));
    }

    const finalAmount = finalPriced.amountKRW + manualAdjustmentKRW;
    const originalAmount = pre.amountKRW;
    if (!Number.isInteger(finalAmount) || finalAmount < 0) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_FINAL_AMOUNT' }));
    }
    if (!Number.isInteger(originalAmount) || originalAmount < 0) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_BOOKING_AMOUNT' }));
    }
    const deltaKRW = finalAmount - originalAmount;

    // 예약 revision과 잔액을 같은 읽기 전용 트랜잭션에서 다시 확인한다. 쓰기는 0건이다.
    const balanceResult = await db.runTransaction(async (tx) => {
      const currentBookingSnap = await tx.get(bookingRef);
      if (!currentBookingSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
      const currentBooking = currentBookingSnap.data() || {};
      const currentRevision = Number.isInteger(currentBooking.revision) ? currentBooking.revision : 0;
      if (currentBooking.status !== 'confirmed' || currentRevision !== preRevision || currentBooking.amountKRW !== originalAmount) {
        return { ok: false, status: 409, error: 'BOOKING_CHANGED' };
      }
      const clientRef = db.collection('mood_clients').doc(String(currentBooking.clientId || ''));
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
      const clientData = clientSnap.data() || {};
      if (!Number.isSafeInteger(clientData.balanceKRW)) {
        return { ok: false, status: 409, error: 'INVALID_CLIENT_BALANCE' };
      }
      return { ok: true, balance: clientData.balanceKRW, creditLimitKRW: clientData.creditLimitKRW };
    });
    if (!balanceResult.ok) {
      res.writeHead(balanceResult.status, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: balanceResult.error }));
    }
    const balance = balanceResult.balance;
    const resultingBalanceKRW = balance - deltaKRW;
    if (!Number.isSafeInteger(resultingBalanceKRW)) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_CALCULATED_BALANCE' }));
    }
    if (balanceResult.creditLimitKRW !== undefined && balanceResult.creditLimitKRW !== null) {
      if (!Number.isSafeInteger(balanceResult.creditLimitKRW) || balanceResult.creditLimitKRW <= 0) {
        res.writeHead(409, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: 'INVALID_CREDIT_LIMIT' }));
      }
      if (deltaKRW > 0 && resultingBalanceKRW < -balanceResult.creditLimitKRW) {
        res.writeHead(409, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: 'CREDIT_LIMIT_EXCEEDED' }));
      }
    }

    const previewHash = buildSettlementPreviewHash({
      mode: 'initial',
      bookingId,
      revision: preRevision,
      actualHours,
      km: finalPriced.km,
      distanceSource,
      actualTotalKm: hasManualDistance ? manualDistance.actualTotalKm : null,
      excludedKm: hasManualDistance ? manualDistance.excludedKm : null,
      tollMode,
      tollKRW: finalPriced.tollKRW,
      tollEntries: tollMode === 'itemized' ? tollEntries : null,
      acknowledgedPendingTolls,
      route: hasRouteOverride ? {
        origin: newOrigin,
        destination: newDest,
        waypoints: newWaypoints,
        courseMoodPercentages: settledCourseMoodPercentages,
        courseShareSchemaVersion: MOOD_COURSE_SHARE_SCHEMA_VERSION,
      } : null,
      manualAdjustmentKRW,
      settlementReason: settlementReason || null,
      bookedAmountKRW: originalAmount,
      finalAmountKRW: finalAmount,
    });

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: {
        bookingId,
        revision: preRevision,
        actualHours,
        km: finalPriced.km,
        distanceSource,
        ...(hasManualDistance ? { actualTotalKm: manualDistance.actualTotalKm, excludedKm: manualDistance.excludedKm } : {}),
        routeRecomputed: recomputed,
        ...(hasRouteOverride ? {
          courseMoodPercentages: settledCourseMoodPercentages,
          courseShareSchemaVersion: MOOD_COURSE_SHARE_SCHEMA_VERSION,
        } : {}),
        baseKRW: finalPriced.baseKRW,
        distanceSurchargeKRW: finalPriced.distanceSurchargeKRW,
        estimatedTollKRW,
        tollKRW: finalPriced.tollKRW,
        ...(tollMode === 'itemized' ? { tollEntries } : {}),
        manualAdjustmentKRW,
        settlementReason: settlementReason || null,
        bookedAmountKRW: originalAmount,
        finalAmountKRW: finalAmount,
        deltaKRW,
        currentBalanceKRW: balance,
        resultingBalanceKRW,
        previewHash,
      },
    }));
  } catch (err) {
    console.error('[mood-settle-preview] failed:', err.message);
    await captureError(err, { route: '/api/mood-settle-preview', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
