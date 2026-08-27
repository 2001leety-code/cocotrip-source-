/**
 * POST /api/mood-change
 *
 * 확정된 MOOD 예약 변경을 처리한다. 금액 영향 변경은 서버가 먼저 15분짜리 미리보기를
 * 발급하고, 변경 운영자가 제안한 뒤 지정된 MOOD 승인자가 같은 내역을 확인해야 확정된다.
 * 금액 영향이 없는 변경은 현재 금액과 경로를 그대로 보존한다. 예약과 고객 잔액,
 * 감사 이벤트, 알림 outbox, 견적 소비, 멱등성 응답은 한 Firestore 트랜잭션에서 함께 기록한다.
 * booking.courseMoodPercentages 는 출발·경유·도착 수와 같은 0~100 정수 배열이며,
 * 구 쓰기 필드 booking.coursePayers 는 400으로 거부한다.
 */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import {
  getMoodAllowlist,
  isAllowedEmail,
  isAdminEmail,
  isSettlementApproverEmail,
} from './_shared/mood-allowlist.js';
import {
  computeMoodTotalKRW,
  isValidServiceType,
  normalizeAirportCode,
  MOOD_MAX_DURATION_HOURS,
} from './_shared/mood-pricing.js';
import { computeRoute } from './_shared/mood-route.js';
import { buildRouteSnapshot, decodeRouteSnapshot } from './_shared/mood-route-snapshot.js';
import { normalizeMoodRouteSchedule } from './_shared/mood-route-schedule.js';
import { notify } from './_shared/notify.js';
import {
  checkMoodBookingChangeAvailability,
  getMoodBookingAvailability,
  moodBookingAvailabilityFromSnapshot,
  moodBookingAvailabilityRef,
} from './_shared/mood-booking-availability.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS_METHODS = 'POST, OPTIONS';
const COURSE_SHARE_SCHEMA_VERSION = 2;
const CHANGE_QUOTE_SCHEMA_VERSION = 2;
const CHANGE_QUOTE_TTL_MS = 15 * 60 * 1000;
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

function routeMatchesSnapshot(breakdown, snapshot) {
  const value = breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown) ? breakdown : {};
  const origin = typeof value.origin === 'string' ? value.origin.trim() : '';
  const destination = typeof value.destination === 'string' ? value.destination.trim() : '';
  const rawWaypoints = value.waypoints === undefined || value.waypoints === null ? [] : value.waypoints;
  if (!Array.isArray(rawWaypoints) || rawWaypoints.some((waypoint) => typeof waypoint !== 'string')) return false;
  const waypoints = rawWaypoints.map((waypoint) => waypoint.trim());
  return origin === snapshot.origin
    && destination === snapshot.destination
    && waypoints.length === snapshot.waypoints.length
    && waypoints.every((waypoint, index) => waypoint === snapshot.waypoints[index]);
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
  const routeScheduleResult = normalizeMoodRouteSchedule(raw.routeSchedule, stopCount, startTime);
  if (!routeScheduleResult.ok) {
    return { ok: false, error: routeScheduleResult.error };
  }

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
      hasRouteSchedule: routeScheduleResult.provided,
      routeSchedule: routeScheduleResult.value,
    },
  };
}

function revisionOf(booking) {
  const value = Number(booking && booking.revision);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function hasOpenSettlementApproval(booking) {
  const status = booking && booking.settlementApproval && booking.settlementApproval.status;
  return status === 'awaiting_mood' || status === 'changes_requested';
}

function stablePayload({ bookingId, expectedRevision, reason, snapshot, includeRouteSchedule = true }) {
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
      ...(includeRouteSchedule ? {
        hasRouteSchedule: snapshot.hasRouteSchedule,
        routeSchedule: snapshot.hasRouteSchedule ? snapshot.routeSchedule : null,
      } : {}),
    },
  });
}

function idempotencyHashMatches(storedHash, payloadHash, legacyPayloadHash) {
  return storedHash === payloadHash || Boolean(legacyPayloadHash && storedHash === legacyPayloadHash);
}

function hasAwaitingBookingChangeApproval(booking) {
  return Boolean(
    booking
    && booking.bookingChangeApproval
    && booking.bookingChangeApproval.status === 'awaiting_mood',
  );
}

function storedRequestSnapshot(snapshot) {
  return {
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
    ...(snapshot.hasInfluencerName ? { influencerName: snapshot.influencerName || null } : {}),
    courseMoodPercentages: snapshot.courseMoodPercentages,
    courseShareSchemaVersion: snapshot.courseShareSchemaVersion,
    ...(snapshot.hasRouteSchedule ? { routeSchedule: snapshot.routeSchedule } : {}),
  };
}

function idempotencyQuoteMatches(storedQuoteId, requestedQuoteId) {
  const normalizedStoredQuoteId = typeof storedQuoteId === 'string' ? storedQuoteId.trim() : '';
  return normalizedStoredQuoteId === requestedQuoteId;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function defaultRouteSchedule(stopCount, startTime) {
  return Array.from({ length: stopCount }, (_, index) => ({
    arrivalTime: null,
    pickupTime: index === 0 ? startTime : null,
  }));
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function storedRouteValues(booking) {
  const breakdown = booking && booking.breakdown && typeof booking.breakdown === 'object' && !Array.isArray(booking.breakdown)
    ? booking.breakdown
    : {};
  const origin = typeof breakdown.origin === 'string' ? breakdown.origin.trim() : '';
  const destination = typeof breakdown.destination === 'string' ? breakdown.destination.trim() : '';
  const rawWaypoints = Array.isArray(breakdown.waypoints) ? breakdown.waypoints : [];
  const waypoints = rawWaypoints
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  return { origin, destination, waypoints };
}

function diffBookingSnapshot(booking, snapshot) {
  const storedCourseShare = normalizeStoredCourseShare(booking);
  if (!storedCourseShare.ok) return { ok: false, error: 'INVALID_STORED_COURSE_SHARE' };

  const storedRoute = storedRouteValues(booking);
  const storedStartTime = String(booking.startTime || '').trim();
  const storedServiceType = String(booking.serviceType || '').trim();
  const stopCount = storedRoute.origin && storedRoute.destination ? storedRoute.waypoints.length + 2 : 0;
  const fallbackSchedule = defaultRouteSchedule(stopCount, storedStartTime);
  const storedScheduleResult = normalizeMoodRouteSchedule(booking.routeSchedule, stopCount, storedStartTime);
  const storedSchedule = storedScheduleResult.ok && storedScheduleResult.provided
    ? storedScheduleResult.value
    : fallbackSchedule;
  const requestedSchedule = snapshot.hasRouteSchedule ? snapshot.routeSchedule : storedSchedule;
  const storedInfluencerName = String(booking.influencerName || '').trim();
  const requestedInfluencerName = snapshot.hasInfluencerName ? snapshot.influencerName : storedInfluencerName;

  const priceFields = [];
  const routePricingFields = [];
  const financialFields = [];
  const nonPriceFields = [];
  const compareRoutePrice = (key, before, after) => {
    if (!sameValue(before, after)) {
      priceFields.push(key);
      routePricingFields.push(key);
    }
  };
  const compareNonPrice = (key, before, after) => {
    if (!sameValue(before, after)) nonPriceFields.push(key);
  };
  const compareFinancial = (key, before, after) => {
    if (!sameValue(before, after)) financialFields.push(key);
  };

  compareNonPrice('date', String(booking.date || '').trim(), snapshot.date);
  compareNonPrice('startTime', storedStartTime, snapshot.startTime);
  compareRoutePrice('durationHours', storedServiceType === 'airport' ? 0 : Number(booking.durationHours), snapshot.durationHours);
  compareRoutePrice('serviceType', storedServiceType, snapshot.serviceType);
  compareRoutePrice('origin', storedRoute.origin, snapshot.origin);
  compareRoutePrice('destination', storedRoute.destination, snapshot.destination);
  compareRoutePrice('waypoints', storedRoute.waypoints, snapshot.waypoints);
  const storedAirportDirection = storedServiceType === 'airport'
    ? (booking.airportDirection === 'sending' ? 'sending' : 'pickup')
    : null;
  const storedAirportCode = storedServiceType === 'airport'
    ? normalizeAirportCode(booking.airportCode || 'ICN')
    : null;
  compareNonPrice('airportDirection', storedAirportDirection, snapshot.airportDirection);
  compareRoutePrice('airportCode', storedAirportCode, snapshot.airportCode);
  compareNonPrice('note', String(booking.note || '').trim(), snapshot.note);
  compareNonPrice('influencerName', storedInfluencerName, requestedInfluencerName);
  compareFinancial('courseMoodPercentages', storedCourseShare.percentages, snapshot.courseMoodPercentages);
  compareNonPrice('routeSchedule', storedSchedule, requestedSchedule);

  return {
    ok: true,
    priceFields,
    financialFields,
    nonPriceFields,
    changedFields: [...priceFields, ...financialFields, ...nonPriceFields],
    priceAffecting: priceFields.length + financialFields.length > 0,
    requiresRoutePricing: routePricingFields.length > 0,
    hasChanges: priceFields.length + financialFields.length + nonPriceFields.length > 0,
    storedCourseShare,
  };
}

function stableQuotePayload(quote) {
  return stableJson({
    schemaVersion: quote.schemaVersion,
    quoteId: quote.quoteId,
    bookingId: quote.bookingId,
    clientId: quote.clientId,
    actorEmail: quote.actorEmail,
    expectedRevision: quote.expectedRevision,
    requestPayloadHash: quote.requestPayloadHash,
    requestSnapshot: quote.requestSnapshot,
    reason: quote.reason,
    currency: quote.currency,
    oldAmountKRW: quote.oldAmountKRW,
    amountKRW: quote.amountKRW,
    adjustmentKRW: quote.adjustmentKRW,
    balanceBeforeKRW: quote.balanceBeforeKRW,
    balanceAfterKRW: quote.balanceAfterKRW,
    ratePerHour: quote.ratePerHour,
    breakdown: quote.breakdown,
    routeSnapshot: quote.routeSnapshot,
    changedFields: quote.changedFields,
    status: quote.status,
    proposedByEmail: quote.proposedByEmail,
    proposedByRole: quote.proposedByRole,
    proposedAt: quote.proposedAt,
    proposalRevision: quote.proposalRevision,
    approvedByEmail: quote.approvedByEmail,
    approvedAt: quote.approvedAt,
    withdrawnByEmail: quote.withdrawnByEmail,
    withdrawnAt: quote.withdrawnAt,
    createdAt: quote.createdAt,
    expiresAt: quote.expiresAt,
    previewExpiresAt: quote.previewExpiresAt,
  });
}

function quoteHash(quote) {
  return sha256(stableQuotePayload(quote));
}

function validateStoredQuote({ quote, quoteId, booking, email, expectedRevision, payloadHash, now }) {
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) return { ok: false, error: 'CHANGE_QUOTE_NOT_FOUND' };
  if (quote.status === 'consumed') return { ok: false, error: 'CHANGE_QUOTE_ALREADY_USED' };
  if (quote.status !== 'ready') return { ok: false, error: 'INVALID_CHANGE_QUOTE' };
  if (
    quote.schemaVersion !== CHANGE_QUOTE_SCHEMA_VERSION
    || quote.currency !== 'KRW'
    || quote.quoteId !== quoteId
    || quote.bookingId !== booking.id
    || quote.clientId !== booking.clientId
    || quote.actorEmail !== email
    || quote.expectedRevision !== expectedRevision
    || quote.requestPayloadHash !== payloadHash
  ) {
    return { ok: false, error: 'CHANGE_QUOTE_MISMATCH' };
  }
  if (!Number.isSafeInteger(quote.expiresAt) || now >= quote.expiresAt) {
    return { ok: false, error: 'CHANGE_QUOTE_EXPIRED' };
  }
  if (typeof quote.integrityHash !== 'string' || quote.integrityHash !== quoteHash(quote)) {
    return { ok: false, error: 'CHANGE_QUOTE_INTEGRITY_FAILED' };
  }
  if (
    !Number.isSafeInteger(quote.oldAmountKRW)
    || quote.oldAmountKRW < 0
    || quote.oldAmountKRW !== booking.amountKRW
    || !Number.isSafeInteger(quote.amountKRW)
    || quote.amountKRW < 0
    || !Number.isSafeInteger(quote.adjustmentKRW)
    || quote.adjustmentKRW !== quote.amountKRW - quote.oldAmountKRW
    || !Number.isSafeInteger(quote.balanceBeforeKRW)
    || !Number.isSafeInteger(quote.balanceAfterKRW)
    || quote.balanceAfterKRW !== quote.balanceBeforeKRW - quote.adjustmentKRW
    || !quote.breakdown
    || typeof quote.breakdown !== 'object'
  ) {
    return { ok: false, error: 'CHANGE_QUOTE_INTEGRITY_FAILED' };
  }
  return { ok: true };
}

function validateAwaitingChangeQuote({ quote, quoteId, booking, now }) {
  if (!quote || typeof quote !== 'object' || Array.isArray(quote)) {
    return { ok: false, error: 'CHANGE_PROPOSAL_NOT_FOUND' };
  }
  if (quote.status === 'approved') return { ok: false, error: 'CHANGE_QUOTE_ALREADY_USED' };
  if (quote.status !== 'awaiting_mood') return { ok: false, error: 'CHANGE_PROPOSAL_NOT_PENDING' };
  const proposedByEmail = typeof quote.proposedByEmail === 'string' ? quote.proposedByEmail.trim().toLowerCase() : '';
  if (
    quote.schemaVersion !== CHANGE_QUOTE_SCHEMA_VERSION
    || quote.currency !== 'KRW'
    || quote.quoteId !== quoteId
    || quote.bookingId !== booking.id
    || quote.clientId !== booking.clientId
    || !proposedByEmail
    || proposedByEmail !== quote.actorEmail
    || quote.proposedByRole !== 'admin'
    || !Number.isSafeInteger(quote.proposedAt)
    || quote.proposedAt <= 0
    || quote.proposedAt > now
    || !Number.isInteger(quote.proposalRevision)
    || quote.proposalRevision !== revisionOf(booking)
    || quote.expiresAt !== null
    || !Number.isSafeInteger(quote.previewExpiresAt)
    || quote.previewExpiresAt < quote.createdAt
  ) {
    return { ok: false, error: 'CHANGE_PROPOSAL_MISMATCH' };
  }
  const approval = booking.bookingChangeApproval;
  if (
    !approval
    || typeof approval !== 'object'
    || Array.isArray(approval)
    || approval.status !== 'awaiting_mood'
    || approval.quoteId !== quoteId
    || approval.proposalRevision !== quote.proposalRevision
  ) {
    return { ok: false, error: 'CHANGE_PROPOSAL_MISMATCH' };
  }
  if (stableJson(approval) !== stableJson(bookingChangeApprovalSummary(quote))) {
    return { ok: false, error: 'CHANGE_PROPOSAL_MISMATCH' };
  }
  if (typeof quote.integrityHash !== 'string' || quote.integrityHash !== quoteHash(quote)) {
    return { ok: false, error: 'CHANGE_QUOTE_INTEGRITY_FAILED' };
  }
  const normalized = normalizeSnapshot(quote.requestSnapshot);
  if (!normalized.ok || stableJson(storedRequestSnapshot(normalized.value)) !== stableJson(quote.requestSnapshot)) {
    return { ok: false, error: 'CHANGE_QUOTE_INTEGRITY_FAILED' };
  }
  const reason = typeof quote.reason === 'string' ? quote.reason.trim() : '';
  if (!reason || reason.length > 500) return { ok: false, error: 'CHANGE_QUOTE_INTEGRITY_FAILED' };
  const expectedPayloadHash = sha256(stablePayload({
    bookingId: quote.bookingId,
    expectedRevision: quote.expectedRevision,
    reason,
    snapshot: normalized.value,
  }));
  if (quote.requestPayloadHash !== expectedPayloadHash) {
    return { ok: false, error: 'CHANGE_QUOTE_INTEGRITY_FAILED' };
  }
  if (
    !Number.isSafeInteger(quote.oldAmountKRW)
    || quote.oldAmountKRW < 0
    || quote.oldAmountKRW !== booking.amountKRW
    || !Number.isSafeInteger(quote.amountKRW)
    || quote.amountKRW < 0
    || !Number.isSafeInteger(quote.adjustmentKRW)
    || quote.adjustmentKRW !== quote.amountKRW - quote.oldAmountKRW
    || !Number.isSafeInteger(quote.balanceBeforeKRW)
    || !Number.isSafeInteger(quote.balanceAfterKRW)
    || quote.balanceAfterKRW !== quote.balanceBeforeKRW - quote.adjustmentKRW
    || !quote.breakdown
    || typeof quote.breakdown !== 'object'
    || Array.isArray(quote.breakdown)
  ) {
    return { ok: false, error: 'CHANGE_QUOTE_INTEGRITY_FAILED' };
  }
  return { ok: true, snapshot: normalized.value, reason };
}

function publicQuoteResponse(quote) {
  return {
    ok: true,
    data: {
      preview: true,
      quoteId: quote.quoteId,
      expectedRevision: quote.expectedRevision,
      currency: quote.currency,
      expiresAt: quote.expiresAt,
      oldAmountKRW: quote.oldAmountKRW,
      amountKRW: quote.amountKRW,
      adjustmentKRW: quote.adjustmentKRW,
      balanceKRW: quote.balanceAfterKRW,
      breakdown: quote.breakdown,
      routeSnapshot: decodeRouteSnapshot(quote.routeSnapshot),
      changedFields: quote.changedFields,
    },
  };
}

function bookingChangeApprovalSummary(quote, overrides = {}) {
  return {
    status: quote.status,
    quoteId: quote.quoteId,
    proposalRevision: quote.proposalRevision,
    proposedByEmail: quote.proposedByEmail,
    proposedAt: quote.proposedAt,
    reason: quote.reason,
    currency: quote.currency,
    oldAmountKRW: quote.oldAmountKRW,
    amountKRW: quote.amountKRW,
    adjustmentKRW: quote.adjustmentKRW,
    balanceBeforeKRW: quote.balanceBeforeKRW,
    balanceAfterKRW: quote.balanceAfterKRW,
    changedFields: quote.changedFields,
    proposedBooking: quote.requestSnapshot,
    breakdown: quote.breakdown,
    routeSnapshot: quote.routeSnapshot,
    ...overrides,
  };
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
    && typeof route.km === 'number'
    && Number.isFinite(route.km)
    && route.km >= 0
    && Number.isSafeInteger(route.tollKRW)
    && route.tollKRW >= 0
    && typeof route.durationMin === 'number'
    && Number.isFinite(route.durationMin)
    && route.durationMin >= 0,
  );
}

/** 멱등 문서에는 저장형을 유지하고, HTTP 경계에서만 기존 지도 계약으로 되돌린다. */
function publicResponse(response) {
  const booking = response && response.data && response.data.booking;
  if (!booking || typeof booking !== 'object' || Array.isArray(booking)) return response;
  return {
    ...response,
    data: {
      ...response.data,
      booking: {
        ...booking,
        ...(Object.prototype.hasOwnProperty.call(booking, 'routeSnapshot')
          ? { routeSnapshot: decodeRouteSnapshot(booking.routeSnapshot) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(booking, 'finalRouteSnapshot')
          ? { finalRouteSnapshot: decodeRouteSnapshot(booking.finalRouteSnapshot) }
          : {}),
      },
    },
  };
}

function buildAppliedChange({
  bookingId,
  booking,
  snapshot,
  currentDiff,
  effectivePricing,
  balanceKRW,
  actorEmail,
  reason,
  now,
  quoteId,
  bookingChangeApproval,
}) {
  const oldAmountKRW = booking.amountKRW;
  const adjustmentKRW = effectivePricing.amountKRW - oldAmountKRW;
  const newBalanceKRW = balanceKRW - adjustmentKRW;
  if (!Number.isSafeInteger(adjustmentKRW) || !Number.isSafeInteger(newBalanceKRW)) {
    return { ok: false, status: 500, error: 'INVALID_CALCULATED_MONEY' };
  }
  const nextRevision = revisionOf(booking) + 1;
  const bookingPatch = {
    date: snapshot.date,
    startTime: snapshot.startTime,
    durationHours: snapshot.durationHours,
    serviceType: snapshot.serviceType,
    airportDirection: snapshot.airportDirection,
    airportCode: snapshot.airportCode,
    note: snapshot.note || null,
    revision: nextRevision,
    updatedAt: now,
    updatedByEmail: actorEmail,
    lastChangeReason: reason,
    courseMoodPercentages: snapshot.courseMoodPercentages,
    courseShareSchemaVersion: snapshot.courseShareSchemaVersion,
    coursePayers: snapshot.coursePayers,
    ...(bookingChangeApproval ? { bookingChangeApproval } : {}),
  };
  if (currentDiff.requiresRoutePricing) {
    bookingPatch.amountKRW = effectivePricing.amountKRW;
    bookingPatch.ratePerHour = effectivePricing.ratePerHour;
    bookingPatch.breakdown = effectivePricing.breakdown;
    bookingPatch.routeSnapshot = effectivePricing.routeSnapshot;
    bookingPatch.balanceAfterKRW = newBalanceKRW;
    bookingPatch.lastAdjustmentKRW = adjustmentKRW;
  }
  const preserveStoredRouteSchedule = !snapshot.hasRouteSchedule
    && routeMatchesSnapshot(booking.breakdown, snapshot)
    && String(booking.startTime || '').trim() === snapshot.startTime;
  const clearStoredRouteSchedule = !snapshot.hasRouteSchedule
    && !preserveStoredRouteSchedule
    && hasOwn(booking, 'routeSchedule');
  if (snapshot.hasRouteSchedule) {
    bookingPatch.routeSchedule = snapshot.routeSchedule;
  } else if (clearStoredRouteSchedule) {
    bookingPatch.routeSchedule = FieldValue.delete();
  }
  if (snapshot.hasInfluencerName) {
    bookingPatch.influencerName = snapshot.influencerName || null;
  }
  const beforeSnapshot = {
    ...booking,
    courseMoodPercentages: currentDiff.storedCourseShare.percentages,
    courseShareSchemaVersion: COURSE_SHARE_SCHEMA_VERSION,
    coursePayers: currentDiff.storedCourseShare.payers,
  };
  const afterSnapshot = { ...beforeSnapshot, ...bookingPatch };
  if (clearStoredRouteSchedule) delete afterSnapshot.routeSchedule;
  const response = {
    ok: true,
    data: {
      bookingId,
      revision: nextRevision,
      oldAmountKRW,
      amountKRW: effectivePricing.amountKRW,
      adjustmentKRW,
      balanceKRW: newBalanceKRW,
      breakdown: effectivePricing.breakdown,
      changedFields: currentDiff.changedFields,
      priceAffecting: currentDiff.priceAffecting,
      quoteId: currentDiff.priceAffecting ? quoteId : null,
      booking: { id: bookingId, ...afterSnapshot },
    },
  };
  return {
    ok: true,
    oldAmountKRW,
    adjustmentKRW,
    newBalanceKRW,
    nextRevision,
    bookingPatch,
    beforeSnapshot,
    afterSnapshot,
    response,
  };
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

  const routeKm = route && route.ok ? route.km : 0;
  const durationMin = route && route.ok ? route.durationMin : 0;
  // 🔴 멱등 doc 에 들어갈 내부 응답은 저장형(path = [{lng,lat}])을 유지한다.
  //   HTTP로 보낼 복사본만 publicResponse에서 공개형으로 바꾼다. (2026-08-13 장애)
  const routeSnapshot = route && route.ok ? buildRouteSnapshot(route) : null;
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

async function replayStoredResponse({
  db,
  bookingRef,
  idempotencyRef,
  allowlist,
  isAdmin,
  payloadHash,
  legacyPayloadHash,
  requestedQuoteId,
  action,
}) {
  return db.runTransaction(async (tx) => {
    const [idempotencySnap, bookingSnap] = await Promise.all([
      tx.get(idempotencyRef),
      tx.get(bookingRef),
    ]);
    if (!idempotencySnap.exists) return { ok: false, missing: true };
    const idempotency = idempotencySnap.data() || {};
    if (!idempotencyHashMatches(idempotency.payloadHash, payloadHash, legacyPayloadHash)) {
      return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
    }
    if (idempotency.action && idempotency.action !== action) {
      return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
    }
    if (!idempotencyQuoteMatches(idempotency.quoteId, requestedQuoteId)) {
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

async function replayStoredResponseIfPresent(args) {
  const idempotencySnap = await args.idempotencyRef.get();
  if (!idempotencySnap.exists) return { ok: false, missing: true };
  return replayStoredResponse(args);
}

async function approveBookingChange({
  db,
  res,
  jsonHeaders,
  allowlist,
  email,
  bookingId,
  quoteId,
  idempotencyKey,
}) {
  if (!isSettlementApproverEmail(allowlist, email)) {
    return sendJson(res, 403, jsonHeaders, { ok: false, error: 'CHANGE_APPROVER_REQUIRED' });
  }
  const now = Date.now();
  const payloadHash = sha256(stableJson({ action: 'approve', bookingId, quoteId }));
  const idempotencyDocumentId = sha256(`${email}:${idempotencyKey}`);
  const bookingRef = db.collection('mood_bookings').doc(bookingId);
  const quoteRef = db.collection('mood_booking_change_quotes').doc(quoteId);
  const idempotencyRef = db.collection('mood_booking_change_idempotency').doc(idempotencyDocumentId);
  const auditRef = db.collection('mood_booking_change_events').doc(idempotencyDocumentId);
  const outboxRef = db.collection('mood_notification_outbox').doc(idempotencyDocumentId);
  const bookingAvailabilityRef = moodBookingAvailabilityRef(db);

  const result = await db.runTransaction(async (tx) => {
    const [idempotencySnap, bookingSnap, quoteSnap, bookingAvailabilitySnap] = await Promise.all([
      tx.get(idempotencyRef),
      tx.get(bookingRef),
      tx.get(quoteRef),
      tx.get(bookingAvailabilityRef),
    ]);
    if (!bookingSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
    const booking = bookingSnap.data() || {};
    if (!idorAllowed(false, allowlist, booking)) {
      return { ok: false, status: 403, error: 'BOOKING_ACCESS_DENIED' };
    }
    if (idempotencySnap.exists) {
      const stored = idempotencySnap.data() || {};
      if (stored.payloadHash !== payloadHash || !idempotencyQuoteMatches(stored.quoteId, quoteId)) {
        return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
      }
      if (!stored.response || typeof stored.response !== 'object') {
        return { ok: false, status: 409, error: 'IDEMPOTENCY_RESPONSE_MISSING' };
      }
      return { ok: true, replayed: true, response: stored.response };
    }
    if (!quoteSnap.exists) return { ok: false, status: 409, error: 'CHANGE_PROPOSAL_NOT_FOUND' };
    const quote = quoteSnap.data() || {};
    if (quote.status === 'approved') {
      return { ok: false, status: 409, error: 'CHANGE_QUOTE_ALREADY_USED' };
    }
    if (booking.status !== 'confirmed') {
      return { ok: false, status: 409, error: 'BOOKING_NOT_CHANGEABLE' };
    }
    if (hasOpenSettlementApproval(booking)) {
      return { ok: false, status: 409, error: 'SETTLEMENT_APPROVAL_PENDING' };
    }
    if (String(quote.proposedByEmail || '').trim().toLowerCase() === email) {
      return { ok: false, status: 403, error: 'CHANGE_SELF_APPROVAL_FORBIDDEN' };
    }
    const quoteValidation = validateAwaitingChangeQuote({
      quote,
      quoteId,
      booking: { id: bookingId, ...booking },
      now,
    });
    if (!quoteValidation.ok) {
      return { ok: false, status: 409, error: quoteValidation.error };
    }
    if (quote.proposalRevision !== quote.expectedRevision) {
      return { ok: false, status: 409, error: 'CHANGE_PROPOSAL_MISMATCH' };
    }
    const snapshot = quoteValidation.snapshot;
    const reason = quoteValidation.reason;
    const bookingAvailability = moodBookingAvailabilityFromSnapshot(bookingAvailabilitySnap);
    const availability = checkMoodBookingChangeAvailability(
      booking.date,
      booking.startTime,
      snapshot.date,
      snapshot.startTime,
      bookingAvailability,
    );
    if (!availability.ok) {
      return { ok: false, status: 409, error: availability.error, reason: availability.reason };
    }
    const currentDiff = diffBookingSnapshot(booking, snapshot);
    if (!currentDiff.ok) return { ok: false, status: 409, error: currentDiff.error };
    if (!currentDiff.hasChanges || !currentDiff.priceAffecting) {
      return { ok: false, status: 409, error: 'CHANGE_PROPOSAL_MISMATCH' };
    }
    if (!sameValue(currentDiff.changedFields, quote.changedFields)) {
      return { ok: false, status: 409, error: 'CHANGE_PROPOSAL_MISMATCH' };
    }
    const clientId = String(booking.clientId || '').trim();
    if (!clientId) return { ok: false, status: 500, error: 'INVALID_BOOKING_OWNER' };
    const clientRef = db.collection('mood_clients').doc(clientId);
    const clientSnap = await tx.get(clientRef);
    if (!clientSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
    const client = clientSnap.data() || {};
    const balanceKRW = client.balanceKRW;
    if (!Number.isSafeInteger(balanceKRW) || balanceKRW !== quote.balanceBeforeKRW) {
      return { ok: false, status: 409, error: 'CHANGE_QUOTE_BALANCE_STALE' };
    }
    const creditLimitKRW = client.creditLimitKRW;
    if (creditLimitKRW !== undefined && creditLimitKRW !== null) {
      if (!Number.isSafeInteger(creditLimitKRW) || creditLimitKRW <= 0) {
        return { ok: false, status: 409, error: 'INVALID_CREDIT_LIMIT' };
      }
      if (quote.adjustmentKRW > 0 && quote.balanceAfterKRW < -creditLimitKRW) {
        return {
          ok: false,
          status: 409,
          error: 'CREDIT_LIMIT_EXCEEDED',
          creditLimitKRW,
          balanceKRW,
        };
      }
    }
    const approvedAt = now;
    const approvedQuote = {
      ...quote,
      status: 'approved',
      approvedByEmail: email,
      approvedAt,
    };
    approvedQuote.integrityHash = quoteHash(approvedQuote);
    const approvalSummary = bookingChangeApprovalSummary(approvedQuote, {
      status: 'approved',
      approvedByEmail: email,
      approvedAt,
    });
    const applied = buildAppliedChange({
      bookingId,
      booking,
      snapshot,
      currentDiff,
      effectivePricing: {
        amountKRW: quote.amountKRW,
        ratePerHour: quote.ratePerHour,
        breakdown: quote.breakdown,
        routeSnapshot: quote.routeSnapshot,
      },
      balanceKRW,
      actorEmail: email,
      reason,
      now,
      quoteId,
      bookingChangeApproval: approvalSummary,
    });
    if (!applied.ok) return applied;

    if (applied.adjustmentKRW !== 0) tx.update(clientRef, { balanceKRW: applied.newBalanceKRW });
    tx.update(bookingRef, applied.bookingPatch);
    tx.set(quoteRef, approvedQuote);
    tx.set(auditRef, {
      type: 'booking_change_approved',
      bookingId,
      clientId,
      actorEmail: email,
      proposedByEmail: quote.proposedByEmail,
      reason,
      expectedRevision: quote.proposalRevision,
      revision: applied.nextRevision,
      oldAmountKRW: applied.oldAmountKRW,
      newAmountKRW: quote.amountKRW,
      adjustmentKRW: applied.adjustmentKRW,
      balanceBeforeKRW: balanceKRW,
      balanceAfterKRW: applied.newBalanceKRW,
      changedFields: currentDiff.changedFields,
      priceAffecting: true,
      currency: 'KRW',
      quoteId,
      before: applied.beforeSnapshot,
      after: applied.afterSnapshot,
      createdAt: now,
    });
    tx.set(outboxRef, {
      type: 'mood_booking_change_approved',
      topic: 'booking',
      bookingId,
      clientId,
      actorEmail: email,
      proposedByEmail: quote.proposedByEmail,
      revision: applied.nextRevision,
      reason,
      oldAmountKRW: applied.oldAmountKRW,
      newAmountKRW: quote.amountKRW,
      adjustmentKRW: applied.adjustmentKRW,
      changedFields: currentDiff.changedFields,
      quoteId,
      currency: 'KRW',
      status: 'pending',
      attemptCount: 0,
      createdAt: now,
    });
    tx.set(idempotencyRef, {
      action: 'approve',
      bookingId,
      actorEmail: email,
      payloadHash,
      quoteId,
      currency: 'KRW',
      status: 'completed',
      response: applied.response,
      createdAt: now,
      completedAt: now,
    });
    return {
      ok: true,
      replayed: false,
      response: applied.response,
      notification: {
        snapshot,
        reason,
        oldAmountKRW: applied.oldAmountKRW,
        amountKRW: quote.amountKRW,
        newBalanceKRW: applied.newBalanceKRW,
      },
    };
  });

  if (!result.ok) {
    return sendJson(res, result.status || 409, jsonHeaders, {
      ok: false,
      error: result.error || 'CHANGE_APPROVAL_FAILED',
      ...(result.reason ? { reason: result.reason } : {}),
    });
  }
  if (!result.replayed) {
    try {
      await notify('booking', [
        '<b>MOOD 예약 변경 양측 확인 완료</b>',
        `${result.notification.snapshot.date} ${result.notification.snapshot.startTime}`,
        `${result.notification.oldAmountKRW.toLocaleString('ko-KR')}원 → ${result.notification.amountKRW.toLocaleString('ko-KR')}원`,
        `잔액 ${result.notification.newBalanceKRW.toLocaleString('ko-KR')}원`,
        `MOOD 확인: ${email}`,
      ].join('\n'));
    } catch (notifyError) {
      console.warn('[mood-change] approval notify failed:', notifyError && notifyError.message ? notifyError.message : notifyError);
    }
  }
  return sendJson(res, 200, jsonHeaders, publicResponse(result.response));
}

async function withdrawBookingChange({
  db,
  res,
  jsonHeaders,
  allowlist,
  email,
  bookingId,
  quoteId,
  idempotencyKey,
}) {
  if (!isAdminEmail(allowlist, email)) {
    return sendJson(res, 403, jsonHeaders, { ok: false, error: 'ADMIN_REQUIRED' });
  }
  const now = Date.now();
  const payloadHash = sha256(stableJson({ action: 'withdraw', bookingId, quoteId }));
  const idempotencyDocumentId = sha256(`${email}:${idempotencyKey}`);
  const bookingRef = db.collection('mood_bookings').doc(bookingId);
  const quoteRef = db.collection('mood_booking_change_quotes').doc(quoteId);
  const idempotencyRef = db.collection('mood_booking_change_idempotency').doc(idempotencyDocumentId);
  const auditRef = db.collection('mood_booking_change_events').doc(idempotencyDocumentId);

  const result = await db.runTransaction(async (tx) => {
    const [idempotencySnap, bookingSnap, quoteSnap] = await Promise.all([
      tx.get(idempotencyRef),
      tx.get(bookingRef),
      tx.get(quoteRef),
    ]);
    if (!bookingSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
    const booking = bookingSnap.data() || {};
    if (!idorAllowed(true, allowlist, booking)) {
      return { ok: false, status: 403, error: 'BOOKING_ACCESS_DENIED' };
    }
    if (idempotencySnap.exists) {
      const stored = idempotencySnap.data() || {};
      if (stored.payloadHash !== payloadHash || !idempotencyQuoteMatches(stored.quoteId, quoteId)) {
        return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
      }
      if (!stored.response || typeof stored.response !== 'object') {
        return { ok: false, status: 409, error: 'IDEMPOTENCY_RESPONSE_MISSING' };
      }
      return { ok: true, replayed: true, response: stored.response };
    }
    if (!quoteSnap.exists) return { ok: false, status: 409, error: 'CHANGE_PROPOSAL_NOT_FOUND' };
    const quote = quoteSnap.data() || {};
    const quoteValidation = validateAwaitingChangeQuote({
      quote,
      quoteId,
      booking: { id: bookingId, ...booking },
      now,
    });
    if (!quoteValidation.ok) {
      return { ok: false, status: 409, error: quoteValidation.error };
    }
    const nextRevision = revisionOf(booking);
    const withdrawnQuote = {
      ...quote,
      status: 'withdrawn',
      withdrawnByEmail: email,
      withdrawnAt: now,
    };
    withdrawnQuote.integrityHash = quoteHash(withdrawnQuote);
    const response = {
      ok: true,
      data: {
        bookingId,
        quoteId,
        status: 'withdrawn',
        revision: nextRevision,
      },
    };
    tx.set(quoteRef, withdrawnQuote);
    tx.update(bookingRef, {
      bookingChangeApproval: bookingChangeApprovalSummary(withdrawnQuote, {
        status: 'withdrawn',
        withdrawnByEmail: email,
        withdrawnAt: now,
      }),
      revision: nextRevision,
      updatedAt: now,
      updatedByEmail: email,
    });
    tx.set(auditRef, {
      type: 'booking_change_withdrawn',
      bookingId,
      clientId: booking.clientId,
      actorEmail: email,
      quoteId,
      proposalRevision: quote.proposalRevision,
      revision: nextRevision,
      currency: 'KRW',
      createdAt: now,
    });
    tx.set(idempotencyRef, {
      action: 'withdraw',
      bookingId,
      actorEmail: email,
      payloadHash,
      quoteId,
      currency: 'KRW',
      status: 'completed',
      response,
      createdAt: now,
      completedAt: now,
    });
    return { ok: true, replayed: false, response };
  });

  if (!result.ok) {
    return sendJson(res, result.status || 409, jsonHeaders, {
      ok: false,
      error: result.error || 'CHANGE_WITHDRAW_FAILED',
    });
  }
  return sendJson(res, 200, jsonHeaders, result.response);
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
  const action = body.action === undefined ? 'confirm' : String(body.action || '').trim();
  const bookingId = typeof body.bookingId === 'string' ? body.bookingId.trim() : '';
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  const requestedQuoteId = typeof body.quoteId === 'string' ? body.quoteId.trim() : '';
  const expectedRevision = body.expectedRevision;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!['preview', 'propose', 'confirm', 'approve', 'withdraw'].includes(action)) {
    return sendJson(res, 400, jsonHeaders, { ok: false, error: 'INVALID_CHANGE_ACTION' });
  }

  if (!validateId(bookingId, 128)) {
    return sendJson(res, 400, jsonHeaders, { ok: false, error: 'INVALID_BOOKING_ID' });
  }
  if (!validateId(idempotencyKey, 200)) {
    return sendJson(res, 400, jsonHeaders, { ok: false, error: 'INVALID_IDEMPOTENCY_KEY' });
  }
  if (requestedQuoteId && !/^[a-f0-9]{64}$/.test(requestedQuoteId)) {
    return sendJson(res, 400, jsonHeaders, { ok: false, error: 'INVALID_CHANGE_QUOTE_ID' });
  }
  if ((action === 'approve' || action === 'withdraw') && !requestedQuoteId) {
    return sendJson(res, 400, jsonHeaders, { ok: false, error: 'CHANGE_QUOTE_REQUIRED' });
  }
  let snapshot = null;
  let payloadHash = '';
  let legacyPayloadHash = null;
  if (action !== 'approve' && action !== 'withdraw') {
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
    snapshot = normalized.value;
    payloadHash = sha256(stablePayload({ bookingId, expectedRevision, reason, snapshot }));
    legacyPayloadHash = snapshot.hasRouteSchedule
      ? null
      : sha256(stablePayload({
        bookingId,
        expectedRevision,
        reason,
        snapshot,
        includeRouteSchedule: false,
      }));
  }
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
    if (action === 'approve') {
      return approveBookingChange({
        db,
        res,
        jsonHeaders,
        allowlist,
        email,
        bookingId,
        quoteId: requestedQuoteId,
        idempotencyKey,
      });
    }
    if (action === 'withdraw') {
      return withdrawBookingChange({
        db,
        res,
        jsonHeaders,
        allowlist,
        email,
        bookingId,
        quoteId: requestedQuoteId,
        idempotencyKey,
      });
    }
    const bookingRef = db.collection('mood_bookings').doc(bookingId);
    const idempotencyRef = db.collection('mood_booking_change_idempotency').doc(idempotencyDocumentId);
    const quoteDocumentId = action === 'preview' ? idempotencyDocumentId : requestedQuoteId;
    const quoteRef = quoteDocumentId
      ? db.collection('mood_booking_change_quotes').doc(quoteDocumentId)
      : null;
    const auditRef = db.collection('mood_booking_change_events').doc(idempotencyDocumentId);
    const outboxRef = db.collection('mood_notification_outbox').doc(idempotencyDocumentId);
    const bookingAvailabilityRef = moodBookingAvailabilityRef(db);

    const [preBookingSnap, preIdempotencySnap, preQuoteSnap] = await Promise.all([
      bookingRef.get(),
      action === 'confirm' || action === 'propose'
        ? idempotencyRef.get()
        : Promise.resolve({ exists: false }),
      action === 'preview' && quoteRef ? quoteRef.get() : Promise.resolve({ exists: false }),
    ]);
    if (!preBookingSnap.exists) {
      return sendJson(res, 404, jsonHeaders, { ok: false, error: 'BOOKING_NOT_FOUND' });
    }
    const preBooking = preBookingSnap.data() || {};
    if (!idorAllowed(isAdmin, allowlist, preBooking)) {
      return sendJson(res, 403, jsonHeaders, { ok: false, error: 'BOOKING_ACCESS_DENIED' });
    }
    if ((action === 'confirm' || action === 'propose') && preIdempotencySnap.exists) {
      const replay = await replayStoredResponse({
        db,
        bookingRef,
        idempotencyRef,
        allowlist,
        isAdmin,
        payloadHash,
        legacyPayloadHash,
        requestedQuoteId,
        action,
      });
      if (replay.ok) return sendJson(res, 200, jsonHeaders, publicResponse(replay.response));
      return sendJson(res, replay.status || 409, jsonHeaders, { ok: false, error: replay.error || 'IDEMPOTENCY_CONFLICT' });
    }

    // 이미 커밋된 동일 요청은 현재 차단 설정이 손상됐더라도 저장 응답을 먼저 재생한다.
    // 신규 변경만 아래 사전 검사와 commit 트랜잭션에서 최신 설정을 fail-closed로 확인한다.
    let preBookingAvailability;
    try {
      preBookingAvailability = await getMoodBookingAvailability(db);
    } catch (configError) {
      // 첫 멱등 조회 직후 동일 요청이 commit됐을 수 있다. 이미 저장된 변경 결과가
      // 있으면 손상된 최신 설정 오류보다 그 응답을 우선해 재시도 결과를 보존한다.
      if (action === 'confirm' || action === 'propose') {
        const lateReplay = await replayStoredResponseIfPresent({
          db,
          bookingRef,
          idempotencyRef,
          allowlist,
          isAdmin,
          payloadHash,
          legacyPayloadHash,
          requestedQuoteId,
          action,
        });
        if (lateReplay.ok) return sendJson(res, 200, jsonHeaders, publicResponse(lateReplay.response));
        if (!lateReplay.missing) {
          return sendJson(res, lateReplay.status || 409, jsonHeaders, { ok: false, error: lateReplay.error || 'IDEMPOTENCY_CONFLICT' });
        }
      }
      throw configError;
    }
    const deferQuotedConfirmChecks = action === 'propose' && Boolean(requestedQuoteId);
    let preDiff = null;
    if (!deferQuotedConfirmChecks) {
      const availability = checkMoodBookingChangeAvailability(
        preBooking.date,
        preBooking.startTime,
        snapshot.date,
        snapshot.startTime,
        preBookingAvailability,
      );
      if (!availability.ok) {
        // 정책 조회 사이에 같은 요청이 먼저 commit됐다면 저장된 성공 응답이 정본이다.
        if (action === 'confirm' || action === 'propose') {
          const lateReplay = await replayStoredResponseIfPresent({
            db,
            bookingRef,
            idempotencyRef,
            allowlist,
            isAdmin,
            payloadHash,
            legacyPayloadHash,
            requestedQuoteId,
            action,
          });
          if (lateReplay.ok) return sendJson(res, 200, jsonHeaders, publicResponse(lateReplay.response));
          if (!lateReplay.missing) {
            return sendJson(res, lateReplay.status || 409, jsonHeaders, { ok: false, error: lateReplay.error || 'IDEMPOTENCY_CONFLICT' });
          }
        }
        return sendJson(res, 409, jsonHeaders, {
          ok: false,
          error: availability.error,
          reason: availability.reason,
        });
      }

      if (preBooking.status !== 'confirmed') {
        return sendJson(res, 409, jsonHeaders, { ok: false, error: 'BOOKING_NOT_CHANGEABLE' });
      }
      if (hasOpenSettlementApproval(preBooking)) {
        return sendJson(res, 409, jsonHeaders, { ok: false, error: 'SETTLEMENT_APPROVAL_PENDING' });
      }
      if (hasAwaitingBookingChangeApproval(preBooking)) {
        return sendJson(res, 409, jsonHeaders, { ok: false, error: 'BOOKING_CHANGE_APPROVAL_PENDING' });
      }
      if (revisionOf(preBooking) !== expectedRevision) {
        return sendJson(res, 409, jsonHeaders, {
          ok: false,
          error: 'REVISION_CONFLICT',
          currentRevision: revisionOf(preBooking),
        });
      }

      preDiff = diffBookingSnapshot(preBooking, snapshot);
      if (!preDiff.ok) {
        return sendJson(res, 409, jsonHeaders, { ok: false, error: preDiff.error });
      }
      if (!preDiff.hasChanges) {
        return sendJson(res, 409, jsonHeaders, { ok: false, error: 'NO_CHANGES' });
      }
    }

    if (action === 'preview') {
      if (!isAdmin) {
        return sendJson(res, 403, jsonHeaders, { ok: false, error: 'ADMIN_REQUIRED' });
      }
      if (!preDiff.priceAffecting) {
        return sendJson(res, 409, jsonHeaders, {
          ok: false,
          error: 'CHANGE_QUOTE_NOT_REQUIRED',
          changedFields: preDiff.changedFields,
        });
      }
      if (!quoteRef) {
        return sendJson(res, 500, jsonHeaders, { ok: false, error: 'CHANGE_QUOTE_UNAVAILABLE' });
      }
      if (preQuoteSnap.exists) {
        const storedQuote = preQuoteSnap.data() || {};
        if (storedQuote.requestPayloadHash !== payloadHash) {
          return sendJson(res, 409, jsonHeaders, { ok: false, error: 'PREVIEW_IDEMPOTENCY_CONFLICT' });
        }
        const quoteValidation = validateStoredQuote({
          quote: storedQuote,
          quoteId: quoteDocumentId,
          booking: { id: bookingId, ...preBooking },
          email,
          expectedRevision,
          payloadHash,
          now: Date.now(),
        });
        if (!quoteValidation.ok) {
          return sendJson(res, 409, jsonHeaders, { ok: false, error: quoteValidation.error });
        }
        return sendJson(res, 200, jsonHeaders, publicQuoteResponse(storedQuote));
      }

      let pricedPreview;
      if (preDiff.requiresRoutePricing) {
        pricedPreview = await priceSnapshot(snapshot);
        if (!pricedPreview.ok) {
          const status = pricedPreview.error === 'ROUTE_CALCULATION_FAILED' ? 422 : 400;
          return sendJson(res, status, jsonHeaders, {
            ok: false,
            error: pricedPreview.error,
            ...(pricedPreview.routeError ? { routeError: pricedPreview.routeError } : {}),
          });
        }
      } else {
        pricedPreview = {
          ok: true,
          amountKRW: preBooking.amountKRW,
          ratePerHour: preBooking.ratePerHour === undefined ? null : preBooking.ratePerHour,
          breakdown: preBooking.breakdown,
          routeSnapshot: preBooking.routeSnapshot || null,
        };
      }

      if (
        !Number.isSafeInteger(pricedPreview.amountKRW)
        || pricedPreview.amountKRW < 0
        || !pricedPreview.breakdown
        || typeof pricedPreview.breakdown !== 'object'
        || Array.isArray(pricedPreview.breakdown)
      ) {
        return sendJson(res, 500, jsonHeaders, { ok: false, error: 'INVALID_STORED_PRICING' });
      }

      const previewNow = Date.now();
      const previewResult = await db.runTransaction(async (tx) => {
        const [quoteSnap, bookingSnap, bookingAvailabilitySnap] = await Promise.all([
          tx.get(quoteRef),
          tx.get(bookingRef),
          tx.get(bookingAvailabilityRef),
        ]);
        if (!bookingSnap.exists) return { ok: false, status: 404, error: 'BOOKING_NOT_FOUND' };
        const currentBooking = bookingSnap.data() || {};
        if (!idorAllowed(isAdmin, allowlist, currentBooking)) {
          return { ok: false, status: 403, error: 'BOOKING_ACCESS_DENIED' };
        }
        if (!isAdmin) return { ok: false, status: 403, error: 'ADMIN_REQUIRED' };
        if (quoteSnap.exists) {
          const storedQuote = quoteSnap.data() || {};
          if (storedQuote.requestPayloadHash !== payloadHash) {
            return { ok: false, status: 409, error: 'PREVIEW_IDEMPOTENCY_CONFLICT' };
          }
          const quoteValidation = validateStoredQuote({
            quote: storedQuote,
            quoteId: quoteDocumentId,
            booking: { id: bookingId, ...currentBooking },
            email,
            expectedRevision,
            payloadHash,
            now: previewNow,
          });
          return quoteValidation.ok
            ? { ok: true, quote: storedQuote }
            : { ok: false, status: 409, error: quoteValidation.error };
        }
        if (currentBooking.status !== 'confirmed') {
          return { ok: false, status: 409, error: 'BOOKING_NOT_CHANGEABLE' };
        }
        if (hasOpenSettlementApproval(currentBooking)) {
          return { ok: false, status: 409, error: 'SETTLEMENT_APPROVAL_PENDING' };
        }
        if (hasAwaitingBookingChangeApproval(currentBooking)) {
          return { ok: false, status: 409, error: 'BOOKING_CHANGE_APPROVAL_PENDING' };
        }
        const currentRevision = revisionOf(currentBooking);
        if (currentRevision !== expectedRevision) {
          return { ok: false, status: 409, error: 'REVISION_CONFLICT', currentRevision };
        }
        const currentBookingAvailability = moodBookingAvailabilityFromSnapshot(bookingAvailabilitySnap);
        const currentAvailability = checkMoodBookingChangeAvailability(
          currentBooking.date,
          currentBooking.startTime,
          snapshot.date,
          snapshot.startTime,
          currentBookingAvailability,
        );
        if (!currentAvailability.ok) {
          return {
            ok: false,
            status: 409,
            error: currentAvailability.error,
            reason: currentAvailability.reason,
          };
        }
        const currentDiff = diffBookingSnapshot(currentBooking, snapshot);
        if (!currentDiff.ok) return { ok: false, status: 409, error: currentDiff.error };
        if (!currentDiff.hasChanges) return { ok: false, status: 409, error: 'NO_CHANGES' };
        if (!currentDiff.priceAffecting) return { ok: false, status: 409, error: 'CHANGE_QUOTE_NOT_REQUIRED' };

        const clientId = String(currentBooking.clientId || '').trim();
        if (!clientId) return { ok: false, status: 500, error: 'INVALID_BOOKING_OWNER' };
        const clientRef = db.collection('mood_clients').doc(clientId);
        const clientSnap = await tx.get(clientRef);
        if (!clientSnap.exists) return { ok: false, status: 404, error: 'CLIENT_NOT_FOUND' };
        const client = clientSnap.data() || {};
        const oldAmountKRW = currentBooking.amountKRW;
        const balanceKRW = client.balanceKRW;
        if (!Number.isSafeInteger(oldAmountKRW) || oldAmountKRW < 0 || !Number.isSafeInteger(balanceKRW)) {
          return { ok: false, status: 500, error: 'INVALID_STORED_MONEY' };
        }
        const adjustmentKRW = pricedPreview.amountKRW - oldAmountKRW;
        const nextBalanceKRW = balanceKRW - adjustmentKRW;
        if (!Number.isSafeInteger(adjustmentKRW) || !Number.isSafeInteger(nextBalanceKRW)) {
          return { ok: false, status: 500, error: 'INVALID_CALCULATED_MONEY' };
        }
        const creditLimitKRW = client.creditLimitKRW;
        if (creditLimitKRW !== undefined && creditLimitKRW !== null) {
          if (!Number.isSafeInteger(creditLimitKRW) || creditLimitKRW <= 0) {
            return { ok: false, status: 409, error: 'INVALID_CREDIT_LIMIT' };
          }
          if (adjustmentKRW > 0 && nextBalanceKRW < -creditLimitKRW) {
            return {
              ok: false,
              status: 409,
              error: 'CREDIT_LIMIT_EXCEEDED',
              creditLimitKRW,
              balanceKRW,
            };
          }
        }

        const quote = {
          schemaVersion: CHANGE_QUOTE_SCHEMA_VERSION,
          quoteId: quoteDocumentId,
          bookingId,
          clientId,
          actorEmail: email,
          expectedRevision,
          requestPayloadHash: payloadHash,
          requestSnapshot: storedRequestSnapshot(snapshot),
          reason,
          currency: 'KRW',
          oldAmountKRW,
          amountKRW: pricedPreview.amountKRW,
          adjustmentKRW,
          balanceBeforeKRW: balanceKRW,
          balanceAfterKRW: nextBalanceKRW,
          ratePerHour: pricedPreview.ratePerHour,
          breakdown: pricedPreview.breakdown,
          routeSnapshot: pricedPreview.routeSnapshot,
          changedFields: currentDiff.changedFields,
          status: 'ready',
          proposedByEmail: null,
          proposedByRole: null,
          proposedAt: null,
          proposalRevision: null,
          createdAt: previewNow,
          expiresAt: previewNow + CHANGE_QUOTE_TTL_MS,
          previewExpiresAt: null,
        };
        quote.integrityHash = quoteHash(quote);
        tx.set(quoteRef, quote);
        return { ok: true, quote };
      });

      if (!previewResult.ok) {
        return sendJson(res, previewResult.status || 409, jsonHeaders, {
          ok: false,
          error: previewResult.error || 'CHANGE_PREVIEW_FAILED',
          ...(previewResult.reason ? { reason: previewResult.reason } : {}),
          ...(typeof previewResult.currentRevision === 'number'
            ? { currentRevision: previewResult.currentRevision }
            : {}),
        });
      }
      return sendJson(res, 200, jsonHeaders, publicQuoteResponse(previewResult.quote));
    }

    if (action === 'confirm' && requestedQuoteId) {
      return sendJson(res, 409, jsonHeaders, { ok: false, error: 'CHANGE_PROPOSAL_REQUIRED' });
    }
    if (action === 'propose' && !isAdmin) {
      return sendJson(res, 403, jsonHeaders, { ok: false, error: 'ADMIN_REQUIRED' });
    }
    if (preDiff && preDiff.priceAffecting && action === 'confirm') {
      return sendJson(res, 409, jsonHeaders, { ok: false, error: 'CHANGE_PROPOSAL_REQUIRED' });
    }
    if ((preDiff && preDiff.priceAffecting && !quoteRef) || (action === 'propose' && !quoteRef)) {
      return sendJson(res, 409, jsonHeaders, { ok: false, error: 'CHANGE_QUOTE_REQUIRED' });
    }

    const now = Date.now();
    const transactionResult = await db.runTransaction(async (tx) => {
      const [idempotencySnap, bookingSnap, quoteSnap, bookingAvailabilitySnap] = await Promise.all([
        tx.get(idempotencyRef),
        tx.get(bookingRef),
        quoteRef ? tx.get(quoteRef) : Promise.resolve({ exists: false }),
        tx.get(bookingAvailabilityRef),
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
        if (!idempotencyHashMatches(stored.payloadHash, payloadHash, legacyPayloadHash)) {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
        }
        if (stored.action && stored.action !== action) {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
        }
        if (!idempotencyQuoteMatches(stored.quoteId, requestedQuoteId)) {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_CONFLICT' };
        }
        if (!stored.response || typeof stored.response !== 'object') {
          return { ok: false, status: 409, error: 'IDEMPOTENCY_RESPONSE_MISSING' };
        }
        return { ok: true, replayed: true, response: stored.response };
      }
      if (requestedQuoteId) {
        if (!quoteSnap.exists) return { ok: false, status: 409, error: 'CHANGE_QUOTE_NOT_FOUND' };
        const requestedQuote = quoteSnap.data() || {};
        if (requestedQuote.status === 'consumed' || requestedQuote.status === 'approved') {
          return { ok: false, status: 409, error: 'CHANGE_QUOTE_ALREADY_USED' };
        }
        if (requestedQuote.status === 'awaiting_mood') {
          return { ok: false, status: 409, error: 'CHANGE_PROPOSAL_ALREADY_SUBMITTED' };
        }
      }
      const currentBookingAvailability = moodBookingAvailabilityFromSnapshot(bookingAvailabilitySnap);
      const transactionAvailability = checkMoodBookingChangeAvailability(
        booking.date,
        booking.startTime,
        snapshot.date,
        snapshot.startTime,
        currentBookingAvailability,
      );
      if (!transactionAvailability.ok) {
        return {
          ok: false,
          status: 409,
          error: transactionAvailability.error,
          reason: transactionAvailability.reason,
        };
      }
      if (booking.status !== 'confirmed') {
        return { ok: false, status: 409, error: 'BOOKING_NOT_CHANGEABLE' };
      }
      if (hasOpenSettlementApproval(booking)) {
        return { ok: false, status: 409, error: 'SETTLEMENT_APPROVAL_PENDING' };
      }
      if (hasAwaitingBookingChangeApproval(booking)) {
        return { ok: false, status: 409, error: 'BOOKING_CHANGE_APPROVAL_PENDING' };
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

      const currentDiff = diffBookingSnapshot(booking, snapshot);
      if (!currentDiff.ok) return { ok: false, status: 409, error: currentDiff.error };
      if (!currentDiff.hasChanges) return { ok: false, status: 409, error: 'NO_CHANGES' };
      if (requestedQuoteId && !currentDiff.priceAffecting) {
        return { ok: false, status: 409, error: 'CHANGE_QUOTE_NOT_REQUIRED' };
      }
      if (currentDiff.priceAffecting && action !== 'propose') {
        return { ok: false, status: 409, error: 'CHANGE_PROPOSAL_REQUIRED' };
      }
      if (currentDiff.priceAffecting && !isAdmin) {
        return { ok: false, status: 403, error: 'ADMIN_REQUIRED' };
      }
      if (!currentDiff.priceAffecting && action === 'propose') {
        return { ok: false, status: 409, error: 'CHANGE_QUOTE_NOT_REQUIRED' };
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

      let effectivePricing;
      let effectiveQuote = null;
      if (currentDiff.priceAffecting) {
        if (!quoteRef || !quoteSnap.exists) {
          return { ok: false, status: 409, error: 'CHANGE_QUOTE_REQUIRED' };
        }
        const storedQuote = quoteSnap.data() || {};
        const quoteValidation = validateStoredQuote({
          quote: storedQuote,
          quoteId: requestedQuoteId,
          booking: { id: bookingId, ...booking },
          email,
          expectedRevision,
          payloadHash,
          now: Date.now(),
        });
        if (!quoteValidation.ok) {
          return { ok: false, status: 409, error: quoteValidation.error };
        }
        if (storedQuote.balanceBeforeKRW !== balanceKRW) {
          return { ok: false, status: 409, error: 'CHANGE_QUOTE_BALANCE_STALE' };
        }
        effectiveQuote = storedQuote;
        effectivePricing = {
          amountKRW: storedQuote.amountKRW,
          ratePerHour: storedQuote.ratePerHour,
          breakdown: storedQuote.breakdown,
          routeSnapshot: storedQuote.routeSnapshot,
        };
      } else {
        effectivePricing = {
          amountKRW: oldAmountKRW,
          ratePerHour: booking.ratePerHour,
          breakdown: booking.breakdown,
          routeSnapshot: booking.routeSnapshot,
        };
      }

      const adjustmentKRW = effectivePricing.amountKRW - oldAmountKRW;
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

      if (currentDiff.priceAffecting) {
        const proposalRevision = currentRevision;
        const proposedQuote = {
          ...effectiveQuote,
          status: 'awaiting_mood',
          proposedByEmail: email,
          proposedByRole: 'admin',
          proposedAt: now,
          proposalRevision,
          previewExpiresAt: effectiveQuote.expiresAt,
          expiresAt: null,
        };
        proposedQuote.integrityHash = quoteHash(proposedQuote);
        const approvalSummary = bookingChangeApprovalSummary(proposedQuote);
        const response = {
          ok: true,
          data: {
            bookingId,
            quoteId: requestedQuoteId,
            status: 'awaiting_mood',
            proposalRevision,
            currency: 'KRW',
            oldAmountKRW,
            amountKRW: effectivePricing.amountKRW,
            adjustmentKRW,
            balanceKRW: newBalanceKRW,
            changedFields: currentDiff.changedFields,
            booking: { id: bookingId, ...booking, revision: proposalRevision, bookingChangeApproval: approvalSummary },
          },
        };
        tx.update(bookingRef, {
          bookingChangeApproval: approvalSummary,
          updatedAt: now,
          updatedByEmail: email,
        });
        tx.set(quoteRef, proposedQuote);
        tx.set(auditRef, {
          type: 'booking_change_proposed',
          bookingId,
          clientId: booking.clientId,
          actorEmail: email,
          reason,
          expectedRevision,
          proposalRevision,
          oldAmountKRW,
          proposedAmountKRW: effectivePricing.amountKRW,
          adjustmentKRW,
          balanceBeforeKRW: balanceKRW,
          proposedBalanceAfterKRW: newBalanceKRW,
          changedFields: currentDiff.changedFields,
          currency: 'KRW',
          quoteId: requestedQuoteId,
          createdAt: now,
        });
        tx.set(outboxRef, {
          type: 'mood_booking_change_approval_requested',
          topic: 'booking',
          bookingId,
          clientId: booking.clientId,
          actorEmail: email,
          proposalRevision,
          reason,
          oldAmountKRW,
          proposedAmountKRW: effectivePricing.amountKRW,
          adjustmentKRW,
          changedFields: currentDiff.changedFields,
          quoteId: requestedQuoteId,
          currency: 'KRW',
          status: 'pending',
          attemptCount: 0,
          createdAt: now,
        });
        tx.set(idempotencyRef, {
          action: 'propose',
          bookingId,
          actorEmail: email,
          payloadHash,
          quoteId: requestedQuoteId,
          currency: 'KRW',
          status: 'completed',
          response,
          createdAt: now,
          completedAt: now,
        });
        return {
          ok: true,
          replayed: false,
          response,
          notification: {
            kind: 'proposal',
            snapshot,
            reason,
            oldAmountKRW,
            amountKRW: effectivePricing.amountKRW,
          },
        };
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
        revision: nextRevision,
        updatedAt: now,
        updatedByEmail: email,
        lastChangeReason: reason,
        courseMoodPercentages: snapshot.courseMoodPercentages,
        courseShareSchemaVersion: snapshot.courseShareSchemaVersion,
        coursePayers: snapshot.coursePayers,
      };
      if (currentDiff.requiresRoutePricing) {
        bookingPatch.amountKRW = effectivePricing.amountKRW;
        bookingPatch.ratePerHour = effectivePricing.ratePerHour;
        bookingPatch.breakdown = effectivePricing.breakdown;
        bookingPatch.routeSnapshot = effectivePricing.routeSnapshot;
        bookingPatch.balanceAfterKRW = newBalanceKRW;
        bookingPatch.lastAdjustmentKRW = adjustmentKRW;
      }
      const preserveStoredRouteSchedule = !snapshot.hasRouteSchedule
        && routeMatchesSnapshot(booking.breakdown, snapshot)
        && String(booking.startTime || '').trim() === snapshot.startTime;
      const clearStoredRouteSchedule = !snapshot.hasRouteSchedule
        && !preserveStoredRouteSchedule
        && hasOwn(booking, 'routeSchedule');
      if (snapshot.hasRouteSchedule) {
        bookingPatch.routeSchedule = snapshot.routeSchedule;
      } else if (clearStoredRouteSchedule) {
        bookingPatch.routeSchedule = FieldValue.delete();
      }
      if (snapshot.hasInfluencerName) {
        bookingPatch.influencerName = snapshot.influencerName || null;
      }
      const beforeSnapshot = {
        ...booking,
        courseMoodPercentages: currentDiff.storedCourseShare.percentages,
        courseShareSchemaVersion: COURSE_SHARE_SCHEMA_VERSION,
        coursePayers: currentDiff.storedCourseShare.payers,
      };
      const afterSnapshot = { ...beforeSnapshot, ...bookingPatch };
      if (clearStoredRouteSchedule) delete afterSnapshot.routeSchedule;
      const response = {
        ok: true,
        data: {
          bookingId,
          revision: nextRevision,
          oldAmountKRW,
          amountKRW: effectivePricing.amountKRW,
          adjustmentKRW,
          balanceKRW: newBalanceKRW,
          breakdown: effectivePricing.breakdown,
          changedFields: currentDiff.changedFields,
          priceAffecting: currentDiff.priceAffecting,
          quoteId: currentDiff.priceAffecting ? requestedQuoteId : null,
          booking: { id: bookingId, ...afterSnapshot },
        },
      };

      if (adjustmentKRW !== 0) tx.update(clientRef, { balanceKRW: newBalanceKRW });
      tx.update(bookingRef, bookingPatch);
      if (currentDiff.priceAffecting && quoteRef) {
        tx.update(quoteRef, {
          status: 'consumed',
          consumedAt: now,
          consumedByEmail: email,
          consumedByIdempotencyId: idempotencyDocumentId,
        });
      }
      tx.set(auditRef, {
        type: 'booking_changed',
        bookingId,
        clientId: booking.clientId,
        actorEmail: email,
        reason,
        expectedRevision,
        revision: nextRevision,
        oldAmountKRW,
        newAmountKRW: effectivePricing.amountKRW,
        adjustmentKRW,
        balanceBeforeKRW: balanceKRW,
        balanceAfterKRW: newBalanceKRW,
        changedFields: currentDiff.changedFields,
        priceAffecting: currentDiff.priceAffecting,
        currency: 'KRW',
        quoteId: currentDiff.priceAffecting ? requestedQuoteId : null,
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
        newAmountKRW: effectivePricing.amountKRW,
        adjustmentKRW,
        changedFields: currentDiff.changedFields,
        quoteId: currentDiff.priceAffecting ? requestedQuoteId : null,
        currency: 'KRW',
        status: 'pending',
        attemptCount: 0,
        createdAt: now,
      });
      tx.set(idempotencyRef, {
        action: 'confirm',
        bookingId,
        actorEmail: email,
        payloadHash,
        quoteId: currentDiff.priceAffecting ? requestedQuoteId : null,
        currency: 'KRW',
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
        ...(transactionResult.reason ? { reason: transactionResult.reason } : {}),
        ...(typeof transactionResult.currentRevision === 'number'
          ? { currentRevision: transactionResult.currentRevision }
          : {}),
      });
    }

    if (!transactionResult.replayed) {
      try {
        if (transactionResult.notification.kind === 'proposal') {
          await notify('booking', [
            '<b>MOOD 예약 변경 금액 확인 요청</b>',
            `${transactionResult.notification.snapshot.date} ${transactionResult.notification.snapshot.startTime}`,
            `${transactionResult.notification.oldAmountKRW.toLocaleString('ko-KR')}원 → ${transactionResult.notification.amountKRW.toLocaleString('ko-KR')}원`,
            'MOOD 확인 전 — 예약 금액과 잔액은 아직 바뀌지 않았습니다.',
            `제안: ${email}`,
          ].join('\n'));
        } else {
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
        }
      } catch (notifyError) {
        console.warn('[mood-change] notify failed:', notifyError && notifyError.message ? notifyError.message : notifyError);
      }
    }

    return sendJson(res, 200, jsonHeaders, publicResponse(transactionResult.response));
  } catch (error) {
    console.error('[mood-change] failed:', error && error.message ? error.message : error);
    await captureError(error, { route: '/api/mood-change', email, bookingId });
    return sendJson(res, 500, jsonHeaders, { ok: false, error: 'SERVER_ERROR' });
  }
}
