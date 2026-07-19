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

import { localizeLineName, romanizeStation } from './_transit_localization.js';

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
// ── (2026-07-19) 실경로 좌표(geometry) ────────────────────────────────────────
// TMAP 응답은 leg 마다 실제 도로·철도를 따라가는 좌표열을 준다 — 이미 호출 중이라
// 추가 비용 0인데 그동안 통째로 버려 지도가 stop→stop 직선만 그렸다.
//   · 대중교통 leg: passShape.linestring ("lon,lat lon,lat …")
//   · 도보 leg: steps[].linestring (+ streetName/description = "테헤란로를 따라 59m")
// Firestore 문서 비대를 막으려고 (a) 좌표 5자리 반올림(≈1m) (b) 최대 점수 샘플링.
const GEO_PRECISION = 1e5;
const MAX_GEO_POINTS = 100;

/**
 * "lon,lat lon,lat …" → **평탄 배열** [lat,lng,lat,lng, …] (지도 순서로 뒤집어서).
 *
 * 🔴 평탄 배열인 이유 (2026-07-19 prod 장애로 학습):
 *   Firestore 는 **중첩 배열(배열 안의 배열)을 저장할 수 없다.** 처음에 [[lat,lng], …]
 *   형태로 저장했다가 persistPlan 이 "Plan save failed" 로 전량 실패해 prod 플랜 생성이
 *   막혔다. 로컬 하네스는 JSON 파일이라 이 제약이 안 걸려 못 잡았다.
 *   평탄 배열은 Firestore 가 허용하고 키 반복도 없어 [{lat,lng}] 보다 작다.
 *   소비 측은 chunkPath()(프론트) 로 2개씩 묶어 쓴다.
 */
export function parseLinestring(ls, maxPoints = MAX_GEO_POINTS) {
  if (!ls || typeof ls !== 'string') return null;
  const pts = [];
  for (const pair of ls.trim().split(/\s+/)) {
    const [lonS, latS] = pair.split(',');
    const lon = Number(lonS), lat = Number(latS);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    pts.push([Math.round(lat * GEO_PRECISION) / GEO_PRECISION, Math.round(lon * GEO_PRECISION) / GEO_PRECISION]);
  }
  if (!pts.length) return null;
  let picked = pts;
  if (pts.length > maxPoints) {
    // 균등 샘플링 — 시작/끝은 반드시 보존(구간이 끊겨 보이지 않게).
    const step = (pts.length - 1) / (maxPoints - 1);
    picked = [];
    for (let i = 0; i < maxPoints; i++) picked.push(pts[Math.round(i * step)]);
    picked[picked.length - 1] = pts[pts.length - 1];
  }
  const flat = [];
  for (const [la, ln] of picked) flat.push(la, ln);
  return flat;
}

/** 도보 leg 의 상세 안내(steps[])를 하나의 좌표열 + 길안내 배열로 합친다. */
function walkGeometry(leg) {
  const sub = Array.isArray(leg.steps) ? leg.steps : [];
  if (sub.length) {
    const merged = [];
    const guide = [];
    for (const s of sub) {
      const p = parseLinestring(s.linestring, MAX_GEO_POINTS); // 평탄 [lat,lng,…]
      if (p) merged.push(...p);
      if (s.description) guide.push({ street: s.streetName || null, distance: s.distance || 0, text: s.description });
    }
    if (!merged.length) return { path: null, guide: guide.length ? guide : null };
    // 병합 결과가 상한을 넘으면 좌표쌍 단위로 다시 균등 샘플링(평탄 배열 유지).
    let path = merged;
    const pairCount = Math.floor(merged.length / 2);
    if (pairCount > MAX_GEO_POINTS) {
      const step = (pairCount - 1) / (MAX_GEO_POINTS - 1);
      path = [];
      for (let i = 0; i < MAX_GEO_POINTS; i++) {
        const idx = Math.round(i * step) * 2;
        path.push(merged[idx], merged[idx + 1]);
      }
      path[path.length - 2] = merged[(pairCount - 1) * 2];
      path[path.length - 1] = merged[(pairCount - 1) * 2 + 1];
    }
    return { path, guide: guide.length ? guide : null };
  }
  return { path: parseLinestring(leg.passShape?.linestring), guide: null };
}

const legPoint = (p) => (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)
  ? { name: p.name || null, lat: Math.round(p.lat * GEO_PRECISION) / GEO_PRECISION, lng: Math.round(p.lon * GEO_PRECISION) / GEO_PRECISION }
  : null);

export function mapTmapItineraryToRoute(it) {
  if (!it) return null;
  const legs = Array.isArray(it.legs) ? it.legs : [];
  const steps = [];
  for (const l of legs) {
    const mode = legModeToStepMode(l.mode);
    const durMin = Math.round((l.sectionTime || 0) / 60);
    // 승하차 지점 + 노선 색 — 지도에 "여기서 탄다" 마커와 노선 색 폴리라인을 그리는 근거.
    const fromPoint = legPoint(l.start);
    const toPoint = legPoint(l.end);
    const routeColor = l.routeColor ? `#${String(l.routeColor).replace(/^#/, '')}` : null;
    if (mode === 'walk') {
      // 0초/극단거리 walk leg 스킵 (ODsay parseSubPath 와 동일 정책).
      if ((l.sectionTime || 0) < 30 && (l.distance || 0) < 30) continue;
      const { path, guide } = walkGeometry(l);
      steps.push({
        mode: 'walk',
        distance: l.distance || 0,
        duration: Math.max(1, durMin),
        description: `도보 ${l.distance || 0}m`,
        ...(path ? { path } : {}),
        ...(guide ? { walk_guide: guide } : {}),
        ...(fromPoint ? { fromPoint } : {}),
        ...(toPoint ? { toPoint } : {}),
      });
      continue;
    }
    const from = l.start?.name || '';
    const to = l.end?.name || '';
    const stationList = l.passStopList?.stationList || [];
    const stationCount = stationList.length || 0;
    const passStops = stationList.map((s) => s.stationName || s.name).filter(Boolean);
    const path = parseLinestring(l.passShape?.linestring);
    const geo = {
      ...(path ? { path } : {}),
      ...(routeColor ? { routeColor } : {}),
      ...(fromPoint ? { fromPoint } : {}),
      ...(toPoint ? { toPoint } : {}),
    };
    if (mode === 'bus') {
      const route = String(l.route || '');
      const busType = route.includes(':') ? route.split(':')[0] : null;
      const busNo = route.includes(':') ? route.split(':').slice(1).join(':') : route;
      steps.push({
        mode: 'bus', busNo, busType, from, to, duration: durMin, stationCount, passStops, ...geo,
        description: `${route || 'Bus'} ${from} → ${to} (${stationCount ? `${stationCount}정거장, ` : ''}${durMin}분)`,
      });
    } else {
      const line = String(l.route || l.Lane?.[0]?.name || '');
      // 🌏 외국어 표기 — ODsay 분기(_odsay_helper parseSubPath)와 동일 정책.
      // TMAP 은 한국어만 주고(lang=1 은 한글을 잃고 품질도 낮다: 홍대입구→"Hongdae"),
      // translate-plan 은 en 을 "lineEn/fromRoman 이 이미 있다"고 보고 건너뛴다
      // → 이 필드를 안 채우면 영어 사용자 화면·PDF 에 역명이 순 한글로 나온다.
      // 우리 표가 공식 표기라 TMAP 영문보다 정확: 홍대입구→"Hongik Univ.", 디지털미디어시티→"DMC".
      const lineKo = localizeLineName(line, 'ko').display || line;
      const lineEn = localizeLineName(line, 'en').display || null;
      const fromRoman = romanizeStation(from, 'en');
      const toRoman = romanizeStation(to, 'en');
      steps.push({
        mode: 'subway', line, lineKo, from, to, duration: durMin, stationCount, passStops, ...geo,
        ...(lineEn && lineEn !== lineKo ? { lineEn } : {}),
        ...(fromRoman ? { fromRoman } : {}),
        ...(toRoman ? { toRoman } : {}),
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

/**
 * 출발시각(yyyymmddhhmi). opts.departDttm 우선, 미지정 시 야간/새벽이면 당일 10:00 보정(관광 기준, 야간버스 추천 방지).
 * ⚠️ KST 기준: now(서버시계, Vercel serverless=UTC)를 +9h 한 뒤 getUTC* 로 KST 연/월/일/시/분 도출.
 *   (recordRecalcStat / adminSalesAggregate 의 +9h 패턴과 동일.) UTC 시계로 야간/주간 보정하면 KST 와 9h 어긋남.
 */
export function buildSearchDttm(opts = {}, now = new Date()) {
  if (opts.departDttm && /^\d{12}$/.test(opts.departDttm)) return opts.departDttm;
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const da = String(kst.getUTCDate()).padStart(2, '0');
  const hh = kst.getUTCHours();
  if (hh < 7 || hh >= 22) return `${y}${mo}${da}1000`; // daytime 보정
  return `${y}${mo}${da}${String(hh).padStart(2, '0')}${String(kst.getUTCMinutes()).padStart(2, '0')}`;
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
