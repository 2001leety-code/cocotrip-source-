import axios from "axios";
import { BaseAgent } from "./BaseAgent.js";
import { searchTransitRoute, formatTransitSummary, getSubwayStationInfo, getSubwayTimetable } from "../../_odsay_helper.js";
import { AIRPORT_COORDS, CITY_CENTER_COORDS, lookupZoneCoord } from "../constants.js";
import { throttledTelegramAlert } from "../../_shared/telegram-throttle.js";

// ── intercity station coordinates (PDF-issue-2 fix, 2026-05-14) ─────────
// KTX/Air/Bus 의 from_station/to_station 좌표 — RouteAgent 가 city-change day
// 의 hotel→station + station→new_hotel bookend transit 계산할 때 사용.
// UI 도 intercity 전후 segment 표시 가능.
export const STATION_COORDS = {
  // ── KTX/SRT 주요역 ─────────────────────────────────
  '서울역':         { lat: 37.5547, lng: 126.9706, label: '서울역' },
  '용산역':         { lat: 37.5298, lng: 126.9648, label: '용산역' },
  '청량리역':       { lat: 37.5800, lng: 127.0470, label: '청량리역' },
  '부산역':         { lat: 35.1149, lng: 129.0411, label: '부산역' },
  '동대구역':       { lat: 35.8772, lng: 128.6286, label: '동대구역' },
  '대전역':         { lat: 36.3322, lng: 127.4346, label: '대전역' },
  '광주송정역':     { lat: 35.1357, lng: 126.7943, label: '광주송정역' },
  '전주역':         { lat: 35.8467, lng: 127.1539, label: '전주역' },
  '강릉역':         { lat: 37.7644, lng: 128.8997, label: '강릉역' },
  '여수EXPO역':     { lat: 34.7589, lng: 127.7426, label: '여수EXPO역' },
  '춘천역':         { lat: 37.8849, lng: 127.7188, label: '춘천역' },
  '가평역':         { lat: 37.8126, lng: 127.5108, label: '가평역' },
  // ── 공항 ──────────────────────────────────────────
  '김포국제공항':   { lat: 37.5589, lng: 126.7906, label: '김포국제공항' },
  '인천국제공항':   { lat: 37.4602, lng: 126.4407, label: '인천국제공항' },
  '김해국제공항':   { lat: 35.1795, lng: 128.9381, label: '김해국제공항' },
  '제주국제공항':   { lat: 33.5113, lng: 126.4929, label: '제주국제공항' },
  '대구국제공항':   { lat: 35.8980, lng: 128.6593, label: '대구국제공항' },
  // ── 고속/시외버스 터미널 ───────────────────────────
  '서울고속버스터미널':   { lat: 37.5044, lng: 127.0048, label: '서울고속버스터미널' },
  '부산종합버스터미널':   { lat: 35.2117, lng: 129.0871, label: '부산종합버스터미널' },
  '경주시외버스터미널':   { lat: 35.8554, lng: 129.2284, label: '경주시외버스터미널' },
};

/**
 * station label → coord lookup. 등록 안 된 station 이면 null.
 * @param {string} stationName 예: "부산역" / "김포국제공항"
 * @returns {{ lat: number, lng: number, label: string } | null}
 */
export function lookupStationCoord(stationName) {
  if (!stationName || typeof stationName !== 'string') return null;
  const trimmed = stationName.trim();
  return STATION_COORDS[trimmed] || null;
}

// ── city → default station 매핑 (PDF-issue-2 v4, 2026-05-14) ─────────────
// STANDARD_INTERCITY 에 등록 안 된 city pair (예: Suwon-Daejeon) 의 fallback —
// 각 city 의 mode 별 기본 정거장. RouteAgent 가 from_station/to_station 없는
// fallback intercity 도 station 좌표 기반 bookend 계산 가능.
export const CITY_DEFAULT_STATION = {
  Seoul:     { ktx: '서울역',        air: '김포국제공항',    bus: '서울고속버스터미널' },
  Busan:     { ktx: '부산역',        air: '김해국제공항',    bus: '부산종합버스터미널' },
  Jeju:      {                      air: '제주국제공항' },
  Daegu:     { ktx: '동대구역',      air: '대구국제공항' },
  Daejeon:   { ktx: '대전역' },
  Gwangju:   { ktx: '광주송정역' },
  Jeonju:    { ktx: '전주역' },
  Gangneung: { ktx: '강릉역' },
  Yeosu:     { ktx: '여수EXPO역' },
  Chuncheon: { ktx: '춘천역' },
  Gapyeong:  { ktx: '가평역' },
  Gyeongju:  {                                            bus: '경주시외버스터미널' },
};

/**
 * city + mode → 기본 station 이름 추론. STANDARD_INTERCITY hit X 케이스 fallback.
 * @param {string} city 예: "Seoul"
 * @param {string} mode 예: "KTX" / "Air" / "Bus" / "ITX" / "SRT"
 * @returns {string | null} station 이름 (예: "서울역") 또는 null
 */
export function inferDefaultStation(city, mode) {
  if (!city || !mode) return null;
  const cityKey = String(city).trim();
  const modeLower = String(mode).toLowerCase().trim();
  const cityStations = CITY_DEFAULT_STATION[cityKey];
  if (!cityStations) return null;
  // mode → station type 매핑 (KTX/SRT/ITX → ktx, Air → air, Bus → bus)
  if (modeLower === 'ktx' || modeLower === 'srt' || modeLower === 'itx') {
    return cityStations.ktx || null;
  }
  if (modeLower === 'air' || modeLower === 'flight') {
    return cityStations.air || null;
  }
  if (modeLower === 'bus' || modeLower === 'coach') {
    return cityStations.bus || null;
  }
  return null;
}

// ── city family normalization (PDF-issue-3 helper, 2026-05-14) ──────────
// 부산/busan/busan_city 같은 다양한 표기를 family key 로 정규화 — 동일 city 판정용.
function cityFamily(raw) {
  if (!raw) return '';
  const s = String(raw).toLowerCase().trim();
  if (/busan|부산/i.test(s)) return 'busan';
  if (/jeju|제주/i.test(s)) return 'jeju';
  if (/seoul|서울/i.test(s)) return 'seoul';
  if (/daegu|대구/i.test(s)) return 'daegu';
  if (/gyeongju|경주/i.test(s)) return 'gyeongju';
  if (/jeonju|전주/i.test(s)) return 'jeonju';
  if (/gangneung|강릉/i.test(s)) return 'gangneung';
  if (/yeosu|여수/i.test(s)) return 'yeosu';
  return s;
}

/**
 * Day 의 city 가 trip 첫 city 와 같은 family 인지 판정.
 * 다도시 plan 의 day-level hotel coord 결정에 사용.
 *
 * @param {string} dCityRaw — 예: "Seoul", "서울", "seoul_city"
 * @param {string} tripFirstRegion — 예: "busan"
 * @returns {boolean} 같은 city = true (단도시 / city 미정 도 true → trip-level 사용)
 */
export function isSameAsFirstCity(dCityRaw, tripFirstRegion) {
  if (!tripFirstRegion || !dCityRaw) return true;
  return cityFamily(dCityRaw) === cityFamily(tripFirstRegion);
}

/**
 * 다도시 plan 의 day-level hotel coord 결정.
 *   - 단도시 / day.city 미정 / 같은 city continuing → trip-level (input hotel)
 *   - 다른 city → recommended_zones[city] 우선 → CITY_CENTER_COORDS[city] fallback
 *
 * PDF-issue-3 fix (2026-05-14): 이전엔 trip-level hotelLat/Lng 만 사용 → 다도시 plan 의 모든 day 가 첫 city 호텔 좌표 기준 → 사용자 PDF "부산 해운대 → 명동 호텔" 모순.
 *
 * @param {object} dayPlan — Gemini plan 의 day 객체 (city 필드 사용)
 * @param {object} ctx — { isMultiCity, recommendedZonesMap, tripFirstRegion, tripHotel: { lat, lng, label, source } }
 * @returns {{ lat: number|null, lng: number|null, label: string|null, source: string|null }}
 */
export function getDayHotelCoord(dayPlan, ctx) {
  const { isMultiCity, recommendedZonesMap, tripFirstRegion, tripHotel } = ctx || {};
  const trip = tripHotel || { lat: null, lng: null, label: null, source: null };
  // 다도시 plan 아니거나 day.city 미정 → trip-level 사용
  if (!isMultiCity || !dayPlan?.city) {
    return { lat: trip.lat, lng: trip.lng, label: trip.label, source: trip.source };
  }
  // 같은 city continuing → trip-level
  if (isSameAsFirstCity(dayPlan.city, tripFirstRegion)) {
    return { lat: trip.lat, lng: trip.lng, label: trip.label, source: trip.source };
  }
  // 다른 city — recommended_zones[city] 우선
  const dCityKey = String(dayPlan.city).toLowerCase().trim();
  if (recommendedZonesMap) {
    for (const [k, v] of Object.entries(recommendedZonesMap)) {
      if (!v || typeof v !== 'string') continue;
      const kLower = String(k).toLowerCase().trim();
      if (kLower === dCityKey || dCityKey.includes(kLower) || kLower.includes(dCityKey)) {
        const z = lookupZoneCoord(v);
        if (z) {
          return { lat: z.lat, lng: z.lng, label: z.label, source: 'multi_city_zone' };
        }
      }
    }
  }
  // CITY_CENTER_COORDS fallback (busan/jeju/seoul/...)
  for (const [key, coord] of Object.entries(CITY_CENTER_COORDS)) {
    if (dCityKey.includes(key) || key.includes(dCityKey)) {
      return { lat: coord.lat, lng: coord.lng, label: coord.label, source: 'multi_city_center' };
    }
  }
  // 마지막 fallback — trip-level (회귀 안전망)
  return { lat: trip.lat, lng: trip.lng, label: trip.label, source: trip.source };
}

// Sentry import은 dynamic — `_shared/sentry.js`의 captureError가 SENTRY_DSN
// 없으면 no-op이라 안전. 실패해도 import 자체로 plan 깨지지 않게 try/catch.
let _captureError = null;
async function reportError(err, ctx) {
  try {
    if (_captureError === null) {
      const mod = await import('../../_shared/sentry.js');
      _captureError = mod.captureError || (() => {});
    }
    await _captureError(err, ctx);
  } catch { /* swallow — 알림 실패가 plan을 깨면 안 됨 */ }
}

// Pick the recommended airport transport based on context.
//   - Heavy luggage  → CocoTrip charter cross-sell. Korean taxi law restricts
//     trunk capacity (a sedan taxi typically only takes ONE large suitcase),
//     so a group with multiple checked bags can't physically use a taxi —
//     they need a 8-pax Staria van or larger. We pitch our own charter here
//     instead of recommending an option that won't actually work.
//   - Late-night arrival (≥23:00 or <05:00) → AREX last train ~23:42, so
//     recommend limousine bus.
//   - Otherwise → AREX express is the fastest/cheapest standard option.
//
// Heavy threshold:
//   ≥3 large bags, OR (≥2 large bags AND ≥4 pax), OR (≥2 mediums AND ≥1 large
//   AND ≥3 pax) — anything that clearly won't fit in a sedan trunk.
function pickRecommendedTransport({ arrivalTimeHHMM, luggage, paxCount }) {
  // 2026-05-13 PR (Critical C3 — Agent X audit): HH:MM 형식 검증.
  // 기존: arrivalTimeHHMM 형식 검증 없음 → "9:30 " / "오전 9시" / "ABCDE" 등
  // 비정상 입력 시 parseInt 가 NaN 반환 → lateNight=false 가정 → 잘못된 추천.
  // /^\d{1,2}:\d{2}$/ 매칭 + 0-23 범위 확인.
  let hour = null;
  if (arrivalTimeHHMM && /^\d{1,2}:\d{2}$/.test(arrivalTimeHHMM)) {
    const parsed = parseInt(arrivalTimeHHMM.split(':')[0], 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed < 24) {
      hour = parsed;
    }
  }
  const lateNight = hour !== null && (hour >= 23 || hour < 5);
  const large = luggage?.large || 0;
  const medium = luggage?.medium || 0;
  const heavyLoad = large >= 3
    || (paxCount >= 4 && large >= 2)
    || (paxCount >= 3 && medium >= 2 && large >= 1);
  if (heavyLoad) {
    return {
      key: 'cocotrip_charter',
      reason_ko: '한국 택시는 캐리어 1개만 가능 — 짐이 많아 코코트립 전용 차량을 추천합니다 (기사가 모든 짐 적재)',
      reason_en: 'Korean taxis can only fit 1 suitcase — book a CocoTrip charter; your driver loads all luggage',
      reason_ja: '韓国のタクシーはスーツケース1個のみ — 荷物が多い方は専用車両を推奨（ドライバーが全荷物を積載）',
      reason_zh: '韩国出租车只能放1个行李箱 — 行李较多请预订CocoTrip包车（司机协助装载所有行李）',
      cta_link: '/charter',
    };
  }
  if (lateNight) {
    return {
      key: 'limousine_bus',
      reason_ko: '늦은 시각 도착 — AREX 막차 후 운행하는 리무진 버스 추천',
      reason_en: 'Late arrival — AREX has stopped, take limousine bus',
      reason_ja: '深夜到着 — AREXの終電後はリムジンバスを推奨',
      reason_zh: '深夜到达 — AREX末班车已结束，推荐机场巴士',
    };
  }
  return {
    key: 'arex_express',
    reason_ko: '가장 빠르고 저렴한 표준 옵션',
    reason_en: 'Fastest and cheapest standard option',
    reason_ja: '最速かつ最安の標準オプション',
    reason_zh: '最快最便宜的标准选择',
  };
}

// Map the Wizard / Gemini `area` value to the matching charter product in
// createPaypalOrder.js PRODUCT_PRICES so the "book a charter" CTA deep-links
// to the correct regional tour instead of always offering Seoul.
//
// Launch P1-1 (2026-05-10): null fallback 으로 변경.
// 잘못된 region 매핑 (예: jeju → charter_seoul_city) 은 사용자에게 잘못된 지역
// 차터를 권유 → 환불·신뢰 손상 위험. 매핑 없으면 차터 cross-sell 자체를 노출
// 하지 않는 게 옳음 (client 가 null 일 때 차터 CTA 숨김).
//
// 'jeju' 누락: 운영자 spec 에 jeju 차터 없음 → null. Jeju 차터 운영 시 매핑 추가.
const REGION_TO_CHARTER_PRODUCT = {
    seoul_city: 'charter_seoul_city',
    seoul: 'charter_seoul_city',
    seoul_suburb: 'charter_seoul_suburb',
    dmz: 'charter_dmz',
    incheon: 'charter_seoul_city',
    suwon: 'charter_seoul_suburb',
    gangwon: 'charter_gangwon',
    gangneung: 'charter_gangwon',
    chuncheon: 'charter_gangwon',
    pyeongchang: 'charter_ski',
    ski: 'charter_ski',
    gyeongju: 'charter_gyeongju',
    jeonju: 'charter_gyeongju',
    busan: 'charter_busan',
    yeosu: 'charter_busan',
    daegu: 'charter_busan',
    // jeju: 운영자 spec 에 차터 운영 안 함 — 매핑 추가 시 cross-sell 노출
};

function regionToCharterProduct(region) {
    if (!region) return null;
    const key = String(region).toLowerCase();
    // 매핑 없으면 null — client 가 차터 CTA 자체를 숨김 (잘못된 지역 권유 방지).
    return REGION_TO_CHARTER_PRODUCT[key] || null;
}

// B-11 fix (2026-05-12): transit_from_prev.mode 명시 보존.
// ODsay formatTransitSummary 는 method 만 채우고 (값: 'subway'|'bus'|'subway+bus'|'walk'),
// 회귀 슈트 B-11 은 `t.mode || t.type` 로 비율 측정 → 0/0 으로 영구 skip 됐다.
// 모든 transit_from_prev / route 객체에 mode 필드를 명시 저장해 ODsay 사용 비율
// 자동 검증 가능 + UI/PDF/이메일 에서 method 와 별개로 분류 가능 (subway+bus →
// 'transit' 정규화). 자율 검증 시스템(2026-05-12) 자동 감지 후 추가된 매핑.
//
// ODsay pathType: 1=지하철, 2=버스, 3=지하철+버스. 도보는 형식이 다른 별도 경로.
export function odsayPathTypeToMode(pathType) {
    switch (pathType) {
        case 1: return 'subway';
        case 2: return 'bus';
        case 3: return 'transit';
        default: return 'walk';
    }
}

// method (formatTransitSummary 출력) 를 표준 mode 값으로 정규화.
// 'subway+bus' → 'transit' 변환, 그 외 enum 값은 그대로 통과.
// 회귀 슈트 B-11 의 허용 enum: subway/bus/walk/transit/metro.
export function methodToMode(method) {
    if (!method) return null;
    const m = String(method).toLowerCase();
    if (m === 'subway+bus' || m === 'bus+subway' || m === 'mixed') return 'transit';
    if (m === 'metro') return 'subway'; // 호환 — 일부 ODsay 응답에 잔존 가능
    return m; // subway / bus / walk / car / unknown 그대로
}

// ── Haversine helper (module-level pure fn) ─────────────────────────────
// _haversineKm 은 RouteAgent 인스턴스 메서드라 reorderStopsByProximity 의
// pure helper 호출을 위해 module-level 복제. 동일 공식 (R=6371 km).
function _haversineKmPure(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 좌표 배열의 총 traversal 거리 (km) — TSP fitness 평가용.
function _totalRouteKm(stops) {
    let total = 0;
    for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        if (a && b && a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
            total += _haversineKmPure(a.lat, a.lng, b.lat, b.lng);
        }
    }
    return total;
}

/**
 * 일 단위 stop 재정렬 — Gemini 가 zone 클러스터 안내 (buildPrompt.js L556) 를
 * 무시하고 zigzag 순서 (Gwangalli → Gijang → Yeongdo → Gwangalli) 를 반환했을 때
 * RouteAgent 가 Haversine nearest-neighbor (greedy TSP) 로 동선 단축.
 *
 * 사용자 신고 (2026-05-13 PDF): Day 4 Busan 동선 4.7시간 (283분) transit —
 * Gwangalli (수영구) → Gijang (NE) → Huinnyeoul (영도구 SW) → 다시 Gwangalli.
 * buildPrompt.js 의 "같은 권역(구) 내 stops 묶어서 이동 시간 최소화" 안내 명시
 * 했지만 RouteAgent 가 Gemini 순서 trust + 재정렬 X.
 *
 * 정책:
 *   - 첫 stop (보통 lodging departure / 호텔 출발) → 그대로 [0]
 *   - 마지막 stop (보통 lodging return 또는 공항 이동) → 그대로 [N-1]
 *   - 중간 stop 들 → 후보 알고리즘 여러 개 돌리고 가장 짧은 총 거리 채택.
 *     1) greedy NN forward (first anchor 기준 nearest-neighbor)
 *     2) greedy NN backward (last anchor 기준 nearest-neighbor — 결과 reverse)
 *     3) 원본 그대로
 *     → 셋 중 총 거리 (first → ... → last 포함) 최소 채택.
 *   - 좌표 누락 중간 stop 있으면 원본 순서 유지 (회귀 안전망)
 *
 * 왜 candidates 비교 — greedy NN 은 "마지막 stop 으로의 복귀 비용" 을 무시해서
 * 종종 원본 zigzag 보다 나쁜 결과 (e.g. outlier 를 첫 step 에 빼면 마지막에 다시
 * 돌아와야 함). fail-safe: 후보 중 최소 거리 채택 → 절대 악화시키지 않음.
 *
 * @param {Array} stops — Gemini/RouteAgent 가 채운 stop 배열. 각 stop 은 lat/lng 필요.
 * @returns {Array} 새 배열 또는 원본 — 좌표 누락 또는 stops.length<=3 시 입력 그대로 반환.
 */
// 2026-05-13 PR #413: stops 가 chronological 인지 검증 (start_time 오름차순).
// PR #409 의 TSP reorder 는 start_time 재할당 X — array 순서만 바꿈.
// reorder 가 chronology 깨면 (e.g. 14:00 stop 이 19:00 stop 앞으로) → PDF 시간 jumbled.
// Gemini 가 일반적으로 chronological 응답 → reorder 가 시간 의미 파괴 가능.
function _isChronological(stops) {
    if (!Array.isArray(stops) || stops.length === 0) return true;
    let prevMinutes = -1;
    for (const s of stops) {
        const t = String(s?.start_time || '');
        const m = t.match(/^(\d{1,2}):(\d{2})$/);
        if (!m) continue; // start_time 없는 stop skip
        const minutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        if (minutes < prevMinutes) return false;
        prevMinutes = minutes;
    }
    return true;
}

export function reorderStopsByProximity(stops) {
    if (!Array.isArray(stops) || stops.length <= 3) {
        // 2-stop (lodging-lodging), 3-stop (lodging + 1 + lodging) → 재정렬 불필요.
        return stops;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const middle = stops.slice(1, stops.length - 1);

    // 좌표 누락 중간 stop 1개라도 있으면 fallback — 원본 순서 유지.
    // (anchor 인 first/last 좌표도 누락 시 거리 계산 불가 → 동일 처리)
    const hasAllCoords = first && first.lat != null && first.lng != null
        && last && last.lat != null && last.lng != null
        && middle.every((s) => s && s.lat != null && s.lng != null);
    if (!hasAllCoords) {
        return stops;
    }

    // ─── 후보 1: greedy NN forward (first anchor 부터) ─────────
    const greedyFromAnchor = (anchorLat, anchorLng, pool) => {
        const remaining = [...pool];
        const ordered = [];
        let aLat = anchorLat;
        let aLng = anchorLng;
        while (remaining.length > 0) {
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < remaining.length; i++) {
                const s = remaining[i];
                const d = _haversineKmPure(aLat, aLng, s.lat, s.lng);
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = i;
                }
            }
            const next = remaining.splice(bestIdx, 1)[0];
            ordered.push(next);
            aLat = next.lat;
            aLng = next.lng;
        }
        return ordered;
    };
    const forwardOrder = greedyFromAnchor(first.lat, first.lng, middle);
    const candidateForward = [first, ...forwardOrder, last];

    // ─── 후보 2: greedy NN backward (last anchor 부터 — 결과 reverse) ─────────
    // last anchor 에서 가장 가까운 stop 부터 거꾸로 잡으면 마지막 stop 이 lodging
    // return 에 가까워서 total path 짧아지는 케이스 (PDF 사례).
    const backwardOrder = greedyFromAnchor(last.lat, last.lng, middle).reverse();
    const candidateBackward = [first, ...backwardOrder, last];

    // ─── 후보 3: 원본 그대로 ─────────
    // greedy 가 둘 다 zigzag 보다 나쁜 케이스 (pathological) — 원본 보존.
    const candidateOriginal = stops;

    // 셋 중 총 거리 최소 채택 — 단, **chronological 보존** candidate 만.
    // 2026-05-13 PR #413: TSP 가 start_time 재할당 X 라 chronology 깨지면 PDF 시간 jumbled.
    // chronological 후보만 distance 비교. original 이 항상 fallback (Gemini 일반적으로 chrono).
    const distForward = _totalRouteKm(candidateForward);
    const distBackward = _totalRouteKm(candidateBackward);
    const distOriginal = _totalRouteKm(candidateOriginal);
    const chronoForward = _isChronological(candidateForward);
    const chronoBackward = _isChronological(candidateBackward);
    const chronoOriginal = _isChronological(candidateOriginal);

    // chronological 후보만 필터 → 그중 min distance
    const validCandidates = [];
    if (chronoForward) validCandidates.push({ stops: candidateForward, dist: distForward, label: 'forward' });
    if (chronoBackward) validCandidates.push({ stops: candidateBackward, dist: distBackward, label: 'backward' });
    if (chronoOriginal) validCandidates.push({ stops: candidateOriginal, dist: distOriginal, label: 'original' });

    if (validCandidates.length === 0) {
        // 모든 후보 비chronological — Gemini 응답 자체가 시간 순서 깨져 있음 (이상 케이스).
        // 안전 default = 원본 반환 (caller 에서 추가 검증 또는 별도 fix 필요).
        return candidateOriginal;
    }

    // min distance 채택 — 순서: forward / backward / original (tie-break)
    validCandidates.sort((a, b) => a.dist - b.dist);
    return validCandidates[0].stops;
}

export class RouteAgent extends BaseAgent {
    constructor(apiKey) {
        super(apiKey, "route");
        // Per-agent cache: one subwayStationInfo call per unique station per plan.
        // A typical plan touches <=20 unique subway stations, well within ODsay's
        // 1000 calls/day Basic tier budget.
        this._stationCache = {};
        // Separate cache for Seoul Open Data timetable API (first/last train).
        // Key is stationID:WEEK_TAG so weekday vs weekend of same station
        // don't collide across days.
        this._timetableCache = {};
    }
    async call(userPrompt) {
        console.log("\n[Route] Naver Maps + ODsay Transit + Time Stitching...");
        // Robust JSON extraction: strip fences, find outermost { }
        let jsonStr = userPrompt.replace(/^```(?:json)?\s*|```\s*$/gm, '').trim();
        const firstBrace = jsonStr.indexOf('{');
        const lastBrace = jsonStr.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
        }
        let data;
        try {
            data = JSON.parse(jsonStr);
        }
        catch (e) {
            console.warn("  [Route] JSON parse failed, falling back to LLM:", e.message);
            return super.call(userPrompt);
        }
        const clientId = (process.env.NAVER_CLIENT_ID || "").trim();
        const clientSecret = (process.env.NAVER_CLIENT_SECRET || "").trim();
        // Support both Gemini output formats
        const rawItinerary = data.itinerary || {};
        const hotelAddress = data.hotel_address || '';
        const region = data.area || data.region || '';
        const charterProductType = regionToCharterProduct(region);
        const daysList = Array.isArray(rawItinerary) ? rawItinerary : (rawItinerary.days || []);

        // ════════════════════════════════════════════════════════
        // Trip-level: geocode hotel ONCE, route airport ↔ hotel
        // (Phase 1 of arrival/departure guide enrichment)
        // ════════════════════════════════════════════════════════
        // Resolve order (B9-15/16/25, 2026-05-09):
        //   1. Naver Geocoding(hotelAddress) — 도로명/호텔명 정확도 최고
        //   2. lookupZoneCoord(hotelAddress) — substring 매칭 ("명동 롯데호텔" → 명동)
        //   3. lookupZoneCoord(recommended_zone key/한글)
        // 모두 실패 시 hotelLat/Lng 는 null 로 남고 후속 fallback (city center) 진입.
        // anchorSource 는 어느 단계에서 좌표를 잡았는지 기록 — 분석/UI 라벨용.
        let hotelLat = null, hotelLng = null, anchorSource = null, anchorLabel = null;
        if (hotelAddress && clientId && clientSecret) {
            try {
                const geoUrl = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
                const geoRes = await axios.get(geoUrl, {
                    params: { query: hotelAddress },
                    headers: { "X-NCP-APIGW-API-KEY-ID": clientId, "X-NCP-APIGW-API-KEY": clientSecret },
                    timeout: 5000,
                });
                if (geoRes.status === 200 && geoRes.data.addresses?.length > 0) {
                    hotelLng = parseFloat(geoRes.data.addresses[0].x);
                    hotelLat = parseFloat(geoRes.data.addresses[0].y);
                    anchorSource = 'naver_geocode';
                    anchorLabel = hotelAddress;
                }
            } catch (e) {
                console.warn(`  - Hotel geocoding failed: ${e.message}`);
            }
        }
        // Fallback chain step 2: zone substring/exact match on hotelAddress.
        // 호텔 주소에 등록된 zone 명이 들어 있으면 좌표 즉시 잡음. NCP 키 fail 또는
        // 단일 동 명("명동")인 경우의 보호 장치.
        if ((hotelLat == null || hotelLng == null) && hotelAddress) {
            const z = lookupZoneCoord(hotelAddress);
            if (z) {
                hotelLat = z.lat;
                hotelLng = z.lng;
                anchorSource = 'zone_lookup';
                anchorLabel = z.label;
                console.log(`  ✓ [hotel-coord] zone substring match: "${hotelAddress}" → ${z.label} (${z.lat}, ${z.lng})`);
            }
        }
        // Fallback chain step 3: explicit recommended_zone key/Korean 한국어 명.
        if ((hotelLat == null || hotelLng == null) && data.recommended_zone) {
            const z = lookupZoneCoord(data.recommended_zone);
            if (z) {
                hotelLat = z.lat;
                hotelLng = z.lng;
                anchorSource = 'zone_key';
                anchorLabel = z.label;
                console.log(`  ✓ [hotel-coord] zone key match: "${data.recommended_zone}" → ${z.label} (${z.lat}, ${z.lng})`);
            }
        }
        if (hotelLat == null || hotelLng == null) {
            console.warn(`  ⚠ [hotel-coord] all fallbacks failed — hotelAddress="${hotelAddress}" zone="${data.recommended_zone || ''}". LodgingBookend 미노출 + departure_guide city-center fallback.`);
        }

        const arrivalAirportKey = this._normalizeAirportKey(rawItinerary.arrival_guide?.airport || data.arrival_airport);
        const departureAirportKey = this._normalizeAirportKey(rawItinerary.departure_guide?.airport || data.departure_airport || arrivalAirportKey);

        if (hotelLat && hotelLng && arrivalAirportKey && AIRPORT_COORDS[arrivalAirportKey]) {
            const ap = AIRPORT_COORDS[arrivalAirportKey];
            const route = await this._routeAirportHotel(ap, { lat: hotelLat, lng: hotelLng }, 'arrival');
            if (route && rawItinerary.arrival_guide) {
                const rec = pickRecommendedTransport({
                    arrivalTimeHHMM: data.arrival_time,
                    luggage: data.luggage,
                    paxCount: data.pax || 2,
                });
                // B9-15/25: anchor_lat/lng/label 명시 attach — routeEnrichment.js
                // 의 validateLodgingBookend 가 이걸 사용. anchor_source 는 분석용
                // (naver_geocode / zone_lookup / zone_key) — UI 는 무시 가능.
                rawItinerary.arrival_guide.route_to_hotel = {
                    ...route,
                    recommended_option: rec,
                    anchor_lat: hotelLat,
                    anchor_lng: hotelLng,
                    anchor_label: anchorLabel,
                    anchor_source: anchorSource,
                };
                console.log(`  - [Airport→Hotel] ${route.est_min}min via ${route.method}, recommended=${rec.key}, anchor=${anchorSource}/${anchorLabel}`);
            }
        }

        // ════════════════════════════════════════════════════════
        // Hotel→Airport: 호텔→공항 경로 무조건 표시 정책 (2026-05-05)
        // ════════════════════════════════════════════════════════
        // 운영자 요청: "공항에서 숙소 가는 경로처럼, 숙소 → 공항도 무조건 표시".
        // Fallback 체인: hotel 좌표 → arrival_guide.address geocode → zone anchor
        // geocode → 도시 중심 좌표. 모두 실패해도 _failed=true 객체를 셋해서
        // 프론트가 graceful 메시지를 띄울 수 있게 한다.
        if (departureAirportKey && AIRPORT_COORDS[departureAirportKey] && rawItinerary.departure_guide) {
            const ap = AIRPORT_COORDS[departureAirportKey];
            const { coord: depFromCoord, source: depFromSource, label: depFromLabel } = await this._resolveHotelOrFallback({
                hotelLat,
                hotelLng,
                hotelAddress,
                arrivalGuide: rawItinerary.arrival_guide,
                recommendedZone: data.recommended_zone,
                region,
                clientId,
                clientSecret,
            });

            if (depFromCoord) {
                const route = await this._routeAirportHotel(depFromCoord, ap, 'departure');
                if (route) {
                    if (depFromSource !== 'hotel') {
                        route.fallback_origin = depFromSource; // 'arrival_guide' | 'zone_anchor' | 'city_center'
                        route.fallback_label = depFromLabel || null;
                    }
                    // B9-16/25: anchor_lat/lng/label 명시 attach — UI 가 "Seoul City
                    // Center" generic 대신 정확한 출발지명 노출 가능. trip-level
                    // hotelLat/Lng 가 있으면 그것을, 없으면 fallback chain 결과를 사용.
                    route.anchor_lat = depFromCoord.lat;
                    route.anchor_lng = depFromCoord.lng;
                    route.anchor_label = depFromLabel || anchorLabel || null;
                    route.anchor_source = depFromSource === 'hotel' ? (anchorSource || 'hotel') : depFromSource;
                    rawItinerary.departure_guide.route_to_airport = route;
                    console.log(`  - [Hotel→Airport] ${route.est_min}min via ${route.method} (origin=${depFromSource}, anchor=${route.anchor_source}/${route.anchor_label})`);
                } else {
                    // ODsay 끝까지 실패 — _failed 마커로 graceful 표시.
                    rawItinerary.departure_guide.route_to_airport = {
                        _failed: true,
                        _odsay_failed: true,
                        fallbackReason: 'odsay_unavailable',
                        fallback_origin: depFromSource,
                        fallback_label: depFromLabel || null,
                        method: 'unknown',
                        mode: 'unknown',
                        source: 'failed',
                        direction: 'departure',
                    };
                    console.warn('  - [Hotel→Airport] ODsay all attempts failed → _failed=true');
                    await reportError(new Error('ODsay departure route failed'), {
                        route: 'RouteAgent.routeToAirport',
                        airport: departureAirportKey,
                        origin: depFromSource,
                        region,
                    });
                }
            } else {
                // 좌표 자체를 못 잡음 (도시 중심도 미정의된 region) — 그래도 _failed
                // 객체를 두면 UI는 Gemini instruction fallback을 보여줄 수 있다.
                rawItinerary.departure_guide.route_to_airport = {
                    _failed: true,
                    _odsay_failed: false,
                    fallbackReason: 'no_origin_coord',
                    method: 'unknown',
                    mode: 'unknown',
                    source: 'failed',
                    direction: 'departure',
                };
                console.warn('  - [Hotel→Airport] no origin coord (region/zone fallback unmapped)');
            }
        }

        // ════════════════════════════════════════════════════════
        // B9-39 (2026-05-09): 다도시 plan 사전 처리
        // ════════════════════════════════════════════════════════
        // Gemini 가 days[].city + days[].intercity_transit 채웠으면 그대로 보존.
        // 안 채웠고 regions.length>=2 면 RouteAgent 가 fallback 으로 채움.
        // - 도시 추론: stops 의 첫 좌표를 city center 와 거리 비교 (haversine).
        // - 부산↔서울 같은 도시 변경 day 의 첫 stop 은 ODsay skip (>100km 무의미).
        const regionsList = Array.isArray(data.regions) ? data.regions
            : (Array.isArray(rawItinerary.regions) ? rawItinerary.regions : []);
        const isMultiCity = regionsList.length >= 2;
        if (isMultiCity) {
            console.log(`  [Route] multi-city plan detected: regions=${regionsList.join('+')}`);
            // city 미명시 day 들 city 추론 + intercity_transit 누락 채움
            this._enrichMultiCityDays(daysList, regionsList);
        }

        // ════════════════════════════════════════════════════════
        // PDF-issue-3 fix (2026-05-14): day-level hotel coord 결정
        // ════════════════════════════════════════════════════════
        // 다도시 plan 의 각 day 는 그 day 의 city 에 맞는 hotel 좌표 사용:
        //   - trip 첫 city continuing → trip-level hotelLat/hotelLng (입력 hotel)
        //   - 다른 city (city-change 이후) → recommended_zones[city] 좌표
        //     → 없으면 CITY_CENTER_COORDS[city] fallback
        // 이전: 모든 day 가 trip-level hotelLat/Lng (첫 city 호텔) 사용 → 부산
        //       도착·서울 이동 plan 의 Day 4 lodging_to_first 가 "부산 해운대 →
        //       명동 호텔" 모순 표시 (사용자 PDF 검토 2026-05-14).
        // prev-day hotel coord cache — Phase 2 loop 의 직전 iteration 결과를 다음
        // iteration 의 intercity bookend segment 계산에 활용. city-change day 의
        // hotel→from_station transit 을 그릴 때 출발지가 이전 day 의 hotel 좌표.
        let prevDayHotelCoord = null;

        const recommendedZonesMap = (data.recommended_zones && typeof data.recommended_zones === 'object' && !Array.isArray(data.recommended_zones))
            ? data.recommended_zones
            : null;
        const tripFirstRegion = regionsList[0] ? String(regionsList[0]).toLowerCase().trim() : null;
        // PDF-issue-3 v2 (2026-05-14): module-level helpers (getDayHotelCoord / isSameAsFirstCity)
        // 사용 — closure 제거 + unit test 가능. context 묶어서 전달.
        const dayHotelCtx = {
            isMultiCity,
            recommendedZonesMap,
            tripFirstRegion,
            tripHotel: { lat: hotelLat, lng: hotelLng, label: anchorLabel, source: anchorSource },
        };

        for (const dayPlan of daysList) {
            const places = dayPlan.stops || dayPlan.places || [];
            // Derive weekday for first/last-train lookup. Gemini writes
            // dayPlan.date as "YYYY-MM-DD"; Date.getDay() -> 0=Sun..6=Sat
            // which we map to WEEK_TAG inside getSubwayTimetable.
            const dayDate = dayPlan.date ? new Date(dayPlan.date) : null;
            const dayOfWeek = (dayDate && !isNaN(dayDate.getTime())) ? dayDate.getDay() : null;

            // ════════════════════════════════════════════════════════
            // Phase 1: 모든 장소의 좌표 확보 (Naver Geocoding) — 병렬화 (P138)
            // ════════════════════════════════════════════════════════
            // P138 (2026-05-22): 운영자 alert "ai-planner-full 4분30초 경과, last step:
            // routeEnrich 39초, total 270001ms" — Vercel 5분 cap 도달 직전. root cause
            // 의 큰 부분 = Phase 1 의 per-place sequential geocoding (30 places × 200-5000ms
            // × 3 query fallback = 최대 75s per day × 5 day = 6분+).
            //
            // 병렬화: outer for-of → Promise.all(places.map). place 간 독립 fetch (Naver
            // NCP 50 req/s 한도 — 30 places 동시는 안전). 각 place 내부의 query fallback
            // (address → name+region → display_name) 는 sequential 유지 — 1순위 성공 시
            // break 하는 의도 보존.
            //
            // 회귀 안전: place 별 try/catch 격리됨. 한 place fetch 실패해도 다른 place
            // 영향 X (Promise.all 의 fail-fast 는 안 발동 — 각 fetch 가 catch).
            await Promise.all(places.map(async (place) => {
                const address = place.address || "";
                const name = place.name || place.name_ko || place.display_name || place.name_en || "";
                let lat = null;
                let lng = null;
                // Layer 2: Geocoding multi-fallback (address -> name+region -> display_name)
                if (clientId && clientSecret) {
                    const geoUrl = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";
                    const queries = [
                        address,
                        name && region ? `${name} ${region}` : '',
                        place.display_name || place.name_en || '',
                    ].filter(Boolean);
                    for (const query of queries) {
                        try {
                            const res = await axios.get(geoUrl, {
                                params: { query },
                                headers: {
                                    "X-NCP-APIGW-API-KEY-ID": clientId,
                                    "X-NCP-APIGW-API-KEY": clientSecret,
                                },
                                timeout: 5000,
                            });
                            if (res.status === 200 && res.data.addresses && res.data.addresses.length > 0) {
                                lng = parseFloat(res.data.addresses[0].x);
                                lat = parseFloat(res.data.addresses[0].y);
                                break;
                            }
                        } catch (e) {
                            console.error(`  - [${name}] geocoding fallback failed for "${query}": ${e.message}`);
                        }
                    }
                }
                // Layer 2.5: Google Places fallback — Naver Geocoding은 도로명/지번에 강하지만
                // 관광지명 ("인사동 문화의 거리", "광화문 광장" 등)에 약함. Naver 모두 실패 시
                // Google Places Text Search로 시도. 키 없으면 skip.
                // Sprint 1 Step 3: Google Places로 좌표 + photo_reference 동시 fetch.
                // 좌표가 이미 있어도 photo는 fetch (시각 강화). 키 없으면 skip.
                if (process.env.GOOGLE_PLACES_API_KEY && (lat === null || !place.photo_ref)) {
                    try {
                        const placeQuery = name + (region ? ` ${region}` : '');
                        const gRes = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
                            params: { query: placeQuery, key: process.env.GOOGLE_PLACES_API_KEY, language: 'ko' },
                            timeout: 4000,
                        });
                        const first = gRes.data?.results?.[0];
                        if (first?.geometry?.location && lat === null) {
                            lat = first.geometry.location.lat;
                            lng = first.geometry.location.lng;
                            console.log(`  ✓ [${name}] Google Places geocoded: ${lat},${lng}`);
                        }
                        if (first?.photos?.[0]?.photo_reference && !place.photo_ref) {
                            place.photo_ref = first.photos[0].photo_reference;
                        }
                    } catch (gErr) {
                        console.warn(`  - [${name}] Google Places call failed: ${gErr.message}`);
                    }
                }
                place.lat = lat;
                place.lng = lng;
                place._geocoded = lat !== null;
                const nameKo = place.name || place.name_ko || place.display_name || place.name_en || name;
                place.naverMapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(nameKo)}`;
            }));

            // ════════════════════════════════════════════════════════
            // Phase 1.5: Intra-day TSP reorder (2026-05-13, PR #408 fix)
            // ════════════════════════════════════════════════════════
            // 사용자 신고: Day 4 Busan 동선 4.7시간 (283분 transit) — Gemini 가 zone
            // 안내 (buildPrompt.js L556 "같은 권역(구) 내 stops 묶어서") 를 무시하고
            // Gwangalli → Gijang → Yeongdo → Gwangalli 셔플 반환. RouteAgent 가
            // 순서 그대로 trust → 재방문 / 백트래킹 발생.
            //
            // 정책: Phase 1 (Naver Geocoding) 완료 후 stops[].lat/lng 채워진 상태에서
            // greedy nearest-neighbor (Haversine) 재정렬. lodging bookend (첫/마지막)
            // 보존. 좌표 누락 시 원본 순서 유지 (회귀 안전망).
            //
            // 2026-05-13 PR #412 env flag (P40 일환): `ROUTE_TSP_ENABLED=false` 시 skip.
            // 운영자 비상 circuit breaker — TSP 재정렬이 의도 깨면 일시 비활성.
            const tspEnabled = process.env.ROUTE_TSP_ENABLED !== 'false';
            const beforeReorder = places.map((p, i) => `${i}:${p.name || p.display_name || '?'}`).join(' → ');
            const reorderedPlaces = tspEnabled ? reorderStopsByProximity(places) : places;
            if (reorderedPlaces !== places) {
                // 새 배열 반환됨 — 순서 바뀐 stops 들의 order 필드도 1..N 재할당.
                for (let k = 0; k < reorderedPlaces.length; k++) {
                    if (reorderedPlaces[k]) reorderedPlaces[k].order = k + 1;
                }
                // dayPlan.stops/places 모두 동기화 (원본 ref 유지하는 day-plan 호환).
                if (dayPlan.stops) dayPlan.stops = reorderedPlaces;
                if (dayPlan.places) dayPlan.places = reorderedPlaces;
                // 이후 Phase 2/3 에서 사용하는 places 변수 자체도 교체.
                places.length = 0;
                for (const p of reorderedPlaces) places.push(p);
                const afterReorder = places.map((p, i) => `${i}:${p.name || p.display_name || '?'}`).join(' → ');
                if (beforeReorder !== afterReorder) {
                    console.log(`  [Route] Day ${dayPlan.day || '?'}: intra-day TSP reorder applied`);
                    console.log(`    before: ${beforeReorder}`);
                    console.log(`    after : ${afterReorder}`);
                }
            }

            // ════════════════════════════════════════════════════════
            // Phase 2: ODsay + Naver 경로 병렬 호출
            // ════════════════════════════════════════════════════════
            const transitPromises = [];
            for (let i = 1; i < places.length; i++) {
                const prev = places[i - 1];
                const curr = places[i];
                if (prev.lat && prev.lng && curr.lat && curr.lng) {
                    transitPromises.push(
                        this._getTransitData(prev, curr, clientId, clientSecret, i, dayOfWeek)
                    );
                } else {
                    transitPromises.push(Promise.resolve({
                        index: i,
                        durationMin: 25,
                        distanceKm: 5.0,
                        publicTransit: null,
                        drivingMin: null,
                    }));
                }
            }

            const transitResults = await Promise.all(transitPromises);

            // ════════════════════════════════════════════════════════
            // B9-39 (2026-05-09): 도시 변경 day 판정 — Phase 3 시각 계산 + Phase 2.5
            // hotelTransit skip 양쪽에서 사용. 선언 위치는 반드시 두 사용처 모두보다 위.
            // ════════════════════════════════════════════════════════
            // B-11 fix (2026-05-12): const isCityChangeDay 가 Phase 3 (line 421) 아래
            // 선언 → Phase 3 의 `if (isCityChangeDay ...)` 가 TDZ ReferenceError 던짐
            // (Cannot access 'isCityChangeDay' before initialization). enrichItinerary-
            // WithRoute 의 try/catch 가 silent swallow → 모든 stop 의 transit_from_prev
            // null, lodging_to_first 누락, Phase 3 시간 재계산 누락 → PDF "가는 방법"
            // 표시 0건 회귀. 선언을 두 사용처 모두보다 위로 이동.
            const isCityChangeDay = isMultiCity
                && dayPlan.intercity_transit
                && dayPlan.intercity_transit.mode;
            if (isCityChangeDay) {
                console.log(`  [Route] Day ${dayPlan.day || '?'}: city change (${dayPlan.intercity_transit.from_city}→${dayPlan.intercity_transit.to_city}), skip Hotel→FirstStop ODsay`);
            }

            // ════════════════════════════════════════════════════════
            // Phase 3: Dynamic Time Stitching — 서버가 시간 계산
            // ════════════════════════════════════════════════════════
            // 첫 장소의 start_time은 Gemini 값 유지 (또는 09:00 디폴트)
            // B9-39: 도시 변경 day 면 intercity_transit.arrival_at 이후로 강제.
            // 예: KTX 부산→서울 11:30 도착 시 stops[0].start_time >= 12:00 (점심).
            //
            // P145 (2026-05-22): upper-bound cap 추가. plan 209de47b 회귀: KTX 12:15
            // 도착인데 Gemini 가 첫 stop 17:43 박음 → Math.max 가 17:43 통과 → 5h+
            // 공백 silent pass. 사용자 신고: "서울에서 부산가는 과정이 엉터리야".
            // P143 이 detect 만 했던 회귀의 root cause 차단.
            //
            // 분기:
            //  - 첫 stop = lodging (호텔 체크인) → cap +240min (호텔 체크인 통상 14-15시).
            //  - 첫 stop = 활동 (사찰/맛집/관광) → cap +90min (도착 후 적정 휴식 후 활동).
            // Gemini 값이 [arrival+30, arrival+cap] 범위 안이면 통과, 밖이면 clamp.
            // P150 (2026-05-22): Gemini 원본 시각 저장. wrap 발생 시 22:30 cascade 대신 Gemini 시각 fallback.
            const _p150GeminiTimes = places.map(p => this._parseTime(p.start_time || '09:00'));
            let currentTime;
            if (isCityChangeDay && dayPlan.intercity_transit?.arrival_at) {
                const arrivalMin = this._parseTime(dayPlan.intercity_transit.arrival_at);
                const geminiFirstMin = this._parseTime(places[0]?.start_time || "09:00");
                const lowerBound = arrivalMin + 30;
                const firstIsLodging = String(places[0]?.category || '').toLowerCase() === 'lodging';
                const upperBound = arrivalMin + (firstIsLodging ? 240 : 90);
                // clamp(Gemini, [lower, upper]). Gemini 17:43 + arrival 12:15 (lodging) =
                // arrival+328min > +240 → upper 로 cap = 16:15. activity 였으면 +90 = 13:45.
                const clamped = Math.max(lowerBound, Math.min(geminiFirstMin, upperBound));
                currentTime = clamped;
                if (clamped !== geminiFirstMin) {
                    console.log(`  [Route] Day ${dayPlan.day || '?'}: P145 city-change clamp — Gemini ${this._formatTime(geminiFirstMin)} → ${this._formatTime(clamped)} (intercity arrival ${dayPlan.intercity_transit.arrival_at}, first.category=${places[0]?.category || '?'}, cap ${firstIsLodging ? '+240min lodging' : '+90min activity'})`);
                } else {
                    console.log(`  [Route] Day ${dayPlan.day || '?'}: city change day, first stop ${this._formatTime(currentTime)} (intercity arrival ${dayPlan.intercity_transit.arrival_at}, within bounds)`);
                }
            } else {
                currentTime = this._parseTime(places[0]?.start_time || "09:00");
            }
            const BUFFER_MIN = 5; // 초행길 여유 시간

            // ════════════════════════════════════════════════════════
            // Phase 2.5: 호텔 → 첫 번째 장소 경로
            // ════════════════════════════════════════════════════════
            // PDF-issue-3 fix (2026-05-14): day-level hotel 좌표 사용 (다도시 plan).
            //   getDayHotelCoord(dayPlan) — day.city 가 trip 첫 city 와 다르면
            //   recommended_zones[city] 또는 city center 좌표 반환. 같은 city 면
            //   trip-level hotelLat/Lng 그대로.
            //
            // city-change day 의 hotelTransit:
            //   이전 (B9-39): 무조건 skip (trip-level hotel 이 100km+ 거리)
            //   이후 (PDF-issue-3): day-level hotel = 새 city 좌표라 ODsay 호출 정상.
            //   사용자 PDF 검토 (2026-05-14): Day 4 lodging_to_first 가 "부산 해운대
            //   (이전 city) → 명동 호텔 (Day 4 첫 stop)" 모순 transit 표시되던 회귀 fix.
            const dayHotel = getDayHotelCoord(dayPlan, dayHotelCtx);
            // P148 (2026-05-22): dayHotel coord null → city center fallback.
            // hotel geocoding 실패 시 prevDayHotelCoord = null → intercity bookend transit 미생성.
            // city-level fallback 으로 최소한 bookend 생성 (정확도 낮지만 없는 것보다 나음).
            if ((!dayHotel.lat || !dayHotel.lng) && (dayPlan.city || tripFirstRegion)) {
              const _cityKey148 = String(dayPlan.city || tripFirstRegion || '').toLowerCase().trim();
              for (const [_k148, _coord148] of Object.entries(CITY_CENTER_COORDS)) {
                if (_cityKey148.includes(_k148) || _k148.includes(_cityKey148)) {
                  dayHotel.lat = _coord148.lat;
                  dayHotel.lng = _coord148.lng;
                  dayHotel.label = dayHotel.label || _coord148.label;
                  dayHotel.source = 'city_center_p148';
                  console.log(`[RouteAgent] P148: dayHotel null → city_center fallback (${_coord148.label}) for day${dayPlan.day || '?'}`);
                  break;
                }
              }
            }

            // ════════════════════════════════════════════════════════
            // Phase 2.4: city-change day intercity bookend (PDF-issue-2 fix, 2026-05-14)
            // ════════════════════════════════════════════════════════
            // city-change day 의 intercity_transit (KTX 부산→서울 등) 전후에:
            //   - lodging_to_station: 이전 day hotel → intercity.from_station (예: 부산역)
            //   - station_to_lodging: intercity.to_station → 새 day hotel (예: 명동 호텔)
            // 사용자 PDF 검토에서 "부산호텔→부산역", "서울역→명동호텔" 표시 안 됨 → 본 fix.
            // UI (DayTimeline) 가 intercity 전후 segment 표시. ODsay 실패 시 graceful skip.
            //
            // P111 (2026-05-20): 4개 silent-fail 분기 모두 throttledTelegramAlert (P83 패턴)
            // 발사. 이전엔 lookupStationCoord null / prevDayHotelCoord null / ODsay throw /
            // dayHotel coord null 4가지 케이스가 silent → 사용자가 "서울→부산 KTX 가이드 없음"
            // 으로 보고. dedup key: intercity-bookend-fail:{reason}:{from→to}.
            const bookendFailReasons = [];
            if (isCityChangeDay && dayPlan.intercity_transit) {
                const it = dayPlan.intercity_transit;
                // PDF-issue-2 v4 (2026-05-14): Gemini 또는 fallback 가 from_station/to_station
                // 미명시 케이스 보강 — city + mode 기반 inferDefaultStation 으로 추론.
                // 이미 명시되어 있으면 그대로 사용 (override X). 회귀 안전망.
                if (!it.from_station && it.from_city && it.mode) {
                    const inferred = inferDefaultStation(it.from_city, it.mode);
                    if (inferred) {
                        it.from_station = inferred;
                        console.log(`  [Route] Day ${dayPlan.day || '?'}: from_station inferred → ${inferred} (city=${it.from_city}, mode=${it.mode})`);
                    }
                }
                if (!it.to_station && it.to_city && it.mode) {
                    const inferred = inferDefaultStation(it.to_city, it.mode);
                    if (inferred) {
                        it.to_station = inferred;
                        console.log(`  [Route] Day ${dayPlan.day || '?'}: to_station inferred → ${inferred} (city=${it.to_city}, mode=${it.mode})`);
                    }
                }
                // Phase 2.4a: 이전 day hotel → from_station
                // P111: 4 silent-fail 분기 explicit log + alert reason 누적.
                if (!it.from_station) {
                    bookendFailReasons.push(`pre:from_station_missing`);
                    console.warn(`  - intercity bookend pre SKIP — from_station undefined`);
                } else if (!prevDayHotelCoord || !prevDayHotelCoord.lat || !prevDayHotelCoord.lng) {
                    bookendFailReasons.push(`pre:prev_hotel_coord_missing`);
                    console.warn(`  - intercity bookend pre SKIP — prevDayHotelCoord lat/lng missing (Day ${dayPlan.day})`);
                } else {
                    const fromStationCoord = lookupStationCoord(it.from_station);
                    if (!fromStationCoord) {
                        bookendFailReasons.push(`pre:station_coord_missing:${it.from_station}`);
                        console.warn(`  - intercity bookend pre SKIP — STATION_COORDS 에 '${it.from_station}' 미등록 (Day ${dayPlan.day})`);
                    } else {
                        try {
                            const stationPlace = { lat: fromStationCoord.lat, lng: fromStationCoord.lng, name: it.from_station, display_name: it.from_station };
                            const prevHotelPlace = { lat: prevDayHotelCoord.lat, lng: prevDayHotelCoord.lng, name: prevDayHotelCoord.label || 'Hotel', display_name: prevDayHotelCoord.label || 'Hotel' };
                            const transitData = await this._getTransitData(prevHotelPlace, stationPlace, clientId, clientSecret, -1, dayOfWeek);
                            const pt = transitData.publicTransit;
                            it.lodging_to_station = {
                                method: pt?.method || 'subway',
                                mode: methodToMode(pt?.method) || 'subway',
                                instruction: pt?.summary || `Take public transit from ${prevDayHotelCoord.label || 'hotel'} to ${it.from_station}`,
                                step_by_step: (pt?.steps || []).map(s => s.description || s.instruction || ''),
                                steps_detail: pt?.steps || [],
                                est_min: pt?.duration || transitData.durationMin || 30,
                                est_fare_krw: pt?.fare || 0,
                                source: 'odsay',
                                from_label: prevDayHotelCoord.label || 'Hotel',
                                to_label: it.from_station,
                            };
                            console.log(`  - [${prevDayHotelCoord.label || 'Hotel'}→${it.from_station}] ${it.lodging_to_station.est_min}min (intercity bookend pre)`);
                        } catch (preErr) {
                            bookendFailReasons.push(`pre:odsay_throw:${(preErr.message || 'unknown').slice(0, 60)}`);
                            console.warn(`  - intercity bookend pre ODsay failed:`, preErr.message);
                        }
                    }
                }
                // Phase 2.4b: to_station → new day hotel
                if (!it.to_station) {
                    bookendFailReasons.push(`post:to_station_missing`);
                    console.warn(`  - intercity bookend post SKIP — to_station undefined`);
                } else if (!dayHotel.lat || !dayHotel.lng) {
                    bookendFailReasons.push(`post:day_hotel_coord_missing`);
                    console.warn(`  - intercity bookend post SKIP — dayHotel lat/lng missing (Day ${dayPlan.day}, source=${dayHotel.source})`);
                } else {
                    const toStationCoord = lookupStationCoord(it.to_station);
                    if (!toStationCoord) {
                        bookendFailReasons.push(`post:station_coord_missing:${it.to_station}`);
                        console.warn(`  - intercity bookend post SKIP — STATION_COORDS 에 '${it.to_station}' 미등록 (Day ${dayPlan.day})`);
                    } else {
                        try {
                            const stationPlace = { lat: toStationCoord.lat, lng: toStationCoord.lng, name: it.to_station, display_name: it.to_station };
                            const newHotelPlace = { lat: dayHotel.lat, lng: dayHotel.lng, name: dayHotel.label || 'Hotel', display_name: dayHotel.label || 'Hotel' };
                            const transitData = await this._getTransitData(stationPlace, newHotelPlace, clientId, clientSecret, -2, dayOfWeek);
                            const pt = transitData.publicTransit;
                            it.station_to_lodging = {
                                method: pt?.method || 'subway',
                                mode: methodToMode(pt?.method) || 'subway',
                                instruction: pt?.summary || `Take public transit from ${it.to_station} to ${dayHotel.label || 'hotel'}`,
                                step_by_step: (pt?.steps || []).map(s => s.description || s.instruction || ''),
                                steps_detail: pt?.steps || [],
                                est_min: pt?.duration || transitData.durationMin || 30,
                                est_fare_krw: pt?.fare || 0,
                                source: 'odsay',
                                from_label: it.to_station,
                                to_label: dayHotel.label || 'Hotel',
                            };
                            console.log(`  - [${it.to_station}→${dayHotel.label || 'Hotel'}] ${it.station_to_lodging.est_min}min (intercity bookend post)`);
                        } catch (postErr) {
                            bookendFailReasons.push(`post:odsay_throw:${(postErr.message || 'unknown').slice(0, 60)}`);
                            console.warn(`  - intercity bookend post ODsay failed:`, postErr.message);
                        }
                    }
                }

                // P111 (2026-05-20): bookend silent fail 누적 시 throttledTelegramAlert.
                // dedup key 에 from→to + 첫 reason 포함 → 같은 city pair 의 같은 원인은
                // 5분 1회 (P67 throttle). user-facing 증상: 사용자가 "서울→부산 KTX 가이드
                // 없음" 으로 보고. lodging_to_station + station_to_lodging 둘 다 없으면
                // UI 는 IntercityTransitCard 만 표시 + LodgingBookend 미표시 → 호텔→역,
                // 역→호텔 transit arrow 누락.
                if (bookendFailReasons.length > 0) {
                    const fromTo = `${it.from_city || '?'}→${it.to_city || '?'}`;
                    const firstReason = bookendFailReasons[0].split(':')[0] + ':' + bookendFailReasons[0].split(':')[1];
                    throttledTelegramAlert({
                        key: `intercity-bookend-fail:${firstReason}:${fromTo}`,
                        channel: 'admin',
                        severity: 'high',
                        message: [
                            `⚠️ <b>intercity bookend silent fail — ${fromTo} (Day ${dayPlan.day || '?'})</b>`,
                            ``,
                            `<b>mode:</b> ${it.mode || '?'}`,
                            `<b>from_station:</b> ${it.from_station || '(none)'}`,
                            `<b>to_station:</b> ${it.to_station || '(none)'}`,
                            `<b>prev_hotel:</b> ${prevDayHotelCoord ? prevDayHotelCoord.label || '(unlabeled)' : '(null)'} (${prevDayHotelCoord?.lat || '?'},${prevDayHotelCoord?.lng || '?'})`,
                            `<b>day_hotel:</b> ${dayHotel.label || '(unlabeled)'} (${dayHotel.lat || '?'},${dayHotel.lng || '?'}, source=${dayHotel.source || '?'})`,
                            `<b>reasons:</b> ${bookendFailReasons.join(' | ').slice(0, 400)}`,
                            ``,
                            `→ 사용자 plan UI 에서 호텔→역 / 역→호텔 transit arrow 누락.`,
                            `→ user-facing 증상: "서울→부산 KTX 가이드가 그냥 부산 나옴" 류 신고.`,
                            `→ 진단:`,
                            `• prev_hotel_coord_missing → 이전 day 의 dayHotel.lat/lng 계산 실패 (Gemini day.lodging 누락 + recommended_zones 폴백 실패)`,
                            `• day_hotel_coord_missing → 새 city 의 dayHotel.lat/lng 계산 실패 (recommended_zones[city] 또는 CITY_CENTER_COORDS 키 매핑 실패)`,
                            `• station_coord_missing → STATION_COORDS 테이블에 미등록된 역명 (예: '대구역' vs '동대구역' 표기 차이)`,
                            `• odsay_throw → ODsay API 호출 실패 (네트워크 / quota)`,
                        ].join('\n'),
                        context: {
                            day: dayPlan.day,
                            fromCity: it.from_city,
                            toCity: it.to_city,
                            mode: it.mode,
                            reasons: bookendFailReasons,
                            step: 'intercity-bookend',
                        },
                    }).catch(() => {});
                }

                // P113 (2026-05-20): intercity_transit.recommended_depart 시간 stitching.
                // Gemini 가 recommended_depart 를 09:00 같은 임의 값으로 출력하면 stop1
                // (호텔 체크아웃) 시간과 모순 — plan 4792076e: stop1=12:25 인데 KTX
                // recommended_depart=09:00 → "KTX 가이드 09:00 인데 호텔 12:25 출발이면
                // 늦음" 사용자 혼란. Phase 2.4 가 lodging_to_station 채웠으면 그 est_min
                // 으로 stop1.start_time + transit 계산 → recommended_depart override.
                // arrival_at 도 동시 stitch (depart + KTX duration).
                if (it.lodging_to_station && Number.isFinite(it.lodging_to_station.est_min)
                    && places.length > 0 && places[0].start_time) {
                    const stop1Min = this._parseTime(places[0].start_time);
                    if (Number.isFinite(stop1Min)) {
                        const newDepartMin = stop1Min + Number(it.lodging_to_station.est_min);
                        const oldDepart = it.recommended_depart || '(none)';
                        const formattedDepart = this._formatTime(newDepartMin);
                        if (formattedDepart) {
                            it.recommended_depart = formattedDepart;
                            // arrival_at = depart + KTX/Air/Bus duration (intercity_transit.est_min)
                            if (Number.isFinite(it.est_min)) {
                                const newArrivalMin = newDepartMin + Number(it.est_min);
                                const formattedArrival = this._formatTime(newArrivalMin);
                                if (formattedArrival) it.arrival_at = formattedArrival;
                            }
                            console.log(`  [Route] Day ${dayPlan.day || '?'}: intercity recommended_depart ${oldDepart} → ${formattedDepart} (stitched stop1=${places[0].start_time} + lodging→station=${it.lodging_to_station.est_min}min)`);
                        }
                    }
                }
            }
            let hotelTransit = null;
            if (dayHotel.lat && dayHotel.lng && places.length > 0 && places[0].lat && places[0].lng) {
                // city-change day 의 first stop 이 새 city 라면 day-level hotel (새 city center)
                // 와 가까운 거리 → ODsay 의미 있음. 단 동일 city 안에서도 100km+ 거리면 skip.
                const haversineKm = this._haversineKm(dayHotel.lat, dayHotel.lng, places[0].lat, places[0].lng);
                if (haversineKm > 100) {
                    console.log(`  [Route] Day ${dayPlan.day || '?'}: day-hotel→first stop ${haversineKm.toFixed(1)}km > 100km, skip ODsay (의미 없음)`);
                } else {
                    try {
                        const hotelPlace = { lat: dayHotel.lat, lng: dayHotel.lng, name: dayHotel.label || 'Hotel', display_name: dayHotel.label || 'Hotel' };
                        const transitData = await this._getTransitData(hotelPlace, places[0], clientId, clientSecret, 0, dayOfWeek);
                        const pt = transitData.publicTransit;
                        hotelTransit = {
                            method: pt?.method || 'subway',
                            mode: methodToMode(pt?.method) || 'subway',
                            instruction: pt?.summary || `Take public transit from ${dayHotel.label || 'hotel'} to ${places[0].name || places[0].display_name || 'first stop'}`,
                            step_by_step: (pt?.steps || []).map(s => s.description || s.instruction || ''),
                            steps_detail: pt?.steps || [],
                            est_min: pt?.duration || transitData.durationMin || 25,
                            est_fare_krw: pt?.fare || 0,
                            source: 'odsay',
                            from_label: dayHotel.label || 'Hotel',
                            // PDF-issue-3: day-level anchor 정보 명시 — UI 가 "부산 호텔" vs
                            // "명동 호텔" 명확히 표시할 수 있도록.
                            anchor_lat: dayHotel.lat,
                            anchor_lng: dayHotel.lng,
                            anchor_label: dayHotel.label || null,
                            anchor_source: dayHotel.source || 'hotel',
                        };
                        console.log(`  - [${dayHotel.label || 'Hotel'}→${places[0].name}] ${hotelTransit.est_min}min via ${hotelTransit.method} (day-city=${dayPlan.city || '?'}, source=${dayHotel.source})`);
                    } catch (hotelErr) {
                        console.warn('  - Hotel→FirstStop route failed:', hotelErr.message);
                    }
                }
            }
            // day-level mirror — UI 의 LodgingBookend 컴포넌트가 day.lodging_to_first 로 직접 접근
            if (hotelTransit) {
                dayPlan.lodging_to_first = hotelTransit;
                // PDF-issue-3: day.lodging_city 명시 — UI 가 day 별 lodging context
                // (부산 vs 서울) 구분 가능. 후속 PR 의 validateResponse 검증 대상.
                if (dayPlan.city) dayPlan.lodging_city = dayPlan.city;
            }

            // ════════════════════════════════════════════════════════
            // Phase 2.6 (2026-05-08 신규): 마지막 장소 → 숙소 복귀 경로
            // ════════════════════════════════════════════════════════
            // 사용자 신고: "Day 마지막에 숙소 복귀 경로 안 나옴 → 저녁 식사 후 어디로?"
            // PDF-issue-3 fix (2026-05-14): day-level hotel 좌표 사용 — 다도시 plan
            //   의 다른 city day 도 새 city hotel 기준으로 ODsay 호출 정상.
            //   이전 (B9-39): 100km+ 거리면 skip (trip-level hotel 만 기준이라 잘못).
            //   이후 (PDF-issue-3): day-level hotel = 그 day 의 city center, 거리는
            //   자연스럽게 < 100km.
            const lastPlaceCheck = places[places.length - 1];
            const lastDistKm = (lastPlaceCheck?.lat && lastPlaceCheck?.lng && dayHotel.lat && dayHotel.lng)
                ? this._haversineKm(lastPlaceCheck.lat, lastPlaceCheck.lng, dayHotel.lat, dayHotel.lng)
                : null;
            const dayHasDifferentCity = lastDistKm != null && lastDistKm > 50;
            if (dayHasDifferentCity) {
                console.log(`  [Route] Day ${dayPlan.day || '?'}: last stop→day-hotel ${lastDistKm.toFixed(1)}km > 50km, skip LastStop→Hotel ODsay`);
            }
            if (!dayHasDifferentCity && dayHotel.lat && dayHotel.lng && places.length > 0) {
                const lastPlace = places[places.length - 1];
                if (lastPlace.lat && lastPlace.lng) {
                    // day-hotel 과 같은 좌표(50m 이내) 이면 의미 없음 — skip
                    const sameAsHotel = Math.abs(lastPlace.lat - dayHotel.lat) < 0.0005
                        && Math.abs(lastPlace.lng - dayHotel.lng) < 0.0005;
                    if (!sameAsHotel) {
                        try {
                            const hotelPlace = { lat: dayHotel.lat, lng: dayHotel.lng, name: dayHotel.label || 'Hotel', display_name: dayHotel.label || 'Hotel' };
                            const lastTransit = await this._getTransitData(lastPlace, hotelPlace, clientId, clientSecret, 999, dayOfWeek);
                            const pt = lastTransit.publicTransit;
                            const returnTransit = {
                                method: pt?.method || 'subway',
                                mode: methodToMode(pt?.method) || 'subway',
                                instruction: pt?.summary || `Return to ${dayHotel.label || 'hotel'} from ${lastPlace.name || lastPlace.display_name || 'last stop'}`,
                                step_by_step: (pt?.steps || []).map(s => s.description || s.instruction || ''),
                                steps_detail: pt?.steps || [],
                                est_min: pt?.duration || lastTransit.durationMin || 25,
                                est_fare_krw: pt?.fare || 0,
                                source: 'odsay',
                                from_label: lastPlace.display_name || lastPlace.name || 'last stop',
                                to_label: dayHotel.label || 'Hotel',
                                anchor_lat: dayHotel.lat,
                                anchor_lng: dayHotel.lng,
                                anchor_label: dayHotel.label || null,
                                anchor_source: dayHotel.source || 'hotel',
                                _isLodgingReturn: true,
                            };
                            dayPlan.last_to_lodging = returnTransit;
                            console.log(`  - [${lastPlace.name}→${dayHotel.label || 'Hotel'}] ${returnTransit.est_min}min via ${returnTransit.method} (return, day-city=${dayPlan.city || '?'})`);
                        } catch (retErr) {
                            console.warn('  - LastStop→Hotel route failed:', retErr.message);
                        }
                    }
                }
            }

            // ════════════════════════════════════════════════════════
            // Phase 3.5 (PDF-issue-2 v2, 2026-05-14): city-change day currentTime 재조정
            // ════════════════════════════════════════════════════════
            // Phase 3 (currentTime 1차) 는 arrival_at + 30분 단순 buffer.
            // 그 사이 Phase 2.4 (station_to_lodging) + Phase 2.5 (lodging_to_first) 가
            // 실제 transit 시간을 채웠으면, 더 현실적인 first stop start_time 계산.
            //   total = arrival + station→hotel + 15min(체크인) + hotel→first + 5min(출발)
            // 결과가 기존 currentTime 보다 크면 갱신 (작으면 보수적으로 기존 유지).
            if (isCityChangeDay && dayPlan.intercity_transit?.arrival_at) {
                const it = dayPlan.intercity_transit;
                const arrivalMin = this._parseTime(it.arrival_at);
                const stationToHotelMin = (it.station_to_lodging && typeof it.station_to_lodging.est_min === 'number')
                    ? it.station_to_lodging.est_min
                    : 0;
                const hotelToFirstMin = (dayPlan.lodging_to_first && typeof dayPlan.lodging_to_first.est_min === 'number')
                    ? dayPlan.lodging_to_first.est_min
                    : 0;
                if (stationToHotelMin > 0 || hotelToFirstMin > 0) {
                    const realisticMin = arrivalMin + stationToHotelMin + 15 + hotelToFirstMin + 5;
                    if (realisticMin > currentTime) {
                        console.log(`  [Route] Day ${dayPlan.day || '?'}: city change day refined ${this._formatTime(currentTime)} → ${this._formatTime(realisticMin)} (arr ${it.arrival_at} + sta→hotel ${stationToHotelMin}min + 15 + hotel→first ${hotelToFirstMin}min + 5)`);
                        currentTime = realisticMin;
                    }
                }
            }

            for (let i = 0; i < places.length; i++) {
                const place = places[i];

                // 첫 장소: 호텔 경로 있으면 사용, 없으면 null
                if (i === 0) {
                    place.start_time = this._formatTime(currentTime);
                    place.transit_from_prev = hotelTransit;
                    place.travelFromPrev = null;
                } else {
                    const transit = transitResults[i - 1];
                    // 2026-04-27 사용자 신고: 모든 transit이 "car · 25분"으로 동일 →
                    // root cause = prev/curr 좌표 없을 때 blind 25 fallback.
                    // 개선: 좌표 없을 때 Gemini가 plan에 넣은 est_min 우선 사용.
                    // Gemini는 보통 거리감 기반 예상치를 제공 (예: 명동→홍대 30분).
                    const geminiOriginal = places[i].transit_from_prev || {};
                    const realTransitMin = transit.publicTransit?.duration
                        || transit.drivingMin
                        || transit.durationMin  // havCarMin if coords exist
                        || geminiOriginal.est_min  // Gemini plan estimate
                        || 25;
                    // PR #463 (Audit X-H4 — 2026-05-16): explicit blind-fallback flag.
                    // Pre-fix: warn only — routeEnrichment summary doesn't see how many
                    // transits actually fell through to the flat-25 path, so a regional
                    // geocoding outage producing "car · 25분" on every stop went silent.
                    const isBlindFallback =
                        !transit.publicTransit?.duration &&
                        !transit.drivingMin &&
                        !transit.durationMin &&
                        !geminiOriginal.est_min;
                    if (isBlindFallback) {
                        console.warn(`  ⚠ [transit ${i}] no coords + no Gemini est_min → using flat 25min fallback. Check NAVER_CLIENT_ID / Gemini prompt.`);
                    }

                    // 이전 장소 체류 후 이동 시간 + 버퍼
                    const prevStayMin = places[i - 1].stay_min || 60;
                    currentTime += prevStayMin + realTransitMin + BUFFER_MIN;

                    // P150 (2026-05-22): 24h wrap → Gemini 원본 시각 fallback (P136 22:30 cascade 차단).
                    // 이전: wrap 시 22:30 cap → 이후 stops 도 22:30+stay+transit → 재차 wrap → cascade.
                    // 이후: wrap 시 해당 stop 의 Gemini 원본 시각 사용 → cascade 차단 → B-MEAL-DINNER 정상.
                    if (!Number.isFinite(currentTime) || currentTime >= 24 * 60) {
                        const geminiMin = _p150GeminiTimes[i];
                        const safeMin = (Number.isFinite(geminiMin) && geminiMin < 24 * 60)
                            ? geminiMin
                            : 22 * 60 + 30; // Gemini 시각도 없으면 최종 fallback
                        console.warn(`[RouteAgent] P150 wrap fallback day${dayPlan.day || '?'}-stop${i}: rawMin=${currentTime} → Gemini ${this._formatTime(safeMin)}`);
                        currentTime = safeMin;
                    } else {
                        currentTime = this._sanitizeTime(currentTime, `day${dayPlan.day || '?'}-stop${i}`);
                    }

                    place.start_time = this._formatTime(currentTime);

                    // ── 통합 transit_from_prev (ODsay 우선, Gemini fallback) ──
                    const pt = transit.publicTransit;
                    if (pt && pt.method !== 'walk') {
                        // ODsay 실제 데이터로 transit_from_prev 교체.
                        // steps_detail은 ODsay raw steps로 UI가 호선/출구/배차/중간정거장
                        // 렌더링에 쓴다. step_by_step(텍스트 배열)은 PDF/이메일 호환용.
                        place.transit_from_prev = {
                            method: pt.method || 'subway',
                            mode: methodToMode(pt.method) || 'subway',
                            instruction_en: pt.summary || '',
                            step_by_step: (pt.steps || []).map(s => s.description),
                            steps_detail: pt.steps || [],
                            transfers: pt.transfers || 0,
                            total_walk_m: pt.totalWalk || 0,
                            first_station: pt.firstStation || null,
                            last_station: pt.lastStation || null,
                            est_min: pt.duration || realTransitMin,
                            est_fare_krw: pt.fare || 0,
                            source: 'odsay',
                        };
                    } else if (pt && pt.method === 'walk') {
                        place.transit_from_prev = {
                            method: 'walk',
                            mode: 'walk',
                            instruction_en: pt.summary || `Walk ${realTransitMin} min`,
                            step_by_step: [],
                            est_min: pt.duration || realTransitMin,
                            est_fare_krw: 0,
                            source: 'odsay',
                        };
                    } else {
                        // ODsay 실패 → Gemini 원본 유지하되 시간은 Naver 기준 보정
                        // P144-continued (2026-05-22): step_by_step 비어있으면 자동 보강.
                        // 사용자 신고: Day 2 마지막 "차량 17분 → Hotel" 단순 표시 — 거리 / 권장
                        // 수단 정보 부재로 사용자 "어떻게 가는지 모름" 신고. ODsay null 케이스에
                        // 거리 / 택시 추정 / 야간 라벨 stub 텍스트 inject. publicTransit 데이터가
                        // 있으면 위 분기에서 이미 채워지므로 본 분기는 ODsay null fallback 전용.
                        const geminiTransit = place.transit_from_prev || {};
                        const fallbackMethod = geminiTransit.method || 'car';
                        const fallbackMin = transit.drivingMin || geminiTransit.est_min || realTransitMin;
                        const distKm = transit.distanceKm;
                        // 시각 (현재 진행 중인 stop 의 start_time 또는 직전 stop end_time 기준)
                        // 으로 야간 라벨 분기. _isLateNightTransit helper 가 22:00 이후 / 막차 종료.
                        // place.start_time 이 22:00+ 또는 04:00- 이면 야간.
                        const startHHMM = String(place.start_time || '');
                        const startHourMatch = /^(\d{1,2}):/.exec(startHHMM);
                        const startHour = startHourMatch ? parseInt(startHourMatch[1], 10) : null;
                        const isLateNight = startHour !== null && (startHour >= 22 || startHour < 5);
                        // 기존 Gemini step_by_step 있으면 그대로 사용. 없을 때만 stub 생성.
                        let enrichedSteps = Array.isArray(geminiTransit.step_by_step) && geminiTransit.step_by_step.length > 0
                            ? geminiTransit.step_by_step
                            : [];
                        if (enrichedSteps.length === 0 && !isBlindFallback) {
                            // 좌표 있는 케이스 (Naver fallback) — 거리 + 택시 권장 stub.
                            const taxiFareKrw = (transit.drivingMin || fallbackMin) * 200 + 4800;
                            const distStr = (typeof distKm === 'number' && Number.isFinite(distKm))
                                ? `약 ${distKm.toFixed(1)}km`
                                : '단거리';
                            enrichedSteps = [
                                `이동 거리: ${distStr}`,
                                `예상 시간: 약 ${fallbackMin}분 (차량 기준)`,
                                `택시 추정: 약 ${Math.round(taxiFareKrw / 100) * 100}원 — 카카오T / Uber 권장`,
                            ];
                            if (isLateNight) {
                                enrichedSteps.push('야간 시간대 — 지하철·버스 막차 종료 가능. 택시·카카오T 안전');
                            }
                        }
                        place.transit_from_prev = {
                            method: fallbackMethod,
                            mode: methodToMode(fallbackMethod) || 'car',
                            instruction_en: geminiTransit.instruction_en || '',
                            step_by_step: enrichedSteps,
                            est_min: fallbackMin,
                            est_fare_krw: geminiTransit.est_fare_krw || 0,
                            // P144-continued: distanceKm 도 transit_from_prev 에 inject — UI 가
                            // 거리 표시 가능 (이전엔 travelFromPrev 에만 존재).
                            ...(typeof distKm === 'number' && Number.isFinite(distKm) ? { distance_km: distKm } : {}),
                            // PR #463 (X-H4): when both real data + Gemini estimate are
                            // absent, source is the blind 25min/5km path. routeEnrichment
                            // aggregates per-plan ratio + fires admin alert.
                            source: isBlindFallback ? 'blind_25_no_coords' : 'naver_fallback',
                            ...(isBlindFallback ? { _blind_fallback: true } : {}),
                            ...(isLateNight ? { _late_night: true } : {}),
                        };
                    }

                    // ── travelFromPrev (상세 옵션) ──
                    place.travelFromPrev = {
                        durationMin: transit.durationMin,
                        distanceKm: transit.distanceKm,
                        naverDirectionsUrl: place.naverMapUrl,
                        transitOptions: {
                            taxi: {
                                estimatedFare: (transit.drivingMin || transit.durationMin || 25) * 200 + 4800,
                                disclaimer: "추정 요금",
                            },
                            // P1-1 (2026-05-10): productType null 일 때 available=false
                            // → client 가 cocotrip 차터 CTA 자체를 숨김 (잘못된 지역
                            // 차터 권유 + 결제 실패 방지).
                            cocotrip: { available: !!charterProductType, productType: charterProductType },
                            ...(pt && pt.method !== 'walk' ? { publicTransit: pt } : {}),
                        },
                    };
                }

                // 좌표 없는 경우 기본값
                if (place.lat === null && i > 0) {
                    place.travelFromPrev = {
                        durationMin: 25,
                        distanceKm: 5.0,
                        naverDirectionsUrl: place.naverMapUrl,
                        transitOptions: {
                            cocotrip: { available: !!charterProductType, productType: charterProductType },
                        },
                    };
                }
            }

            console.log(`  [Route] Day ${dayPlan.day || '?'}: ${places.length} stops, time-stitched ${this._formatTime(this._parseTime(places[0]?.start_time || "09:00"))} ~ ${places[places.length - 1]?.start_time || '?'}`);

            // PDF-issue-2/3: 다음 iteration 의 intercity bookend 계산용으로 현재
            // day 의 hotel coord cache. dayHotel 이 valid 면 (lat/lng 둘 다) 업데이트.
            if (dayHotel.lat && dayHotel.lng) {
                prevDayHotelCoord = {
                    lat: dayHotel.lat,
                    lng: dayHotel.lng,
                    label: dayHotel.label,
                    source: dayHotel.source,
                };
            }
        }

        // Layer 4: Enforce transit completeness invariant
        this._enforceTransitCompleteness(data);

        const finalJsonStr = JSON.stringify(data, null, 2);
        console.log("  [Route] enrichment complete (Naver + ODsay + Time Stitch + Completeness Gate)");
        return {
            agentName: this.agentKey,
            systemPrompt: this.systemPrompt,
            userPrompt: userPrompt,
            rawOutput: finalJsonStr,
            thinkingSummary: "[route] Naver Maps + ODsay Transit + Dynamic Time Stitching complete",
            inputTokens: 0,
            outputTokens: 0,
        };
    }

    /**
     * 단일 구간의 경로 데이터를 병렬로 가져오기 (Naver Driving + ODsay Transit)
     */
    async _getTransitData(prev, curr, clientId, clientSecret, index, dayOfWeek) {
        // Haversine baseline — used to (a) prefer walking for <1.5km legs, and
        // (b) replace the legacy 25min/5km blind fallback when both APIs fail
        // but coordinates are known. Pedestrian pace 70m/min (~4.2km/h).
        const havKm = (prev?.lat != null && prev?.lng != null && curr?.lat != null && curr?.lng != null)
            ? this._haversineKm(prev.lat, prev.lng, curr.lat, curr.lng)
            : null;
        const havWalkMin = havKm != null ? Math.max(3, Math.round(havKm * 1000 / 70)) : null;
        // Coarse car estimate from straight-line distance: assume ~25km/h average
        // in dense urban areas (covers traffic + signals). Only used when no
        // routing API answers — better than a flat 25min.
        const havCarMin = havKm != null ? Math.max(5, Math.round((havKm / 25) * 60)) : null;
        let durationMin = havCarMin != null ? havCarMin : 25;
        let distanceKm = havKm != null ? Math.round(havKm * 10) / 10 : 5.0;
        let drivingMin = null;
        let publicTransit = null;
        const name = curr.display_name || curr.name || curr.name_en || curr.name_ko || `stop-${index}`;
        const fromName = prev?.display_name || prev?.name || prev?.name_en || prev?.name_ko || 'previous stop';

        // Naver Driving + ODsay Transit 병렬 호출
        const [naverResult, odsayResult] = await Promise.allSettled([
            // Naver Driving
            (clientId && clientSecret) ? axios.get("https://maps.apigw.ntruss.com/map-direction/v1/driving", {
                params: {
                    start: `${prev.lng},${prev.lat}`,
                    goal: `${curr.lng},${curr.lat}`,
                    option: "traoptimal",
                },
                headers: {
                    "X-NCP-APIGW-API-KEY-ID": clientId,
                    "X-NCP-APIGW-API-KEY": clientSecret,
                },
                timeout: 5000,
            }) : Promise.reject(new Error('no credentials')),
            // ODsay Transit (Layer 3: retry with 500ms backoff, 10s timeout)
            this._searchOdsayWithRetry(prev.lng, prev.lat, curr.lng, curr.lat),
        ]);

        // Naver 결과 처리
        if (naverResult.status === 'fulfilled' && naverResult.value?.data?.code === 0) {
            const summary = naverResult.value.data.route.traoptimal[0].summary;
            durationMin = Math.floor(summary.duration / 60000);
            distanceKm = Math.round((summary.distance / 1000) * 10) / 10;
            drivingMin = durationMin;
        }

        // ODsay 결과 처리
        // B9-31 (2026-05-09): null result(빈 path / no routes) 는 Vercel 로그에 누적되던
        // noise 의 주요 원인. 정상적 fallback 임을 표시하기 위해 명시적 빈 객체를
        // 만들고 console.info 로 1회만 표시 (warn → info). rejected (transient) 만
        // warn 으로 유지.
        if (odsayResult.status === 'fulfilled' && odsayResult.value) {
            publicTransit = formatTransitSummary(odsayResult.value);
            console.log(`  ✓ [${name}] ODsay: ${odsayResult.value.type} ${odsayResult.value.totalTime}min ₩${odsayResult.value.fare}`);

            // Enrich each subway step with station metadata (transfer lines,
            // accessibility, lost&found) + first/last train times. All
            // parallelised; caches prevent duplicate calls across segments
            // that touch the same station.
            if (publicTransit?.steps?.length) {
                const enrichments = publicTransit.steps.map(async (step) => {
                    if (step.mode !== 'subway') return;
                    const calls = [
                        getSubwayStationInfo(step.fromStationID, this._stationCache),
                        getSubwayStationInfo(step.toStationID, this._stationCache),
                    ];
                    // Timetable needs weekday — only run if we have a valid day
                    if (dayOfWeek !== null && dayOfWeek !== undefined) {
                        calls.push(getSubwayTimetable(step.fromStationID, dayOfWeek, this._timetableCache));
                    }
                    const [fromInfo, toInfo, fromTimetable] = await Promise.all(calls);
                    if (fromInfo) step.fromStationInfo = fromInfo;
                    if (toInfo) step.toStationInfo = toInfo;
                    if (fromTimetable) step.fromTimetable = fromTimetable;
                });
                await Promise.all(enrichments);
            }
        } else if (odsayResult.status === 'rejected') {
            // Transient 또는 fatal — error message 만 출력 (stack X, helper 가 throw 한
            // Error 객체).
            console.warn(`  - [${name}] ODsay unavailable: ${odsayResult.reason?.message || 'unknown'}`);
        } else {
            // 정상적 null result (빈 path / 도시간 검색 실패 등) — info 로 다운그레이드.
            // Caller 는 이미 publicTransit==null 을 graceful 처리.
            console.info(`  - [${fromName}→${name}] ODsay no result, using fallback`);
        }

        // Walk-first override for short legs: if straight-line distance is
        // under 1.5km, walking is almost always faster door-to-door than
        // taxi/transit (waiting + boarding + alighting). Replaces the
        // "북촌→인사동 차로 25분" symptom where ODsay returned a transit
        // option for what is really a 12-min walk.
        const SHORT_LEG_KM = 1.5;
        if (havKm != null && havKm < SHORT_LEG_KM) {
            const walkM = Math.round(havKm * 1000);
            const walkMin = havWalkMin || Math.max(3, Math.round(walkM / 70));
            // Only override when ODsay didn't already say "walk".
            if (!publicTransit || publicTransit.method !== 'walk') {
                publicTransit = {
                    method: 'walk',
                    duration: walkMin,
                    summary: `Walk ${walkMin}min (${walkM}m)`,
                    steps: [
                        { mode: 'walk', duration: walkMin, distance: walkM, from: fromName, to: name }
                    ],
                    fare: 0,
                    transfers: 0,
                    totalWalk: walkM,
                };
                console.log(`  ↪ [${fromName}→${name}] short leg ${havKm.toFixed(2)}km → walk ${walkMin}min`);
            }
            durationMin = walkMin;
            drivingMin = walkMin;
        }

        return { index, durationMin, distanceKm, drivingMin, publicTransit };
    }

    /**
     * B9-39 (2026-05-09): 다도시 plan 의 day.city + day.intercity_transit
     * 누락 fallback. Gemini 가 안 채웠을 때만 작동.
     *
     * 1) day.city 추론: regions 순서대로 day 분배 (간단 휴리스틱).
     *    - regions=["busan","seoul"], days=5 → 부산 2일 + 서울 3일 (반올림).
     *    - Gemini 가 day.city 를 채웠으면 그대로 우선 사용.
     * 2) intercity_transit 누락 fallback: day.city 가 직전 day 와 다르면
     *    표준 mode/fare/시간 default 셋. KTX 부산↔서울 (165min/₩59,800) 등.
     */
    _enrichMultiCityDays(daysList, regionsList) {
        if (!Array.isArray(daysList) || daysList.length === 0) return;
        if (!Array.isArray(regionsList) || regionsList.length < 2) return;

        // city 라벨 정규화 helper. "busan_city" / "Busan" / "부산" 모두 → "Busan".
        const normalizeCity = (raw) => {
            if (!raw) return null;
            const s = String(raw).trim().toLowerCase();
            if (s.includes('busan') || s.includes('부산')) return 'Busan';
            if (s.includes('seoul') || s.includes('서울')) return 'Seoul';
            if (s.includes('jeju') || s.includes('제주')) return 'Jeju';
            if (s.includes('gyeongju') || s.includes('경주')) return 'Gyeongju';
            if (s.includes('jeonju') || s.includes('전주')) return 'Jeonju';
            if (s.includes('gangneung') || s.includes('강릉')) return 'Gangneung';
            if (s.includes('yeosu') || s.includes('여수')) return 'Yeosu';
            if (s.includes('daegu') || s.includes('대구')) return 'Daegu';
            if (s.includes('incheon') || s.includes('인천')) return 'Incheon';
            // capitalize first letter for unknown
            return s.charAt(0).toUpperCase() + s.slice(1);
        };

        // ── Step 1: day.city 채우기 (Gemini 가 안 채웠으면 regions 순서대로 분배)
        const normalizedRegions = regionsList.map(normalizeCity).filter(Boolean);
        if (normalizedRegions.length < 2) return;

        // 도시별 day 갯수 (단순 분배 — 마지막 도시에 잔여)
        const totalDays = daysList.length;
        const perCity = Math.floor(totalDays / normalizedRegions.length);
        const remainder = totalDays - perCity * normalizedRegions.length;
        const cityDays = normalizedRegions.map((city, i) => ({
            city,
            count: perCity + (i === normalizedRegions.length - 1 ? remainder : 0),
        }));

        let cursor = 0;
        for (const { city, count } of cityDays) {
            for (let i = 0; i < count && cursor < daysList.length; i++) {
                const d = daysList[cursor];
                if (d && !d.city) {
                    d.city = city;
                }
                cursor++;
            }
        }

        // ── Step 2: 도시 변경 day 의 intercity_transit fallback
        // 표준 KTX/Air/Bus 데이터 (Gemini prompt 와 일관).
        // Launch P1-2 (2026-05-10): 누락 노선 6쌍(12 entry) 추가.
        // PDF-issue-2 (2026-05-14): from_station/to_station + 좌표 추가 — RouteAgent
        //   bookend transit 계산 + UI 가 KTX 전후 segment 표시 가능. STATION_COORDS 는
        //   상수 헤더에서 정의 (모듈 레벨).
        const STANDARD_INTERCITY = {
            'Busan-Seoul':    { mode: 'KTX',     est_min: 165, est_fare_krw: 59800, recommended_depart: '08:30', arrival_at: '11:30', booking_url: 'https://www.letskorail.com', from_station: '부산역', to_station: '서울역' },
            'Seoul-Busan':    { mode: 'KTX',     est_min: 165, est_fare_krw: 59800, recommended_depart: '08:30', arrival_at: '11:30', booking_url: 'https://www.letskorail.com', from_station: '서울역', to_station: '부산역' },
            'Busan-Daejeon':  { mode: 'KTX',     est_min: 95,  est_fare_krw: 36000, recommended_depart: '09:00', arrival_at: '10:35', booking_url: 'https://www.letskorail.com', from_station: '부산역', to_station: '대전역' },
            'Daejeon-Busan':  { mode: 'KTX',     est_min: 95,  est_fare_krw: 36000, recommended_depart: '09:00', arrival_at: '10:35', booking_url: 'https://www.letskorail.com', from_station: '대전역', to_station: '부산역' },
            'Jeju-Seoul':    { mode: 'Air',     est_min: 65,  est_fare_krw: 70000, recommended_depart: '10:00', arrival_at: '11:05', booking_url: 'https://www.trip.com', from_station: '제주국제공항', to_station: '김포국제공항' },
            'Seoul-Jeju':    { mode: 'Air',     est_min: 65,  est_fare_krw: 70000, recommended_depart: '10:00', arrival_at: '11:05', booking_url: 'https://www.trip.com', from_station: '김포국제공항', to_station: '제주국제공항' },
            'Jeju-Busan':    { mode: 'Air',     est_min: 50,  est_fare_krw: 60000, recommended_depart: '10:00', arrival_at: '10:50', booking_url: 'https://www.trip.com', from_station: '제주국제공항', to_station: '김해국제공항' },
            'Busan-Jeju':    { mode: 'Air',     est_min: 50,  est_fare_krw: 60000, recommended_depart: '10:00', arrival_at: '10:50', booking_url: 'https://www.trip.com', from_station: '김해국제공항', to_station: '제주국제공항' },
            'Seoul-Jeonju':   { mode: 'KTX',     est_min: 90,  est_fare_krw: 35000, recommended_depart: '09:00', arrival_at: '10:30', booking_url: 'https://www.letskorail.com', from_station: '서울역', to_station: '전주역' },
            'Jeonju-Seoul':   { mode: 'KTX',     est_min: 90,  est_fare_krw: 35000, recommended_depart: '09:00', arrival_at: '10:30', booking_url: 'https://www.letskorail.com', from_station: '전주역', to_station: '서울역' },
            'Seoul-Gangneung':{ mode: 'KTX',     est_min: 110, est_fare_krw: 28000, recommended_depart: '09:00', arrival_at: '10:50', booking_url: 'https://www.letskorail.com', from_station: '서울역', to_station: '강릉역' },
            'Gangneung-Seoul':{ mode: 'KTX',     est_min: 110, est_fare_krw: 28000, recommended_depart: '09:00', arrival_at: '10:50', booking_url: 'https://www.letskorail.com', from_station: '강릉역', to_station: '서울역' },
            'Busan-Gyeongju': { mode: 'Bus',     est_min: 60,  est_fare_krw: 7000,  recommended_depart: '09:00', arrival_at: '10:00', booking_url: 'https://www.kobus.co.kr', from_station: '부산종합버스터미널', to_station: '경주시외버스터미널' },
            'Gyeongju-Busan': { mode: 'Bus',     est_min: 60,  est_fare_krw: 7000,  recommended_depart: '09:00', arrival_at: '10:00', booking_url: 'https://www.kobus.co.kr', from_station: '경주시외버스터미널', to_station: '부산종합버스터미널' },
            'Seoul-Gapyeong': { mode: 'ITX',     est_min: 60,  est_fare_krw: 8000,  recommended_depart: '09:00', arrival_at: '10:00', booking_url: 'https://www.letskorail.com', from_station: '청량리역', to_station: '가평역' },
            'Seoul-Chuncheon':{ mode: 'ITX',     est_min: 75,  est_fare_krw: 9000,  recommended_depart: '09:00', arrival_at: '10:15', booking_url: 'https://www.letskorail.com', from_station: '청량리역', to_station: '춘천역' },
            // P1-2 신규 노선 (2026-05-10)
            'Gangneung-Busan':{ mode: 'KTX',     est_min: 330, est_fare_krw: 70000, recommended_depart: '08:00', arrival_at: '13:30', booking_url: 'https://www.letskorail.com', from_station: '강릉역', to_station: '부산역' },
            'Busan-Gangneung':{ mode: 'KTX',     est_min: 330, est_fare_krw: 70000, recommended_depart: '08:00', arrival_at: '13:30', booking_url: 'https://www.letskorail.com', from_station: '부산역', to_station: '강릉역' },
            'Yeosu-Seoul':    { mode: 'KTX',     est_min: 240, est_fare_krw: 55000, recommended_depart: '08:30', arrival_at: '12:30', booking_url: 'https://www.letskorail.com', from_station: '여수EXPO역', to_station: '서울역' },
            'Seoul-Yeosu':    { mode: 'KTX',     est_min: 240, est_fare_krw: 55000, recommended_depart: '08:30', arrival_at: '12:30', booking_url: 'https://www.letskorail.com', from_station: '서울역', to_station: '여수EXPO역' },
            'Gwangju-Seoul':  { mode: 'KTX',     est_min: 120, est_fare_krw: 47000, recommended_depart: '09:00', arrival_at: '11:00', booking_url: 'https://www.letskorail.com', from_station: '광주송정역', to_station: '서울역' },
            'Seoul-Gwangju':  { mode: 'KTX',     est_min: 120, est_fare_krw: 47000, recommended_depart: '09:00', arrival_at: '11:00', booking_url: 'https://www.letskorail.com', from_station: '서울역', to_station: '광주송정역' },
            'Daegu-Busan':    { mode: 'KTX',     est_min: 65,  est_fare_krw: 17000, recommended_depart: '09:00', arrival_at: '10:05', booking_url: 'https://www.letskorail.com', from_station: '동대구역', to_station: '부산역' },
            'Busan-Daegu':    { mode: 'KTX',     est_min: 65,  est_fare_krw: 17000, recommended_depart: '09:00', arrival_at: '10:05', booking_url: 'https://www.letskorail.com', from_station: '부산역', to_station: '동대구역' },
            'Daegu-Seoul':    { mode: 'KTX',     est_min: 110, est_fare_krw: 43500, recommended_depart: '09:00', arrival_at: '10:50', booking_url: 'https://www.letskorail.com', from_station: '동대구역', to_station: '서울역' },
            'Seoul-Daegu':    { mode: 'KTX',     est_min: 110, est_fare_krw: 43500, recommended_depart: '09:00', arrival_at: '10:50', booking_url: 'https://www.letskorail.com', from_station: '서울역', to_station: '동대구역' },
            'Jeju-Daegu':    { mode: 'Air',     est_min: 60,  est_fare_krw: 80000, recommended_depart: '10:00', arrival_at: '11:00', booking_url: 'https://www.trip.com', from_station: '제주국제공항', to_station: '대구국제공항' },
            'Daegu-Jeju':    { mode: 'Air',     est_min: 60,  est_fare_krw: 80000, recommended_depart: '10:00', arrival_at: '11:00', booking_url: 'https://www.trip.com', from_station: '대구국제공항', to_station: '제주국제공항' },
        };

        for (let i = 1; i < daysList.length; i++) {
            const d = daysList[i];
            const prev = daysList[i - 1];
            if (!d || !prev) continue;
            const dCity = normalizeCity(d.city);
            const prevCity = normalizeCity(prev.city);
            if (!dCity || !prevCity) continue;
            if (dCity === prevCity) continue;

            // Gemini 가 이미 채웠으면 그대로 보존 (덮어쓰기 X)
            if (d.intercity_transit && d.intercity_transit.mode) {
                console.log(`  [Route] multi-city Day ${d.day || i+1}: Gemini intercity_transit preserved (${d.intercity_transit.mode} ${prevCity}→${dCity})`);
                continue;
            }

            const key = `${prevCity}-${dCity}`;
            const std = STANDARD_INTERCITY[key];
            if (std) {
                d.intercity_transit = {
                    mode: std.mode,
                    from_city: prevCity,
                    to_city: dCity,
                    from_city_display: prevCity,
                    to_city_display: dCity,
                    est_min: std.est_min,
                    est_fare_krw: std.est_fare_krw,
                    recommended_depart: std.recommended_depart,
                    arrival_at: std.arrival_at,
                    instruction: `${prevCity} → ${dCity} via ${std.mode} (~${Math.round(std.est_min/60*10)/10}h, ₩${std.est_fare_krw.toLocaleString()})`,
                    booking_url: std.booking_url,
                    // PDF-issue-2 (2026-05-14): UI 가 intercity 전후 bookend segment 표시 가능.
                    from_station: std.from_station || null,
                    to_station: std.to_station || null,
                };
                console.log(`  [Route] multi-city Day ${d.day || i+1}: fallback intercity_transit ${std.mode} ${prevCity}→${dCity} (${std.from_station} → ${std.to_station})`);
            } else {
                // 표준 데이터 없는 도시쌍 — 보수적 default (Bus 2시간).
                // PDF-issue-2 v4 (2026-05-14): from_station/to_station 도 city 기반 추론
                // (CITY_DEFAULT_STATION lookup) — UI bookend segment 표시 가능.
                d.intercity_transit = {
                    mode: 'Bus',
                    from_city: prevCity,
                    to_city: dCity,
                    from_city_display: prevCity,
                    to_city_display: dCity,
                    est_min: 120,
                    est_fare_krw: 15000,
                    recommended_depart: '09:00',
                    arrival_at: '11:00',
                    instruction: `${prevCity} → ${dCity} via Bus (~2h, ₩15,000)`,
                    booking_url: 'https://www.kobus.co.kr',
                    from_station: inferDefaultStation(prevCity, 'Bus'),
                    to_station: inferDefaultStation(dCity, 'Bus'),
                };
                console.log(`  [Route] multi-city Day ${d.day || i+1}: generic Bus fallback ${prevCity}→${dCity} (stations: ${d.intercity_transit.from_station || '?'} → ${d.intercity_transit.to_station || '?'})`);
            }
        }
    }

    /**
     * Great-circle distance in km between two lat/lng points.
     * Used as a baseline so we never claim a flat 25min for adjacent stops.
     */
    _haversineKm(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const toRad = (x) => (x * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Layer 3: ODsay search with 500ms backoff retry (max 2 attempts).
     * B9-31: attempt 1 failure 는 retry 가 정상 흐름이라 info 로 다운그레이드.
     * attempt 2 fatal 만 warn 유지 (운영자가 인식해야 하는 패턴).
     */
    async _searchOdsayWithRetry(sx, sy, ex, ey) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const result = await searchTransitRoute(sx, sy, ex, ey);
                return result;
            } catch (e) {
                if (attempt === 0) {
                    console.info(`  - [ODsay] attempt 1 failed, retrying: ${e.message}`);
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    console.warn(`  - [ODsay] attempt 2 failed, giving up: ${e.message}`);
                    return null;
                }
            }
        }
        return null;
    }

    /**
     * Layer 4: Enforce transit completeness invariant.
     * subway/bus without step_by_step -> downgrade to car.
     */
    _enforceTransitCompleteness(data) {
        const days = (data.itinerary && data.itinerary.days) || data.days || [];
        let downgradeCount = 0;
        for (const day of days) {
            for (const stop of (day.stops || [])) {
                const t = stop.transit_from_prev;
                if (!t) continue;
                const needsDetail = t.method === 'subway' || t.method === 'bus';
                const hasDetail = Array.isArray(t.step_by_step)
                    && t.step_by_step.length > 0
                    && (t.instruction || t.instruction_en);
                if (needsDetail && !hasDetail) {
                    t._downgraded_from = t.method;
                    t.method = 'car';
                    t.mode = 'car';
                    t.source = 'downgrade';
                    downgradeCount++;
                }
            }
        }
        if (downgradeCount > 0) {
            console.log(`  [Route] enforceTransitCompleteness: downgraded ${downgradeCount} transit(s)`);
        }
    }

    /**
     * Normalize Gemini's "ICN T1" / "ICN T2" / "GMP" form to constants key.
     * Returns null if unrecognized so callers can skip routing.
     */
    _normalizeAirportKey(raw) {
        if (!raw) return null;
        const k = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
        if (AIRPORT_COORDS[k]) return k;
        if (k.startsWith('ICN_T1') || k === 'ICN1' || k === 'INCHEON_T1') return 'ICN_T1';
        if (k.startsWith('ICN_T2') || k === 'ICN2' || k === 'INCHEON_T2') return 'ICN_T2';
        if (k.startsWith('ICN') || k === 'INCHEON') return 'ICN_T1';
        if (k === 'GIMPO') return 'GMP';
        if (k === 'BUSAN' || k === 'GIMHAE') return 'PUS';
        if (k === 'JEJU') return 'CJU';
        return null;
    }

    /**
     * Resolve hotel-side coordinate for hotel↔airport routing with fallback chain.
     * Order (B9-16/25 강화):
     *   1. hotelLat/hotelLng (already geocoded from hotel_address)
     *   2. lookupZoneCoord(recommended_zone) — 정적 좌표 매핑 (Naver 호출 X)
     *   3. lookupZoneCoord(hotelAddress) — substring 매핑 ("명동 롯데호텔" → 명동)
     *   4. arrival_guide.address geocode (Gemini's per-stop transport address)
     *   5. recommended_zone string Naver geocode (fallback for unmapped zones)
     *   6. CITY_CENTER_COORDS[region] — last resort, "도시 중심 기준"
     * Returns { coord, source, label } where source indicates which fallback was used.
     */
    async _resolveHotelOrFallback({ hotelLat, hotelLng, hotelAddress, arrivalGuide, recommendedZone, region, clientId, clientSecret }) {
        // 1) primary
        if (hotelLat && hotelLng) {
            return { coord: { lat: hotelLat, lng: hotelLng }, source: 'hotel', label: hotelAddress || null };
        }
        // 2/3) 정적 zone 좌표 매핑 — Naver 호출 전 첫 시도. NCP 키 fail 또는 단일 동
        // 명("명동")인 경우의 1차 보호. 좌표 정확도 ±100m, fail 가능성 0.
        if (recommendedZone) {
            const z = lookupZoneCoord(recommendedZone);
            if (z) return { coord: { lat: z.lat, lng: z.lng }, source: 'zone_anchor', label: z.label };
        }
        if (hotelAddress) {
            const z = lookupZoneCoord(hotelAddress);
            if (z) return { coord: { lat: z.lat, lng: z.lng }, source: 'zone_anchor', label: z.label };
        }
        const tryGeocode = async (q) => {
            if (!q || !clientId || !clientSecret) return null;
            try {
                const res = await axios.get('https://maps.apigw.ntruss.com/map-geocode/v2/geocode', {
                    params: { query: q },
                    headers: { 'X-NCP-APIGW-API-KEY-ID': clientId, 'X-NCP-APIGW-API-KEY': clientSecret },
                    timeout: 5000,
                });
                if (res.status === 200 && res.data.addresses?.length > 0) {
                    return { lat: parseFloat(res.data.addresses[0].y), lng: parseFloat(res.data.addresses[0].x) };
                }
            } catch (e) {
                console.warn(`  - fallback geocode "${q}" failed: ${e.message}`);
            }
            return null;
        };
        // 4) arrival_guide address (Gemini가 가끔 to_hotel 안내에 호텔 주소를 적어둠)
        const arrivalGuideAddr = arrivalGuide?.address || arrivalGuide?.hotel_address;
        if (arrivalGuideAddr) {
            const c = await tryGeocode(arrivalGuideAddr);
            if (c) return { coord: c, source: 'arrival_guide', label: arrivalGuideAddr };
        }
        // 5) recommended_zone (string key like 'myeongdong' or address — geocode 시도)
        if (recommendedZone) {
            const c = await tryGeocode(String(recommendedZone));
            if (c) return { coord: c, source: 'zone_anchor', label: String(recommendedZone) };
        }
        // 6) city center — last resort. 운영자 신고: 시청→노량진 우회 → 표시 부정확.
        const regionKey = String(region || '').toLowerCase().trim();
        const cc = CITY_CENTER_COORDS[regionKey];
        if (cc) {
            console.warn(`  ⚠ [_resolveHotelOrFallback] city_center fallback → "${cc.label}". hotelAddress="${hotelAddress || ''}" zone="${recommendedZone || ''}". Naver Geocoding 또는 zone 매핑 실패 — 운영자 검토 필요.`);
            return { coord: { lat: cc.lat, lng: cc.lng }, source: 'city_center', label: cc.label };
        }
        return { coord: null, source: 'none', label: null };
    }

    /**
     * ODsay route between airport coord and hotel coord.
     * Returns the same TransitFromPrev shape used by stop↔stop transit so the UI
     * can reuse the existing TransitArrow component without a special case.
     * Direction: 'arrival' (airport→hotel) or 'departure' (hotel→airport).
     *
     * Retry policy: 1 retry with 1s backoff on transient failure (network/timeout/5xx).
     * `_searchOdsayWithRetry` inside `_getTransitData` already does its own 500ms
     * retry, so this outer retry covers cases where _getTransitData itself throws
     * (e.g. axios network error before any ODsay call).
     */
    async _routeAirportHotel(from, to, direction) {
        const fromPlace = { lat: from.lat, lng: from.lng, name: direction === 'arrival' ? 'Airport' : 'Hotel' };
        const toPlace = { lat: to.lat, lng: to.lng, name: direction === 'arrival' ? 'Hotel' : 'Airport' };
        const cid = (process.env.NAVER_CLIENT_ID || '').trim();
        const csec = (process.env.NAVER_CLIENT_SECRET || '').trim();
        const MAX_ATTEMPTS = 2; // 1 try + 1 retry
        let lastErr = null;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            try {
                const td = await this._getTransitData(fromPlace, toPlace, cid, csec, 0);
                const pt = td.publicTransit;
                if (!pt) {
                    // No transit → 다음 attempt에서 같은 결과일 가능성 높지만,
                    // _getTransitData가 호출 중 transient 실패 시 null로 fallthrough할
                    // 수도 있어서 한 번 더 시도해본다.
                    if (attempt + 1 < MAX_ATTEMPTS) {
                        console.warn(`  - Airport↔Hotel (${direction}) attempt ${attempt + 1}: no publicTransit, retrying in 1s`);
                        await new Promise(r => setTimeout(r, 1000));
                        continue;
                    }
                    return null;
                }
                return {
                    method: pt.method || 'subway',
                    mode: methodToMode(pt.method) || 'subway',
                    instruction: pt.summary || '',
                    step_by_step: (pt.steps || []).map(s => s.description || s.instruction || ''),
                    steps_detail: pt.steps || [],
                    transfers: pt.transfers || 0,
                    total_walk_m: pt.totalWalk || 0,
                    est_min: pt.duration || td.durationMin || 0,
                    est_fare_krw: pt.fare || 0,
                    source: 'odsay',
                    direction,
                };
            } catch (e) {
                lastErr = e;
                console.warn(`  - Airport↔Hotel (${direction}) attempt ${attempt + 1} failed: ${e.message}`);
                if (attempt + 1 < MAX_ATTEMPTS) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
        if (lastErr) {
            await reportError(lastErr, { route: 'RouteAgent._routeAirportHotel', direction });
        }
        return null;
    }

    /** "HH:MM" → 분(number) */
    _parseTime(timeStr) {
        const [h, m] = (timeStr || "09:00").split(":").map(Number);
        return (h || 0) * 60 + (m || 0);
    }

    /** 분(number) → "HH:MM" */
    _formatTime(totalMin) {
        const h = Math.floor(totalMin / 60) % 24;
        const m = totalMin % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    /**
     * P136: 24h wrap 차단.
     * rawMin >= 1440 (midnight) → 22:30 (1350min) hard cap + admin alert (non-blocking).
     * pre-dawn (< 300 = 05:00) 은 planPersister.detectUnreasonableStopTimes 에 위임.
     *
     * P150 (2026-05-22): Phase 3 루프 내 wrap 은 이 메서드 대신 Gemini 원본 시각 fallback 사용.
     * 이 메서드는 non-finite 방어 + non-loop 경로 (예: 직접 호출) 에서만 22:30 cap 적용.
     *
     * @param {number} rawMin - 분 단위 누적 시각
     * @param {string} [context] - 로그용 컨텍스트 (예: "day3-stop2")
     * @returns {number} sanitized minutes (<= 1439)
     */
    _sanitizeTime(rawMin, context = '') {
        const MIDNIGHT_MIN = 24 * 60;   // 1440
        const SAFE_CAP_MIN = 22 * 60 + 30; // 1350 = 22:30
        const MAX_DAY_MIN = 23 * 60 + 59;  // 1439

        if (!Number.isFinite(rawMin)) {
            console.warn(`[RouteAgent] P136 _sanitizeTime: non-finite rawMin (${rawMin}) → cap 22:30${context ? ' ctx=' + context : ''}`);
            throttledTelegramAlert({
                key: `plan-time-wrap:non-finite${context ? ':' + context : ''}`,
                channel: 'admin',
                severity: 'low',
                message: `⚠️ P136 RouteAgent _sanitizeTime: non-finite rawMin=${rawMin}${context ? ' ctx=' + context : ''}`,
            });
            return SAFE_CAP_MIN;
        }

        if (rawMin >= MIDNIGHT_MIN) {
            console.warn(`[RouteAgent] P136 _sanitizeTime: 24h wrap detected rawMin=${rawMin} → cap 22:30${context ? ' ctx=' + context : ''}`);
            throttledTelegramAlert({
                key: `plan-time-wrap:${context || 'unknown'}`,
                channel: 'admin',
                severity: 'low',
                message: `⚠️ P136 RouteAgent 24h wrap 차단: rawMin=${rawMin} (${this._formatTime(rawMin % (24 * 60))}) → capped 22:30${context ? ' ctx=' + context : ''}`,
            });
            return SAFE_CAP_MIN;
        }

        return Math.min(rawMin, MAX_DAY_MIN);
    }
}
