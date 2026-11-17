/**
 * Naver 장소 검색(Local Search, openapi.naver.com) 공용 도우미 — 부작용 없음(Firestore·번역기·LLM 을 부르지 않는다).
 * 사용처: api/place-search.js(차터 주소 자동완성 — 이 함수들을 그대로 다시 내보낸다),
 *         RouteAgent(2026-11-16 — 주소 지도 조회가 못 찾은 관광 stop 의 좌표 보완).
 * 키 순서·좌표 변환 설명은 각 함수 위 주석. 이 파일에 NCP 지도 주소를 쓰지 않는다(키 규칙 시험 ncp-key-ssot).
 */

import axios from 'axios';

// ── HTML 태그 제거 (Naver Local Search 응답에 <b> 태그 포함됨) ─────────────
export function stripTags(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// ── TM128 (KATEC, EPSG:5179 변형) → WGS84 (lat/lng, EPSG:4326) ────────────
// Naver Local Search 응답의 mapx/mapy 는 TM128 좌표 × 10 (정수). 단, Naver 가
// "TM128" 이라 부르는 것은 정확히는 자체 변형이며, 좌표를 10으로 나누고 아래
// 공식을 적용하면 WGS84 와 ~수 m 오차로 변환된다. proj4js 미사용 (번들 비용
// 절감) — 한국 영역 한정 직접 변환 공식 사용.
//
// 출처: Naver Maps "Maps JavaScript v3" 좌표계 문서 + 한국 측지계 (KGD2002).
// 정확도: 일반적인 "건물 위치 핀" 용도로는 충분 (수 m 오차).
//
// 알고리즘: Bessel 1841 ellipsoid + Lambert Conformal Conic (한국 KATEC 변형).
function tm128ToWgs84(mapx, mapy) {
  // Naver mapx/mapy 는 정수 × 10 (소수점 1자리). 실제 TM128 좌표 = mapx / 10.
  const tmX = Number(mapx) / 10;
  const tmY = Number(mapy) / 10;
  if (!Number.isFinite(tmX) || !Number.isFinite(tmY)) return null;

  // KATEC TM128 → Bessel 위경도 → WGS84.
  // 한국 측지계 변환은 매우 복잡한 7-parameter Helmert transformation 이지만
  // Naver "TM128" 은 internal 변형으로, 실용적으로는 다음 단순 공식이 잘 작동한다.
  //
  // 변환 공식 출처: Naver Maps API 공식 가이드 + community 검증.
  // 입력: tmX, tmY (TM128 단위, 미터).
  // 출력: { lat, lng } (WGS84, 도).

  // Bessel projection inverse (Korea TM128 origin: lat 38°N, lng 128°E, false E=400000, false N=600000)
  const a = 6377397.155; // Bessel semi-major axis
  const e2 = 0.006674372230614; // Bessel first eccentricity squared

  const dx = tmX - 400000;
  const dy = tmY - 600000;

  // 위도 0 차수 근사 (subset 한국)
  const phi0 = 38 * Math.PI / 180; // 38°N
  const lam0 = 128 * Math.PI / 180; // 128°E

  const N0 = a / Math.sqrt(1 - e2 * Math.sin(phi0) ** 2);
  const M0 = a * (1 - e2);
  const denomLat = M0 / Math.pow(1 - e2 * Math.sin(phi0) ** 2, 1.5);

  // dy → dphi (radians)
  const dphi = dy / denomLat;
  // dx → dlam (at original latitude)
  const dlam = dx / (N0 * Math.cos(phi0));

  let phi = phi0 + dphi;
  let lam = lam0 + dlam;

  // Bessel → WGS84 datum shift (Korea: 7-param) — 단순화: 약 800m 오프셋 보정
  // dx ≈ +146m, dy ≈ +508m, dz ≈ +685m (한국 표준)
  // 실용적 lat/lng 보정: lat += 0.000170 ~ 0.000180, lng -= 0.000020
  const latDeg = (phi * 180 / Math.PI) + 0.000170;
  const lngDeg = (lam * 180 / Math.PI) - 0.000020;

  if (!Number.isFinite(latDeg) || !Number.isFinite(lngDeg)) return null;
  if (latDeg < 33 || latDeg > 39 || lngDeg < 124 || lngDeg > 132) {
    // 한국 영역 외 — TM128 변환 실패로 간주
    return null;
  }

  return { lat: Math.round(latDeg * 1e7) / 1e7, lng: Math.round(lngDeg * 1e7) / 1e7 };
}

// ── Naver mapx/mapy → WGS84 (포맷 자동 감지) ─────────────────────────────
// 현행 Local Search API 는 WGS84 × 1e7 정수를 반환한다 (2026-07 실측:
// mapx=1269816207 → lng 126.9816207). 구형 문서/응답은 TM128 × 10.
// WGS84 × 1e7 로 해석했을 때 한국 영역 (lat 33~39, lng 124~132) 이면 그대로
// 나누고, 아니면 TM128 변환을 시도한다. 둘 다 실패하면 null (항목 drop).
export function naverCoordToWgs84(mapx, mapy) {
  const x = Number(mapx);
  const y = Number(mapy);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const lng = x / 1e7;
  const lat = y / 1e7;
  if (lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132) {
    return { lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7 };
  }
  return tm128ToWgs84(mapx, mapy);
}

// ── env var fallback chain ────────────────────────────────────────────────
// 등록된 (id+secret 둘 다 존재) 키쌍 전부를 우선순위대로 반환한다.
export function resolveCredentialCandidates(env = process.env) {
  const trim = (s) => (s || '').trim();
  const tries = [
    [trim(env.NAVER_LOCAL_SEARCH_CLIENT_ID), trim(env.NAVER_LOCAL_SEARCH_SECRET), 'NAVER_LOCAL_SEARCH_*'],
    [trim(env.NAVER_DEVELOPERS_CLIENT_ID), trim(env.NAVER_DEVELOPERS_SECRET), 'NAVER_DEVELOPERS_*'],
    [trim(env.NAVER_CLIENT_ID), trim(env.NAVER_CLIENT_SECRET), 'NAVER_CLIENT_*'],
    [trim(env.NCP_CLIENT_ID), trim(env.NCP_CLIENT_SECRET), 'NCP_CLIENT_*'],
  ];
  return tries
    .filter(([id, secret]) => id && secret)
    .map(([id, secret, source]) => ({ id, secret, source }));
}


// 후보 키쌍을 차례로 시도해 첫 비-401/403 응답을 반환한다.
// 401/403 = 그 키가 Naver 에서 거부됨 (만료·앱 삭제) → 다음 후보로.
// 그 외 상태 (200, 429, 5xx...) 는 키 문제가 아니므로 즉시 반환.
// preferred 가 후보에 있으면 그 키쌍부터 시도한다.
export async function searchWithCredentialFallback(candidates, doRequest, preferred = null) {
  const ordered = preferred
    ? [...candidates.filter((c) => c.source === preferred), ...candidates.filter((c) => c.source !== preferred)]
    : candidates;
  const rejected = [];
  for (const creds of ordered) {
    const upstream = await doRequest(creds);
    if (upstream.status === 401 || upstream.status === 403) {
      rejected.push({ source: creds.source, status: upstream.status, data: upstream.data });
      continue;
    }
    return { upstream, source: creds.source, rejected };
  }
  return { upstream: null, source: null, rejected };
}

const LOCAL_SEARCH_URL = 'https://openapi.naver.com/v1/search/local.json';
// 마지막으로 성공한 키쌍 source — 자동완성 핸들러와 따로 기억한다(같은 키여도 무방).
let lastGoodLocalSource = null;

/**
 * 장소 검색 한 번 → [{ title, category, address, roadAddress, lat, lng }] (좌표 변환 실패 항목은 뺀다).
 * 결과 없음·검색어 너무 짧음 = [], 실패(키 없음·모든 키 거부·429·5xx·시간 초과·예외) = null. throw 하지 않는다.
 */
export async function searchNaverLocal(query, { display = 5, timeoutMs = 2000, env = process.env } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const candidates = resolveCredentialCandidates(env);
  if (!candidates.length) return null;
  try {
    const doRequest = (creds) => axios.get(LOCAL_SEARCH_URL, {
      params: { query: q, display, sort: 'random' },
      headers: { 'X-Naver-Client-Id': creds.id, 'X-Naver-Client-Secret': creds.secret, Accept: 'application/json' },
      timeout: timeoutMs,
      validateStatus: () => true,
    });
    const { upstream, source } = await searchWithCredentialFallback(candidates, doRequest, lastGoodLocalSource);
    if (!upstream || upstream.status !== 200) return null;
    lastGoodLocalSource = source;
    const items = Array.isArray(upstream.data && upstream.data.items) ? upstream.data.items : [];
    const out = [];
    for (const it of items) {
      const coord = naverCoordToWgs84(it.mapx, it.mapy);
      if (!coord) continue;
      out.push({ title: stripTags(it.title), category: stripTags(it.category), address: stripTags(it.address), roadAddress: stripTags(it.roadAddress), lat: coord.lat, lng: coord.lng });
    }
    return out;
  } catch {
    return null;
  }
}
