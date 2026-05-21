/**
 * Vercel API Route: Rebuild zone-course transit matrix (Track C, 2026-05-21)
 *
 * POST /api/admin-rebuild-zone-course-transit
 * Headers: Authorization: Bearer <Firebase-ID-token>  (admin only)
 *
 * Body:
 *   {
 *     blockId: string,
 *     stops: Array<{ order, name, address, lat?, lng?, stay_min }>
 *   }
 *
 * Returns:
 *   {
 *     ok: true,
 *     data: {
 *       transit_matrix: Record<"i->j", ZoneCourseTransit>,
 *       updated_stops?: ZoneCourseStop[], // Naver Geocoding 으로 채운 lat/lng
 *       notices: string[]
 *     }
 *   }
 *
 * 구현은 scripts/build-zone-course.mjs 의 buildBlock 핵심 로직 재사용:
 *   - Naver Geocoding (lat/lng 누락 시)
 *   - ODsay searchPubTransPathT (transit 매트릭스)
 *   - API key 부재 시 mock fallback (haversine 거리 기반 15분 default)
 *
 * 운영자는 ENV (NCP_CLIENT_ID/SECRET, ODSAY_API_KEY) 부재로 mock 결과만 받을 수
 * 있음 — notices 에 명시. 그 외엔 silent fail 금지.
 */
import { verifyAdminToken } from './_shared/admin-auth.js';
import { wrapHandler, captureError } from './_shared/sentry.js';
import { buildAdminCors, buildAdminJsonCors } from './_shared/cors.js';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const NAVER_GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode';
const ODSAY_BASE = 'https://api.odsay.com/v1/api';

const CORS_METHODS = 'POST, OPTIONS';

function json(req, res, status, body) {
  res.writeHead(status, buildAdminJsonCors(req, { methods: CORS_METHODS }));
  return res.end(JSON.stringify(body));
}

async function geocodeNaver(query, clientId, clientSecret) {
  const url = new URL(NAVER_GEOCODE_URL);
  url.searchParams.set('query', query);
  const res = await fetch(url.toString(), {
    headers: {
      'X-NCP-APIGW-API-KEY-ID': clientId,
      'X-NCP-APIGW-API-KEY': clientSecret,
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Naver Geocode HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.addresses?.length) return null;
  const a = data.addresses[0];
  return {
    lat: parseFloat(a.y),
    lng: parseFloat(a.x),
    matched_address: a.roadAddress || a.jibunAddress || query,
  };
}

async function searchOdsay(sx, sy, ex, ey, apiKey) {
  const url = `${ODSAY_BASE}/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${encodeURIComponent(apiKey)}&output=json`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { Referer: 'https://cocotripkr.com' },
  });
  if (!res.ok) throw new Error(`ODsay HTTP ${res.status}`);
  const data = await res.json();
  if (data.error || !data.result?.path?.length) return null;
  const best = data.result.path[0];
  const info = best.info;
  return {
    pathType: info.pathType,
    totalTime: info.totalTime,
    payment: info.payment,
    distance: info.totalDistance,
  };
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371e3;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function pathTypeToMode(pathType) {
  if (pathType === 1) return 'subway';
  if (pathType === 2) return 'bus';
  return 'mixed';
}

function buildNaverRouteUrl(fromName, fromLat, fromLng, toName, toLat, toLng) {
  const encFrom = encodeURIComponent(fromName);
  const encTo   = encodeURIComponent(toName);
  return `https://map.naver.com/p/directions/${fromLng},${fromLat},${encFrom},,/${toLng},${toLat},${encTo},,/-/transit`;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, buildAdminCors(req, { methods: CORS_METHODS }));
    return res.end();
  }
  if (req.method !== 'POST') {
    return json(req, res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  const auth = await verifyAdminToken(req);
  if (!auth.ok) {
    return json(req, res, auth.status, { ok: false, error: auth.error, code: 'AUTH_FAILED' });
  }

  let body;
  try { body = await readJsonBody(req); }
  catch (err) {
    return json(req, res, 400, { ok: false, error: `Invalid JSON: ${err.message}`, code: 'BAD_JSON' });
  }

  const blockId = body?.blockId;
  const stopsIn = Array.isArray(body?.stops) ? body.stops : null;
  if (!blockId || !stopsIn || stopsIn.length < 2) {
    return json(req, res, 400, {
      ok: false,
      error: 'blockId + stops (2 개 이상) 필요',
      code: 'INVALID_INPUT',
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const NCP_ID = (process.env.NCP_CLIENT_ID || '').trim();
  const NCP_SECRET = (process.env.NCP_CLIENT_SECRET || '').trim();
  const ODSAY_KEY = (process.env.ODSAY_API_KEY || '').trim();
  const hasNaver = !!(NCP_ID && NCP_SECRET);
  const hasOdsay = !!ODSAY_KEY;

  const notices = [];
  if (!hasNaver) notices.push('NCP_CLIENT_ID/SECRET 부재 — lat/lng=0 placeholder (운영자 수동 입력 또는 Vercel ENV 등록 후 재실행).');
  if (!hasOdsay) notices.push('ODSAY_API_KEY 부재 — transit_matrix 항목 mock (haversine 거리 + 15분 default).');

  try {
    // 1) Geocode (lat/lng 없는 stop 만)
    const updatedStops = [];
    for (const raw of stopsIn) {
      const stop = { ...raw };
      const needGeocode = (!stop.lat || stop.lat === 0) && stop.address;
      if (needGeocode && hasNaver) {
        try {
          const geo = await geocodeNaver(stop.address, NCP_ID, NCP_SECRET);
          if (geo) {
            stop.lat = geo.lat;
            stop.lng = geo.lng;
          } else {
            notices.push(`Geocode no-match: stop ${stop.order} "${stop.name || stop.address}"`);
          }
        } catch (err) {
          notices.push(`Geocode 실패 stop ${stop.order}: ${err.message}`);
        }
      }
      updatedStops.push(stop);
    }

    // 2) Transit matrix (연속 pair)
    const transit_matrix = {};
    for (let i = 0; i < updatedStops.length - 1; i++) {
      const a = updatedStops[i];
      const b = updatedStops[i + 1];
      const key = `${a.order}->${b.order}`;
      const fromName = a.name || a.address || `Stop ${a.order}`;
      const toName   = b.name || b.address || `Stop ${b.order}`;

      let entry = null;
      const canOdsay = hasOdsay && a.lat && a.lng && b.lat && b.lng;
      if (canOdsay) {
        try {
          const od = await searchOdsay(a.lng, a.lat, b.lng, b.lat, ODSAY_KEY);
          if (od) {
            entry = {
              from_order: a.order,
              to_order: b.order,
              mode: pathTypeToMode(od.pathType),
              duration_min: od.totalTime,
              distance_m: od.distance,
              cost_krw: od.payment,
              naver_route_url: buildNaverRouteUrl(fromName, a.lat, a.lng, toName, b.lat, b.lng),
              source: 'odsay_api',
              fetched_at: today,
            };
          }
        } catch (err) {
          notices.push(`ODsay 실패 ${key}: ${err.message}`);
        }
      }

      if (!entry) {
        const dist = a.lat && b.lat ? haversineMeters(a.lat, a.lng, b.lat, b.lng) : 1000;
        entry = {
          from_order: a.order,
          to_order: b.order,
          mode: 'mixed',
          duration_min: 15,
          distance_m: Math.round(dist),
          cost_krw: 1500,
          source: 'mock',
          fetched_at: today,
          notes: 'API call skipped, manual verification needed',
        };
      }
      transit_matrix[key] = entry;
    }

    return json(req, res, 200, {
      ok: true,
      data: {
        transit_matrix,
        updated_stops: updatedStops,
        notices,
      },
    });
  } catch (err) {
    await captureError(err, { route: '/api/admin-rebuild-zone-course-transit', blockId });
    return json(req, res, 500, {
      ok: false,
      error: err?.message || 'Unexpected error',
      code: 'REBUILD_FAILED',
    });
  }
}

export default wrapHandler(handler);
