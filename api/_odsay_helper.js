/**
 * ODsay Lab — 대중교통 경로 탐색 헬퍼
 * https://lab.odsay.com
 *
 * AI Planner의 RouteAgent에서 각 정류장 간 실제 대중교통 경로를
 * 조회하여 환승 정보, 소요 시간, 요금, 상세 이동 단계를 제공합니다.
 */

import { localizeLineName, romanizeStation } from './_transit_localization.js';

const ODSAY_BASE = 'https://api.odsay.com/v1/api';

/**
 * 두 좌표 간 대중교통 경로 검색
 * @param {number} sx - 출발지 경도 (longitude)
 * @param {number} sy - 출발지 위도 (latitude)
 * @param {number} ex - 도착지 경도
 * @param {number} ey - 도착지 위도
 * @returns {object|null} 최적 경로 요약 또는 null
 */
export async function searchTransitRoute(sx, sy, ex, ey) {
  const apiKey = (process.env.ODSAY_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('[ODsay] ODSAY_API_KEY not configured');
    return null;
  }

  // 거리가 너무 가까우면 (약 300m 이내) 도보로 처리
  const dist = haversineDistance(sy, sx, ey, ex);
  if (dist < 0.3) {
    return {
      type: 'walk',
      totalTime: Math.max(3, Math.round(dist / 0.07)), // ~4.2km/h walking
      fare: 0,
      transfers: 0,
      steps: [{ mode: 'walk', description: `도보 약 ${Math.round(dist * 1000)}m`, duration: Math.max(3, Math.round(dist / 0.07)) }],
    };
  }

  try {
    const url = `${ODSAY_BASE}/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${encodeURIComponent(apiKey)}&output=json`;
    // ODsay Basic tier enforces a Referer whitelist per application. Vercel
    // serverless fetches don't set Referer, so we spoof it with a registered
    // domain — otherwise every call returns "[ApiKeyAuthFailed] ApiKey
    // authentication failed" and the planner silently falls back to driving.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Referer: 'https://cocotripkr.com' },
    });

    if (!res.ok) {
      console.warn(`[ODsay] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();

    if (data.error || !data.result?.path?.length) {
      console.warn('[ODsay] No routes found or error:', data.error?.msg || 'empty');
      return null;
    }

    // 최적 경로 (첫 번째 = 최단 시간)
    const best = data.result.path[0];
    const info = best.info;

    // 상세 이동 단계 파싱
    const steps = (best.subPath || []).map(sub => parseSubPath(sub)).filter(Boolean);

    return {
      type: info.pathType === 1 ? 'subway' : info.pathType === 2 ? 'bus' : 'subway+bus',
      totalTime: info.totalTime,       // 분
      fare: info.payment,              // 원
      transfers: (info.busTransitCount || 0) + (info.subwayTransitCount || 0),
      distance: info.totalDistance,     // 미터
      totalWalk: info.totalWalk,        // 미터 (전체 도보 거리)
      firstStation: info.firstStartStation,  // "강남" — 첫 승차역/정류장
      lastStation: info.lastEndStation,      // "잠실" — 최종 하차역/정류장
      steps,
      // 대안 경로 수
      alternatives: Math.min(data.result.path.length - 1, 2),
    };
  } catch (err) {
    console.warn('[ODsay] API error:', err.message);
    return null;
  }
}

/**
 * ODsay subPath를 읽기 쉬운 단계로 변환
 */
function parseSubPath(sub) {
  // trafficType: 1=지하철, 2=버스, 3=도보
  if (sub.trafficType === 3) {
    if (sub.sectionTime < 1) return null;
    return {
      mode: 'walk',
      distance: sub.distance,
      description: `도보 ${sub.distance}m`,
      duration: sub.sectionTime,
    };
  }

  if (sub.trafficType === 1) {
    // 지하철 — ODsay가 출발/목적지 좌표에 가장 가까운 출구(startExitNo/endExitNo)를
    // 이미 계산해서 준다. 별도 출구 DB 조회 불필요.
    // Basic tier는 한국어만 → 주요 역 로마자/호선명 영문 표기를 코드에서 추가.
    // Client가 사용자 언어에 맞게 "강남 (Gangnam)" 처럼 병기 표시 가능.
    const lineName = sub.lane?.[0]?.name || '';
    const fromExit = sub.startExitNo || null;
    const toExit = sub.endExitNo || null;
    const lineKo = localizeLineName(lineName, 'ko').display;
    const lineEn = localizeLineName(lineName, 'en').display;
    const fromRoman = romanizeStation(sub.startName, 'en');
    const toRoman = romanizeStation(sub.endName, 'en');
    const wayRoman = sub.way ? romanizeStation(sub.way, 'en') : null;
    const descParts = [
      `${lineName}`,
      `${sub.startName}역${fromExit ? ` ${fromExit}번출구` : ''}`,
      `→ ${sub.endName}역${toExit ? ` ${toExit}번출구` : ''}`,
      `(${sub.stationCount}정거장, ${sub.sectionTime}분${sub.intervalTime ? `, 배차 ${sub.intervalTime}분` : ''})`,
    ];
    return {
      mode: 'subway',
      line: lineName,                             // Raw ODsay verbose form, e.g. "수도권 2호선"
      lineKo,                                     // Korean normalized: "2호선"
      lineEn,                                     // English: "Line 2" / "Shinbundang Line"
      subwayCode: sub.lane?.[0]?.subwayCode,
      fromStationID: sub.startID || null,         // ODsay stationID for subwayStationInfo lookup
      toStationID: sub.endID || null,
      from: sub.startName,
      fromRoman,                                  // "Gangnam" (null if not translatable)
      to: sub.endName,
      toRoman,                                    // "Jamsil"
      way: sub.way || null,                       // 진행 방향 (e.g., "잠실")
      wayRoman,                                   // "Jamsil"
      fromExit,                                   // 승차역 출구 번호
      toExit,                                     // 하차역 출구 번호
      fromExitCoord: (sub.startExitX && sub.startExitY) ? { x: sub.startExitX, y: sub.startExitY } : null,
      toExitCoord: (sub.endExitX && sub.endExitY) ? { x: sub.endExitX, y: sub.endExitY } : null,
      duration: sub.sectionTime,
      stationCount: sub.stationCount,
      intervalMin: sub.intervalTime || null,
      passStops: (sub.passStopList?.stations || []).map(s => s.stationName),
      description: descParts.join(' '),
    };
  }

  if (sub.trafficType === 2) {
    // 버스 — 정류장명은 고유명사/동네명이 섞여 기계적 로마자 변환이 저품질.
    // 승하차 정류장은 한국어 그대로 유지 (현장 간판과 일치하는 게 더 실용적).
    const busNo = sub.lane?.[0]?.busNo || '';
    const busType = sub.lane?.[0]?.type || 0;
    const busLabel = getBusTypeLabel(busType);
    return {
      mode: 'bus',
      busNo,
      busType: busLabel,
      from: sub.startName,
      to: sub.endName,
      fromArs: sub.startArsID || null,             // 서울 정류장 고유번호 5자리
      toArs: sub.endArsID || null,
      fromCoord: (sub.startX && sub.startY) ? { x: sub.startX, y: sub.startY } : null,
      toCoord: (sub.endX && sub.endY) ? { x: sub.endX, y: sub.endY } : null,
      duration: sub.sectionTime,
      stationCount: sub.stationCount,
      intervalMin: sub.intervalTime || null,
      passStops: (sub.passStopList?.stations || []).map(s => s.stationName),
      description: `${busLabel} ${busNo}번 ${sub.startName}${sub.startArsID ? `(${sub.startArsID})` : ''} → ${sub.endName}${sub.endArsID ? `(${sub.endArsID})` : ''} (${sub.stationCount}정거장, ${sub.sectionTime}분${sub.intervalTime ? `, 배차 ${sub.intervalTime}분` : ''})`,
    };
  }

  return null;
}

/**
 * 버스 유형 라벨
 */
function getBusTypeLabel(type) {
  const map = {
    1: '일반', 2: '좌석', 3: '마을', 4: '직행좌석',
    5: '공항', 6: '간선', 7: '외곽', 10: '순환', 11: '광역', 12: '인천',
  };
  return map[type] || '버스';
}

/**
 * Haversine 거리 (km)
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Fetch subway station metadata (transfer lines, accessibility, lost&found).
 * ODsay Basic tier gives this for free — 1 call per unique station.
 * Uses a caller-provided cache object so one plan generation hits each
 * station at most once even if it appears as both 승차/하차 across segments.
 *
 * Returns a compact shape; returns null on any failure so callers can
 * gracefully skip enrichment without breaking transit rendering.
 */
export async function getSubwayStationInfo(stationID, cache = {}) {
  if (!stationID) return null;
  if (Object.prototype.hasOwnProperty.call(cache, stationID)) {
    return cache[stationID];
  }

  const apiKey = (process.env.ODSAY_API_KEY || '').trim();
  if (!apiKey) {
    cache[stationID] = null;
    return null;
  }

  try {
    const url = `${ODSAY_BASE}/subwayStationInfo?stationID=${stationID}&apiKey=${encodeURIComponent(apiKey)}&output=json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { Referer: 'https://cocotripkr.com' },
    });
    if (!res.ok) { cache[stationID] = null; return null; }
    const data = await res.json();
    const r = data.result;
    if (!r || data.error) { cache[stationID] = null; return null; }

    // Normalise transfer lines via the same helper used for primary line names
    const transferLines = (r.exOBJ?.station || []).map(s => ({
      lineKo: localizeLineName(s.laneName || '', 'ko').display,
      lineEn: localizeLineName(s.laneName || '', 'en').display,
      stationID: s.stationID,
    }));

    const compact = {
      stationName: r.stationName,
      transferLines,
      address: r.defaultInfo?.new_address || r.defaultInfo?.address || null,
      phone: r.defaultInfo?.tel || null,
      lostCenterPhone: r.defaultInfo?.lostcenterTel || null,
      hasElevator: (r.useInfo?.elevator || 0) > 0,
      hasWheelchairLift: (r.useInfo?.wheelchairLift || 0) > 0,
      hasRestroom: (r.useInfo?.restroom || 0) > 0,
    };
    cache[stationID] = compact;
    return compact;
  } catch (err) {
    console.warn('[ODsay] subwayStationInfo failed:', err.message);
    cache[stationID] = null;
    return null;
  }
}

/**
 * Format KST time from Seoul Subway timetable API.
 * The API expresses past-midnight departures as "24:46:00" etc. Convert to
 * readable "00:46 (+1)" so travelers don't misread it as 24-hour noon.
 */
function formatTrainTime(t) {
  if (!t) return null;
  const parts = t.split(':');
  const h = parseInt(parts[0], 10);
  const m = parts[1] || '00';
  if (isNaN(h)) return null;
  if (h >= 24) return `${String(h - 24).padStart(2, '0')}:${m} (+1)`;
  return `${String(h).padStart(2, '0')}:${m}`;
}

/**
 * Map ODsay stationID -> Seoul Open Data STATION_CD. Empirically this is
 * just zero-padded to 4 digits with a leading "0" (e.g. 222 -> "0222",
 * 216 -> "0216"). Works for Seoul Metro lines 1-9 within stationID <= 999.
 * Returns null for out-of-range IDs (private operators, metro extensions)
 * where the timetable API won't have data.
 */
function stationIdToStationCd(stationID) {
  if (!stationID || stationID > 999) return null;
  return '0' + String(stationID).padStart(3, '0');
}

/**
 * Fetch first/last subway train times at a station for a given weekday.
 * Uses Seoul Open Data `SearchSTNTimeTableByIDService` (requires
 * SUBWAY_REALTIME_KEY env var — not ODsay).
 *
 * @param {number} stationID ODsay subway station ID
 * @param {number} dayOfWeek JS Date.getDay() — 0=Sun ... 6=Sat
 * @param {object} cache Shared cache across a plan (key: stationID:weekTag)
 * @returns {{ up: TrainTimes|null, down: TrainTimes|null } | null}
 *   where TrainTimes = { first, last, firstDest, lastDest }
 */
export async function getSubwayTimetable(stationID, dayOfWeek, cache = {}) {
  const STATION_CD = stationIdToStationCd(stationID);
  if (!STATION_CD) return null;

  const WEEK_TAG = dayOfWeek === 0 ? 3 : dayOfWeek === 6 ? 2 : 1;
  const cacheKey = `${STATION_CD}:${WEEK_TAG}`;
  if (Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
    return cache[cacheKey];
  }

  const key = (process.env.SUBWAY_REALTIME_KEY || '').trim();
  if (!key) { cache[cacheKey] = null; return null; }

  async function fetchDirection(INOUT_TAG) {
    try {
      const url = `http://openapi.seoul.go.kr:8088/${key}/json/SearchSTNTimeTableByIDService/1/1000/${STATION_CD}/${WEEK_TAG}/${INOUT_TAG}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const data = await res.json();
      const rows = data?.SearchSTNTimeTableByIDService?.row;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const sorted = [...rows].sort((a, b) => (a.ARRIVETIME || '').localeCompare(b.ARRIVETIME || ''));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      return {
        first: formatTrainTime(first.ARRIVETIME),
        last: formatTrainTime(last.ARRIVETIME),
        firstDest: first.SUBWAYENAME || null,
        lastDest: last.SUBWAYENAME || null,
      };
    } catch (err) {
      console.warn('[SeoulTimetable] fetch failed:', err.message);
      return null;
    }
  }

  const [up, down] = await Promise.all([fetchDirection(1), fetchDirection(2)]);
  const result = { up, down };
  cache[cacheKey] = result;
  return result;
}

/**
 * ODsay 경로 결과를 사람이 읽기 좋은 영문 요약으로 변환
 */
export function formatTransitSummary(route, lang = 'en') {
  if (!route) return null;
  if (route.type === 'walk') {
    return { method: 'walk', summary: `Walk ${route.steps[0]?.description || ''}`, duration: route.totalTime, fare: 0, steps: route.steps };
  }

  const stepsText = route.steps
    .filter(s => s.mode !== 'walk' || s.duration >= 3)
    .map(s => {
      if (s.mode === 'subway') return `🚇 ${s.line}: ${s.from}${s.fromExit ? `(출구${s.fromExit})` : ''} → ${s.to}${s.toExit ? `(출구${s.toExit})` : ''} (${s.duration}min)`;
      if (s.mode === 'bus') return `🚌 Bus ${s.busNo}: ${s.from} → ${s.to} (${s.duration}min)`;
      return `🚶 Walk ${s.duration}min`;
    });

  return {
    method: route.type,
    summary: stepsText.join(' → '),
    duration: route.totalTime,
    fare: route.fare,
    transfers: route.transfers,
    totalWalk: route.totalWalk || 0,        // 전체 도보 거리 (미터)
    firstStation: route.firstStation,        // 첫 승차역/정류장
    lastStation: route.lastStation,          // 최종 하차역/정류장
    steps: route.steps,
  };
}
