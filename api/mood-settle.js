/**
 * POST /api/mood-settle — MOOD 운행 종료 정산 (운영자 전용)
 *
 * 예약(가예약, status='confirmed')을 실제 운행시간으로 최종 정산:
 *   최종금액 = 시급 × max(3, 실제시간) + (실제 거리추가 + 톨비)
 *   차액 = 최종 − 선결제(원래 차감액) → 잔액 조정(초과면 추가차감 / 적으면 환원), 한 트랜잭션.
 *   status → 'completed', 실제시간·최종금액·조정액·실제 경로 저장 + 최종 정산 영수증 메일.
 *
 * 🛣️ 거리 재측정 (추가 방문지): origin/destination(+waypoints) 가 body 로 오면
 *   운행 중 실제로 들른 경로로 Naver Directions 를 다시 호출해 정확한 km/톨비를 구한다.
 *   (운행 종료 시 매니저가 "추가 방문지" 를 넣으면 정확한 거리 합산이 나온다.)
 *   route 가 안 오면 예약 시 측정값(breakdown.km/tollKRW) 재사용. 클라가 보낸 km/금액은 무시.
 *
 * 🔴 멱등성: status!=='confirmed' 면 거부(이미 정산/취소). 공항(정액)은 정산 무관.
 * 🔴 금액 SSOT: 최종 금액은 백엔드 computeMoodTotalKRW 로만 계산 (P311).
 * 인증: Bearer Firebase ID token, allowlist.admins (mood-topup 동일 게이트).
 * Body: { bookingId, actualHours, origin?, destination?, waypoints?(string[] | "A|B"),
 *         courseMoodPercentages?, courseShareSchemaVersion? }
 * 실제 경로를 바꾸면 courseMoodPercentages 가 필수다. 구 쓰기 필드 coursePayers 는 400으로 거부한다.
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';
import { computeMoodTotalKRW, fixedPriceFor, MOOD_MAX_DURATION_HOURS } from './_shared/mood-pricing.js';
import {
  buildSettlementPreviewHash,
  legacyMoodPayersForPercentages as legacyPayersForPercentages,
  MOOD_COURSE_SHARE_SCHEMA_VERSION as COURSE_SHARE_SCHEMA_VERSION,
  normalizeRequestedMoodCourseShare,
  normalizeStoredMoodCourseShare as normalizeStoredCourseShare,
  normalizeTollEntries,
  validateActualDistance,
} from './_shared/mood-settle-calc.js';
import { computeRoute } from './_shared/mood-route.js';
import { buildRouteSnapshot } from './_shared/mood-route-snapshot.js';
import {
  buildSettlementApprovalSummary,
  buildSettlementIdempotencyDocumentId,
  buildSettlementProposalId,
  settlementProposalVersionOf,
} from './_shared/mood-settlement-proposal.js';
import { notify } from './_shared/notify.js';

/** body.waypoints 정규화 — 배열 또는 "A|B" 문자열 둘 다 허용 (mood-book 과 동일 규칙). */
function normalizeWaypoints(raw) {
  if (Array.isArray(raw)) return raw.map((w) => String(w || '').trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split('|').map((w) => w.trim()).filter(Boolean);
  return [];
}

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';
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
  // itemized — 톨비 항목(뒷돈/카드충전 등 비-톨비 항목 제외) 을 서버가 직접 합산한다.
  // 클라가 보낸 합계는 절대 신뢰하지 않는다 (INVALID_TOLL_ENTRY_* / TOO_MANY_TOLL_ENTRIES).
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
  // 실사용 거리(총 주행 − 픽업 전/비과금 제외) — route override 와 동시 사용 불가(출처 충돌).
  // 서버가 excludedKm 를 뺀 정산거리(billableKm) 를 재계산한다 (클라 정산거리는 무시).
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
  if (body.expectedRevision === undefined || body.expectedRevision === null) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'EXPECTED_REVISION_REQUIRED' }));
  }
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_EXPECTED_REVISION' }));
  }
  const acknowledgedPendingTolls = body.acknowledgePendingTolls === true;
  if (pendingIncludedTollCount > 0 && !acknowledgedPendingTolls) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'PENDING_TOLL_ACK_REQUIRED' }));
  }
  const previewHash = typeof body.previewHash === 'string' ? body.previewHash.trim() : '';
  if (!/^[a-f0-9]{64}$/.test(previewHash)) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: previewHash ? 'INVALID_PREVIEW_HASH' : 'PREVIEW_REQUIRED' }));
  }
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    res.writeHead(400, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'INVALID_IDEMPOTENCY_KEY' }));
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
    const db = initAdminDb('mood-settle');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const allowlist = await getMoodAllowlist(db);
    if (!isAdminEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '권한 없음 (운영자 전용)' }));
    }

    const requestPayloadHash = buildSettlementPreviewHash({
      mode: 'initial-proposal-request',
      bookingId,
      expectedRevision,
      previewHash,
    });
    const proposalId = buildSettlementProposalId({ bookingId, actorEmail: email, idempotencyKey });
    const proposalRef = db.collection('mood_settlement_proposals').doc(proposalId);
    const idempotencyRef = db.collection('mood_settlement_idempotency').doc(buildSettlementIdempotencyDocumentId({
      scope: 'mood-settlement-proposal',
      actorEmail: email,
      idempotencyKey,
    }));
    // 성공 응답을 잃은 재시도는 예약 revision이 이미 바뀌었어도 같은 결과를 재생한다.
    const priorIdempotencySnap = await idempotencyRef.get();
    if (priorIdempotencySnap.exists) {
      const stored = priorIdempotencySnap.data() || {};
      if (stored.payloadHash !== requestPayloadHash) {
        res.writeHead(409, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: 'IDEMPOTENCY_CONFLICT' }));
      }
      if (!stored.response || typeof stored.response !== 'object') {
        res.writeHead(409, JSON_HEADERS);
        return res.end(JSON.stringify({ ok: false, error: 'IDEMPOTENCY_RESPONSE_MISSING' }));
      }
      res.writeHead(200, JSON_HEADERS);
      return res.end(JSON.stringify({ ...stored.response, replayed: true }));
    }

    const bookingRef = db.collection('mood_bookings').doc(bookingId);

    // ── 1) 사전 read — serviceType + 기존 경로/거리 (route 기본값·재사용·정액 게이트) ──
    // computeRoute(네트워크)는 Firestore 트랜잭션 안에서 돌릴 수 없어 먼저 읽고 밖에서 측정.
    // serviceType·예약 거리는 불변이라 트랜잭션 밖 사전 read 로 충분 (멱등성은 tx 안에서 재확인).
    const preSnap = await bookingRef.get();
    if (!preSnap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'BOOKING_NOT_FOUND' }));
    }
    const pre = preSnap.data() || {};
    if (pre.bookingChangeApproval && pre.bookingChangeApproval.status === 'awaiting_mood') {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'BOOKING_CHANGE_APPROVAL_PENDING' }));
    }
    if (pre.status !== 'confirmed') {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'ALREADY_SETTLED' }));
    }
    const preRevision = Number.isInteger(pre.revision) ? pre.revision : 0;
    // 미리보기(mood-settle-preview) 에서 받은 revision 과 다르면 그새 예약이 바뀐 것 —
    // 정산 확정을 막는다(그대로 진행하면 미리보기에서 못 본 변경을 덮어씀).
    if (expectedRevision !== preRevision) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'STALE_REVISION' }));
    }
    if (fixedPriceFor(pre.serviceType) !== null) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'AIRPORT_NO_SETTLE' }));
    }
    const preBd = pre.breakdown || {};
    const hasStoredRate = pre.ratePerHour !== undefined && pre.ratePerHour !== null;
    if (
      hasStoredRate
      && (!Number.isSafeInteger(pre.ratePerHour) || pre.ratePerHour <= 0)
    ) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_BOOKING_RATE' }));
    }

    // ── 2) 거리/톨비 — 추가 방문지(route) 오면 Naver 재측정, 없으면 예약값 재사용 ──
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
      const expectedCourseCount = newWaypoints.length + 2;
      const normalizedRequestedCourseShare = normalizeRequestedMoodCourseShare({
        courseMoodPercentages: body.courseMoodPercentages,
        courseShareSchemaVersion: body.courseShareSchemaVersion,
        stopCount: expectedCourseCount,
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
        typeof preBd.km !== 'number'
        || !Number.isFinite(preBd.km)
        || preBd.km < 0
      ))
      || typeof preBd.tollKRW !== 'number'
      || !Number.isFinite(preBd.tollKRW)
      || preBd.tollKRW < 0
    )) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_BOOKING_BREAKDOWN' }));
    }
    if (!normalizeStoredCourseShare(pre).ok) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_STORED_COURSE_SHARE' }));
    }
    let km = preBd.km;
    let tollKRW = preBd.tollKRW;
    if (hasRouteOverride) {
      km = 0;
      tollKRW = 0;
    }
    let routeMeta = {
      origin: preBd.origin || null,
      destination: preBd.destination || null,
      waypoints: preBd.waypoints || null,
      recomputed: false,
    };
    let routeError = null;
    let finalRouteSnapshot = null;
    if (hasRouteOverride) {
      const route = await computeRoute({ origin: newOrigin, destination: newDest, waypoints: newWaypoints });
      if (
        route.ok
        && typeof route.km === 'number'
        && Number.isFinite(route.km)
        && route.km >= 0
        && Number.isSafeInteger(route.tollKRW)
        && route.tollKRW >= 0
        && typeof route.durationMin === 'number'
        && Number.isFinite(route.durationMin)
        && route.durationMin >= 0
      ) {
        km = route.km;
        tollKRW = route.tollKRW;
        routeMeta = {
          origin: newOrigin,
          destination: newDest,
          waypoints: newWaypoints.length ? newWaypoints : null,
          recomputed: true,
        };
        finalRouteSnapshot = buildRouteSnapshot(route);
      } else {
        // 경로 재측정 실패 → 예약 거리로 조용히 대체하지 않고 아래에서 422로 fail-closed 처리한다.
        routeError = route.error || 'INVALID_ROUTE_RESULT';
        console.warn('[mood-settle] route 재측정 실패:', route.error, route.detail || '');
      }
    }
    if (routeError) {
      res.writeHead(422, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'ROUTE_RECALCULATION_FAILED', detail: routeError }));
    }
    // 실사용 거리(총 주행 − 제외 거리) — route 재측정과 배타적. 정산거리(billableKm)는
    // 서버가 계산한 값만 쓴다(클라 정산거리 무시). 톨비는 그대로(거리와 별개 출처).
    if (hasManualDistance) km = manualDistance.billableKm;
    const distanceSource = hasManualDistance ? 'manual' : (hasRouteOverride ? 'route' : 'booked');

    const estimatedTollKRW = tollKRW;
    if (tollMode === 'none') tollKRW = 0;
    if (tollMode === 'actual') tollKRW = actualTollKRW;
    if (tollMode === 'itemized') tollKRW = itemizedTollKRW;

    // ── 3) 최종 금액 (백엔드 SSOT — 클라 금액 무시) ──
    // 예약 당시 단가 보존(2026-07-04 요율 개정 33k→30k/44k→40k) — 옛 예약을 새 단가로
    // 정산하면 예약가와 어긋남. 거리단가는 현행 상수(재측정 km 대상, ±60원/km 허용).
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

    const calculatedFinalAmount = finalPriced.amountKRW + manualAdjustmentKRW;
    if (!Number.isSafeInteger(calculatedFinalAmount) || calculatedFinalAmount < 0) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_FINAL_AMOUNT' }));
    }
    if (!Number.isSafeInteger(pre.amountKRW) || pre.amountKRW < 0) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_BOOKING_AMOUNT' }));
    }
    const previewPayload = {
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
        courseShareSchemaVersion: COURSE_SHARE_SCHEMA_VERSION,
      } : null,
      manualAdjustmentKRW,
      settlementReason: settlementReason || null,
      bookedAmountKRW: pre.amountKRW,
      finalAmountKRW: calculatedFinalAmount,
    };
    const calculatedPreviewHash = buildSettlementPreviewHash(previewPayload);
    if (previewHash !== calculatedPreviewHash) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'PREVIEW_MISMATCH' }));
    }

    const proposedAt = Date.now();

    // ── 4) 트랜잭션 — 제안 저장만. 잔액/완료 상태는 MOOD 승인 전까지 불변 ──
    const result = await db.runTransaction(async (tx) => {
      const [idempotencySnap, bSnap] = await Promise.all([
        tx.get(idempotencyRef),
        tx.get(bookingRef),
      ]);
      if (idempotencySnap.exists) {
        const stored = idempotencySnap.data() || {};
        if (stored.payloadHash !== requestPayloadHash) return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
        if (!stored.response || typeof stored.response !== 'object') {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_RESPONSE_MISSING' };
        }
        return { ok: true, replayed: true, response: stored.response };
      }
      if (!bSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
      const b = bSnap.data() || {};
      if (b.bookingChangeApproval && b.bookingChangeApproval.status === 'awaiting_mood') {
        return { ok: false, status: 409, error: 'BOOKING_CHANGE_APPROVAL_PENDING' };
      }
      if (b.status !== 'confirmed') return { ok: false, status: 409, error: 'ALREADY_SETTLED' };
      const currentRevision = Number.isInteger(b.revision) ? b.revision : 0;
      if (currentRevision !== preRevision) return { ok: false, status: 409, error: 'BOOKING_CHANGED' };
      if (fixedPriceFor(b.serviceType) !== null) return { ok: false, status: 400, error: 'AIRPORT_NO_SETTLE' };
      const currentCourseShare = normalizeStoredCourseShare(b);
      if (!currentCourseShare.ok) return { ok: false, status: 409, error: 'INVALID_STORED_COURSE_SHARE' };
      const finalCourseMoodPercentages = settledCourseMoodPercentages || currentCourseShare.percentages;
      const finalCoursePayers = legacyPayersForPercentages(finalCourseMoodPercentages);

      const finalAmount = calculatedFinalAmount;
      const originalAmount = b.amountKRW;
      if (!Number.isSafeInteger(finalAmount) || finalAmount < 0) return { ok: false, status: 400, error: 'INVALID_FINAL_AMOUNT' };
      if (!Number.isSafeInteger(originalAmount) || originalAmount < 0) return { ok: false, status: 409, error: 'INVALID_BOOKING_AMOUNT' };
      if (originalAmount !== pre.amountKRW) return { ok: false, status: 409, error: 'BOOKING_CHANGED' };
      const diff = finalAmount - originalAmount;

      const clientRef = db.collection('mood_clients').doc(String(b.clientId || ''));
      const cSnap = await tx.get(clientRef);
      if (!cSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
      const clientData = cSnap.data() || {};
      const balance = clientData.balanceKRW;
      if (!Number.isSafeInteger(balance)) return { ok: false, status: 409, error: 'INVALID_CLIENT_BALANCE' };
      const newBalance = balance - diff;
      if (!Number.isSafeInteger(diff) || !Number.isSafeInteger(newBalance)) {
        return { ok: false, status: 409, error: 'INVALID_CALCULATED_BALANCE' };
      }
      const creditLimitKRW = clientData.creditLimitKRW;
      if (creditLimitKRW !== undefined && creditLimitKRW !== null) {
        if (!Number.isSafeInteger(creditLimitKRW) || creditLimitKRW <= 0) {
          return { ok: false, status: 409, error: 'INVALID_CREDIT_LIMIT' };
        }
        if (diff > 0 && newBalance < -creditLimitKRW) {
          return { ok: false, status: 409, error: 'CREDIT_LIMIT_EXCEEDED' };
        }
      }

      const existingApproval = b.settlementApproval && typeof b.settlementApproval === 'object'
        ? b.settlementApproval
        : null;
      let previousProposalRef = null;
      let previousProposalSnap = null;
      if (
        existingApproval
        && existingApproval.proposalId
        && existingApproval.proposalId !== proposalId
        && (existingApproval.status === 'awaiting_mood' || existingApproval.status === 'changes_requested')
      ) {
        previousProposalRef = db.collection('mood_settlement_proposals').doc(String(existingApproval.proposalId));
        previousProposalSnap = await tx.get(previousProposalRef);
        if (!previousProposalSnap.exists) return { ok: false, status: 409, error: 'ACTIVE_PROPOSAL_NOT_FOUND' };
      }

      const version = settlementProposalVersionOf(b) + 1;
      const nextRevision = currentRevision + 1;
      const finalBreakdown = {
        baseKRW: finalPriced.baseKRW,
        distanceSurchargeKRW: finalPriced.distanceSurchargeKRW,
        tollKRW: finalPriced.tollKRW,
        estimatedTollKRW,
        km: finalPriced.km,
        distanceSource,
        ...(hasManualDistance ? { actualTotalKm: manualDistance.actualTotalKm, excludedKm: manualDistance.excludedKm } : {}),
        ...routeMeta,
      };
      const proposal = {
        proposalId,
        bookingId,
        clientId: b.clientId,
        mode: 'initial',
        version,
        status: 'awaiting_mood',
        bookingRevisionBefore: currentRevision,
        bookingRevisionAfterProposal: nextRevision,
        previewHash: calculatedPreviewHash,
        previewPayload,
        actualHours,
        finalAmountKRW: finalAmount,
        bookedAmountKRW: originalAmount,
        previousFinalAmountKRW: null,
        deltaKRW: diff,
        finalBreakdown,
        manualAdjustmentKRW,
        estimatedTollKRW,
        tollMode,
        tollEntries: tollMode === 'itemized' ? tollEntries : null,
        pendingIncludedTollCount,
        acknowledgedPendingTollsByOperator: acknowledgedPendingTolls,
        settlementReason: settlementReason || null,
        courseMoodPercentages: finalCourseMoodPercentages,
        courseShareSchemaVersion: COURSE_SHARE_SCHEMA_VERSION,
        coursePayers: finalCoursePayers,
        finalRouteSnapshot: finalRouteSnapshot || null,
        proposedBalanceKRW: balance,
        proposedResultingBalanceKRW: newBalance,
        proposedByEmail: email,
        proposedAt,
        changeRequestReason: null,
        approvedByEmail: null,
        approvedAt: null,
      };
      const approvalSummary = buildSettlementApprovalSummary(proposal);
      const response = {
        ok: true,
        data: {
          bookingId,
          proposalId,
          mode: 'initial',
          status: 'awaiting_mood',
          version,
          actualHours,
          finalAmountKRW: finalAmount,
          adjustmentKRW: diff,
          deltaKRW: diff,
          proposedBalanceKRW: balance,
          proposedResultingBalanceKRW: newBalance,
          pendingIncludedTollCount,
          revision: nextRevision,
          settlementApproval: approvalSummary,
        },
      };

      if (previousProposalRef && previousProposalSnap) {
        tx.update(previousProposalRef, {
          status: 'superseded',
          supersededByProposalId: proposalId,
          supersededByEmail: email,
          supersededAt: proposedAt,
        });
      }
      tx.set(proposalRef, proposal);
      tx.update(bookingRef, {
        settlementApproval: approvalSummary,
        settlementProposalVersion: version,
        revision: nextRevision,
      });
      tx.set(idempotencyRef, {
        scope: 'mood-settlement-proposal',
        bookingId,
        proposalId,
        actorEmail: email,
        payloadHash: requestPayloadHash,
        status: 'completed',
        response,
        createdAt: proposedAt,
        completedAt: proposedAt,
      });

      return {
        ok: true,
        replayed: false,
        response,
        booking: b,
      };
    });

    if (!result.ok) {
      res.writeHead(result.status, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: result.error }));
    }

    const response = result.response;
    if (!result.replayed) {
      try {
        const b = result.booking || {};
        const clientName = b.clientName || b.clientId || '-';
        const delta = response.data.deltaKRW;
        const adjustment = delta > 0 ? `추가 ${delta.toLocaleString('ko-KR')}원`
          : delta < 0 ? `환원 ${(-delta).toLocaleString('ko-KR')}원` : '변동 없음';
        await notify('booking',
          `<b>MOOD 정산 확인 요청</b>\n` +
          `${clientName} · ${b.date} ${b.startTime}\n` +
          `최종 제안 ${response.data.finalAmountKRW.toLocaleString('ko-KR')}원 (${adjustment})\n` +
          `MOOD 승인 전 — 잔액은 아직 바뀌지 않았습니다.`);
      } catch (e) { console.warn('[mood-settle] proposal notify 실패:', e?.message); }
    }

    console.log('[mood-settle]', email, '→', bookingId, result.replayed ? '| 제안 멱등 재생' : `| 제안 ${proposalId} | 최종 ${response.data.finalAmountKRW}`);
    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({ ...response, replayed: result.replayed }));
  } catch (err) {
    console.error('[mood-settle] failed:', err.message);
    await captureError(err, { route: '/api/mood-settle', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
