/**
 * POST /api/course-route — 코스 빌더/공유 코스의 "실제 대중교통 경로" (2026-07-19)
 *
 * 사용자가 직접 짠 코스(좌표 배열)를 받아 구간마다 TMAP 대중교통을 조회하고,
 * 지도에 그릴 수 있는 실경로 세그먼트를 돌려준다. 플랜(PlanDetailPage)이 쓰는
 * steps_detail geometry 와 **같은 형태**라 프론트가 동일 렌더 코드를 재사용한다.
 *   · path: 평탄 배열 [lat,lng,lat,lng, …]  ← Firestore 중첩배열 금지 정책과 동일 형태
 *   · routeColor: 노선 공식 색 / fromPoint·toPoint: 승하차 지점(이름+좌표)
 *
 * 인증 없음(플래너 공개 기능, course-ai 와 동일 정책) — 대신 아래로 남용/비용 방어:
 *   · 구간 상한(MAX_LEGS) — 코스가 길어도 조회는 여기까지
 *   · IP rate-limit 시간당 30회 (TMAP 유료 호출이라 course-ai 와 같은 계열 방어)
 *   · 좌표 유효성 검사, 동일 좌표(0m) 구간 skip
 * TMAP 실패/키 미설정은 fail-soft — 해당 구간만 비우고 200 으로 응답(프론트가 직선 폴백).
 */
import { searchTransitRouteTmap } from './_tmap_helper.js';
import { checkIpRateLimit, getClientIp } from './_shared/ip-rate-limit.js';
import { initAdminDb } from './_shared/firebase-admin.js';
import { captureError } from './_shared/sentry.js';

export const maxDuration = 30;
export const config = { runtime: 'nodejs' };

const _rateDb = initAdminDb('course-route');

const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const MAX_STOPS = 20;
const MAX_LEGS = 12;          // 조회 구간 상한(비용). 초과분은 프론트가 직선으로 남긴다.
const MIN_LEG_KM = 0.05;      // 50m 미만은 같은 지점 취급 — 호출 낭비 방지

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const validCoord = (s) => s && isNum(s.lat) && isNum(s.lng)
  && s.lat >= -90 && s.lat <= 90 && s.lng >= -180 && s.lng <= 180;

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(JSON_HEADERS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED' });

  // 비용 DoS 방어 — TMAP 유료 호출. fail-open(Firestore 장애 시 실사용자 안 막음).
  const rate = await checkIpRateLimit({
    db: _rateDb, ip: getClientIp(req), collection: 'course_route_rate_limits',
    maxRequests: 30, errorLabel: 'course route lookups',
  });
  if (!rate.ok) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    return res.status(rate.status).json({ ok: false, code: 'RATE_LIMITED', error: rate.error });
  }

  try {
    const stops = Array.isArray(req.body?.stops) ? req.body.stops.slice(0, MAX_STOPS) : [];
    const valid = stops.filter(validCoord);
    if (valid.length < 2) return res.status(200).json({ ok: true, segments: [], reason: 'NOT_ENOUGH_COORDS' });

    const segments = [];
    let looked = 0;
    for (let i = 1; i < valid.length; i++) {
      if (looked >= MAX_LEGS) break;
      const a = valid[i - 1], b = valid[i];
      if (haversineKm(a.lat, a.lng, b.lat, b.lng) < MIN_LEG_KM) continue;
      looked++;
      let route = null;
      try {
        route = await searchTransitRouteTmap(a.lng, a.lat, b.lng, b.lat);
      } catch (e) {
        // transient(5xx/타임아웃)는 helper 가 throw — 구간만 비우고 계속(fail-soft).
        console.info(`[course-route] leg ${i} TMAP error: ${e && e.message}`);
      }
      if (!route || !Array.isArray(route.steps)) continue;
      segments.push({
        from: i - 1,
        to: i,
        method: route.type || 'transit',
        est_min: route.totalTime || 0,
        est_fare_krw: route.fare || 0,
        transfers: route.transfers || 0,
        // 플랜의 steps_detail 과 동일 shape — 프론트 렌더 코드 공유.
        steps_detail: route.steps,
      });
    }
    return res.status(200).json({ ok: true, segments, legsLookedUp: looked, capped: valid.length - 1 > MAX_LEGS });
  } catch (err) {
    captureError(err, { tags: { route: 'course-route' } });
    console.error('[course-route] fatal:', err && err.message);
    // fail-soft: 지도는 직선으로라도 떠야 한다.
    return res.status(200).json({ ok: false, segments: [], code: 'LOOKUP_FAILED' });
  }
}
