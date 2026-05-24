/**
 * ODsay Lab — 대중교통 경로 탐색 헬퍼
 * https://lab.odsay.com
 *
 * AI Planner의 RouteAgent에서 각 정류장 간 실제 대중교통 경로를
 * 조회하여 환승 정보, 소요 시간, 요금, 상세 이동 단계를 제공합니다.
 */

import { localizeLineName, romanizeStation } from './_transit_localization.js';
import { initAdminDb } from './_shared/firebase-admin.js';

const ODSAY_BASE = 'https://api.odsay.com/v1/api';

// ── P184 (2026-05-24) — ODSAY transit_cache (Firestore 1 month TTL) ────────
// 운영자: "오딧세이 80% 썼어 대안방향있어?" + "호출할때마다 학습해서 그경로 숙지
// 해놓고 필요할때 그것도 갖다 쓰면 되지않아?" → 정확. 같은 좌표 pair 호출 반복
// = quota waste. 1 month cache + lazy update (cache hit + 만료 시 자동 refresh).
//
// cache key = `${sy.toFixed(4)},${sx.toFixed(4)}_${ey.toFixed(4)},${ex.toFixed(4)}`
// = 위/경도 4자리 (≈11m precision — 같은 건물 다른 출구 cluster).
// TTL = 30 days. 지하철/버스 schedule 안정 (KTX edge case 1-3 day stale 허용).
//
// Firestore rules: transit_cache server only (Admin SDK 우회).
const TRANSIT_CACHE_COLLECTION = 'transit_cache';
const TRANSIT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function buildTransitCacheKey(sx, sy, ex, ey) {
  // 좌표 4자리 반올림 + Firestore doc ID 안전 chars (no slash). "_" separator.
  const f = (n) => Number(n).toFixed(4);
  return `${f(sy)},${f(sx)}_${f(ey)},${f(ex)}`;
}

async function getCachedTransit(key) {
  const adminDb = initAdminDb('odsay-cache');
  if (!adminDb) return null;
  try {
    const doc = await adminDb.collection(TRANSIT_CACHE_COLLECTION).doc(key).get();
    if (!doc.exists) return null;
    const data = doc.data() || {};
    const age = Date.now() - (data.cachedAt || 0);
    if (age > TRANSIT_CACHE_TTL_MS) return null; // expired — lazy refresh by caller
    return data.transit || null;
  } catch (e) {
    console.warn(`[ODsay cache] read failed (key=${key}):`, e.message);
    return null;
  }
}

async function setCachedTransit(key, transit) {
  const adminDb = initAdminDb('odsay-cache');
  if (!adminDb || !transit) return;
  try {
    await adminDb.collection(TRANSIT_CACHE_COLLECTION).doc(key).set({
      transit,
      cachedAt: Date.now(),
      cachedAtISO: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(`[ODsay cache] write failed (key=${key}):`, e.message);
  }
}

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

  // P184: Firestore cache lookup (1 month TTL). cache hit 시 ODSAY 호출 0.
  const cacheKey = buildTransitCacheKey(sx, sy, ex, ey);
  const cached = await getCachedTransit(cacheKey);
  if (cached) {
    console.log(`[ODsay cache HIT] ${cacheKey} (saved 1 ODSAY call)`);
    return cached;
  }

  try {
    const url = `${ODSAY_BASE}/searchPubTransPathT?SX=${sx}&SY=${sy}&EX=${ex}&EY=${ey}&apiKey=${encodeURIComponent(apiKey)}&output=json`;
    // ODsay Basic tier enforces a Referer whitelist per application. Vercel
    // serverless fetches don't set Referer, so we spoof it with a registered
    // domain — otherwise every call returns "[ApiKeyAuthFailed] ApiKey
    // authentication failed" and the planner silently falls back to driving.
    // Timeout: 8s → 12s (호텔→공항 fallback chain 추가로 호출 횟수 늘어, 가끔
    // 첫 호출 cold start 5-7s → timeout 빈발). 12s는 Vercel 300s budget 대비 안전.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { Referer: 'https://cocotripkr.com' },
    });

    if (!res.ok) {
      // 5xx는 일시 장애로 throw → 호출자가 retry 결정. 4xx는 그대로 null
      // (인증/쿼리 오류는 retry 무의미).
      if (res.status >= 500) {
        throw new Error(`ODsay HTTP ${res.status}`);
      }
      console.warn(`[ODsay] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();

    if (data.error || !data.result?.path?.length) {
      // B9-31: 정상적 fallback — info 로 다운그레이드 (caller 가 graceful 처리).
      console.info('[ODsay] no routes found:', data.error?.msg || 'empty path');
      return null;
    }

    // 최적 경로 (첫 번째 = 최단 시간)
    const best = data.result.path[0];
    const info = best.info;

    // 상세 이동 단계 파싱
    const steps = (best.subPath || []).map(sub => parseSubPath(sub)).filter(Boolean);

    const result = {
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
    // P184: write to cache (fire-and-forget, await 안 함 — caller latency 영향 0)
    setCachedTransit(cacheKey, result).catch(() => {});
    return result;
  } catch (err) {
    // Timeout (AbortError) + 5xx + network error 모두 throw — 호출자가 retry 결정.
    // 사실 ODsay searchTransitRoute는 RouteAgent의 _searchOdsayWithRetry 또는
    // _routeAirportHotel가 try/catch로 감싸므로 throw해도 plan 실패는 안 남.
    const isTransient = err.name === 'AbortError'
      || err.name === 'TimeoutError'
      || /HTTP 5\d\d/.test(err.message || '')
      || /fetch failed|ECONNRESET|ENETUNREACH|EAI_AGAIN/i.test(err.message || '');
    console.warn(`[ODsay] API error (${isTransient ? 'transient' : 'fatal'}):`, err.message);
    if (isTransient) throw err;
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

  // Convert "HH:MM:SS" to minutes, treating 00:00-04:59 as *next-day*
  // continuations of the previous service day. Subway timetables normally
  // end around 24:00-25:00 (next-day 00:xx-01:xx), and the API sometimes
  // mixes 24:46 and 00:46 notation for the same run. Without this roll-over,
  // a naive string sort puts 00:46 *before* 05:35 and picks it as "first".
  function toMinutes(t) {
    if (!t) return -1;
    const parts = t.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1] || '0', 10);
    if (isNaN(h) || isNaN(m)) return -1;
    return (h < 5 ? h + 24 : h) * 60 + m;
  }

  async function fetchDirection(INOUT_TAG) {
    try {
      const url = `http://openapi.seoul.go.kr:8088/${key}/json/SearchSTNTimeTableByIDService/1/1000/${STATION_CD}/${WEEK_TAG}/${INOUT_TAG}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const data = await res.json();
      const rows = data?.SearchSTNTimeTableByIDService?.row;
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const valid = rows.filter(r => toMinutes(r.ARRIVETIME) >= 0);
      if (valid.length === 0) return null;
      const sorted = [...valid].sort((a, b) => toMinutes(a.ARRIVETIME) - toMinutes(b.ARRIVETIME));
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
