/**
 * _axios-mock.mjs — 하네스용 axios 대체 (default export).
 *
 * RouteAgent 가 `import axios from "axios"` 로 쓰는 axios.get 만 의미있게 구현.
 *   - Naver Geocoding URL (map-geocode) → globalThis.__PLAN_LOCAL_GEO__ 좌표표에서
 *     query(주소/이름) 매칭해 ODsay/Naver 응답 형식으로 반환 → 좌표 채워짐(오프라인 geocoding 시뮬).
 *   - 그 외 모든 외부 URL (Naver driving 등) → reject → RouteAgent graceful fallback.
 *
 * globalThis.__PLAN_LOCAL_GEO__ = [{ q:[검색어들], lat, lng }] (run.mjs 가 fixture 로 채움).
 */

function lookupGeo(query) {
  const table = globalThis.__PLAN_LOCAL_GEO__ || [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  // 정확/부분 매칭 (주소 또는 이름 포함).
  for (const row of table) {
    for (const cand of row.q) {
      const c = String(cand || '').trim().toLowerCase();
      if (!c) continue;
      if (c === q || c.includes(q) || q.includes(c)) return row;
    }
  }
  return null;
}

const axios = {
  async get(url, _config = {}) {
    const u = String(url || '');
    // Naver Geocoding
    if (u.includes('map-geocode')) {
      const query = _config?.params?.query || '';
      const hit = lookupGeo(query);
      if (hit) {
        return { status: 200, data: { addresses: [{ x: String(hit.lng), y: String(hit.lat) }] } };
      }
      return { status: 200, data: { addresses: [] } };
    }
    // 그 외 (Naver driving, Google Places 등) — 오프라인이므로 실패 처리 → RouteAgent fallback.
    const err = new Error('offline-harness: external HTTP disabled');
    err.code = 'OFFLINE_HARNESS';
    throw err;
  },
  async post() { const e = new Error('offline-harness: external HTTP disabled'); throw e; },
};

export default axios;
export { axios };
