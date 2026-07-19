/**
 * _seoul_bus_ars.js — 버스 정류장 좌표 → 간판 ARS 번호(5자리).
 *
 * 왜 필요한가: prod provider 가 TMAP 인데 TMAP 응답에는 ARS 번호가 없다(raw 전수 스캔 확인).
 * 외국인이 현장에서 정류장을 특정하려면 간판의 5자리 번호가 가장 확실한 단서라
 * ODsay 시절에는 `fromArs`/`toArs` 로 내려가 TransitArrow·PDF 가 렌더하고 있었다.
 * TMAP 은 대신 정류장 **좌표**를 주므로, 서울시 정류소 데이터와 좌표로 매칭해 되살린다.
 *
 * 데이터: 서울 열린데이터광장 busStopLocationXyInfo (11,240건, 한강선착장 8건 제외).
 *   🔑 간판 ARS = `NODE_ID` 필드. `STOPS_NO`(9자리)는 TOPIS stationId 라 간판 번호가 아니다.
 *   ⚠️ 반드시 JSON/XML 로 받을 것 — CSV 는 선행 0 이 잘려 30.4%(3,422건)가 깨진다.
 *   서울 전용. 서울 밖 좌표는 후보가 없어 자연히 null 이 된다.
 *
 * 🔴 안전 원칙: 버스 정류장은 양방향이 20~40m 거리에 **서로 다른 ARS** 를 가진다.
 *   틀린 번호는 사람을 반대편 승강장으로 보내므로, 확신이 없으면 **아무것도 주지 않는다**.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 후보 반경(m). 이 밖은 아예 다른 정류장으로 본다. */
const SEARCH_RADIUS_M = 60;
/** 이름이 안 맞을 때 거리만으로 채택하는 상한(m). */
const DISTANCE_ONLY_MAX_M = 30;
/** 이름이 안 맞을 때 1위·2위가 이만큼 벌어져야 채택(m). 양방향 쌍 오인 방지. */
const DISTANCE_ONLY_MIN_GAP_M = 20;

let _index = null;
/** [[ars, lat, lng, name], …] — 지연 로딩 후 캐시(콜드스타트 1회). */
function loadIndex() {
  if (_index) return _index;
  try {
    _index = JSON.parse(readFileSync(join(__dirname, '_seoul_bus_ars.json'), 'utf-8'));
  } catch (err) {
    console.warn('[seoul-ars] index load failed:', err.message);
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
 * 좌표(+정류장명)로 간판 ARS 를 찾는다. 확신이 없으면 null.
 *
 * 판정 순서 — 이름이 거리보다 강한 단서다:
 *   1) 반경 안에 이름이 정확히 같은 후보가 있으면 그중 가장 가까운 것.
 *      (양방향 쌍은 이름이 같으므로 여기서 거리로 갈린다.)
 *   2) 이름이 안 맞으면 1위가 30m 이내이고 2위와 20m 이상 벌어질 때만 채택.
 *   3) 그 외 → null. "방배역"(8.3m) 옆에 "방배(백석예술대)역3번출구"(2.2m) 가 있는 식이라
 *      거리만 믿으면 틀린 승강장을 알려주게 된다.
 *
 * ⚠️ TMAP 은 중앙차로 정류장을 "○○역(중)" 으로 준다. 이 접미사를 떼고 이름을 맞추면
 *    같은 이름의 **갓길** 정류장(다른 ARS)에 걸릴 수 있어 일부러 떼지 않는다.
 *
 * @param {number} lat @param {number} lng
 * @param {string} [name] 제공자가 준 정류장명 (있으면 정확도가 크게 오른다)
 * @returns {string|null} 5자리 ARS (선행 0 포함) 또는 null
 */
export function resolveBusArs(lat, lng, name) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const near = [];
  for (const [ars, sLat, sLng, sName] of loadIndex()) {
    // 위도 0.001° ≈ 111m — 하버사인 전에 싸게 걸러낸다(11,240건 전수 계산 회피).
    if (Math.abs(sLat - lat) > 0.001 || Math.abs(sLng - lng) > 0.0013) continue;
    const d = distanceM(lat, lng, sLat, sLng);
    if (d <= SEARCH_RADIUS_M) near.push({ ars, name: sName, d });
  }
  if (!near.length) return null;
  near.sort((a, b) => a.d - b.d);

  if (name) {
    const exact = near.filter((x) => x.name === name);
    if (exact.length) return exact[0].ars;
  }
  const gap = near.length > 1 ? near[1].d - near[0].d : Infinity;
  if (near[0].d <= DISTANCE_ONLY_MAX_M && gap >= DISTANCE_ONLY_MIN_GAP_M) return near[0].ars;
  return null;
}

/** 테스트용 — 인덱스 크기 확인. */
export function _indexSize() {
  return loadIndex().length;
}
