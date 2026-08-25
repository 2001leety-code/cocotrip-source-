/**
 * GET /api/mood-data?clientId=... — MOOD 포털 조회
 *
 * 잔액 카드 + 공유 캘린더 + 차감 리스트(ledger)용 데이터를 반환.
 *
 * 인증: Authorization: Bearer <Firebase ID token>.
 *   - 토큰 email 이 mood_config/allowlist.emails 에 없으면 403.
 *   - admins 여부도 함께 반환 → 프론트가 "충전" UI 노출 분기.
 *
 * v1 단일 client 가정: mood_config/allowlist.clientId 에 기본 client 1개.
 *   - query clientId 가 오면 그걸 우선 사용하되, 광고사 직원은 allowlist.clientId
 *     (자기 회사) 만 조회 가능하도록 제한 (admin 은 임의 clientId 조회 허용).
 *
 * 차감 리스트(ledger): 각 예약의 breakdown(시급/거리추가/톨비/km/경로) + 그 예약
 *   직후 running 잔액(runningBalanceKRW) 을 최신순으로 반환. 직원/운영자가
 *   "얼마 빠졌고 잔액 얼마" 를 한눈에 본다 (외상 = 음수 잔액 포함).
 *
 * 반환 예약에는 v2 courseMoodPercentages 와 courseShareSchemaVersion=2를 포함한다.
 * 구 coursePayers 만 있는 예약은 위치 그대로 mood=100, influencer=0으로 변환한다.
 * 반환: { client: { name, balanceKRW }, bookings: [...ledger], isAdmin, clientId }
 */
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAllowedEmail, isAdminEmail, isSettlementApproverEmail } from './_shared/mood-allowlist.js';
import { decodeRouteSnapshot } from './_shared/mood-route-snapshot.js';
import { normalizeMoodRouteSchedule } from './_shared/mood-route-schedule.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'GET, OPTIONS';
const COURSE_SHARE_SCHEMA_VERSION = 2;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function routeStopCount(breakdown) {
  const value = breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown) ? breakdown : {};
  const origin = typeof value.origin === 'string' ? value.origin.trim() : '';
  const destination = typeof value.destination === 'string' ? value.destination.trim() : '';
  const waypoints = value.waypoints === undefined || value.waypoints === null ? [] : value.waypoints;
  if (!Array.isArray(waypoints) || waypoints.some((waypoint) => typeof waypoint !== 'string' || !waypoint.trim())) return null;
  if (!origin && !destination && waypoints.length === 0) return 0;
  if (!origin || !destination) return null;
  return waypoints.length + 2;
}

function normalizedRouteSchedule(booking) {
  const stopCount = routeStopCount(booking.breakdown);
  if (stopCount === null) return null;
  const result = normalizeMoodRouteSchedule(booking.routeSchedule, stopCount, String(booking.startTime || ''));
  return result.ok && result.provided ? result.value : null;
}

function defaultCourseMoodPercentages(stopCount) {
  return Array.from({ length: stopCount }, (_, index) => index === 0 ? 100 : 0);
}

function legacyPayersForPercentages(percentages) {
  if (!percentages.every((percentage) => percentage === 0 || percentage === 100)) return null;
  return percentages.map((percentage) => percentage === 100 ? 'mood' : 'influencer');
}

function normalizedCourseShare(booking) {
  const activeBreakdown = booking.status === 'completed' && booking.finalBreakdown
    ? booking.finalBreakdown
    : booking.breakdown;
  const stopCount = routeStopCount(activeBreakdown);
  if (stopCount === null) return { ok: false };

  const hasCanonicalField = hasOwn(booking, 'courseMoodPercentages') || hasOwn(booking, 'courseShareSchemaVersion');
  if (hasCanonicalField) {
    const percentages = booking.courseMoodPercentages;
    if (
      booking.courseShareSchemaVersion !== COURSE_SHARE_SCHEMA_VERSION
      || !Array.isArray(percentages)
      || percentages.length !== stopCount
      || percentages.some((percentage) => !Number.isInteger(percentage) || percentage < 0 || percentage > 100)
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      percentages: percentages.slice(),
      payers: legacyPayersForPercentages(percentages),
      schemaVersion: COURSE_SHARE_SCHEMA_VERSION,
    };
  }

  if (hasOwn(booking, 'coursePayers') && booking.coursePayers !== null) {
    const payers = booking.coursePayers;
    if (
      !Array.isArray(payers)
      || payers.length !== stopCount
      || payers.some((payer) => payer !== 'mood' && payer !== 'influencer')
    ) {
      return { ok: true, percentages: null, payers: null, schemaVersion: null };
    }
    return {
      ok: true,
      percentages: payers.map((payer) => payer === 'mood' ? 100 : 0),
      payers: payers.slice(),
      schemaVersion: COURSE_SHARE_SCHEMA_VERSION,
    };
  }

  const percentages = defaultCourseMoodPercentages(stopCount);
  return {
    ok: true,
    percentages,
    payers: legacyPayersForPercentages(percentages),
    schemaVersion: COURSE_SHARE_SCHEMA_VERSION,
  };
}

function invalidBookingMoney(errorCode) {
  const error = new Error(errorCode);
  error.code = errorCode;
  throw error;
}

function validateOptionalMoney(value, { minimum = null, errorCode = 'INVALID_BOOKING_MONEY' } = {}) {
  if (value === undefined || value === null) return;
  if (!Number.isSafeInteger(value) || (minimum !== null && value < minimum)) {
    invalidBookingMoney(errorCode);
  }
}

function validateBreakdownMoney(value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object' || Array.isArray(value)) invalidBookingMoney('INVALID_BOOKING_MONEY');

  ['baseKRW', 'distanceSurchargeKRW', 'tollKRW', 'estimatedTollKRW'].forEach((field) => {
    validateOptionalMoney(value[field], { minimum: 0 });
  });
  ['otherAdjustmentKRW', 'manualAdjustmentKRW'].forEach((field) => {
    validateOptionalMoney(value[field]);
  });
  ['km', 'routeKm', 'airportDetourKm', 'durationMin', 'actualTotalKm', 'excludedKm'].forEach((field) => {
    const numericValue = value[field];
    if (
      numericValue !== undefined
      && numericValue !== null
      && (typeof numericValue !== 'number' || !Number.isFinite(numericValue) || numericValue < 0)
    ) {
      invalidBookingMoney('INVALID_BOOKING_MONEY');
    }
  });
}

function validateTollEntries(value) {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) invalidBookingMoney('INVALID_BOOKING_MONEY');
  let includedTotal = 0;
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object') invalidBookingMoney('INVALID_BOOKING_MONEY');
    validateOptionalMoney(entry.amountKRW, { minimum: 0 });
    if (
      typeof entry.label !== 'string'
      || !entry.label.trim()
      || (entry.status !== 'pending' && entry.status !== 'confirmed')
      || typeof entry.includedInSettlement !== 'boolean'
    ) {
      invalidBookingMoney('INVALID_BOOKING_MONEY');
    }
    if (entry.includedInSettlement) includedTotal += entry.amountKRW;
  });
  if (!Number.isSafeInteger(includedTotal) || includedTotal > 1000000) invalidBookingMoney('INVALID_BOOKING_MONEY');
}

function normalizedSettlementApproval(booking) {
  const value = booking.settlementApproval;
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  if (!['awaiting_mood', 'changes_requested', 'approved', 'withdrawn'].includes(value.status)) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  if (value.mode !== 'initial' && value.mode !== 'correction') invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  if (typeof value.proposalId !== 'string' || value.proposalId.length < 8 || value.proposalId.length > 200) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  if (!Number.isInteger(value.version) || value.version <= 0 || value.version !== booking.settlementProposalVersion) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  if (
    !Number.isSafeInteger(value.bookedAmountKRW)
    || value.bookedAmountKRW < 0
    || value.bookedAmountKRW !== booking.amountKRW
    || !Number.isSafeInteger(value.finalAmountKRW)
    || value.finalAmountKRW < 0
    || !Number.isSafeInteger(value.deltaKRW)
    || !Number.isSafeInteger(value.proposedBalanceKRW)
    || !Number.isSafeInteger(value.proposedResultingBalanceKRW)
  ) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  if (value.mode === 'initial' && value.previousFinalAmountKRW !== null) invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  if (value.mode === 'correction' && (!Number.isSafeInteger(value.previousFinalAmountKRW) || value.previousFinalAmountKRW < 0)) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  const comparisonAmount = value.mode === 'initial' ? value.bookedAmountKRW : value.previousFinalAmountKRW;
  if (!Number.isSafeInteger(comparisonAmount) || value.finalAmountKRW - comparisonAmount !== value.deltaKRW) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  if (
    typeof value.actualHours !== 'number'
    || !Number.isFinite(value.actualHours)
    || value.actualHours <= 0
  ) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  if (!value.finalBreakdown || typeof value.finalBreakdown !== 'object' || Array.isArray(value.finalBreakdown)) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  validateBreakdownMoney(value.finalBreakdown);
  if (!['estimated', 'none', 'actual', 'itemized'].includes(value.tollMode)) invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  if (value.tollMode === 'itemized') {
    if (!Array.isArray(value.tollEntries)) invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
    validateTollEntries(value.tollEntries);
  }
  else if (value.tollEntries !== null) invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  if (!Number.isInteger(value.pendingIncludedTollCount) || value.pendingIncludedTollCount < 0) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  const actualPendingCount = Array.isArray(value.tollEntries)
    ? value.tollEntries.filter((entry) => entry.includedInSettlement && entry.status === 'pending').length
    : 0;
  if (actualPendingCount !== value.pendingIncludedTollCount) invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  if (
    typeof value.proposedByEmail !== 'string'
    || !value.proposedByEmail.trim()
    || !Number.isSafeInteger(value.proposedAt)
    || value.proposedAt < 0
  ) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  if (value.status === 'approved' && (
    typeof value.approvedByEmail !== 'string'
    || !value.approvedByEmail.trim()
    || !Number.isSafeInteger(value.approvedAt)
    || value.approvedAt < 0
  )) {
    invalidBookingMoney('INVALID_SETTLEMENT_APPROVAL');
  }
  return {
    status: value.status,
    mode: value.mode,
    proposalId: value.proposalId,
    version: value.version,
    bookedAmountKRW: value.bookedAmountKRW,
    previousFinalAmountKRW: value.previousFinalAmountKRW,
    finalAmountKRW: value.finalAmountKRW,
    deltaKRW: value.deltaKRW,
    actualHours: value.actualHours,
    finalBreakdown: value.finalBreakdown,
    tollMode: value.tollMode,
    tollEntries: value.tollEntries,
    settlementReason: typeof value.settlementReason === 'string' && value.settlementReason ? value.settlementReason : null,
    proposedBalanceKRW: value.proposedBalanceKRW,
    proposedResultingBalanceKRW: value.proposedResultingBalanceKRW,
    pendingIncludedTollCount: value.pendingIncludedTollCount,
    proposedByEmail: value.proposedByEmail,
    proposedAt: value.proposedAt,
    changeRequestReason: typeof value.changeRequestReason === 'string' && value.changeRequestReason ? value.changeRequestReason : null,
    approvedByEmail: typeof value.approvedByEmail === 'string' && value.approvedByEmail ? value.approvedByEmail : null,
    approvedAt: Number.isSafeInteger(value.approvedAt) ? value.approvedAt : null,
  };
}

function validateBookingMoney(booking) {
  validateOptionalMoney(booking.ratePerHour, { minimum: 0 });
  validateOptionalMoney(booking.balanceAfterKRW);
  validateOptionalMoney(booking.finalAmountKRW, { minimum: 0 });
  validateOptionalMoney(booking.adjustmentKRW);
  validateOptionalMoney(booking.manualAdjustmentKRW);
  validateOptionalMoney(booking.estimatedTollKRW, { minimum: 0 });
  validateBreakdownMoney(booking.breakdown);
  validateBreakdownMoney(booking.finalBreakdown);
  validateTollEntries(booking.tollEntries);
}

export default async function handler(req, res) {
  const JSON_HEADERS = { 'Cache-Control': 'no-store', ...buildAdminJsonCors(req, { methods: CORS_METHODS, headers: 'Authorization, Content-Type' }) };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_HEADERS);
    return res.end();
  }
  if (req.method !== 'GET') {
    res.writeHead(405, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'GET only' }));
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) {
    res.writeHead(auth.status, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }
  if (!auth.emailVerified) {
    res.writeHead(403, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: 'EMAIL_NOT_VERIFIED' }));
  }
  const email = auth.email;

  try {
    const db = initAdminDb('mood-data');
    if (!db) {
      res.writeHead(500, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'Firestore unavailable' }));
    }

    const allowlist = await getMoodAllowlist(db);
    if (!isAllowedEmail(allowlist, email)) {
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '접근 권한 없음' }));
    }
    const admin = isAdminEmail(allowlist, email);
    const canApproveSettlement = isSettlementApproverEmail(allowlist, email);

    const url = new URL(req.url, `https://${req.headers.host}`);
    const queryClientId = (url.searchParams.get('clientId') || '').trim();

    // 광고사 직원: allowlist.clientId (자기 회사) 로 강제. admin: query 우선.
    let clientId = allowlist.clientId;
    if (admin && queryClientId) {
      clientId = queryClientId;
    } else if (!admin && queryClientId && queryClientId !== allowlist.clientId) {
      // 비-admin 이 다른 회사 clientId 를 보려 하면 거부 (IDOR 방지).
      res.writeHead(403, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: '본인 회사 데이터만 조회 가능' }));
    }

    if (!clientId) {
      res.writeHead(400, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'clientId 미지정 (mood_config/allowlist.clientId 설정 필요)' }));
    }

    const clientSnap = await db.collection('mood_clients').doc(clientId).get();
    if (!clientSnap.exists) {
      res.writeHead(404, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: `CLIENT_NOT_FOUND: ${clientId}` }));
    }
    const clientData = clientSnap.data() || {};
    const currentBalanceKRW = clientData.balanceKRW;
    if (!Number.isSafeInteger(currentBalanceKRW)) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: 'INVALID_CLIENT_BALANCE' }));
    }

    // 캘린더 + 차감 리스트용 예약 목록 — 해당 client, 최근순.
    // ⚠️ where(clientId ==) + orderBy(createdAt) 는 복합 인덱스 필요(자동 인덱스 X).
    //    firestore.indexes.json: mood_bookings (clientId ASC, createdAt DESC).
    const bookingsSnap = await db.collection('mood_bookings')
      .where('clientId', '==', clientId)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    // running 잔액(예약 직후 잔액):
    //   - 예약 doc 에 balanceAfterKRW 가 저장돼 있으면(신규 예약) 그대로 사용 = 정확.
    //   - 없으면(레거시) null. 충전(topup) 이력은 이 컬렉션에 없어 역산에 반영 못 하므로
    //     amountKRW 만으로 거슬러 올라가면 충전액만큼 틀어진다 → 틀린 숫자 대신 null
    //     (프론트가 '잔액' 줄을 숨김 = 빈칸). 정확값 필요하면 백필로 balanceAfterKRW 채울 것.
    const bookings = bookingsSnap.docs.map((d) => {
      const b = d.data() || {};
      const amount = b.amountKRW;
      if (!Number.isSafeInteger(amount) || amount < 0) {
        invalidBookingMoney('INVALID_BOOKING_AMOUNT');
      }
      validateBookingMoney(b);
      const settlementApproval = normalizedSettlementApproval(b);
      const courseShare = normalizedCourseShare(b);
      if (!courseShare.ok) invalidBookingMoney('INVALID_COURSE_SHARE');
      const runningBalanceKRW = typeof b.balanceAfterKRW === 'number' ? b.balanceAfterKRW : null;
      return {
        id: d.id,
        date: b.date,
        startTime: b.startTime,
        durationHours: b.durationHours,
        serviceType: b.serviceType,
        // 공항 예약 메타 — 정액 단가 근거(ICN 110,000 / GMP 80,000)와 픽업/샌딩 방향.
        // 레거시 예약엔 없음 → null (프론트가 기본 인천으로 표시).
        airportCode: b.airportCode === 'ICN' || b.airportCode === 'GMP' ? b.airportCode : null,
        airportDirection: b.airportDirection === 'pickup' || b.airportDirection === 'sending' ? b.airportDirection : null,
        amountKRW: amount,
        ratePerHour: typeof b.ratePerHour === 'number' ? b.ratePerHour : null, // 영수증 산식 표기용 (2026-07-04)
        breakdown: b.breakdown || null, // { baseKRW, distanceSurchargeKRW, tollKRW, km, origin, destination, waypoints }
        routeSchedule: normalizedRouteSchedule(b),
        finalBreakdown: b.finalBreakdown || null,
        // 저장형 path = [{lng,lat}] (Firestore 는 중첩 배열 불가) → 공개 계약 [[lng,lat],...]
        // 으로 되돌린다. 프론트 지도/공유 카드 계약 불변. (api/_shared/mood-route-snapshot.js)
        routeSnapshot: decodeRouteSnapshot(b.routeSnapshot),
        finalRouteSnapshot: decodeRouteSnapshot(b.finalRouteSnapshot),
        revision: Number.isInteger(b.revision) && b.revision >= 0 ? b.revision : 0,
        influencerName: typeof b.influencerName === 'string' && b.influencerName ? b.influencerName : null,
        courseMoodPercentages: courseShare.percentages,
        courseShareSchemaVersion: courseShare.schemaVersion,
        coursePayers: courseShare.payers,
        runningBalanceKRW,               // 이 예약 직후 잔액 (외상 = 음수 가능)
        status: b.status,
        // 운행 종료 정산(completed) — 실제시간·최종금액·조정액 (mood-settle.js)
        actualHours: typeof b.actualHours === 'number' ? b.actualHours : null,
        finalAmountKRW: typeof b.finalAmountKRW === 'number' ? b.finalAmountKRW : null,
        adjustmentKRW: typeof b.adjustmentKRW === 'number' ? b.adjustmentKRW : null,
        manualAdjustmentKRW: typeof b.manualAdjustmentKRW === 'number' ? b.manualAdjustmentKRW : null,
        settlementReason: typeof b.settlementReason === 'string' && b.settlementReason ? b.settlementReason : null,
        tollMode: typeof b.tollMode === 'string' ? b.tollMode : null,
        tollEntries: Array.isArray(b.tollEntries) ? b.tollEntries : null,
        correctionCount: Number.isInteger(b.correctionCount) && b.correctionCount >= 0 ? b.correctionCount : 0,
        lastCorrectionReason: typeof b.lastCorrectionReason === 'string' && b.lastCorrectionReason ? b.lastCorrectionReason : null,
        settlementApproval,
        note: typeof b.note === 'string' && b.note ? b.note : null, // 예약 메모 (항공편 등, 2026-07-05)
        createdByEmail: b.createdByEmail,
        createdAt: b.createdAt,
      };
    });

    res.writeHead(200, JSON_HEADERS);
    return res.end(JSON.stringify({
      ok: true,
      data: {
        clientId,
        client: { name: clientData.name || clientId, balanceKRW: currentBalanceKRW },
        bookings,
        isAdmin: admin,
        canApproveSettlement,
      },
    }));
  } catch (err) {
    if (err && (
      err.code === 'INVALID_BOOKING_AMOUNT'
      || err.code === 'INVALID_BOOKING_MONEY'
      || err.code === 'INVALID_COURSE_SHARE'
      || err.code === 'INVALID_SETTLEMENT_APPROVAL'
    )) {
      res.writeHead(409, JSON_HEADERS);
      return res.end(JSON.stringify({ ok: false, error: err.code }));
    }
    console.error('[mood-data] failed:', err.message);
    await captureError(err, { route: '/api/mood-data', email });
    res.writeHead(500, JSON_HEADERS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
