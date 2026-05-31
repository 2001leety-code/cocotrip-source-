/**
 * _tmap_helper.js — TMAP 대중교통 API client (ODsay searchTransitRoute drop-in 대체).
 *
 * 목적: ODsay 와 동일 비용 대비 28~340배 저렴(0.88원/건)한 TMAP 으로 언제든 교체 가능하게
 * "구현만" 해둠. provider 스위치(_transit_provider.js)가 TRANSIT_PROVIDER=tmap 일 때만 사용.
 * 기본은 ODsay → prod 무영향. 출력 shape = ODsay searchTransitRoute 와 100% 동일 →
 * formatTransitSummary / RouteAgent 매핑 그대로 작동.
 *
 * 검증(2026-05-31 P329): ICN→명동 공항철도 급행 43분 직통 native, 서울→부산 KTX native,
 * 소도시(강릉) 커버. 단점: 일부 도심 구간 ODsay보다 느림 + 출발시각 안 넘기면 야간 버스 추천
 * → searchDttm(출발시각) 기본 daytime 보정.
 *
 * 엔드포인트: POST https://apis.openapi.sk.com/transit/routes (헤더 appKey)
 * v1 한계: P184 per-coord 캐시 미적용(TMAP 저렴 + 상위 zone_courses 캐시는 provider 무관 적용).
 */

const TMAP_ENDPOINT = 'https://apis.openapi.sk.com/transit/routes';

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** TMAP leg.mode → ODsay step.mode (subway/bus/walk). 도시간(TRAIN/EXPRESSBUS 등)도 렌더용 subway 처리. */
function legModeToStepMode(mode) {
  const m = String(mode || '').toUpperCase();
  if (m === 'WALK') return 'walk';
  if (m === 'BUS') return 'bus';
  return 'subway'; // SUBWAY / TRAIN / EXPRESSBUS / AIRPLANE / FERRY
}

/**
 * TMAP itinerary → ODsay searchTransitRoute 호환 raw shape (pure, 테스트용 export).
 * @returns {object|null} { type, totalTime(분), fare(원), transfers, distance(m), totalWalk(m),
 *   firstStation, lastStation, steps[], alternatives, _provider:'tmap' }
 */
export function mapTmapItineraryToRoute(it) {
  if (!it) return null;
  const legs = Array.isArray(it.legs) ? it.legs : [];
  const steps = [];
  for (const l of legs) {
    const mode = legModeToStepMode(l.mode);
    const durMin = Math.round((l.sectionTime || 0) / 60);
    if (mode === 'walk') {
      // 0초/극단거리 walk leg 스킵 (ODsay parseSubPath 와 동일 정책).
      if ((l.sectionTime || 0) < 30 && (l.distance || 0) < 30) continue;
      steps.push({
        mode: 'walk',
        distance: l.distance || 0,
        duration: Math.max(1, durMin),
        description: `도보 ${l.distance || 0}m`,
      });
      continue;
    }
    const from = l.start?.name || '';
    const to = l.end?.name || '';
    const stationList = l.passStopList?.stationList || [];
    const stationCount = stationList.length || 0;
    const passStops = stationList.map((s) => s.stationName || s.name).filter(Boolean);
    if (mode === 'bus') {
      const route = String(l.route || '');
      const busType = route.includes(':') ? route.split(':')[0] : null;
      const busNo = route.includes(':') ? route.split(':').slice(1).join(':') : route;
      steps.push({
        mode: 'bus', busNo, busType, from, to, duration: durMin, stationCount, passStops,
        description: `${route || 'Bus'} ${from} → ${to} (${stationCount ? `${stationCount}정거장, ` : ''}${durMin}분)`,
      });
    } else {
      const line = String(l.route || l.Lane?.[0]?.name || '');
      steps.push({
        mode: 'subway', line, lineKo: line, from, to, duration: durMin, stationCount, passStops,
        description: `${line} ${from} → ${to} (${stationCount ? `${stationCount}정거장, ` : ''}${durMin}분)`,
      });
    }
  }
  const transitSteps = steps.filter((s) => s.mode !== 'walk');
  const pathType = it.pathType;
  const type = pathType === 1 ? 'subway' : pathType === 2 ? 'bus' : 'subway+bus';
  return {
    type,
    totalTime: Math.round((it.totalTime || 0) / 60), // 분
    fare: it.fare?.regular?.totalFare || 0, // 원
    transfers: it.transferCount || 0,
    distance: it.totalDistance || 0, // 미터
    totalWalk: it.totalWalkDistance || 0, // 미터
    firstStation: transitSteps[0]?.from || null,
    lastStation: transitSteps[transitSteps.length - 1]?.to || null,
    steps,
    alternatives: 0,
    _provider: 'tmap',
  };
}

/** 출발시각(yyyymmddhhmi). opts.departDttm 우선, 미지정 시 야간/새벽이면 당일 10:00 보정(관광 기준, 야간버스 추천 방지). */
export function buildSearchDttm(opts = {}, now = new Date()) {
  if (opts.departDttm && /^\d{12}$/.test(opts.departDttm)) return opts.departDttm;
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const da = String(now.getDate()).padStart(2, '0');
  const hh = now.getHours();
  if (hh < 7 || hh >= 22) return `${y}${mo}${da}1000`; // daytime 보정
  return `${y}${mo}${da}${String(hh).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * 두 좌표 간 대중교통 경로 검색 (TMAP). ODsay searchTransitRoute 와 동일 시그니처/출력.
 * @param {number} sx 출발 경도 / @param {number} sy 출발 위도 / @param {number} ex 도착 경도 / @param {number} ey 도착 위도
 * @returns {object|null} ODsay 호환 raw route 또는 null. transient(5xx/timeout)는 throw (caller retry).
 */
export async function searchTransitRouteTmap(sx, sy, ex, ey, opts = {}) {
  const appKey = (process.env.TMAP_APP_KEY || '').trim();
  if (!appKey) {
    console.warn('[TMAP] TMAP_APP_KEY not configured');
    return null;
  }
  // 가까우면 도보 (ODsay 와 동일 <300m 정책).
  const dist = haversineKm(sy, sx, ey, ex);
  if (dist < 0.3) {
    const min = Math.max(3, Math.round((dist * 1000) / 70)); // ~4.2km/h
    return {
      type: 'walk', totalTime: min, fare: 0, transfers: 0,
      steps: [{ mode: 'walk', distance: Math.round(dist * 1000), description: `도보 약 ${Math.round(dist * 1000)}m`, duration: min }],
      _provider: 'tmap',
    };
  }
  try {
    const res = await fetch(TMAP_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(12000),
      headers: { appKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        startX: String(sx), startY: String(sy), endX: String(ex), endY: String(ey),
        count: 3, format: 'json', searchDttm: buildSearchDttm(opts),
      }),
    });
    if (!res.ok) {
      if (res.status >= 500) throw new Error(`TMAP HTTP ${res.status}`);
      console.warn(`[TMAP] HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const its = data?.metaData?.plan?.itineraries;
    if (!its || !its.length) {
      console.info('[TMAP] no routes found:', data?.result?.message || data?.error?.message || 'empty');
      return null;
    }
    return mapTmapItineraryToRoute(its[0]); // path[0] = 최단(ODsay 와 동일 정책)
  } catch (err) {
    const isTransient = err.name === 'AbortError' || err.name === 'TimeoutError'
      || /HTTP 5\d\d/.test(err.message || '')
      || /fetch failed|ECONNRESET|ENETUNREACH|EAI_AGAIN/i.test(err.message || '');
    console.warn(`[TMAP] API error (${isTransient ? 'transient' : 'fatal'}):`, err.message);
    if (isTransient) throw err;
    return null;
  }
}
