/**
 * POST /api/mood-quote-preview — 관리자 전용 업체 차량 견적 미리보기.
 *
 * 실제 예약/잔액/결제에는 쓰지 않는다. profile version snapshot + 서버 계산 결과 +
 * 같은 snapshot에서 만든 고객용 한글 복사문을 반환한다.
 */
import { createHash } from 'node:crypto';
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { captureError } from './_shared/sentry.js';
import { buildAdminJsonCors } from './_shared/cors.js';
import { getMoodAllowlist, isAdminEmail } from './_shared/mood-allowlist.js';
import { computeRoute } from './_shared/mood-route.js';
import {
  BUILT_IN_MOOD_QUOTE_PROFILE,
  calculateVehicleQuote,
  formatVehicleQuoteDocument,
  normalizeVehicleQuoteProfile,
  timeSpanMinutes,
  validateScheduleBasics,
} from './_shared/vehicle-quote.js';
import {
  detectQuoteRegionConflicts,
  formatQuoteRegionConflictWarning,
} from './_shared/vehicle-quote-region.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const METHODS = 'POST, OPTIONS';
const PROFILE_COLLECTION = 'mood_quote_profiles';
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,49}$/;

function headers(req) {
  return {
    'Cache-Control': 'no-store',
    ...buildAdminJsonCors(req, { methods: METHODS, headers: 'Authorization, Content-Type' }),
  };
}

function send(res, status, responseHeaders, payload) {
  res.writeHead(status, responseHeaders);
  return res.end(JSON.stringify(payload));
}

function parseBody(req) {
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  return body && typeof body === 'object' ? body : {};
}

function versionDocId(version) {
  return `v${String(version).padStart(6, '0')}`;
}

async function requireMoodAdmin(req, db) {
  const auth = await verifyUserToken(req);
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.error, code: 'AUTH_REQUIRED' };
  if (!auth.emailVerified) {
    return { ok: false, status: 403, error: '이메일 미검증', code: 'EMAIL_UNVERIFIED' };
  }
  const allowlist = await getMoodAllowlist(db);
  if (!isAdminEmail(allowlist, auth.email)) {
    return { ok: false, status: 403, error: '권한 없음 (관리자 전용)', code: 'ADMIN_ONLY' };
  }
  return { ok: true, email: auth.email, uid: auth.uid || '' };
}

async function loadProfile(db, profileId, requestedVersion) {
  if (!PROFILE_ID_RE.test(profileId)) return { ok: false, status: 400, error: 'INVALID_PROFILE_ID' };

  if (requestedVersion === BUILT_IN_MOOD_QUOTE_PROFILE.version
    && profileId === BUILT_IN_MOOD_QUOTE_PROFILE.id) {
    return { ok: true, profile: { ...BUILT_IN_MOOD_QUOTE_PROFILE } };
  }

  const ref = db.collection(PROFILE_COLLECTION).doc(profileId);
  let snap;
  if (requestedVersion) {
    snap = await ref.collection('versions').doc(versionDocId(requestedVersion)).get();
  } else {
    snap = await ref.get();
  }

  if (!snap.exists) {
    if (!requestedVersion && profileId === BUILT_IN_MOOD_QUOTE_PROFILE.id) {
      return { ok: true, profile: { ...BUILT_IN_MOOD_QUOTE_PROFILE } };
    }
    return { ok: false, status: 404, error: 'PROFILE_NOT_FOUND' };
  }
  const data = snap.data() || {};
  if (data.archived === true) return { ok: false, status: 404, error: 'PROFILE_ARCHIVED' };
  const normalized = normalizeVehicleQuoteProfile({ ...data, id: profileId }, {
    fallback: profileId === BUILT_IN_MOOD_QUOTE_PROFILE.id ? BUILT_IN_MOOD_QUOTE_PROFILE : data,
  });
  if (!normalized.ok) return { ok: false, status: 500, error: 'INVALID_STORED_PROFILE' };
  return {
    ok: true,
    profile: {
      ...normalized.profile,
      builtIn: profileId === BUILT_IN_MOOD_QUOTE_PROFILE.id,
    },
  };
}

function routeAddressForStop(stop) {
  return String(stop.roadAddress || stop.jibunAddress || '').trim();
}

export function buildQuoteRouteAddresses(schedule) {
  const addresses = [];
  if (schedule.departureAddress) addresses.push(schedule.departureAddress);
  for (const stop of schedule.stops) {
    if (!stop.includeInRoute) continue;
    const address = routeAddressForStop(stop);
    if (!address) {
      return { ok: false, error: 'ROUTE_ADDRESS_REQUIRED', stopOrder: stop.order };
    }
    if (!stop.addressVerified) {
      return { ok: false, error: 'ROUTE_ADDRESS_NOT_CONFIRMED', stopOrder: stop.order };
    }
    if (addresses[addresses.length - 1] !== address) addresses.push(address);
  }
  if (schedule.returnAddress && addresses[addresses.length - 1] !== schedule.returnAddress) {
    addresses.push(schedule.returnAddress);
  }
  if (addresses.length < 2) return { ok: false, error: 'ROUTE_NEEDS_TWO_ADDRESSES' };
  return { ok: true, addresses };
}

export function buildManualQuoteRouteAddresses(schedule) {
  const addresses = [];
  if (schedule.departureAddress) addresses.push(schedule.departureAddress);
  for (const stop of schedule.stops) {
    if (!stop.includeInRoute) continue;
    const address = routeAddressForStop(stop);
    if (address && addresses[addresses.length - 1] !== address) addresses.push(address);
  }
  if (schedule.returnAddress && addresses[addresses.length - 1] !== schedule.returnAddress) {
    addresses.push(schedule.returnAddress);
  }
  if (addresses.length < 2) return { ok: false, error: 'ROUTE_NEEDS_TWO_ADDRESSES' };
  return { ok: true, addresses };
}

async function computeLongRoute(addresses) {
  let cursor = 0;
  let distanceMeters = 0;
  let tollKRW = 0;
  let durationMinutes = 0;
  const path = [];
  const points = [];

  // Naver Directions 1회 제한(출발+도착+경유 5개)에 맞춰 7개씩 겹쳐 호출한다.
  while (cursor < addresses.length - 1) {
    const chunk = addresses.slice(cursor, cursor + 7);
    const result = await computeRoute({
      origin: chunk[0],
      destination: chunk[chunk.length - 1],
      waypoints: chunk.slice(1, -1),
    });
    if (!result.ok) return result;
    let segmentDistanceMeters = null;
    if (typeof result.distanceMeters === 'number'
      && Number.isFinite(result.distanceMeters)
      && result.distanceMeters >= 0) {
      segmentDistanceMeters = Math.round(result.distanceMeters);
    } else if (typeof result.km === 'number' && Number.isFinite(result.km) && result.km >= 0) {
      segmentDistanceMeters = Math.round(result.km * 1000);
    }
    if (segmentDistanceMeters === null) {
      return { ok: false, status: 502, error: 'ROUTE_LOOKUP_FAILED' };
    }
    distanceMeters += segmentDistanceMeters;
    tollKRW += Number(result.tollKRW) || 0;
    durationMinutes += Number(result.durationMin) || 0;
    const resultPath = Array.isArray(result.path) ? result.path : [];
    const resultPoints = Array.isArray(result.points) ? result.points : [];
    path.push(...(path.length ? resultPath.slice(1) : resultPath));
    points.push(...(points.length ? resultPoints.slice(1) : resultPoints));
    cursor += chunk.length - 1;
  }
  return { ok: true, distanceMeters, tollKRW, durationMinutes, path, points };
}

function manualDistanceMeters(value) {
  if (typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > 3000) return null;
  return Math.round(value * 1000);
}

function optionalIntegerAmount(source, field) {
  if (!Object.prototype.hasOwnProperty.call(source, field)) return 0;
  const value = source[field];
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
    || value > 10000000) return null;
  return value;
}

function scheduleWarnings(schedule, routeMode, computedSpan) {
  const warnings = [];
  if (!schedule.stops.length) warnings.push('방문 장소가 입력되지 않았습니다.');
  for (const stop of schedule.stops) {
    if (!stop.roadAddress && !stop.jibunAddress) warnings.push(`${stop.order}번 장소의 주소 확인이 필요합니다.`);
    if (!stop.addressVerified) warnings.push(`${stop.order}번 장소의 주소가 아직 확인되지 않았습니다.`);
    if (!stop.naverMapUrl) warnings.push(`${stop.order}번 장소의 네이버 지도 링크 확인이 필요합니다.`);
  }
  if (routeMode === 'manual') warnings.push('예상 운행거리를 관리자가 직접 입력한 견적입니다.');
  if (computedSpan && schedule.timeMinutes !== computedSpan) {
    warnings.push(`입력한 총 이용시간(${schedule.timeMinutes}분)과 시작·종료 시각 차이(${computedSpan}분)가 다릅니다.`);
  }
  return [...new Set(warnings)];
}

function hashSnapshot(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export default async function handler(req, res) {
  const responseHeaders = headers(req);
  if (req.method === 'OPTIONS') return send(res, 200, responseHeaders, {});
  if (req.method !== 'POST') {
    return send(res, 405, responseHeaders, { ok: false, error: 'POST only', code: 'METHOD_NOT_ALLOWED' });
  }

  const db = initAdminDb('mood-quote-preview');
  if (!db) return send(res, 500, responseHeaders, { ok: false, error: 'Firestore unavailable', code: 'DB_UNAVAILABLE' });

  let auth;
  try {
    auth = await requireMoodAdmin(req, db);
  } catch (error) {
    await captureError(error, { route: '/api/mood-quote-preview', phase: 'auth' });
    return send(res, 500, responseHeaders, { ok: false, error: '서버 오류', code: 'INTERNAL_ERROR' });
  }
  if (!auth.ok) return send(res, auth.status, responseHeaders, auth);

  const body = parseBody(req);
  const profileId = String(body.profileId || BUILT_IN_MOOD_QUOTE_PROFILE.id).toLowerCase().trim();
  const hasProfileVersion = Object.prototype.hasOwnProperty.call(body, 'profileVersion');
  if (hasProfileVersion
    && (!Number.isSafeInteger(body.profileVersion) || body.profileVersion <= 0)) {
    return send(res, 400, responseHeaders, {
      ok: false,
      error: 'INVALID_PROFILE_VERSION',
      code: 'INVALID_PROFILE_VERSION',
    });
  }
  const profileVersion = hasProfileVersion ? body.profileVersion : null;
  const hasRouteMode = Object.prototype.hasOwnProperty.call(body, 'routeMode');
  if (!hasRouteMode || (body.routeMode !== 'route' && body.routeMode !== 'manual')) {
    return send(res, 400, responseHeaders, {
      ok: false,
      error: 'INVALID_ROUTE_MODE',
      code: 'INVALID_ROUTE_MODE',
    });
  }
  const routeMode = body.routeMode;

  try {
    const loaded = await loadProfile(db, profileId, profileVersion);
    if (!loaded.ok) return send(res, loaded.status, responseHeaders, { ok: false, error: loaded.error, code: loaded.error });

    const scheduleResult = validateScheduleBasics(body);
    if (!scheduleResult.ok) {
      return send(res, 400, responseHeaders, { ok: false, error: scheduleResult.error, code: scheduleResult.error });
    }
    const schedule = scheduleResult.schedule;
    const conflicts = detectQuoteRegionConflicts(schedule.stops);
    let route;
    if (routeMode === 'route') {
      const addressResult = buildQuoteRouteAddresses(schedule);
      if (!addressResult.ok) {
        return send(res, 400, responseHeaders, {
          ok: false,
          error: addressResult.error,
          code: addressResult.error,
          ...(addressResult.stopOrder ? { stopOrder: addressResult.stopOrder } : {}),
        });
      }
      const routeResult = await computeLongRoute(addressResult.addresses);
      if (!routeResult.ok) {
        return send(res, routeResult.status || 502, responseHeaders, {
          ok: false,
          error: routeResult.error || 'ROUTE_LOOKUP_FAILED',
          code: 'ROUTE_LOOKUP_FAILED',
        });
      }
      route = {
        source: 'route',
        distanceMeters: routeResult.distanceMeters,
        distanceKm: routeResult.distanceMeters / 1000,
        durationMinutes: routeResult.durationMinutes,
        tollKRW: routeResult.tollKRW,
        path: routeResult.path,
        points: routeResult.points,
      };
    } else {
      const addressResult = buildManualQuoteRouteAddresses(schedule);
      if (!addressResult.ok) {
        return send(res, 400, responseHeaders, {
          ok: false,
          error: addressResult.error,
          code: addressResult.error,
        });
      }
      const distanceMeters = manualDistanceMeters(body.manualDistanceKm);
      if (distanceMeters === null) {
        return send(res, 400, responseHeaders, { ok: false, error: 'INVALID_MANUAL_DISTANCE', code: 'INVALID_MANUAL_DISTANCE' });
      }
      const tollKRW = optionalIntegerAmount(body, 'manualTollKRW');
      if (tollKRW === null) {
        return send(res, 400, responseHeaders, { ok: false, error: 'INVALID_TOLL_AMOUNT', code: 'INVALID_TOLL_AMOUNT' });
      }
      route = {
        source: 'manual',
        distanceMeters,
        distanceKm: distanceMeters / 1000,
        durationMinutes: null,
        tollKRW,
        path: [],
        points: [],
      };
    }

    const manualTollKRW = optionalIntegerAmount(body, 'manualTollKRW');
    const parkingKRW = optionalIntegerAmount(body, 'parkingKRW');
    if (manualTollKRW === null || parkingKRW === null) {
      return send(res, 400, responseHeaders, { ok: false, error: 'INVALID_INCIDENTAL_AMOUNT', code: 'INVALID_INCIDENTAL_AMOUNT' });
    }
    const quote = calculateVehicleQuote(loaded.profile, {
      timeMinutes: schedule.timeMinutes,
      distanceMeters: route.distanceMeters,
      routeTollKRW: route.tollKRW,
      manualTollKRW,
      manualParkingKRW: parkingKRW,
    });
    if (!quote.ok) return send(res, 400, responseHeaders, { ok: false, error: quote.error, code: quote.error });

    const computedSpan = timeSpanMinutes(schedule.startTime, schedule.endTime);
    const warnings = [
      ...scheduleWarnings(schedule, routeMode, computedSpan),
      ...conflicts.map(formatQuoteRegionConflictWarning),
    ];
    const snapshotData = {
      schemaVersion: 1,
      generatedAt: Date.now(),
      generatedByEmail: auth.email,
      profile: loaded.profile,
      schedule,
      route: {
        source: route.source,
        distanceMeters: route.distanceMeters,
        durationMinutes: route.durationMinutes,
        tollKRW: route.tollKRW,
      },
      breakdown: quote.breakdown,
      conflicts,
      warnings,
    };
    const quoteSnapshot = { ...snapshotData, snapshotHash: hashSnapshot(snapshotData) };
    const documentText = formatVehicleQuoteDocument({
      profile: loaded.profile,
      schedule,
      route,
      breakdown: quote.breakdown,
      warnings,
    });

    return send(res, 200, responseHeaders, {
      ok: true,
      data: {
        profile: loaded.profile,
        route,
        breakdown: quote.breakdown,
        documentText,
        conflicts,
        warnings,
        quoteSnapshot,
      },
    });
  } catch (error) {
    console.error('[mood-quote-preview] failed:', error.message);
    await captureError(error, { route: '/api/mood-quote-preview', email: auth.email });
    return send(res, 500, responseHeaders, { ok: false, error: '서버 오류', code: 'INTERNAL_ERROR' });
  }
}
