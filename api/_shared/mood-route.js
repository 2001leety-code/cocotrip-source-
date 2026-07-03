/**
 * MOOD 포털 — 경로 계산 헬퍼 (Naver Directions Driving)
 *
 * 출발지/목적지/경유지를 받아 ① geocode 로 좌표화 ② Naver Directions Driving 으로
 * 실제 도로 거리(km) + 톨비(원) + 소요시간(분) 을 구한다.
 *
 * 🔴 금액 SSOT 분리: 이 모듈은 "거리/톨비" 만 책임진다. 최종 청구금액은
 *     api/_shared/mood-pricing.js 의 computeMoodTotalKRW 가 (km, tollKRW) 를 받아
 *     계산한다. api/mood-book.js 가 이 둘을 백엔드에서 재계산 → 클라이언트가 보낸
 *     km/toll/amount 는 전부 무시 (위조 불가).
 *
 * CLAUDE.md I 섹션: NCP_CLIENT_ID / NCP_CLIENT_SECRET 은 .trim() 필수
 *   (보이지 않는 개행문자 \n 로 401 발생).
 *
 * ESM — Vercel serverless (api/*) + Vitest 양쪽에서 import 가능.
 */

import axios from 'axios';

const GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode';
const DIRECTIONS_URL = 'https://maps.apigw.ntruss.com/map-direction/v1/driving';

/**
 * Naver Geocoding — 주소/장소명 → { lat, lng }. 실패 시 null.
 * (api/calculator-distance.js geocode 패턴 재사용.)
 */
export async function geocode(query, clientId, clientSecret) {
  const res = await axios.get(GEOCODE_URL, {
    params: { query },
    headers: {
      'X-NCP-APIGW-API-KEY-ID': clientId,
      'X-NCP-APIGW-API-KEY': clientSecret,
    },
    timeout: 5000,
  });
  if (res.status === 200 && res.data?.addresses?.length > 0) {
    return {
      lat: parseFloat(res.data.addresses[0].y),
      lng: parseFloat(res.data.addresses[0].x),
    };
  }
  return null;
}

/**
 * NCP(Naver Cloud Maps) 키 해석 — computeRoute 와 동일한 폴백 규칙.
 * CLAUDE.md I: 키는 .trim() 필수 (\n 손상 방지). 변수명 이원화(NCP_ / NAVER_ 계열) 둘 다 허용.
 * @returns {{ clientId: string, clientSecret: string }} — 미설정이면 빈 문자열.
 */
function resolveNcpKeys() {
  const clientId = (process.env.NCP_CLIENT_ID || process.env.NAVER_CLIENT_ID || '').trim();
  const clientSecret = (process.env.NCP_CLIENT_SECRET || process.env.NAVER_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret };
}

/**
 * 단일 주소 geocode — 키 해석까지 내부에서 처리 (호출자가 NCP 키 몰라도 됨).
 * mood-places(주소록 저장) 같이 "주소 → 좌표" 만 필요한 곳에서 재사용.
 *
 * @param {string} query - 주소 또는 장소명
 * @returns {Promise<
 *     { ok: true, lat: number, lng: number }
 *   | { ok: false, status: number, error: string }
 * >}
 *   - MISSING_PARAMS (400): 빈 주소
 *   - NCP_NOT_CONFIGURED (500): NCP 키 미설정
 *   - GEOCODING_FAILED (404): 좌표화 실패 (엉터리 주소)
 */
export async function geocodeAddress(query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, status: 400, error: 'MISSING_PARAMS' };

  const { clientId, clientSecret } = resolveNcpKeys();
  if (!clientId || !clientSecret) {
    return { ok: false, status: 500, error: 'NCP_NOT_CONFIGURED' };
  }

  try {
    const coord = await geocode(q, clientId, clientSecret);
    if (!coord) return { ok: false, status: 404, error: 'GEOCODING_FAILED' };
    return { ok: true, lat: coord.lat, lng: coord.lng };
  } catch (err) {
    // Naver 호출 자체 실패(네트워크/키오류) — 좌표 못 뽑았으니 저장 거부 대상.
    return { ok: false, status: 404, error: 'GEOCODING_FAILED', detail: err?.message };
  }
}

/** "lng,lat" 좌표 문자열 (Naver Directions 파라미터 포맷). */
function coordParam(c) {
  return `${c.lng},${c.lat}`;
}

/**
 * 경로 계산 — geocode(origin·destination·waypoints) → Naver Directions Driving.
 *
 * @param {{ origin: string, destination: string, waypoints?: string[] }} input
 *   - waypoints: 경유지 배열 (선택). 순서대로 경유.
 * @returns {Promise<
 *     { ok: true, km: number, tollKRW: number, durationMin: number }
 *   | { ok: false, status: number, error: string, detail?: string }
 * >}
 *
 * 에러 케이스:
 *   - NCP_NOT_CONFIGURED (500): NCP 키 미설정
 *   - MISSING_PARAMS (400): origin/destination 빈 값
 *   - GEOCODING_FAILED (404): 주소 좌표화 실패 (detail = 어느 지점인지)
 *   - DIRECTIONS_FAILED (502): Naver Directions 호출/응답 실패
 */
export async function computeRoute({ origin, destination, waypoints = [] } = {}) {
  const originQ = String(origin || '').trim();
  const destQ = String(destination || '').trim();
  if (!originQ || !destQ) {
    return { ok: false, status: 400, error: 'MISSING_PARAMS' };
  }

  // CLAUDE.md I — NCP 키는 .trim() 필수 (\n 손상 방지).
  // 변수명 폴백: 메인 플래너(RouteAgent/recalc-transit)는 NAVER_CLIENT_*, MOOD/calculator 는
  // NCP_CLIENT_* 로 같은 네이버 클라우드 Maps 키를 읽던 이원화 → 어느 이름으로 등록돼도 동작
  // (prod 는 NAVER_CLIENT_* 만 설정돼 MOOD 가 NCP_NOT_CONFIGURED 였음, 2026-06-13).
  const { clientId, clientSecret } = resolveNcpKeys();
  if (!clientId || !clientSecret) {
    return { ok: false, status: 500, error: 'NCP_NOT_CONFIGURED' };
  }

  // 경유지 정규화 — 빈 문자열 제거.
  const wpQueries = (Array.isArray(waypoints) ? waypoints : [])
    .map((w) => String(w || '').trim())
    .filter(Boolean);

  // Naver Directions Driving 경유지 최대 5개 — 초과 시 명시적 거부.
  // (silent slice 금지: 돈 경로라 의도한 경유지가 조용히 누락되면 거리/요금 오류.)
  if (wpQueries.length > 5) {
    return { ok: false, status: 400, error: 'TOO_MANY_WAYPOINTS', detail: '경유지는 최대 5개' };
  }

  try {
    // ── 1) geocode (origin + destination + waypoints) 병렬 ──────────
    const [originCoord, destCoord, ...wpCoords] = await Promise.all([
      geocode(originQ, clientId, clientSecret),
      geocode(destQ, clientId, clientSecret),
      ...wpQueries.map((w) => geocode(w, clientId, clientSecret)),
    ]);

    if (!originCoord) return { ok: false, status: 404, error: 'GEOCODING_FAILED', detail: 'origin' };
    if (!destCoord) return { ok: false, status: 404, error: 'GEOCODING_FAILED', detail: 'destination' };
    const badWpIdx = wpCoords.findIndex((c) => !c);
    if (badWpIdx !== -1) {
      return { ok: false, status: 404, error: 'GEOCODING_FAILED', detail: `waypoint[${badWpIdx}]` };
    }

    // ── 2) Naver Directions Driving ────────────────────────────────
    const params = {
      start: coordParam(originCoord),
      goal: coordParam(destCoord),
      option: 'traoptimal',
    };
    if (wpCoords.length > 0) {
      // Naver waypoints: 경유지 사이는 "|" 로 구분 ("lng,lat|lng,lat").
      // 콜론(:)은 "한 경유지 안의 대체 좌표쌍" 용도라 다중 경유지에 쓰면 Naver 가
      // 단일 경유지의 좌표쌍으로 오해석 → 경로/거리/톨비가 틀어진다.
      params.waypoints = wpCoords.map(coordParam).join('|');
    }

    const res = await axios.get(DIRECTIONS_URL, {
      params,
      headers: {
        'X-NCP-APIGW-API-KEY-ID': clientId,
        'X-NCP-APIGW-API-KEY': clientSecret,
      },
      timeout: 8000,
    });

    // Naver Directions 성공 = data.code === 0 + route.traoptimal[0].summary 존재.
    const route0 = res.data?.code === 0 ? res.data?.route?.traoptimal?.[0] : null;
    const summary = route0?.summary || null;
    if (!summary) {
      return {
        ok: false,
        status: 502,
        error: 'DIRECTIONS_FAILED',
        detail: res.data?.message || `code=${res.data?.code}`,
      };
    }

    const km = Math.round((Number(summary.distance) / 1000) * 10) / 10; // m → km, 소수 1자리
    const durationMin = Math.max(1, Math.round(Number(summary.duration) / 60000)); // ms → 분
    const tollKRW = Math.max(0, Math.round(Number(summary.tollFare) || 0)); // tollFare 없으면 0

    // 경로 선(폴리라인) 좌표 [[lng,lat],...] + 출발/경유/도착 마커 좌표 — 지도에 실제 경로 그리기용.
    // (추가 필드: 기존 km/tollKRW/durationMin 은 그대로 = 가격 계산 무영향.)
    const path = Array.isArray(route0.path) ? route0.path : [];
    const points = [
      { lat: originCoord.lat, lng: originCoord.lng, role: 'origin' },
      ...wpCoords.map((c, i) => ({ lat: c.lat, lng: c.lng, role: 'waypoint', index: i })),
      { lat: destCoord.lat, lng: destCoord.lng, role: 'destination' },
    ];

    return { ok: true, km, tollKRW, durationMin, path, points };
  } catch (err) {
    return { ok: false, status: 502, error: 'DIRECTIONS_FAILED', detail: err?.message };
  }
}
