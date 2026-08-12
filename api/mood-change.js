/**
 * POST /api/mood-change
 *
 * 확정된 MOOD 예약의 전체 스냅샷을 교체하고, 서버에서 현재 요율과 실제 경로를
 * 다시 계산한다. 예약과 고객 잔액, 감사 이벤트, 알림 outbox, 멱등성 응답은 한
 * Firestore 트랜잭션에서 함께 기록한다.
 * booking.courseMoodPercentages 는 출발·경유·도착 수와 같은 0~100 정수 배열이며,
 * 구 쓰기 필드 booking.coursePayers 는 400으로 거부한다.
 */
import { createHash } from 'node:crypto';
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAllowedEmail, isAdminEmail } from './_shared/mood-allowlist.js';
import {
  computeMoodTotalKRW,
  isValidServiceType,
  normalizeAirportCode,
  MOOD_MAX_DURATION_HOURS,
} from './_shared/mood-pricing.js';
import { computeRoute } from './_shared/mood-route.js';
import { notify } from './_shared/notify.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';
const COURSE_SHARE_SCHEMA_VERSION = 2;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const REQUIRED_SNAPSHOT_FIELDS = [
  'date',
  'startTime',
  'durationHours',
  'serviceType',
  'origin',
  'destination',
  'waypoints',
  'note',
  'airportDirection',
  'airportCode',
];

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function legacyPayersForPercentages(percentages) {
  if (!percentages.every((percentage) => percentage === 0 || percentage === 100)) return null;
  return percentages.map((percentage) => percentage === 100 ? 'mood' : 'influencer');
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

function normalizeStoredCourseShare(booking) {
  const stopCount = routeStopCount(booking.breakdown);
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
    return { ok: true, percentages: percentages.slice(), payers: legacyPayersForPercentages(percentages) };
  }
  if (hasOwn(booking, 'coursePayers') && booking.coursePayers !== null) {
    const payers = booking.coursePayers;
    if (
      !Array.isArray(payers)
      || payers.length !== stopCount
      || payers.some((payer) => payer !== 'mood' && payer !== 'influencer')
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      percentages: payers.map((payer) => payer === 'mood' ? 100 : 0),
      payers: payers.slice(),
    };
  }
  const percentages = Array.from({ length: stopCount }, (_, index) => index === 0 ? 100 : 0);
  return { ok: true, percentages, payers: legacyPayersForPercentages(percentages) };
}

function sendJson(res, status, headers, payload) {
  res.writeHead(status, headers);
  return res.end(JSON.stringify(payload));
}

function parseBody(req) {
  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

function validCalendarDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validateId(value, maxLength) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= maxLength
    && !value.includes('/');
}

function normalizeSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'FULL_SNAPSHOT_REQUIRED' };
  }
  if (REQUIRED_SNAPSHOT_FIELDS.some((field) => !hasOwn(raw, field))) {
    return { ok: false, error: 'FULL_SNAPSHOT_REQUIRED' };
  }

  if (
    (raw.origin !== null && typeof raw.origin !== 'string')
    || (raw.destination !== null && typeof raw.destination !== 'string')
    || (raw.note !== null && typeof raw.note !== 'string')
  ) {
    return { ok: false, error: 'INVALID_SNAPSHOT_FIELD' };
  }

  const date = String(raw.date || '').trim();
  const startTime = String(raw.startTime || '').trim();
  const serviceType = String(raw.serviceType || '').trim();
  const durationHours = Number(raw.durationHours);
  const origin = String(raw.origin || '').trim();
  const destination = String(raw.destination || '').trim();
  const note = raw.note === null ? '' : String(raw.note || '').trim();

  if (!validCalendarDate(date)) return { ok: false, error: 'INVALID_DATE' };
  if (!TIME_RE.test(startTime)) return { ok: false, error: 'INVALID_START_TIME' };
  if (!isValidServiceType(serviceType)) return { ok: false, error: 'INVALID_SERVICE_TYPE' };
  if (origin.length > 300 || destination.length > 300) {
    return { ok: false, error: 'ADDRESS_TOO_LONG' };
  }
  if ((origin && !destination) || (!origin && destination)) {
    return { ok: false, error: 'ROUTE_ENDPOINTS_REQUIRED' };
  }
  if (!Array.isArray(raw.waypoints)) {
    return { ok: false, error: 'INVALID_WAYPOINTS' };
  }
  if (raw.waypoints.some((value) => typeof value !== 'string')) {
    return { ok: false, error: 'INVALID_WAYPOINTS' };
  }
  const waypoints = raw.waypoints.map((value) => String(value || '').trim()).filter(Boolean);
  if (waypoints.length > 5) {
    return { ok: false, error: 'WAYPOINT_LIMIT_EXCEEDED' };
  }
  if (waypoints.some((value) => value.length > 300)) {
    return { ok: false, error: 'ADDRESS_TOO_LONG' };
  }
  if (waypoints.length && (!origin || !destination)) {
    return { ok: false, error: 'ROUTE_ENDPOINTS_REQUIRED' };
  }
  if (note.length > 500) return { ok: false, error: 'NOTE_TOO_LONG' };

  let airportDirection = null;
  let airportCode = null;
  if (serviceType === 'airport') {
    if (raw.airportDirection !== 'pickup' && raw.airportDirection !== 'sending') {
      return { ok: false, error: 'INVALID_AIRPORT_DIRECTION' };
    }
    const requestedAirportCode = String(raw.airportCode || '').trim().toUpperCase();
    if (requestedAirportCode !== 'ICN' && requestedAirportCode !== 'GMP') {
      return { ok: false, error: 'INVALID_AIRPORT_CODE' };
    }
    airportDirection = raw.airportDirection;
    airportCode = normalizeAirportCode(requestedAirportCode);
    if (durationHours !== 0) return { ok: false, error: 'INVALID_DURATION' };
  } else if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > MOOD_MAX_DURATION_HOURS) {
    return { ok: false, error: 'INVALID_DURATION' };
  }

  let influencerName;
  if (hasOwn(raw, 'influencerName')) {
    if (raw.influencerName !== null && typeof raw.influencerName !== 'string') {
      return { ok: false, error: 'INVALID_INFLUENCER_NAME' };
    }
    influencerName = raw.influencerName === null ? '' : String(raw.influencerName || '').trim();
    if (influencerName.length > 120) return { ok: false, error: 'INFLUENCER_NAME_TOO_LONG' };
  }
  const stopCount = origin && destination ? waypoints.length + 2 : 0;
  if (hasOwn(raw, 'coursePayers')) {
    return { ok: false, error: 'INVALID_COURSE_MOOD_PERCENTAGES' };
  }
  if (
    hasOwn(raw, 'courseShareSchemaVersion')
    && raw.courseShareSchemaVersion !== COURSE_SHARE_SCHEMA_VERSION
  ) {
    return { ok: false, error: 'INVALID_COURSE_SHARE_SCHEMA_VERSION' };
  }
  let courseMoodPercentages;
  if (hasOwn(raw, 'courseMoodPercentages')) {
    if (
      !Array.isArray(raw.courseMoodPercentages)
      || raw.courseMoodPercentages.length !== stopCount
      || raw.courseMoodPercentages.some((percentage) => !Number.isInteger(percentage) || percentage < 0 || percentage > 100)
    ) {
      return { ok: false, error: 'INVALID_COURSE_MOOD_PERCENTAGES' };
    }
    courseMoodPercentages = raw.courseMoodPercentages.slice();
  } else {
    courseMoodPercentages = Array.from({ length: stopCount }, (_, index) => index === 0 ? 100 : 0);
  }
  const coursePayers = legacyPayersForPercentages(courseMoodPercentages);

  return {
    ok: true,
    value: {
      date,
      startTime,
      durationHours,
      serviceType,
      origin,
      destination,
      waypoints,
      note,
      airportDirection,
      airportCode,
      hasInfluencerName: hasOwn(raw, 'influencerName'),
      influencerName,
      courseMoodPercentages,
      courseShareSchemaVersion: COURSE_SHARE_SCHEMA_VERSION,
      coursePayers,
    },
  };
}

function revisionOf(booking) {
  const value = Number(booking && booking.revision);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function stablePayload({ bookingId, expectedRevision, reason, snapshot }) {
  return JSON.stringify({
    bookingId,
    expectedRevision,
    reason,
    booking: {
      date: snapshot.date,
      startTime: snapshot.startTime,
      durationHours: snapshot.durationHours,
      serviceType: snapshot.serviceType,
      origin: snapshot.origin,
      destination: snapshot.destination,
      waypoints: snapshot.waypoints,
      note: snapshot.note,
      airportDirection: snapshot.airportDirection,
      airportCode: snapshot.airportCode,
      hasInfluencerName: snapshot.hasInfluencerName,
      influencerName: snapshot.hasInfluencerName ? snapshot.influencerName : null,
      courseMoodPercentages: snapshot.courseMoodPercentages,
      courseShareSchemaVersion: snapshot.courseShareSchemaVersion,
    },
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compactPath(path, limit = 600) {
  if (!Array.isArray(path) || path.length <= limit) return Array.isArray(path) ? path : [];
  const step = (path.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => path[Math.round(index * step)]);
}

function routeFailure(route) {
  return {
    ok: false,
    error: 'ROUTE_CALCULATION_FAILED',
    routeError: route && route.error ? route.error : 'DIRECTIONS_FAILED',
  };
}

function isValidComputedRoute(route) {
  return Boolean(
    route
    && route.ok
    && Number.isFinite(Number(route.km))
    && Number(route.km) >= 0
    && Number.isFinite(Number(route.tollKRW))
    && Number(route.tollKRW) >= 0
    && Number.isFinite(Number(route.durationMin))
    && Number(route.durationMin) >= 0,
  );
}

async function priceSnapshot(snapshot) {
  const hasRoute = Boolean(snapshot.origin && snapshot.destination);
  let route = null;
  let directRoute = null;
  let km = 0;
  let tollKRW = 0;
  let airportDetourKm = 0;

  if (hasRoute) {
    try {
      if (snapshot.serviceType === 'airport' && snapshot.waypoints.length) {
        [route, directRoute] = await Promise.all([
          computeRoute({
            origin: snapshot.origin,
            destination: snapshot.destination,
            waypoints: snapshot.waypoints,
          }),
          computeRoute({ origin: snapshot.origin, destination: snapshot.destination }),
        ]);
        if (!isValidComputedRoute(route)) return routeFailure(route);
        if (!isValidComputedRoute(directRoute)) return routeFailure(directRoute);
        airportDetourKm = Math.max(0, Number(route.km) - Number(directRoute.km));
      } else {
        route = await computeRoute({
          origin: snapshot.origin,
          destination: snapshot.destination,
          waypoints: snapshot.waypoints,
        });
        if (!isValidComputedRoute(route)) return routeFailure(route);
      }
    } catch (error) {
      return routeFailure({ error: error && error.message ? error.message : 'DIRECTIONS_FAILED' });
    }

    if (snapshot.serviceType !== 'airport') {
      km = Number(route.km) || 0;
      tollKRW = Number(route.tollKRW) || 0;
    }
  }

  const priced = computeMoodTotalKRW({
    serviceType: snapshot.serviceType,
    durationHours: snapshot.durationHours,
    km,
    tollKRW,
    airportDetourKm,
    airportCode: snapshot.airportCode,
  });
  if (!priced.ok) return { ok: false, error: priced.error || 'PRICING_FAILED' };
  if (
    ![
      priced.amountKRW,
      priced.baseKRW,
      priced.ratePerHour,
      priced.distanceSurchargeKRW,
      priced.tollKRW,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
    || typeof priced.km !== 'number'
    || !Number.isFinite(priced.km)
    || priced.km < 0
  ) {
    return { ok: false, error: 'INVALID_PRICING_RESULT' };
  }

  const routeKm = route && route.ok ? Math.max(0, Number(route.km) || 0) : 0;
  const durationMin = route && route.ok ? Math.max(0, Number(route.durationMin) || 0) : 0;
  const routeSnapshot = route && route.ok ? {
    km: routeKm,
    tollKRW: Math.max(0, Number(route.tollKRW) || 0),
    durationMin,
    path: compactPath(route.path),
    points: Array.isArray(route.points) ? route.points : [],
    calculatedAt: Date.now(),
  } : null;
  return {
    ok: true,
    amountKRW: priced.amountKRW,
    ratePerHour: priced.ratePerHour,
    routeSnapshot,
    breakdown: {
      baseKRW: priced.baseKRW,
      distanceSurchargeKRW: priced.distanceSurchargeKRW,
      tollKRW: priced.tollKRW,
      km: snapshot.serviceType === 'airport' ? routeKm : priced.km,
      durationMin,
      airportDetourKm: snapshot.serviceType === 'airport' ? airportDetourKm : 0,
      origin: snapshot.origin || null,
      destination: snapshot.destination || null,
      waypoints: snapshot.waypoints.length ? snapshot.waypoints : null,
    },
  };
}

function idorAllowed(isAdmin, allowlist, booking) {
  return isAdmin || booking.clientId === allowlist.clientId;
}

async function replayStoredResponse({ db, bookingRef, idempotencyRef, allowlist, isAdmin, payloadHash }) {
  return db.runTransaction(async (tx) => {
    const [idempotencySnap, bookingSnap] = await Promise.all([
      tx.get(idempotencyRef),
      tx.get(bookingRef),
    ]);
    if (!idempotencySnap.exists) return { ok: false, missing: true };
    const idempotency = idempotencySnap.data() || {};
    if (idempotency.payloadHash !== payloadHash) {
      return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
    }
    if (!bookingSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
    const booking = bookingSnap.data() || {};
    if (!idorAllowed(isAdmin, allowlist, booking)) {
      return { ok: false, status: 403, error: 'BOOKING_ACCESS_DENIED' };
    }
    const bookingClientId = String(booking.clientId || '').trim();
    if (!bookingClientId) return { ok: false, status: 500, error: 'INVALID_BOOKING_OWNER' };
    const clientRef = db.collection('mood_clients').doc(bookingClientId);
    const clientSnap = await tx.get(clientRef);
    if (!clientSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
    if (!idempotency.response || typeof idempotency.response !== 'object') {
      return { ok: false, status: 409, error: 'IDEMPOTENCY_RESPONSE_MISSING' };
    }
    return { ok: true, response: idempotency.response };
  });
}

export default async function handler(req, res) {
  const jsonHeaders = {
    'Cache-Control': 'no-store',
    ...buildAdminJsonCors(req, {
      methods: CORS_METHODS,
      headers: 'Authorization, Content-Type',
    }),
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(200, jsonHeaders);
    return res.end();
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, jsonHeaders, { ok: false, error: 'POST_ONLY' });
  }

  const auth = await verifyUserToken(req);
  if (!auth.ok) return sendJson(res, auth.status, jsonHeaders, { ok: false, error: auth.error });
  if (!auth.emailVerified) {
    return sendJson(res, 403, jsonHeaders, { ok: false, error: 'EMAIL_NOT_VERIFIED' });
  }
  const email = auth.email;
  const body = parseBody(req);
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId.trim() : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const expectedRevision = body.expectedRevision;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!validateId(bookingId, 128)) {
    return sendJson(res, 400, jsonHeaders, { ok: false, error: 'INVALID_BOOKING_ID' });
  }
  if (!validateId(idempotencyKey, 200)) {
    return sendJson(res, 400, jsonHeaders, { ok: false, error: 'INVALID_IDEMPOTENCY_KEY' });
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return sendJson(res, 400, jsonHeaders, { ok: false, error: 'INVALID_EXPECTED_REVISION' });
  }
  if (!reason || reason.length > 500) {
    return sendJson(res, 400, jsonHeaders, { ok: false, error: 'CHANGE_REASON_REQUIRED' });
  }
  const normalized = normalizeSnapshot(body.booking);
  if (!normalized.ok) {
    return sendJson(res, 400, jsonHeaders, { ok: false, error: normalized.error });
  }
  const snapshot = normalized.value;
  const payloadHash = sha256(stablePayload({ bookingId, expectedRevision, reason, snapshot }));
  const idempotencyDocumentId = sha256(`${email}:${idempotencyKey}`);

  try {
    const db = initAdminDb('mood-change');
    if (!db) {
      return sendJson(res, 500, jsonHeaders, { ok: false, error: 'FIRESTORE_UNAVAILABLE' });
    }

    const allowlist = await getMoodAllowlist(db);
    if (!isAllowedEmail(allowlist, email)) {
      return sendJson(res, 403, jsonHeaders, { ok: false, error: 'ACCESS_DENIED' });
    }
    const isAdmin = isAdminEmail(allowlist, email);
    const bookingRef = db.collection('mood_bookings').doc(bookingId);
    const idempotencyRef = db.collection('mood_booking_change_idempotency').doc(idempotencyDocumentId);
    const auditRef = db.collection('mood_booking_change_events').doc(idempotencyDocumentId);
    const outboxRef = db.collection('mood_notification_outbox').doc(idempotencyDocumentId);

    const [preBookingSnap, preIdempotencySnap] = await Promise.all([
      bookingRef.get(),
      idempotencyRef.get(),
    ]);
    if (!preBookingSnap.exists) {
      return sendJson(res, 404, jsonHeaders, { ok: false, error: 'BOOKING_NOT_FOUND' });
    }
    const preBooking = preBookingSnap.data() || {};
    if (!idorAllowed(isAdmin, allowlist, preBooking)) {
      return sendJson(res, 403, jsonHeaders, { ok: false, error: 'BOOKING_ACCESS_DENIED' });
    }

    if (preIdempotencySnap.exists) {
      const replay = await replayStoredResponse({
        db,
        bookingRef,
        idempotencyRef,
        allowlist,
        isAdmin,
        payloadHash,
      });
      if (replay.ok) return sendJson(res, 200, jsonHeaders, replay.response);
      return sendJson(res, replay.status || 409, jsonHeaders, { ok: false, error: replay.error || 'IDEMPOTENCY_CONFLICT' });
    }

    if (preBooking.status !== 'confirmed') {
      return sendJson(res, 409, jsonHeaders, { ok: false, error: 'BOOKING_NOT_CHANGEABLE' });
    }
    if (revisionOf(preBooking) !== expectedRevision) {
      return sendJson(res, 409, jsonHeaders, {
        ok: false,
        error: 'REVISION_CONFLICT',
        currentRevision: revisionOf(preBooking),
      });
    }

    const priced = await priceSnapshot(snapshot);
    if (!priced.ok) {
      const status = priced.error === 'ROUTE_CALCULATION_FAILED' ? 422 : 400;
      return sendJson(res, status, jsonHeaders, {
        ok: false,
        error: priced.error,
        ...(priced.routeError ? { routeError: priced.routeError } : {}),
      });
    }

    const now = Date.now();
    const transactionResult = await db.runTransaction(async (tx) => {
      const [idempotencySnap, bookingSnap] = await Promise.all([
        tx.get(idempotencyRef),
        tx.get(bookingRef),
      ]);
      if (!bookingSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
      const booking = bookingSnap.data() || {};
      if (!idorAllowed(isAdmin, allowlist, booking)) {
        return { ok: false, status: 403, error: 'BOOKING_ACCESS_DENIED' };
      }

      const bookingClientId = String(booking.clientId || '').trim();
      if (!bookingClientId) return { ok: false, status: 500, error: 'INVALID_BOOKING_OWNER' };
      const clientRef = db.collection('mood_clients').doc(bookingClientId);
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };

      if (idempotencySnap.exists) {
        const stored = idempotencySnap.data() || {};
        if (stored.payloadHash !== payloadHash) {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
        }
        if (!stored.response || typeof stored.response !== 'object') {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_RESPONSE_MISSING' };
        }
        return { ok: true, replayed: true, response: stored.response };
      }
      if (booking.status !== 'confirmed') {
        return { ok: false, status: 409, error: 'BOOKING_NOT_CHANGEABLE' };
      }
      const currentRevision = revisionOf(booking);
      if (currentRevision !== expectedRevision) {
        return {
          ok: false,
          status: 409,
          error: 'REVISION_CONFLICT',
          currentRevision,
        };
      }

      const storedCourseShare = normalizeStoredCourseShare(booking);
      if (!storedCourseShare.ok) {
        return { ok: false, status: 409, error: 'INVALID_STORED_COURSE_SHARE' };
      }

      const oldAmountKRW = booking.amountKRW;
      const client = clientSnap.data() || {};
      const balanceKRW = client.balanceKRW;
      if (
        !Number.isSafeInteger(oldAmountKRW)
        || oldAmountKRW < 0
        || !Number.isSafeInteger(balanceKRW)
      ) {
        return { ok: false, status: 500, error: 'INVALID_STORED_MONEY' };
      }
      const adjustmentKRW = priced.amountKRW - oldAmountKRW;
      const newBalanceKRW = balanceKRW - adjustmentKRW;
      if (!Number.isSafeInteger(adjustmentKRW) || !Number.isSafeInteger(newBalanceKRW)) {
        return { ok: false, status: 500, error: 'INVALID_CALCULATED_MONEY' };
      }
      const creditLimitKRW = client.creditLimitKRW;
      if (creditLimitKRW !== undefined && creditLimitKRW !== null) {
        if (!Number.isSafeInteger(creditLimitKRW) || creditLimitKRW <= 0) {
          return { ok: false, status: 409, error: 'INVALID_CREDIT_LIMIT' };
        }
        if (adjustmentKRW > 0 && newBalanceKRW < -creditLimitKRW) {
          return {
            ok: false,
            status: 409,
            error: 'CREDIT_LIMIT_EXCEEDED',
            creditLimitKRW,
            balanceKRW,
          };
        }
      }

      const nextRevision = currentRevision + 1;
      const bookingPatch = {
        date: snapshot.date,
        startTime: snapshot.startTime,
        durationHours: snapshot.durationHours,
        serviceType: snapshot.serviceType,
        airportDirection: snapshot.airportDirection,
        airportCode: snapshot.airportCode,
        note: snapshot.note || null,
        amountKRW: priced.amountKRW,
        ratePerHour: priced.ratePerHour,
        breakdown: priced.breakdown,
        routeSnapshot: priced.routeSnapshot,
        balanceAfterKRW: newBalanceKRW,
        revision: nextRevision,
        updatedAt: now,
        updatedByEmail: email,
        lastChangeReason: reason,
        lastAdjustmentKRW: adjustmentKRW,
        courseMoodPercentages: snapshot.courseMoodPercentages,
        courseShareSchemaVersion: snapshot.courseShareSchemaVersion,
        coursePayers: snapshot.coursePayers,
      };
      if (snapshot.hasInfluencerName) {
        bookingPatch.influencerName = snapshot.influencerName || null;
      }
      const beforeSnapshot = {
        ...booking,
        courseMoodPercentages: storedCourseShare.percentages,
        courseShareSchemaVersion: COURSE_SHARE_SCHEMA_VERSION,
        coursePayers: storedCourseShare.payers,
      };
      const afterSnapshot = { ...beforeSnapshot, ...bookingPatch };
      const response = {
        ok: true,
        data: {
          bookingId,
          revision: nextRevision,
          oldAmountKRW,
          amountKRW: priced.amountKRW,
          adjustmentKRW,
          balanceKRW: newBalanceKRW,
          breakdown: priced.breakdown,
          booking: { id: bookingId, ...afterSnapshot },
        },
      };

      tx.update(clientRef, { balanceKRW: newBalanceKRW });
      tx.update(bookingRef, bookingPatch);
      tx.set(auditRef, {
        type: 'booking_changed',
        bookingId,
        clientId: booking.clientId,
        actorEmail: email,
        reason,
        expectedRevision,
        revision: nextRevision,
        oldAmountKRW,
        newAmountKRW: priced.amountKRW,
        adjustmentKRW,
        balanceBeforeKRW: balanceKRW,
        balanceAfterKRW: newBalanceKRW,
        before: beforeSnapshot,
        after: afterSnapshot,
        createdAt: now,
      });
      tx.set(outboxRef, {
        type: 'mood_booking_changed',
        topic: 'booking',
        bookingId,
        clientId: booking.clientId,
        actorEmail: email,
        revision: nextRevision,
        reason,
        oldAmountKRW,
        newAmountKRW: priced.amountKRW,
        adjustmentKRW,
        status: 'pending',
        attemptCount: 0,
        createdAt: now,
      });
      tx.set(idempotencyRef, {
        bookingId,
        actorEmail: email,
        payloadHash,
        status: 'completed',
        response,
        createdAt: now,
        completedAt: now,
      });
      return { ok: true, replayed: false, response, notification: { booking, adjustmentKRW, newBalanceKRW } };
    });

    if (!transactionResult.ok) {
      return sendJson(res, transactionResult.status || 409, jsonHeaders, {
        ok: false,
        error: transactionResult.error || 'CHANGE_FAILED',
        ...(typeof transactionResult.currentRevision === 'number'
          ? { currentRevision: transactionResult.currentRevision }
          : {}),
      });
    }

    if (!transactionResult.replayed) {
      try {
        const oldAmount = transactionResult.response.data.oldAmountKRW.toLocaleString('ko-KR');
        const newAmount = transactionResult.response.data.amountKRW.toLocaleString('ko-KR');
        const balance = transactionResult.notification.newBalanceKRW.toLocaleString('ko-KR');
        await notify('booking', [
          '<b>MOOD 예약 변경</b>',
          `${snapshot.date} ${snapshot.startTime} | ${snapshot.serviceType}`,
          `${oldAmount}원 → ${newAmount}원 | 잔액 ${balance}원`,
          `사유: ${reason}`,
          `변경: ${email}`,
        ].join('\n'));
      } catch (notifyError) {
        console.warn('[mood-change] notify failed:', notifyError && notifyError.message ? notifyError.message : notifyError);
      }
    }

    return sendJson(res, 200, jsonHeaders, transactionResult.response);
  } catch (error) {
    console.error('[mood-change] failed:', error && error.message ? error.message : error);
    await captureError(error, { route: '/api/mood-change', email, bookingId });
    return sendJson(res, 500, jsonHeaders, { ok: false, error: 'SERVER_ERROR' });
  }
}
