/**
 * POST /api/charter-route-km — 차터 경유지 경로 거리(km) 견적 (표시 전용).
 *
 * 차터 예약 위자드가 출발/경유/도착 좌표로 실제 도로 주행거리(km)를 미리 받아 견적가를
 * 계산·표시한다. 프론트는 서버 TMAP_APP_KEY 를 못 쓰므로 이 엔드포인트를 경유.
 *
 * 🔴 표시 전용: 실제 청구는 createPaypalOrder.js 가 동일 좌표(body.routeCoords)로 TMAP km 를
 *   다시 재조회해 백엔드에서 재계산한다(P311, 이 응답값은 신뢰 안 함). 둘 다 trafficInfo:'N'
 *   결정론 → 같은 좌표면 같은 km → 표시가==청구가.
 *
 * body: { origin:{lng,lat}, dest:{lng,lat}, waypoints?:[{lng,lat}...] } (최대 5 경유지)
 * 반환: { ok:true, data:{ km, meters, source:'tmap' } } | { ok:false, error }
 *
 * 인증 없음(차터 견적은 비로그인 위자드) — 응답은 거리 숫자뿐(민감정보 없음). 좌표 검증 +
 *   경유지 5 cap 은 helper 가 담당. FEATURE_CHARTER_WAYPOINTS OFF 여도 이 엔드포인트는 살아있음
 *   (표시 견적용); 실제 결제 게이트만 플래그로 잠근다.
 */
import { fetchTmapCarRouteKm, extractRouteCoords } from './_tmap_car_route.js';

export const maxDuration = 15;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_CORS = { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, JSON_CORS);
    return res.end();
  }
  if (req.method !== 'POST') {
    res.writeHead(405, JSON_CORS);
    return res.end(JSON.stringify({ ok: false, error: 'POST only' }));
  }

  // body 파싱 (Vercel node runtime 은 자동 파싱 안 될 수 있어 방어적으로 처리).
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') {
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify({ ok: false, error: 'invalid body' }));
  }

  // routeCoords 래핑이 없으면(프론트가 origin/dest 를 top-level 로 보낸 경우) 감싸서 재사용.
  const wrapped = body.routeCoords ? body : { routeCoords: { origin: body.origin, dest: body.dest, waypoints: body.waypoints } };
  const coords = extractRouteCoords(wrapped);
  if (!coords) {
    res.writeHead(400, JSON_CORS);
    return res.end(JSON.stringify({ ok: false, error: 'origin·dest 좌표(lng/lat) 필수' }));
  }

  try {
    const route = await fetchTmapCarRouteKm(coords.origin, coords.dest, coords.waypoints);
    if (!route || !(route.km > 0)) {
      res.writeHead(502, JSON_CORS);
      return res.end(JSON.stringify({ ok: false, error: '경로 거리 조회 실패' }));
    }
    res.writeHead(200, JSON_CORS);
    return res.end(JSON.stringify({ ok: true, data: { km: route.km, meters: route.meters, source: route.source } }));
  } catch (err) {
    console.error('[charter-route-km] failed:', err?.message);
    res.writeHead(500, JSON_CORS);
    return res.end(JSON.stringify({ ok: false, error: '서버 오류' }));
  }
}
