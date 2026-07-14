/**
 * _tmap_car_route.js — TMAP 자동차 경로안내 client (경유지 총 주행거리).
 *
 * 차터 경유지 가격 = 경로 총 km × 기존 요율. km 은 **서버에서만** TMAP 로 재조회해
 * 클라 위조 방어(P311). 대중교통 _tmap_helper.js 와 별개 엔드포인트(같은 TMAP_APP_KEY).
 *
 * 엔드포인트: POST https://apis.openapi.sk.com/tmap/routes?version=1&format=json (헤더 appKey)
 *   body: startX/startY(출발 lng/lat) · endX/endY(도착) · passList("x1,y1_x2,y2" 경유지, 최대 5)
 *         reqCoordType/resCoordType = WGS84GEO.
 *   응답: features[0].properties.totalDistance (미터).
 *
 * @param {{lng:number,lat:number}} origin
 * @param {{lng:number,lat:number}} dest
 * @param {{lng:number,lat:number}[]} [waypoints]  최대 5 (TMAP passList 제한)
 * @returns {Promise<{km:number, meters:number, source:'tmap'} | null>}  실패/미설정 시 null.
 */
const TMAP_CAR_ENDPOINT = 'https://apis.openapi.sk.com/tmap/routes?version=1&format=json';

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const validPoint = (p) => p && isFiniteNum(p.lng) && isFiniteNum(p.lat)
  && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;

export async function fetchTmapCarRouteKm(origin, dest, waypoints = []) {
  const appKey = (process.env.TMAP_APP_KEY || '').trim();
  if (!appKey) {
    console.warn('[TMAP-car] TMAP_APP_KEY not configured');
    return null;
  }
  if (!validPoint(origin) || !validPoint(dest)) {
    console.warn('[TMAP-car] invalid origin/dest coords');
    return null;
  }
  const wps = (Array.isArray(waypoints) ? waypoints : []).filter(validPoint).slice(0, 5);

  const body = {
    startX: String(origin.lng),
    startY: String(origin.lat),
    endX: String(dest.lng),
    endY: String(dest.lat),
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO',
    searchOption: '0', // 0 = 교통최적+추천
    trafficInfo: 'N',
  };
  if (wps.length > 0) {
    // TMAP passList 포맷: "x1,y1_x2,y2_..." (lng,lat)
    body.passList = wps.map((p) => `${p.lng},${p.lat}`).join('_');
  }

  try {
    const res = await fetch(TMAP_CAR_ENDPOINT, {
      method: 'POST',
      headers: { appKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn('[TMAP-car] HTTP', res.status);
      return null;
    }
    const data = await res.json();
    // 총 거리 = 첫 feature(전체 경로)의 properties.totalDistance(미터).
    const feats = Array.isArray(data?.features) ? data.features : [];
    let meters = null;
    for (const f of feats) {
      const td = f?.properties?.totalDistance;
      if (isFiniteNum(td) && td > 0) { meters = td; break; }
    }
    if (!isFiniteNum(meters) || meters <= 0) {
      console.info('[TMAP-car] no totalDistance in response');
      return null;
    }
    return { km: Math.round((meters / 1000) * 10) / 10, meters, source: 'tmap' };
  } catch (err) {
    console.warn('[TMAP-car] fetch failed:', err?.message);
    return null;
  }
}

export default fetchTmapCarRouteKm;
