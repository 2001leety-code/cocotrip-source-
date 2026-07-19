/**
 * _subway_exits.js — 역 + 목적지 → 나가야 할 출구 번호.
 *
 * 왜 필요한가: prod provider 가 TMAP 인데 TMAP 응답에는 출구 정보가 없다(raw 전수 스캔 확인).
 * 국토교통부 TAGO 지하철정보도 답이 아니다 — 공식 스펙상 출구 레코드가
 * `{busRouteNo, exitNo}` / `{dirDesc, exitNo}` 뿐이라 **위경도 필드가 아예 없다.**
 * 좌표가 없으면 "목적지에서 가장 가까운 출구"를 고를 수 없다.
 *
 * 그래서 OpenStreetMap 의 `railway=subway_entrance` 노드를 쓴다(출구번호 `ref` + 좌표, 무료·무키).
 * 지도 타일이 이미 OSM 기반이라 출처 표기(ODbL)도 화면에 이미 들어가 있다.
 *
 * 인덱스는 출구를 **역에 소속**시켜 만든다(공식 전국도시철도역사정보표준데이터 기준).
 * 🔴 단순 반경으로 묶으면 이웃 역 출구가 섞인다 — 명동역 조회가 270m 떨어진 을지로입구
 *    출구를 물어왔다. 출구 번호는 역마다 독립이라 옆 역 번호를 주면 그냥 틀린 안내다.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 이름이 같은 역 후보 중 이 거리 안의 것만 본다. 시청(서울·부산·대전)처럼 동명이역을 가른다. */
const NAME_MATCH_MAX_M = 1500;
/** 이름을 못 맞췄을 때 좌표만으로 역을 고르는 상한. 이웃 역 오인을 막으려 좁게 잡는다. */
const COORD_ONLY_MAX_M = 200;

let _index = null;
/** [[역명, 역위도, 역경도, [[ref, lat, lng], …]], …] — 지연 로딩 후 캐시. */
function loadIndex() {
  if (_index) return _index;
  try {
    _index = JSON.parse(readFileSync(join(__dirname, '_subway_exits.json'), 'utf-8'));
  } catch (err) {
    console.warn('[subway-exits] index load failed:', err.message);
    _index = [];
  }
  return _index;
}

const R = 6371000;
const rad = (x) => (x * Math.PI) / 180;
function distanceM(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * 역명 정규화. 공식 데이터가 같은 역을 "홍대입구"/"홍대입구역" 두 표기로 싣고
 * 괄호 부제("자양(뚝섬한강공원)")도 붙어 있어, 인덱스와 조회 양쪽에서 같은 규칙을 쓴다.
 * 2글자 이하는 건드리지 않는다("역곡" 같은 이름에서 '역'을 떼면 안 된다).
 */
export function canonicalStationName(name) {
  const base = String(name || '').replace(/\(.*?\)/g, '').trim();
  return base.length > 2 ? base.replace(/역$/, '') : base;
}

/**
 * 역에 딸린 출구 중 목적지에서 가장 가까운 것의 번호.
 *
 * 역을 고르는 순서 — 이름이 좌표보다 강한 단서다:
 *   1) 정규화한 이름이 같고 1.5km 안인 후보 중 좌표가 가장 가까운 역
 *      (시청은 서울·부산·대전 3곳, 신촌은 2호선·경의중앙 2곳이라 좌표로 갈린다)
 *   2) 이름을 못 맞추면 200m 안의 가장 가까운 역 (좁게 — 이웃 역을 집으면 틀린 번호가 된다)
 *   3) 그래도 없으면 null
 *
 * @param {{lat:number,lng:number,name?:string}|null} station 역 (TMAP leg.start / leg.end)
 * @param {{lat:number,lng:number}|null} target 이 출구로 나가서 갈 곳
 *   (하차역이면 목적지, 승차역이면 출발지)
 * @returns {string|null} 출구 번호(예: "3", "9-1") 또는 판단 불가 시 null
 */
export function resolveStationExit(station, target) {
  if (!station || !target) return null;
  if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return null;
  if (!Number.isFinite(target.lat) || !Number.isFinite(target.lng)) return null;

  const index = loadIndex();
  const wanted = canonicalStationName(station.name);

  let picked = null;
  if (wanted) {
    for (const entry of index) {
      if (entry[0] !== wanted) continue;
      const d = distanceM(station.lat, station.lng, entry[1], entry[2]);
      if (d <= NAME_MATCH_MAX_M && (!picked || d < picked.d)) picked = { entry, d };
    }
  }
  if (!picked) {
    for (const entry of index) {
      if (Math.abs(entry[1] - station.lat) > 0.003 || Math.abs(entry[2] - station.lng) > 0.004) continue;
      const d = distanceM(station.lat, station.lng, entry[1], entry[2]);
      if (d <= COORD_ONLY_MAX_M && (!picked || d < picked.d)) picked = { entry, d };
    }
  }
  if (!picked) return null;

  let best = null;
  for (const [ref, lat, lng] of picked.entry[3]) {
    const d = distanceM(target.lat, target.lng, lat, lng);
    if (!best || d < best.d) best = { ref, d };
  }
  return best ? best.ref : null;
}

/** 테스트용 — 인덱스 크기 확인(경로가 틀리면 조용히 0 이 된다). */
export function _indexSize() {
  return loadIndex().length;
}
