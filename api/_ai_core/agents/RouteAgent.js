import axios from "axios";
import { BaseAgent } from "./BaseAgent.js";
import { formatTransitSummary, getSubwayStationInfo, getSubwayTimetable } from "../../_odsay_helper.js";
// P330 (2026-05-31): provider 스위치 — 기본 ODsay, TRANSIT_PROVIDER=tmap 시 TMAP. 출력 shape 동일.
import { searchTransit } from "../../_transit_provider.js";
// BUGHUNT-LOW (2026-06-14): AREX 직통 HERO 합성을 ODsay 일 때만 발동시키는 게이트용 (TMAP native 급행 보존).
import { getTransitProvider } from "../../_transit_provider.js";
import { AIRPORT_COORDS, AIRPORT_STATION_COORDS, AIRPORT_NAMES, CITY_CENTER_COORDS, lookupZoneCoord } from "../constants.js";
// P-launch (2026-05-31): 한글 regions('부산') → 영문 키('busan') 정규화 (멀티시티 departure city 해석용).
import { normalizeRegionKey } from "../responseValidator.js";
import { throttledTelegramAlert } from "../../_shared/telegram-throttle.js";
// Phase 3 (2026-05-27): zone_courses Firestore transit_matrix cache — ODsay 호출 절감.
import { lookupTransitCache, getTransitCacheStats } from "../transitCache.js";
// PR-C (2026-06-01, FEATURE_CHARTER_HERO_PRICE OFF default): 공항픽업 가격 SSOT.
// 차터 도착 HERO 가격 표시용 — airport_transfer_prices[zoneKey].priceKRW (읽기 전용).
import { loadPricingSpec } from "../../_shared/pricing.js";
// NCP Maps(maps.apigw.ntruss.com) 키 해석 SSOT — 키 목록 복제 금지 (mood-route.js:45~ 주석).
import { resolveNcpKeys } from "../../_shared/mood-route.js";

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
  // P155 (2026-05-22): 신경주역 추가 — 경주 KTX 정거장.
  // prod alert 다수 발생 ("신경주역 미등록" intercity bookend silent fail).
  '신경주역':       { lat: 35.7976, lng: 129.1338, label: '신경주역' },
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
  // P155 (2026-05-22): 경주고속버스터미널 추가 — Gemini 가 시외 / 고속 둘 다 사용.
  '경주고속버스터미널':   { lat: 35.8489, lng: 129.2143, label: '경주고속버스터미널' },
};

// P327 (2026-05-31): AREX 직통열차(Express) — 인천공항 공항철도 직통(무정차) → 서울역.
// ODsay 는 express 를 별도 path 로 모델링 못 함(일반열차→홍대입구→2호선 환승 79분 indirect
// 경로만 path[0] 로 반환) → HERO 가 자가모순(recommended_option 라벨 "AREX Express 가장 빠름"
// ↔ route 데이터 79분 일반경로). ICN→서울 중심부일 때 직통(고정) + 서울역→호텔 last-mile(실
// ODsay)을 이어붙여 라벨과 일치하는 직통 HERO 를 합성한다. 요금/시간 = 공식 AREX express
// (T1 43분 / T2 51분, ₩9,500 — planPersister selfHeal default 와 동일값).
export const AREX_EXPRESS = {
  ICN_T1: { express_min: 43, from_station: '인천공항1터미널역' },
  ICN_T2: { express_min: 51, from_station: '인천공항2터미널역' },
  ICN:    { express_min: 43, from_station: '인천공항1터미널역' }, // generic = T1 alias
};
export const AREX_EXPRESS_FARE_KRW = 9500;
// 직통 HERO 게이트: 목적지가 서울역 반경 이내(중심부)일 때만. 그 밖(강남/잠실 등)은 기존
// ODsay route 유지 — 먼 거리는 직통+last-mile 이 직선 경로보다 유리하지 않을 수 있어 보수적.
export const AREX_EXPRESS_MAX_KM_FROM_SEOUL_STN = 6;

// P790 (2026-06-03): geocoding 좌표 parseFloat NaN 가드. parseFloat 실패(비수치 응답)면 NaN 인데
// NaN 은 `== null` 가드를 통과해 haversine 까지 전파(거리 NaN → 비교 항상 false → cache 지리검증/
// 거리 로직 silent 오작동). 유한수 아니면 null 반환 → 기존 null fallback 체인이 정상 처리.
export function finiteCoord(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// P155 (2026-05-22): Station 이름 정규화 매핑 — Gemini 출력 변형 (괄호 suffix /
// 공백 / 동/노포 위치명) 처리. lookupStationCoord 이 정규화 후 매칭.
const STATION_ALIAS = {
  // 공항 코드 suffix 변형
  'gmp': '김포국제공항',
  'icn': '인천국제공항',
  'pus': '김해국제공항',
  'cju': '제주국제공항',
  'tae': '대구국제공항',
  // 부산종합버스터미널 노포 변형
  '부산종합버스터미널노포': '부산종합버스터미널',
  '노포동부산종합버스터미널': '부산종합버스터미널',
};

/**
 * station label → coord lookup with fuzzy fallback (P155, 2026-05-22).
 *
 * 1) Exact match
 * 2) Remove parenthetical suffix: "김포국제공항 (GMP)" → "김포국제공항"
 * 3) Remove all whitespace: "부산종합버스터미널 (노포)" → "부산종합버스터미널노포"
 * 4) Alias map: airport codes / location suffixes
 *
 * @param {string} stationName 예: "부산역" / "김포국제공항 (GMP)" / "부산종합버스터미널(노포)"
 * @returns {{ lat: number, lng: number, label: string } | null}
 */
export function lookupStationCoord(stationName) {
  if (!stationName || typeof stationName !== 'string') return null;
  const raw = stationName.trim();
  if (STATION_COORDS[raw]) return STATION_COORDS[raw];

  // 1) 괄호 suffix 제거: "김포국제공항 (GMP)" / "부산종합버스터미널 (노포)"
  const noParen = raw.replace(/\s*\([^)]*\)\s*/g, '').trim();
  if (noParen && STATION_COORDS[noParen]) return STATION_COORDS[noParen];

  // 2) 공백 제거: "부산종합버스터미널 (노포)" → "부산종합버스터미널(노포)"
  const noSpace = raw.replace(/\s+/g, '');
  if (STATION_COORDS[noSpace]) return STATION_COORDS[noSpace];

  // 3) 괄호 + 공백 모두 제거: "부산종합버스터미널 (노포)" → "부산종합버스터미널"
  const normalized = noParen.replace(/\s+/g, '');
  if (normalized && STATION_COORDS[normalized]) return STATION_COORDS[normalized];

  // 4) Alias map (airport code / 위치명 변형)
  const lowerNorm = normalized.toLowerCase();
  // 공항 코드만 들어온 경우 ("GMP", "PUS")
  if (STATION_ALIAS[lowerNorm]) return STATION_COORDS[STATION_ALIAS[lowerNorm]] || null;
  // 괄호 안 알파벳 코드만 추출 시도: "김포 (GMP)" → 'gmp' 추출
  const parenCode = raw.match(/\(([A-Z]{3,4})\)/i);
  if (parenCode && STATION_ALIAS[parenCode[1].toLowerCase()]) {
    return STATION_COORDS[STATION_ALIAS[parenCode[1].toLowerCase()]] || null;
  }
  // 노포동 / 동대구역 alias
  if (STATION_ALIAS[normalized]) return STATION_COORDS[STATION_ALIAS[normalized]] || null;

  return null;
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
  Gyeongju:  { ktx: '신경주역',                              bus: '경주시외버스터미널' },
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
// PR-C (2026-06-01): heavyLoad(charter) HERO 가격+구간 표시용 context 는 선택 인자.
//   region/airportKey/fromLabel/toLabel/estMin 는 FEATURE_CHARTER_HERO_PRICE='true'
//   일 때만 charter 반환에 est_price_krw/from/to/est_min + prefill cta_link 추가.
//   추천 *판단* (hour/lateNight/large/medium/heavyLoad) 은 불변 — 새 인자 영향 0.
//   플래그 OFF / 기존 호출(인자 미전달) 시 반환 객체 byte-identical.
export function pickRecommendedTransport({ arrivalTimeHHMM, luggage, paxCount, region, airportKey, fromLabel, toLabel, estMin } = {}) {
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
    const rec = {
      key: 'cocotrip_charter',
      reason_ko: '한국 택시는 캐리어 1개만 가능 — 짐이 많아 코코트립 전용 차량을 추천합니다 (기사가 모든 짐 적재)',
      reason_en: 'Korean taxis can only fit 1 suitcase — book a CocoTrip charter; your driver loads all luggage',
      reason_ja: '韓国のタクシーはスーツケース1個のみ — 荷物が多い方は専用車両を推奨（ドライバーが全荷物を積載）',
      reason_zh: '韩国出租车只能放1个行李箱 — 行李较多请预订CocoTrip包车（司机协助装载所有行李）',
      cta_link: '/charter',
    };
    // FEATURE_CHARTER_HERO_PRICE='true' 일 때만 가격/구간 + prefill 딥링크 채움.
    // OFF = 위 객체 그대로 (현재 동작 byte-identical).
    if (process.env.FEATURE_CHARTER_HERO_PRICE === 'true') {
      const priceKRW = airportTransferPriceKRW(region); // SSOT lookup, 미매핑 → null
      // 🔴 가격은 null 이면 필드 자체를 넣지 않음 (프론트가 0/빈칸 노출 못 하도록).
      if (priceKRW != null) rec.est_price_krw = priceKRW;
      if (fromLabel) rec.from = fromLabel;
      if (toLabel) rec.to = toLabel;
      if (typeof estMin === 'number' && estMin > 0) rec.est_min = estMin;
      // prefill 딥링크 — origin=공항키, destinationKey=region, pax. 값 있을 때만.
      const params = new URLSearchParams({ service: 'airport_transfer' });
      if (airportKey) params.set('origin', String(airportKey));
      if (region) params.set('destinationKey', String(region));
      if (paxCount) params.set('pax', String(paxCount));
      rec.cta_link = `/charter?${params.toString()}`;
    }
    return rec;
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

// ── PR-C (2026-06-01): 공항픽업 가격 SSOT lookup (FEATURE_CHARTER_HERO_PRICE) ────
// arrival region (normalizeRegionKey 영문 lowercase: 'seoul'/'busan'/'jeju'...) →
// 지역→zone 매핑은 SSOT(pricing_spec.json airport_transfer_regions)로 이동 (2026-06-02 이원화 제거).
// 기존 RouteAgent 하드코딩 REGION_TO_AIRPORT_TRANSFER_ZONE 을 pricing_spec.json 으로 옮겨 운영자가
// 1곳(pricing_spec)만 수정 → backend/frontend 자동 동기화. zone 키는 SSOT airport_transfer_prices
// 키와 1:1. 매핑 없는 region(gwangju/daejeon/ulsan/...)은 null → HERO 가격 숨김(오노출 방지).
/**
 * arrival region → 공항픽업 편도 요금(KRW). SSOT(pricing_spec.json) 단일 출처.
 * airport_transfer_regions[region] → airport_transfer_prices[zoneKey].priceKRW.
 * 매핑/spec 부재 시 null (HERO 가격 숨김 — 오노출 방지).
 * @param {string} region normalizeRegionKey 영문 lowercase 권장 ('seoul'/'busan')
 * @returns {number|null} priceKRW 또는 null
 */
export function airportTransferPriceKRW(region) {
    if (!region) return null;
    const low = String(region).toLowerCase();
    const spec = loadPricingSpec();
    const regions = spec?.airport_transfer_regions || {};
    // area 키('seoul_city'/'seoul_suburb' 등 세분 키)는 base city('seoul')로 환원 — 공항픽업
    //   가격은 도시 단위 SSOT. (정확 키 우선, 없으면 '_' 앞 base 도시로 폴백.)
    const zoneKey = regions[low]
        || (low.includes('_') ? regions[low.split('_')[0]] : undefined);
    if (!zoneKey) return null;
    const price = spec?.airport_transfer_prices?.[zoneKey]?.priceKRW;
    return (typeof price === 'number' && price > 0) ? price : null;
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

// ── P275 (2026-05-29): airport station mismatch verify (terminal 일치 검증) ─────
// SAFETY-CRITICAL: input airport key (ICN_T1 / ICN_T2 / ICN) 과 ODsay 추천 station name
// 의 terminal 일치 검증. mismatch 시 사용자 비행기 놓침 risk. Phase A (측정) — Phase B
// (station 좌표 별도 dict + 자동 fix) 는 별도 cycle.
//
// 반환: { match: boolean, reason: string }
//   - reason 종류: 't1_match' / 't1_input_t2_station' / 't2_match' / 't2_input_t1_station'
//                  / 'generic_match' / 'unspecified' / 'no_terminal_check' / 'no_data'
function _verifyAirportStation(inputAirportKey, stationName) {
    if (!inputAirportKey || !stationName) return { match: true, reason: 'no_data' };
    const ak = String(inputAirportKey).toUpperCase();
    const sn = String(stationName);

    if (ak === 'ICN_T1') {
        if (/T1|1터미널|제1여객터미널|terminal 1/i.test(sn)) return { match: true, reason: 't1_match' };
        if (/T2|2터미널|제2여객터미널|terminal 2/i.test(sn)) return { match: false, reason: 't1_input_t2_station' };
        return { match: true, reason: 'unspecified' };
    }
    if (ak === 'ICN_T2') {
        if (/T2|2터미널|제2여객터미널|terminal 2/i.test(sn)) return { match: true, reason: 't2_match' };
        if (/T1|1터미널|제1여객터미널|terminal 1/i.test(sn)) return { match: false, reason: 't2_input_t1_station' };
        return { match: true, reason: 'unspecified' };
    }
    // ICN (generic) — terminal 명시 없어도 OK. 명시 있어도 자가 모순 아님 (input 자체 unspecified).
    if (ak === 'ICN') {
        return { match: true, reason: 'generic_input' };
    }
    // GMP / PUS / CJU — terminal 구분 없음, station 명시 다양해도 OK.
    return { match: true, reason: 'no_terminal_check' };
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

// ── (2026-06-23): intercity bookend fallback leg 합성 ─────────────────────────
// ODsay 가 호텔↔역 bookend 구간에 null 응답을 주면(농어촌·시외·quota) 기존 코드는
// it.lodging_to_station / it.station_to_lodging 를 비워 둬 UI(LodgingBookend)가 그
// 구간 transit arrow 자체를 미렌더 → 사용자 화면에 "호텔→부산역" 화살표가 통째로
// 빈칸. 두 좌표는 KNOWN(호텔 + 역 STATION_COORDS) 이므로 haversine 으로 거리/도보·택시
// 추정 + 네이버 대중교통 길찾기 링크를 합성해 graceful 한 fallback leg 를 반환한다.
//
// 반환 shape = TransitFromPrev (src/types/plan.ts). frontend TransitArrow/LodgingBookend
// 가 그대로 소비:
//   - method 'walk'(<1.2km) | 'taxi' — 둘 다 isPublicTransitMethod=false → TransitArrow
//     의 shouldShowFallbackWarning 이 발화 안 함(public-transit 전용 경고라 오탐 방지).
//   - source 'naver_fallback' — TransitFromPrev enum 의 정식 값(types/plan.ts L174).
//   - instruction/instruction_en + step_by_step 로 거리·시간·네이버 링크 인라인 표시.
// 좌표가 하나라도 없으면 null → 호출부가 기존 skip 동작 유지(절대 깨지지 않음).
function buildBookendFallbackLeg({ fromLat, fromLng, fromLabel, toLat, toLng, toLabel }) {
    if (fromLat == null || fromLng == null || toLat == null || toLng == null) return null;
    if (![fromLat, fromLng, toLat, toLng].every((n) => Number.isFinite(n))) return null;
    const distKm = _haversineKmPure(fromLat, fromLng, toLat, toLng);
    if (!Number.isFinite(distKm)) return null;
    const distM = Math.round(distKm * 1000);
    // 보행 70m/분(~4.2km/h). 짧으면 도보, 길면 택시 권장.
    const isWalk = distKm < 1.2;
    const method = isWalk ? 'walk' : 'taxi';
    const walkMin = Math.max(3, Math.round(distM / 70));
    // 한국 표준 택시: 기본 ₩4,800(1.6km) + 132m 당 ₩100. 100원 반올림.
    const taxiKrw = Math.round((4800 + Math.max(0, Math.ceil((distM - 1600) / 132)) * 100) / 100) * 100;
    const estMin = isWalk ? walkMin : Math.max(5, Math.round((distKm / 25) * 60)); // 택시 평속 ~25km/h
    const enc = encodeURIComponent;
    const naverUrl = `https://map.naver.com/v5/directions/${fromLng},${fromLat},${enc(fromLabel || '')}/${toLng},${toLat},${enc(toLabel || '')}/-/transit?c=15`;
    const stepKo = isWalk
        ? `도보 약 ${walkMin}분 (${distM}m)`
        : `택시 약 ${estMin}분 · 추정 ${taxiKrw.toLocaleString('ko-KR')}원 (${distKm.toFixed(1)}km)`;
    const stepEn = isWalk
        ? `~${walkMin} min walk (${distM}m)`
        : `Taxi ~${estMin} min · est. ₩${taxiKrw.toLocaleString('en-US')} (${distKm.toFixed(1)}km)`;
    return {
        method,
        mode: methodToMode(method) || method,
        instruction: `${stepKo} · 네이버 지도 길찾기: ${naverUrl}`,
        instruction_en: `${stepEn} · Naver Map directions: ${naverUrl}`,
        step_by_step: [stepKo, `네이버 지도 길찾기: ${naverUrl}`],
        est_min: estMin,
        est_fare_krw: isWalk ? 0 : taxiKrw,
        distance_km: distKm,
        source: 'naver_fallback',
        from_label: fromLabel || 'Hotel',
        to_label: toLabel || '',
        naver_directions_url: naverUrl,
        _bookend_fallback: true,
    };
}

// ── (2026-07-19): 도보 override 판정 (pure, 회귀 테스트용 export) ────────────────
// 배경: 기존 walk-first override 는 "직선 1.5km 미만이면 무조건 도보"였다. 의도는
// "북촌→인사동 차로 25분" 오답 교정이었지만, 서울 도심 코스는 대부분 1.5km 이내라
// 교통 API 가 준 지하철 경로까지 전부 도보로 덮여 운영자 신고("각 장소 이동이 다
// 도보")로 이어졌다. 실측 플랜(9f42660f): 공항행 1560m·호텔행 1472m/1165m 도보.
//
// 3중 가드:
//  1) 상한 — 직선 walkMin > MAX_WALK_OVERRIDE_MIN 이면 override 금지. 직선거리 기반이라
//     실제 보행은 우회로 더 길다(체감 1.3~1.5배). 20분 초과는 "걸어가라"가 아니다.
//  2) 짐 구간 — 공항·역·터미널이 양끝 중 하나면 캐리어 전제라 도보 강권 금지.
//  3) 실시간 비교 — 교통 API 가 실제 소요(duration)를 줬으면 도보가 그보다 빠를 때만
//     덮는다. 기존엔 지하철 8분 경로도 도보 20분으로 갈아치웠다.
// API 결과가 없을 때(transitMin=null)는 기존대로 도보 우선(대안이 blind car 추정뿐).
export const MAX_WALK_OVERRIDE_MIN = 20;
// 이름 '각각'에 적용한다. 합쳐서 검사하면 '역$'(이름 끝이 역) 같은 앵커가
// 뒤 이름에만 걸려 '서울역 → 명동 호텔' 을 놓친다.
const LUGGAGE_LEG_RE = /airport|공항|terminal|터미널|\bstation\b|역$|KTX|SRT/i;
const isLuggageStop = (s) => LUGGAGE_LEG_RE.test(String(s || '').trim());

export function shouldOverrideToWalk({ walkMin, transitMin, fromName, toName }) {
    if (!Number.isFinite(walkMin)) return false;
    if (walkMin > MAX_WALK_OVERRIDE_MIN) return false;
    if (isLuggageStop(fromName) || isLuggageStop(toName)) return false;
    if (Number.isFinite(transitMin) && walkMin > transitMin) return false;
    return true;
}

// ── P326 (2026-05-31): transit cache 지리 정합 검증 (pure, 회귀 테스트용 export) ──
// block_mode transit cache(P228) 는 stop order 만 key 로 쓴다. food placeholder 치환
// (matchFoodPlaceholder) 으로 venue 좌표가 바뀌면 같은 order 에 옛 거리/시간이 붙어
// "6km 를 23분/3959m" + subway→car 강등 같은 틀린 transit 을 노출한다. 실거리(haversine)
// 가 cache 거리와 ±50% 이상 벗어나면 venue 치환을 의심해 cache 를 폐기(false)하고
// 호출부가 ODsay 실측으로 fall-through 하게 한다.
// 거리 정보가 없거나(actualKm/cachedKm ≤ 0) 검증 불가하면 보수적으로 cache 신뢰(true).
export function isCacheGeoConsistent(actualKm, cached) {
    const cachedKm = cached && cached.distanceKm != null ? cached.distanceKm
        : (cached && cached.distance_m != null ? cached.distance_m / 1000 : null);
    if (cachedKm == null || cachedKm <= 0 || actualKm <= 0) return true;
    return actualKm <= cachedKm * 1.5 && actualKm >= cachedKm * 0.5;
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
        // 키 해석 = mood-route.resolveNcpKeys (SSOT). 여기서 process.env 를 직접 읽지 않는다.
        //   🔴 2026-07-27 실측 장애: `NAVER_CLIENT_*` 만 읽고 있었다. prod 의 NAVER_CLIENT_* 는
        //   Developers(openapi 검색) 키로 갱신돼 maps.apigw.ntruss.com 에 401 → 호텔 anchor
        //   geocoding·stop geocoding·Driving 이 전부 실패하고 city_center fallback / flat 25분
        //   으로 조용히 떨어져 있었다 (운영자 신고 "시청→노량진 우회" 의 원인).
        const { clientId, clientSecret } = resolveNcpKeys();
        // Support both Gemini output formats
        const rawItinerary = data.itinerary || {};
        const hotelAddress = data.hotel_address || '';
        const region = data.area || data.region || '';
        const charterProductType = regionToCharterProduct(region);
        const daysList = Array.isArray(rawItinerary) ? rawItinerary : (rawItinerary.days || []);
        // Phase 3 (2026-05-27): block mode 에서 전달된 zone_id. legacy path = null.
        // zone_id 가 있으면 _getTransitData 전 transitCache lookup → ODsay call 절감.
        const zoneId = data.zone_id || null;

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
                    // P790: parseFloat NaN 가드 — 좌표 유한할 때만 anchor 확정 (NaN 이면 zone fallback 으로).
                    const hx = finiteCoord(geoRes.data.addresses[0].x);
                    const hy = finiteCoord(geoRes.data.addresses[0].y);
                    if (hx != null && hy != null) {
                        hotelLng = hx;
                        hotelLat = hy;
                        anchorSource = 'naver_geocode';
                        anchorLabel = hotelAddress;
                    }
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

        // P269 (2026-05-28): arrival_guide.route_to_hotel 4-fallback chain 적용.
        // 이전: hotelLat/Lng 둘 다 있을 때만 route 생성 → hotel_address='' 케이스 (운영자
        // dispatch admin-bypass 또는 일반 사용자 hotel 미입력) 시 5/5 plan 모두 route_to_hotel
        // 누락 (5/28 P266 결과물 검증 cycle). departure 측 (line 642+) 은 이미
        // `_resolveHotelOrFallback` 4-fallback chain (hotel 좌표 → arrival_guide.address →
        // zone anchor → 도시 중심) + _failed 마커 적용 — arrival 측만 누락.
        // 동일 패턴 + _failed 마커 적용으로 사용자 도착 후 호텔 경로 무조건 표시 정책 (운영자 의도).
        if (arrivalAirportKey && AIRPORT_COORDS[arrivalAirportKey] && rawItinerary.arrival_guide) {
            // P275 Phase B (2026-05-29): ODsay 호출 시 station 좌표 우선 사용 (strict match).
            // SAFETY-CRITICAL — AIRPORT_COORDS (lobby) 사용 시 T1↔T2 ~260m 인접 → ODsay 임의 station
            // 추천 (prod plan 696b273d 사건). AIRPORT_STATION_COORDS (subway station) = T1↔T2 ~2.6km
            // 떨어진 strict station match. fallback: AIRPORT_COORDS (CJU/TAE/MWX/YNY 지하철 없음).
            const ap = AIRPORT_STATION_COORDS[arrivalAirportKey] || AIRPORT_COORDS[arrivalAirportKey];
            const { coord: arrFromCoord, source: arrFromSource, label: arrFromLabel } = await this._resolveHotelOrFallback({
                hotelLat,
                hotelLng,
                hotelAddress,
                arrivalGuide: rawItinerary.arrival_guide,
                recommendedZone: data.recommended_zone,
                region,
                clientId,
                clientSecret,
            });

            if (arrFromCoord) {
                const route = await this._routeAirportHotel(ap, arrFromCoord, 'arrival');
                if (route) {
                    // PR-C (2026-06-01, FEATURE_CHARTER_HERO_PRICE): charter HERO 가격/구간 context.
                    //   region 은 한글('서울') 가능 → normalizeRegionKey 로 영문 키('seoul') 변환
                    //   (가격 zone 매핑 키와 일치). 공항 라벨은 AIRPORT_NAMES, generic 'ICN' 은 항목
                    //   없어 'Incheon Airport' fallback, 그래도 없으면 plan 의 airport 문자열.
                    //   est_min/to 는 이미 계산된 route + hotel/zone 라벨 재사용. 플래그 OFF 면
                    //   pickRecommendedTransport 가 이 인자들을 전부 무시 (반환 byte-identical).
                    const heroRegionKey = normalizeRegionKey(region) || null;
                    const heroFromLabel = AIRPORT_NAMES[arrivalAirportKey]
                        || (arrivalAirportKey && String(arrivalAirportKey).startsWith('ICN') ? 'Incheon Airport' : null)
                        || rawItinerary.arrival_guide.airport
                        || null;
                    const rec = pickRecommendedTransport({
                        arrivalTimeHHMM: data.arrival_time,
                        luggage: data.luggage,
                        paxCount: data.pax || 2,
                        region: heroRegionKey,
                        airportKey: arrivalAirportKey,
                        fromLabel: heroFromLabel,
                        toLabel: arrFromLabel || null,
                        estMin: route.est_min,
                    });

                    // P327 (2026-05-31): ICN→서울 중심부 + arex_express 추천 시 직통 HERO 로 교체.
                    // ODsay path[0] 가 일반열차→홍대입구→2호선 79분 indirect 라 라벨 "AREX Express
                    // 가장 빠름" 과 모순이었다. heavy-luggage(charter)/late-night(limousine) 추천은
                    // 그대로 두고, 표준 arex_express 추천일 때만 직통+last-mile 합성으로 라벨↔데이터 정합.
                    let heroRoute = route;
                    let effectiveRec = rec;
                    const isIcnArrival = arrivalAirportKey === 'ICN' || arrivalAirportKey === 'ICN_T1' || arrivalAirportKey === 'ICN_T2';
                    // BUGHUNT-LOW (2026-06-14): AREX 직통 HERO 합성은 ODsay 가 express 를 모델 못 해서
                    //   만든 우회책이다. TMAP 은 ICN→명동을 native 로 ₩4,600(공항철도 급행+4호선) 코히어런트
                    //   하게 반환하므로, TMAP 활성 시 합성(₩9,500 직통 + 서울역→호텔 last-mile)으로 덮으면
                    //   서울 중심부 호텔에서 더 비싸고 덜 정확해진다. → ODsay 일 때만 합성, TMAP 일 땐
                    //   _buildArexExpressHero 를 호출하지 않고(express=null) _routeAirportHotel 이 이미 반환한
                    //   native 경로(route)를 그대로 HERO 로 사용. ODsay(폴백 포함) primary 면 기존대로 합성.
                    if (isIcnArrival && rec.key === 'arex_express') {
                        const arexProviderOdsay = getTransitProvider() === 'odsay';
                        const express = arexProviderOdsay
                            ? await this._buildArexExpressHero(arrivalAirportKey, arrFromCoord, clientId, clientSecret)
                            : null;
                        if (express) {
                            heroRoute = express;
                            console.log(`  - [Airport→Hotel] P327 AREX 직통 HERO: ${express.est_min}min / ₩${express.est_fare_krw} / ${express.transfers}tr (ODsay path[0] 는 ${route.est_min}min/${route.transfers}tr 였음)`);
                        } else if (!arexProviderOdsay) {
                            // BUGHUNT-LOW (2026-06-14): TMAP 활성 → 합성 의도적 skip. TMAP 의 native route 는
                            //   공항철도 급행을 코히어런트하게 모델하므로 ODsay 같은 강등 불필요. route/rec 그대로 유지.
                            console.log(`  - [Airport→Hotel] AREX 합성 skip (provider=tmap) → TMAP native 경로 사용 (${route.est_min}min/₩${route.est_fare_krw}/${route.transfers}tr/${route.source})`);
                        } else {
                            // P-launch (2026-05-31): 직통 합성 실패(>6km 또는 경로 없음) → route 는 ODsay indirect.
                            //   "AREX Express 가장 빠름" 라벨을 그대로 두면 라벨↔데이터 모순(plan db7fae92).
                            //   실제 경로(대중교통 indirect)에 맞는 중립 추천으로 강등 → 모순 제거.
                            effectiveRec = {
                                key: 'public_transit',
                                reason_ko: '대중교통(공항철도+환승) 경로 — 짐·도착 시각에 따라 리무진 버스/택시도 고려하세요',
                                reason_en: 'Public transit (airport rail + transfer). Consider limousine bus or taxi depending on luggage/time',
                                reason_ja: '公共交通（空港鉄道＋乗換）。荷物や到着時刻に応じてリムジンバス・タクシーもご検討ください',
                                reason_zh: '公共交通（机场铁路+换乘）。可根据行李和到达时间考虑机场大巴或出租车',
                            };
                            console.warn(`  - [Airport→Hotel] P327 직통 합성 실패 → rec arex_express→public_transit (route ${route.est_min}min/${route.transfers}tr/${route.source})`);
                        }
                    }

                    if (arrFromSource !== 'hotel') {
                        heroRoute.fallback_origin = arrFromSource; // 'arrival_guide' | 'zone_anchor' | 'city_center'
                        heroRoute.fallback_label = arrFromLabel || null;
                    }

                    // P275 (2026-05-29): ODsay station mismatch 측정 + quality_warnings 박제.
                    // P274 우회 fix (input 'ICN' echo) 의 측정 강화 — input terminal vs ODsay 추천
                    // station 의 terminal 일치 검증. mismatch 시 운영자 admin panel (P121) 즉시 노출.
                    // 추후 Phase B (station 좌표 별도 dict + 호출 시 strict match) 에서 자동 fix.
                    // P327: 직통 HERO 는 fromStationName=인천공항N터미널역 → terminal match 통과.
                    const arrV = _verifyAirportStation(arrivalAirportKey, heroRoute.fromStationName);
                    if (!arrV.match) {
                        rawItinerary.quality_warnings = rawItinerary.quality_warnings || [];
                        rawItinerary.quality_warnings.push({
                            kind: 'arrival_station_terminal_mismatch',
                            type: 'arrival_station_terminal_mismatch',
                            severity: 'high',
                            message: `P275: input arrival_airport='${arrivalAirportKey}' but ODsay station='${heroRoute.fromStationName}' (${arrV.reason}). 사용자 비행기 놓침 risk. 운영자 조치: 해당 plan 도착 경로 수동 확인 후 손님에게 정확한 터미널 안내.`,
                        });
                        console.warn(`[RouteAgent P275] arrival station mismatch: input='${arrivalAirportKey}' station='${heroRoute.fromStationName}' (${arrV.reason})`);
                        // SAFE-4 (SAFETY): 도착 터미널 mismatch 도 동일하게 telegram 통지(throttled).
                        throttledTelegramAlert({
                            key: `arrival-terminal-mismatch:${arrivalAirportKey}:${arrV.reason}`,
                            channel: 'admin',
                            severity: 'high',
                            message: `⚠️ <b>도착 터미널 mismatch — 비행기 놓침 risk</b>\n\ninput arrival='${arrivalAirportKey}' but station='${heroRoute.fromStationName}' (${arrV.reason})\n운영자 조치: 해당 plan 도착 경로 수동 확인 후 손님에게 정확한 터미널 안내.`,
                        }).catch(() => {});
                    }

                    // B9-15/25 + P269: anchor 우선순위 — hotel 좌표 있으면 그것, 없으면 fallback chain 결과.
                    rawItinerary.arrival_guide.route_to_hotel = {
                        ...heroRoute,
                        recommended_option: effectiveRec,
                        anchor_lat: arrFromCoord.lat,
                        anchor_lng: arrFromCoord.lng,
                        anchor_label: arrFromLabel || anchorLabel || null,
                        anchor_source: arrFromSource === 'hotel' ? (anchorSource || 'hotel') : arrFromSource,
                    };
                    console.log(`  - [Airport→Hotel] ${heroRoute.est_min}min via ${heroRoute.method}, recommended=${effectiveRec.key}, origin=${arrFromSource}, source=${heroRoute.source}`);
                } else {
                    // ODsay 끝까지 실패 — _failed 마커로 graceful 표시.
                    rawItinerary.arrival_guide.route_to_hotel = {
                        _failed: true,
                        _odsay_failed: true,
                        fallbackReason: 'odsay_unavailable',
                        fallback_origin: arrFromSource,
                        fallback_label: arrFromLabel || null,
                        method: 'unknown',
                        mode: 'unknown',
                        source: 'failed',
                        direction: 'arrival',
                    };
                    console.warn('  - [Airport→Hotel] ODsay all attempts failed → _failed=true');
                }
            } else {
                // 좌표 자체 못 잡음 (모든 fallback 실패) — _failed 마커.
                rawItinerary.arrival_guide.route_to_hotel = {
                    _failed: true,
                    _odsay_failed: false,
                    fallbackReason: 'no_destination_coord',
                    method: 'unknown',
                    mode: 'unknown',
                    source: 'failed',
                    direction: 'arrival',
                };
                console.warn('  - [Airport→Hotel] no destination coord (region/zone fallback unmapped)');
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
            // P275 Phase B: station 좌표 우선 사용 (arrival 측과 동일 패턴).
            const ap = AIRPORT_STATION_COORDS[departureAirportKey] || AIRPORT_COORDS[departureAirportKey];
            // ── P-launch (2026-05-31): 멀티시티 departure origin fix (비행기 놓침 risk) ──
            //   departure_guide 는 마지막 도시 호텔에서 출발해야 한다. plan a8b96f91 처럼 부산서 끝나는데
            //   "명동 출발 85분" 안내 → 부산 손님이 비행기 시간 오해(부산→ICN 4-5h). regions[마지막]=출발도시
            //   (inferDepartureAirport 동일 convention). 기존 getDayHotelCoord 재사용. 단도시/동일도시 무영향.
            let depHotelLat = hotelLat, depHotelLng = hotelLng, depHotelAddr = hotelAddress, departureCity = null;
            const depRegions = Array.isArray(data.regions) ? data.regions : (Array.isArray(rawItinerary.regions) ? rawItinerary.regions : []);
            // P-launch (2026-05-31): normalizeRegionKey — 한글 '부산' → 'busan' (P321 trap). 이거 없으면
            //   getDayHotelCoord/CITY_CENTER_COORDS 영문 키 mismatch → silent 첫 도시(명동) 폴백.
            const depFirstRegion = depRegions[0] ? normalizeRegionKey(depRegions[0]) : null;
            const depLastRegion = depRegions.length >= 2 ? normalizeRegionKey(depRegions[depRegions.length - 1]) : null;
            if (depLastRegion && !isSameAsFirstCity(depLastRegion, depFirstRegion)) {
                const depZonesMap = (data.recommended_zones && typeof data.recommended_zones === 'object' && !Array.isArray(data.recommended_zones)) ? data.recommended_zones : null;
                const depHotel = getDayHotelCoord({ city: depLastRegion }, {
                    isMultiCity: true, recommendedZonesMap: depZonesMap, tripFirstRegion: depFirstRegion,
                    tripHotel: { lat: hotelLat, lng: hotelLng, label: anchorLabel, source: anchorSource },
                });
                if (depHotel.lat != null && depHotel.lng != null) {
                    depHotelLat = depHotel.lat; depHotelLng = depHotel.lng;
                    depHotelAddr = depHotel.label || depLastRegion; departureCity = depLastRegion;
                    console.log(`  - [Hotel→Airport] 멀티시티 departure origin = ${depLastRegion} (${depHotel.source}/${depHotel.label})`);
                }
            }
            const { coord: depFromCoord, source: depFromSource, label: depFromLabel } = await this._resolveHotelOrFallback({
                hotelLat: depHotelLat,
                hotelLng: depHotelLng,
                hotelAddress: depHotelAddr,
                arrivalGuide: rawItinerary.arrival_guide,
                recommendedZone: departureCity
                    ? ((data.recommended_zones && data.recommended_zones[String(departureCity).toLowerCase()]) || data.recommended_zone)
                    : data.recommended_zone,
                region: departureCity || region,
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

                    // P275 (2026-05-29): departure side station mismatch 측정.
                    // 사용자 출국 시 잘못된 terminal station 으로 가면 비행기 놓침 risk.
                    const depV = _verifyAirportStation(departureAirportKey, route.toStationName);
                    if (!depV.match) {
                        rawItinerary.quality_warnings = rawItinerary.quality_warnings || [];
                        rawItinerary.quality_warnings.push({
                            kind: 'departure_station_terminal_mismatch',
                            type: 'departure_station_terminal_mismatch',
                            severity: 'high',
                            message: `P275: input departure_airport='${departureAirportKey}' but ODsay station='${route.toStationName}' (${depV.reason}). 사용자 비행기 놓침 risk. 운영자 조치: 해당 plan 출국 경로 수동 확인 후 손님에게 정확한 터미널 안내.`,
                        });
                        console.warn(`[RouteAgent P275] departure station mismatch: input='${departureAirportKey}' station='${route.toStationName}' (${depV.reason})`);
                        // SAFE-4 (SAFETY): 출국 터미널 mismatch=비행기 놓침 risk. quality_warning(수동 패널)만으론
                        //   운영자가 능동 확인 안 하면 놓침 → 다른 high-severity 와 동일 패턴으로 telegram 통지(throttled).
                        throttledTelegramAlert({
                            key: `departure-terminal-mismatch:${departureAirportKey}:${depV.reason}`,
                            channel: 'admin',
                            severity: 'high',
                            message: `⚠️ <b>출국 터미널 mismatch — 비행기 놓침 risk</b>\n\ninput departure='${departureAirportKey}' but station='${route.toStationName}' (${depV.reason})\n운영자 조치: 해당 plan 출국 경로 수동 확인 후 손님에게 정확한 터미널 안내.`,
                        }).catch(() => {});
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
        const recommendedZonesMap = (data.recommended_zones && typeof data.recommended_zones === 'object' && !Array.isArray(data.recommended_zones))
            ? data.recommended_zones
            : null;
        // P-fix #3 (2026-06-20): normalizeRegionKey — 한글 '부산' → 'busan' (P321 재발 차단).
        //   .toLowerCase() 만으론 '부산'.toLowerCase() === '부산' → getDayHotelCoord /
        //   CITY_CENTER_COORDS 영문 키('busan') mismatch → 둘째 도시 숙소좌표 silent skip →
        //   다도시 day 가 첫 도시 호텔로 폴백. ko/ja/zh 다도시 100% 영향.
        const tripFirstRegion = regionsList[0] ? normalizeRegionKey(regionsList[0]) : null;
        // PDF-issue-3 v2 (2026-05-14): module-level helpers (getDayHotelCoord / isSameAsFirstCity)
        // 사용 — closure 제거 + unit test 가능. context 묶어서 전달.
        const dayHotelCtx = {
            isMultiCity,
            recommendedZonesMap,
            tripFirstRegion,
            tripHotel: { lat: hotelLat, lng: hotelLng, label: anchorLabel, source: anchorSource },
        };

        // ════════════════════════════════════════════════════════
        // P157 (2026-05-22): days 병렬화 — dayHotel pre-computation
        // ════════════════════════════════════════════════════════
        // 10d multi-city plan 300s timeout fix. RouteAgent processing 60-120s → 20-30s.
        // inter-day dep 인 prevDayHotelCoord 는 getDayHotelCoord (pure 함수) 결과 →
        // 사전 일괄 계산하여 race condition 회피. P148 CITY_CENTER fallback 도 deterministic.
        //
        // NCP/ODsay rate limit 안전: 동시 days 수 제한 (DAY_CONCURRENCY=ROUTE_DAY_CONCURRENCY env, 기본 5 — P320).
        // 3 days 씩 batch 처리.
        const dayHotels = daysList.map((dayPlan) => {
            const dh = getDayHotelCoord(dayPlan, dayHotelCtx);
            // P148 CITY_CENTER fallback
            if ((!dh.lat || !dh.lng) && (dayPlan.city || tripFirstRegion)) {
                const cityKey = String(dayPlan.city || tripFirstRegion || '').toLowerCase().trim();
                for (const [k, c] of Object.entries(CITY_CENTER_COORDS)) {
                    if (cityKey.includes(k) || k.includes(cityKey)) {
                        dh.lat = c.lat;
                        dh.lng = c.lng;
                        dh.label = dh.label || c.label;
                        dh.source = 'city_center_p148';
                        break;
                    }
                }
            }
            return dh;
        });

        // P320 (2026-05-31): 5일+ plan latency fix. 기존 3 = 5일이 2배치(ceil(5/3)) →
        // RouteAgent 시간 ~2배("5일 절벽"). env화 기본 5 = 5일 1배치. day 내부는 이미
        // 완전 병렬(geocode/transit Promise.all)이라 day간 동시성↑ 시 외부 API 동시호출도↑
        // (Naver NCP 50req/s + ODsay Referer-bound quota). ROUTE_DAY_CONCURRENCY 로 즉시
        // 조정/롤백(재배포 불필요). 측정 후 상향, rate limit 문제 시 env 다운 = 안전망.
        const DAY_CONCURRENCY = Math.max(1, Math.min(7, Number(process.env.ROUTE_DAY_CONCURRENCY) || 5));
        const processDayFn = async (dayPlan, dayIdx) => {
            const dayHotel = dayHotels[dayIdx];
            const prevDayHotelCoord = dayIdx > 0 ? dayHotels[dayIdx - 1] : null;
            const places = dayPlan.stops || dayPlan.places || [];
            // Derive weekday for first/last-train lookup. Gemini writes
            // dayPlan.date as "YYYY-MM-DD"; Date.getDay() -> 0=Sun..6=Sat
            // which we map to WEEK_TAG inside getSubwayTimetable.
            const dayDate = dayPlan.date ? new Date(dayPlan.date) : null;
            const dayOfWeek = (dayDate && !isNaN(dayDate.getTime())) ? dayDate.getDay() : null;
            // Phase 3 (2026-05-27): day-level zone_id = block mode 의 source_block_id.
            // P-fix #1 (2026-06-20): per-day source_block_id 우선, trip-level zoneId 폴백.
            //   다도시 plan 은 day 마다 block 이 다르다 (부산 day = busan block, 서울 day =
            //   seoul block). trip-level zoneId (data.zone_id = blocksUsed[0]) 우선 시
            //   부산 day 가 서울 block 의 transit_matrix 를 조회 → 틀린 거리/시간/모드.
            //   각 day 가 올바른 block_id 보유 → source_block_id 우선이 정답. 단일-block
            //   plan 은 source_block_id === blocksUsed[0] === zoneId 라 동작 동일.
            // legacy path = 둘 다 null → cache miss → 기존 ODsay 경로.
            const dayZoneId = dayPlan.source_block_id || zoneId || null;

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
                                // P790: 좌표 유한할 때만 채택 + break (NaN 이면 다음 fallback query 시도).
                                const px = finiteCoord(res.data.addresses[0].x);
                                const py = finiteCoord(res.data.addresses[0].y);
                                if (px != null && py != null) {
                                    lng = px;
                                    lat = py;
                                    break;
                                }
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
            // Phase 3 (2026-05-27): transitCache lookup 먼저 — hit 시 ODsay skip.
            // zoneId: block mode 에서 전달 (data.zone_id). legacy path = null → miss.
            // ════════════════════════════════════════════════════════
            const transitPromises = [];
            for (let i = 1; i < places.length; i++) {
                const prev = places[i - 1];
                const curr = places[i];
                if (prev.lat && prev.lng && curr.lat && curr.lng) {
                    // Phase 3: cache lookup — stop.order 기반 (zone_courses transit_matrix key: "N->M").
                    // order 필드 없으면 index (i) 로 fallback (legacy Gemini plan 호환).
                    const fromOrder = prev.order != null ? prev.order : i;
                    const toOrder = curr.order != null ? curr.order : i + 1;
                    transitPromises.push(
                        lookupTransitCache(dayZoneId, fromOrder, toOrder).then((cached) => {
                            if (cached) {
                                // P326 (2026-05-31): cache 지리 검증 — food placeholder 치환(matchFoodPlaceholder)으로
                                //   stop venue 가 바뀌면 order key 는 같아도 실제 좌표가 달라짐. cache 는 order 만 보고
                                //   옛 거리/시간을 붙여 "6km 를 23분" 처럼 틀린 transit + subway→car 강등 유발.
                                //   haversine(prev,curr) 가 cache 거리와 ±50% 벗어나면 cache 폐기 → ODsay 실측.
                                const actualKm = _haversineKmPure(prev.lat, prev.lng, curr.lat, curr.lng);
                                if (isCacheGeoConsistent(actualKm, cached)) {
                                    // Cache hit (지리 정합): ODsay skip. index 필드 추가 (caller 기대값).
                                    return { index: i, ...cached };
                                }
                                // 지리 mismatch (venue 치환 의심) → cache 폐기, 아래 ODsay 실측으로.
                            }
                            // Cache miss 또는 geo mismatch: 기존 ODsay 경로
                            return this._getTransitData(prev, curr, clientId, clientSecret, i, dayOfWeek);
                        })
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
                // P239 (2026-05-27): Day 1 tour_start_time architectural fix.
                // 운영자 의도: 새벽 도착 시 호텔까지 transit 만 + tour_start_time 부터 stops.
                // root cause level 해소: P159 새벽 stops (00:00~04:59) / P136 24h wrap / B-13 false positive.
                //
                // 룰 (buildPrompt ARRIVAL DAY HANDLING 과 일치):
                //   - stops[0] (lodging 체크인): arrival_time + 60min — Gemini 값 유지
                //   - stops[1+] (활동): max(tour_start_time, arrival_time + 60min) 부터 시작
                //   - tour_start_time hour < 5 또는 잘못된 값: '09:00' 폴백 (안전 + 시설 미운영)
                //
                // Day 1 검출: dayIdx === 0 또는 dayPlan.day === 1. 미식별 시 skip (보수적).
                const isDay1 = dayIdx === 0 || dayPlan.day === 1 || dayPlan.day_index === 1;
                if (isDay1 && places.length >= 2) {
                    const firstCat = String(places[0]?.category || '').toLowerCase();
                    const isLodgingFirst = firstCat === 'lodging';
                    if (isLodgingFirst) {
                        // tour_start_time 파싱 + hour<5 폴백 '09:00'.
                        const tourStartRaw = data.tour_start_time || data.tourStartTime || '09:00';
                        const tourStartMin = this._parseTime(tourStartRaw);
                        const tourStartHour = Math.floor((tourStartMin || 0) / 60);
                        const safeTourStartMin = (tourStartHour >= 5 && tourStartHour <= 23)
                            ? tourStartMin
                            : this._parseTime('09:00');
                        // stops[1] 의 Gemini 시각 vs tour_start_time — 둘 중 늦은 것 사용.
                        // (Gemini 가 14:00 도착 → 15:00 stops[1] 추천 시 그 값 우선.)
                        const stop1GeminiMin = this._parseTime(places[1]?.start_time || tourStartRaw);
                        const arrivalPlus60 = data.arrival_time
                            ? this._parseTime(data.arrival_time) + 60
                            : 0;
                        const effectiveTourStart = Math.max(safeTourStartMin, stop1GeminiMin, arrivalPlus60);
                        // currentTime 은 stops[0] (lodging) 시각 — 변경 X. stitch loop 가 places[1] 부터
                        // 처리할 때 이 tour_start_time 을 사용하도록 dayPlan 에 cache.
                        dayPlan._p239TourStartMin = effectiveTourStart;
                        console.log(`  [Route] Day 1: P239 tour_start_time set = ${this._formatTime(effectiveTourStart)} (raw=${tourStartRaw}, safe=${this._formatTime(safeTourStartMin)}, gemini stop1=${this._formatTime(stop1GeminiMin)}, arrival+60=${this._formatTime(arrivalPlus60)})`);
                    }
                }
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
            // P157 (2026-05-22): dayHotel + prevDayHotelCoord 는 loop top 에서 pre-computed
            // dayHotels[] 로 부터 받음. inline getDayHotelCoord + P148 fallback 는 pre-computation
            // 으로 이동 (race-condition 차단 + days 병렬화 안전).

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
                // P155 (2026-05-22): Day 1 + intercity_transit 케이스에 prev_hotel
                // = arrival_airport coord fallback. prod alert 다수: "Seoul→Busan
                // (Day 1) prev_hotel: (null) — pre:prev_hotel_coord_missing".
                // 입국일에 바로 KTX/Bus/Air 로 다른 도시 이동 = 출발지 = 공항.
                let prevHotelEffective = prevDayHotelCoord;
                const isDay1 = (dayPlan.day === 1 || dayPlan.day_index === 1);
                if (isDay1 && (!prevHotelEffective || !prevHotelEffective.lat || !prevHotelEffective.lng)
                    && arrivalAirportKey && AIRPORT_COORDS[arrivalAirportKey]) {
                    const ap = AIRPORT_COORDS[arrivalAirportKey];
                    prevHotelEffective = {
                        lat: ap.lat, lng: ap.lng,
                        label: ap.label || arrivalAirportKey,
                        source: 'arrival_airport_day1_p155',
                    };
                    console.log(`[RouteAgent] P155: Day 1 prev_hotel = arrival_airport (${arrivalAirportKey}) for intercity bookend`);
                }
                // Phase 2.4a: 이전 day hotel → from_station
                // P111: 4 silent-fail 분기 explicit log + alert reason 누적.
                if (!it.from_station) {
                    bookendFailReasons.push(`pre:from_station_missing`);
                    console.warn(`  - intercity bookend pre SKIP — from_station undefined`);
                } else if (!prevHotelEffective || !prevHotelEffective.lat || !prevHotelEffective.lng) {
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
                            const prevHotelPlace = { lat: prevHotelEffective.lat, lng: prevHotelEffective.lng, name: prevHotelEffective.label || 'Hotel', display_name: prevHotelEffective.label || 'Hotel' };
                            const transitData = await this._getTransitData(prevHotelPlace, stationPlace, clientId, clientSecret, -1, dayOfWeek);
                            const pt = transitData.publicTransit;
                            if (!pt) {
                                // (2026-06-23): null 응답 → skip 대신 합성 fallback leg.
                                // 두 좌표(prevHotel ↔ fromStation)는 KNOWN → 도보/택시 추정 +
                                // 네이버 길찾기 링크. UI 가 빈칸 대신 graceful 안내 표시.
                                const fb = buildBookendFallbackLeg({
                                    fromLat: prevHotelEffective.lat, fromLng: prevHotelEffective.lng,
                                    fromLabel: prevHotelEffective.label || 'Hotel',
                                    toLat: fromStationCoord.lat, toLng: fromStationCoord.lng,
                                    toLabel: it.from_station,
                                });
                                if (fb) {
                                    it.lodging_to_station = fb;
                                    bookendFailReasons.push(`pre:odsay_null_fallback_synth`);
                                    console.warn(`  - intercity bookend pre ODsay null (Day ${dayPlan.day}) → synth fallback ${fb.method} ${fb.est_min}min`);
                                } else {
                                    bookendFailReasons.push(`pre:odsay_null_response`);
                                    console.warn(`  - intercity bookend pre ODsay returned null (Day ${dayPlan.day}) — skipping lodging_to_station (coords missing)`);
                                }
                            } else {
                            it.lodging_to_station = {
                                method: pt.method || 'subway',
                                mode: methodToMode(pt.method) || 'subway',
                                instruction: pt.summary || `Take public transit from ${prevHotelEffective.label || 'hotel'} to ${it.from_station}`,
                                step_by_step: (pt.steps || []).map(s => s.description || s.instruction || ''),
                                steps_detail: pt.steps || [],
                                est_min: pt.duration || transitData.durationMin || 30,
                                est_fare_krw: pt.fare || 0,
                                source: 'odsay',
                                from_label: prevHotelEffective.label || 'Hotel',
                                to_label: it.from_station,
                            };
                            }
                            // 가드 (2026-06-23): pt(publicTransit)가 null 이면 위 else 가 안 돌아
                            //   it.lodging_to_station 이 undefined → .est_min 읽기 throw
                            //   ("Cannot read properties of undefined (reading 'est_min')") →
                            //   catch 가 pre:odsay_throw 로 누적하며 leg skip. 정상 응답이면
                            //   값 동일, null 응답이면 '(skipped)' 로 graceful 로그.
                            console.log(`  - [${prevHotelEffective.label || 'Hotel'}→${it.from_station}] ${it.lodging_to_station ? `${it.lodging_to_station.est_min}min` : '(skipped — no transit)'} (intercity bookend pre, source=${prevHotelEffective.source || 'prev_day_hotel'})`);
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
                            if (!pt) {
                                // (2026-06-23): null 응답 → skip 대신 합성 fallback leg.
                                // 두 좌표(toStation ↔ dayHotel)는 KNOWN → 도보/택시 추정 +
                                // 네이버 길찾기 링크. UI 가 빈칸 대신 graceful 안내 표시.
                                const fb = buildBookendFallbackLeg({
                                    fromLat: toStationCoord.lat, fromLng: toStationCoord.lng,
                                    fromLabel: it.to_station,
                                    toLat: dayHotel.lat, toLng: dayHotel.lng,
                                    toLabel: dayHotel.label || 'Hotel',
                                });
                                if (fb) {
                                    it.station_to_lodging = fb;
                                    bookendFailReasons.push(`post:odsay_null_fallback_synth`);
                                    console.warn(`  - intercity bookend post ODsay null (Day ${dayPlan.day}) → synth fallback ${fb.method} ${fb.est_min}min`);
                                } else {
                                    bookendFailReasons.push(`post:odsay_null_response`);
                                    console.warn(`  - intercity bookend post ODsay returned null (Day ${dayPlan.day}) — skipping station_to_lodging (coords missing)`);
                                }
                            } else {
                            it.station_to_lodging = {
                                method: pt.method || 'subway',
                                mode: methodToMode(pt.method) || 'subway',
                                instruction: pt.summary || `Take public transit from ${it.to_station} to ${dayHotel.label || 'hotel'}`,
                                step_by_step: (pt.steps || []).map(s => s.description || s.instruction || ''),
                                steps_detail: pt.steps || [],
                                est_min: pt.duration || transitData.durationMin || 30,
                                est_fare_krw: pt.fare || 0,
                                source: 'odsay',
                                from_label: it.to_station,
                                to_label: dayHotel.label || 'Hotel',
                            };
                            }
                            // 가드 (2026-06-23): pt 가 null 이면 it.station_to_lodging 미할당 →
                            //   .est_min 읽기 throw → catch 가 post:odsay_throw 로 누적하며 leg skip.
                            //   정상 응답이면 값 동일, null 응답이면 '(skipped)' 로 graceful 로그.
                            console.log(`  - [${it.to_station}→${dayHotel.label || 'Hotel'}] ${it.station_to_lodging ? `${it.station_to_lodging.est_min}min` : '(skipped — no transit)'} (intercity bookend post)`);
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
                // (2026-06-23): synth fallback(*_fallback_synth)은 leg 를 채워 UI 빈칸을
                // 막은 GRACEFUL 케이스 → "silent fail" 알림 대상에서 제외. 실제로 leg 가
                // 비어 있는(skip) 원인만 high-severity 알림 발화.
                const hardFailReasons = bookendFailReasons.filter((r) => !r.includes('_fallback_synth'));
                if (hardFailReasons.length > 0) {
                    const fromTo = `${it.from_city || '?'}→${it.to_city || '?'}`;
                    const firstReason = hardFailReasons[0].split(':')[0] + ':' + hardFailReasons[0].split(':')[1];
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
                            `<b>reasons:</b> ${hardFailReasons.join(' | ').slice(0, 400)}`,
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
                            reasons: hardFailReasons,
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
                            // P-fix #8 (2026-06-20): stitching 성공 = day stop1 기준 실제
                            //   출발시각 도출 → 더 이상 추정값 아님. depart_estimated 해제
                            //   (있었다면). _enrichMultiCityDays 의 표준 fallback 이 셋했던
                            //   추정 마킹을 여기서 신뢰 가능한 값으로 승격.
                            if ('depart_estimated' in it) it.depart_estimated = false;
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
                        console.warn(`  ⚠ [transit ${i}] no coords + no Gemini est_min → using flat 25min fallback. Check NCP Maps 키(resolveNcpKeys) / Gemini prompt.`);
                    }

                    // 이전 장소 체류 후 이동 시간 + 버퍼
                    const prevStayMin = places[i - 1].stay_min || 60;
                    currentTime += prevStayMin + realTransitMin + BUFFER_MIN;

                    // P239 (2026-05-27): Day 1 tour_start_time floor — i==1 (lodging → 첫 활동) 만.
                    // 운영자 의도: 새벽 도착 시 lodging stops[0] 02:30 + stops[1] 09:00 (tour_start_time).
                    // currentTime (02:30 + stay 60 + transit 30 + buffer 5 = 04:05) < tour_start_time (09:00).
                    // 옛 코드: 04:05 그대로 사용 → P159 새벽 stop alert.
                    // 신 코드: max(currentTime, tour_start_time) — 04:05 → 09:00 floor 적용.
                    // 영향 영역: Day 1 의 i==1 만. Day 1 의 i>=2 는 prevStayMin chain 으로 자연 처리.
                    if (i === 1 && Number.isFinite(dayPlan._p239TourStartMin) && currentTime < dayPlan._p239TourStartMin) {
                        console.log(`  [Route] Day 1: P239 tour_start_time floor — ${this._formatTime(currentTime)} → ${this._formatTime(dayPlan._p239TourStartMin)} (lodging→첫 활동 시각 명시 lift)`);
                        currentTime = dayPlan._p239TourStartMin;
                    }

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
                    // P259 (2026-05-28): cache hit 마커 보존 — transitCache.js:121-124 가 stamp 한
                    // _fromCache + _cacheSource 가 transit_from_prev 재구성 단계에서 손실되면
                    // 모든 측정 도구가 hit rate 0% misreport (P258 lesson — plan 14c7bac1).
                    // source 도 'odsay' 하드코딩 X — cache hit 시 'cache' 분기 표시.
                    const isCacheHit = pt && pt._fromCache === true;
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
                            source: isCacheHit ? 'cache' : 'odsay',
                            // P259 (2026-05-28): cache marker 보존 의무. 누락 시 측정 false negative.
                            ...(isCacheHit ? { _fromCache: true, _cacheSource: pt._cacheSource || 'odsay_api' } : {}),
                        };
                    } else if (pt && pt.method === 'walk') {
                        place.transit_from_prev = {
                            method: 'walk',
                            mode: 'walk',
                            instruction_en: pt.summary || `Walk ${realTransitMin} min`,
                            step_by_step: [],
                            est_min: pt.duration || realTransitMin,
                            est_fare_krw: 0,
                            source: isCacheHit ? 'cache' : 'odsay',
                            // P259 (2026-05-28): walk 도 zone_courses transit_matrix 에 cache 가능 — 마커 보존.
                            ...(isCacheHit ? { _fromCache: true, _cacheSource: pt._cacheSource || 'zone_courses' } : {}),
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

            // P157 (2026-05-22): prevDayHotelCoord update 불필요 — pre-computed dayHotels[] 사용.
        };

        // P157: batch processing — DAY_CONCURRENCY days 씩 동시 처리.
        // NCP/ODsay rate limit 고려 (50 req/s NCP, ODsay 분당 quota).
        for (let batchStart = 0; batchStart < daysList.length; batchStart += DAY_CONCURRENCY) {
            const batchEnd = Math.min(batchStart + DAY_CONCURRENCY, daysList.length);
            const batchPromises = [];
            for (let i = batchStart; i < batchEnd; i++) {
                batchPromises.push(processDayFn(daysList[i], i));
            }
            await Promise.all(batchPromises);
        }

        // Layer 4: Enforce transit completeness invariant
        this._enforceTransitCompleteness(data);

        const finalJsonStr = JSON.stringify(data, null, 2);
        // Phase 3 (2026-05-27): transit cache 통계 로그 — prod log grep 으로 hit rate 추적.
        // grep: "[P228 TRANSIT_CACHE]"
        const cacheStats = getTransitCacheStats();
        console.log(`  [P228 TRANSIT_CACHE] zoneId=${zoneId || 'null'} enabled=${cacheStats.enabled} zones_loaded=${cacheStats.zoneCount}`);
        console.log("  [Route] enrichment complete (Naver + ODsay + Time Stitch + Completeness Gate + TransitCache)");
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
            // (2026-07-19) 3중 가드 — 상한/짐 구간/실소요 비교. 근거는 shouldOverrideToWalk 주석.
            const transitMin = Number.isFinite(publicTransit?.duration) ? publicTransit.duration : null;
            const canOverride = shouldOverrideToWalk({ walkMin, transitMin, fromName, toName: name });
            if (!canOverride) {
                console.log(`  ↪ [${fromName}→${name}] short leg ${havKm.toFixed(2)}km 이지만 도보 override 보류 (walk ${walkMin}min / transit ${transitMin ?? '-'}min)`);
            } else {
                // Only override when the provider didn't already say "walk".
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
        // P-fix #8 (2026-06-20): recommended_depart 는 모든 노선이 '09:00'/'08:30' 류
        //   하드코딩 = 실제 출발시각 아님(손님 첫 stop·항공권 시간과 무관). arrival_at 도
        //   양방향 동일 + est_min 과 불일치(165min 인데 08:30→11:30 = 180min). 정책:
        //   (a) arrival_at 은 표에서 빼고 depart + est_min 으로 매 assignment 시 역산
        //       → 내부 정합(08:30 + 165 = 11:15). (b) 이 값들은 estimate 라서 P113
        //       stitching(아래) 이 day stop1 기준으로 덮어쓴다. stitching 실패 시엔
        //       depart_estimated=true 로 마킹 → UI/PDF 가 "추정" 으로 표시, 손님이 이
        //       시각을 실제 열차 시간표로 오인해 KTX 놓치는 risk 차단. recommended_depart
        //       는 "오전 출발 권장" 정도의 가이드 값으로만 둔다.
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
                // P-fix #8 (2026-06-20): arrival_at = depart + est_min 역산 (표 하드코딩
                //   값은 est_min 과 불일치 — 165min 인데 08:30→11:30=180min). 내부 정합.
                const stdArrival = this._formatTime(this._parseTime(std.recommended_depart) + Number(std.est_min)) || std.arrival_at;
                d.intercity_transit = {
                    mode: std.mode,
                    from_city: prevCity,
                    to_city: dCity,
                    from_city_display: prevCity,
                    to_city_display: dCity,
                    est_min: std.est_min,
                    est_fare_krw: std.est_fare_krw,
                    recommended_depart: std.recommended_depart,
                    arrival_at: stdArrival,
                    // P-fix #8: 표준 depart/arrival 은 추정값(실제 열차 시간표 아님).
                    //   P113 stitching 이 day stop1 기준으로 덮어쓰면 false 로 내려간다.
                    //   stitching 실패 시 UI/PDF 가 "추정" 표시 → KTX 놓침 risk 차단.
                    depart_estimated: true,
                    instruction: `${prevCity} → ${dCity} via ${std.mode} (~${Math.round(std.est_min/60*10)/10}h, ₩${std.est_fare_krw.toLocaleString()})`,
                    booking_url: std.booking_url,
                    // PDF-issue-2 (2026-05-14): UI 가 intercity 전후 bookend segment 표시 가능.
                    from_station: std.from_station || null,
                    to_station: std.to_station || null,
                };
                console.log(`  [Route] multi-city Day ${d.day || i+1}: fallback intercity_transit ${std.mode} ${prevCity}→${dCity} (${std.from_station} → ${std.to_station}, depart~${std.recommended_depart} est arr ${stdArrival})`);
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
                    // P-fix #8: depart + est_min 역산 (09:00 + 120 = 11:00) + 추정 마킹.
                    arrival_at: this._formatTime(this._parseTime('09:00') + 120) || '11:00',
                    depart_estimated: true,
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
                // P330: provider-aware (ODsay 기본 / TMAP env 스위치). 출력 shape 동일.
                const result = await searchTransit(sx, sy, ex, ey);
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
     *
     * P274 (2026-05-29): SAFETY-CRITICAL — input 'ICN' (terminal 미지정) → 'ICN' 유지
     *   이전: 'ICN' (generic) → 'ICN_T1' hardcode default → ODsay 가 T1/T2 좌표 매우 가까워 (~260m)
     *     임의로 'T2' station 추천 → arrival_guide.route_to_hotel.fromStationName='인천공항2터미널'
     *     + departure_guide.airport='ICN T1' (Gemini hallucinate) = 자가 모순 (비행기 놓침 risk).
     *   현재: 'ICN' 입력은 'ICN' 그대로 유지 (constants.js AIRPORT_COORDS['ICN'] entry 활용).
     *     terminal 명시 (ICN_T1/T2) 시만 strict matching. 사용자 신고 plan 696b273d 등 4건 회귀 차단.
     */
    _normalizeAirportKey(raw) {
        if (!raw) return null;
        const k = String(raw).trim().toUpperCase().replace(/\s+/g, '_');
        if (AIRPORT_COORDS[k]) return k;
        if (k.startsWith('ICN_T1') || k === 'ICN1' || k === 'INCHEON_T1') return 'ICN_T1';
        if (k.startsWith('ICN_T2') || k === 'ICN2' || k === 'INCHEON_T2') return 'ICN_T2';
        // P274: 'ICN' (generic) → 'ICN' 유지 (이전 T1 hardcode 제거). AIRPORT_COORDS['ICN'] 활용.
        if (k.startsWith('ICN') || k === 'INCHEON') return 'ICN';
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
                    // P790: NaN 좌표면 null 반환 (함수 실패=null 계약 일관) — NaN {lat,lng} 전파 차단.
                    const gy = finiteCoord(res.data.addresses[0].y);
                    const gx = finiteCoord(res.data.addresses[0].x);
                    if (gy != null && gx != null) return { lat: gy, lng: gx };
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
        // 키 해석 = mood-route.resolveNcpKeys (SSOT) — 2026-07-27 죽은 NAVER_CLIENT_* 직독 제거.
        const { clientId: cid, clientSecret: csec } = resolveNcpKeys();
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
                // P275 (2026-05-29): ODsay station name extract — input terminal 일치 검증용.
                // 호출 site (line 632, 704) 에서 input airport key (ICN_T1/ICN_T2/ICN) 와
                // 비교 → mismatch 시 quality_warnings 박제 (P274 우회 fix 의 측정 강화).
                // ODsay steps[0] 의 startName / startX,startY 좌표 / startID — 첫 station 정보.
                // 🔴 SAFETY fix (2026-06-12): parseSubPath(_odsay_helper.js)가 emit 하는 필드는
                //    `from`/`to`(=sub.startName/endName) 이지 startName/fromName/start 가 아니다.
                //    이전엔 미존재 필드만 읽어 fromStationName/toStationName 이 항상 null →
                //    _verifyAirportStation(L446 !stationName→match:true)이 절대 발화 안 함 = P275
                //    터미널 불일치(비행기 놓침) 가드 死. 실제 필드 from/to 먼저 읽고 구필드 폴백.
                const firstStep = (pt.steps && pt.steps[0]) || null;
                const fromStationName = firstStep
                    ? (firstStep.from || firstStep.fromRoman || firstStep.startName || firstStep.fromName || null)
                    : (pt.firstStation || null);
                const lastStep = (pt.steps && pt.steps[pt.steps.length - 1]) || null;
                const toStationName = lastStep
                    ? (lastStep.to || lastStep.toRoman || lastStep.endName || lastStep.toName || null)
                    : (pt.lastStation || null);
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
                    // P275: station name 노출 — 호출 site 가 input terminal 과 verify
                    fromStationName,
                    toStationName,
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

    /**
     * P327 (2026-05-31): AREX 직통열차(Express) HERO 합성 — ICN→서울 중심부 전용.
     * ODsay 가 express 를 못 줘서(일반열차→홍대입구→2호선 79분 indirect 경로만) HERO 가 라벨
     * "AREX Express 가장 빠름" ↔ 데이터 79분 일반경로 로 자가모순이었다. 인천공항→서울역 무정차
     * 직통(고정 시간/요금) + 서울역→호텔 last-mile(실 ODsay)을 이어붙여 라벨과 일치하는 직통
     * HERO 를 만든다. buildPrompt 변경 0 (백엔드 합성, Gemini 안 거침 = cache miss 0).
     * 게이트 밖(비-ICN / 서울역 6km 초과 / last-mile 실패)이면 null → 호출부가 기존 route 유지(안전).
     * @returns {Promise<object|null>} route_to_hotel 호환 객체 또는 null
     */
    async _buildArexExpressHero(arrivalAirportKey, destCoord, clientId, clientSecret) {
        const ax = AREX_EXPRESS[arrivalAirportKey];
        const seoul = STATION_COORDS['서울역'];
        if (!ax || !seoul || !destCoord || destCoord.lat == null || destCoord.lng == null) return null;
        // 중심부 게이트: 서울역 반경 이내만 (명동/종로/중구/마포 등). 그 밖은 기존 route 유지.
        const kmFromSeoulStn = _haversineKmPure(seoul.lat, seoul.lng, destCoord.lat, destCoord.lng);
        if (!(kmFromSeoulStn <= AREX_EXPRESS_MAX_KM_FROM_SEOUL_STN)) return null;
        // last-mile: 서울역 → 호텔 (실 ODsay — 명동=4호선 2정거장 등).
        let lastMile = await this._routeAirportHotel({ lat: seoul.lat, lng: seoul.lng }, destCoord, 'arrival');
        if (!lastMile) {
            // P-launch (2026-05-31): ODsay 가 서울역→목적지(짧은 거리) 경로를 안 주는 dead-band(1.5~6km)
            //   에선 직통 HERO 가 null → indirect 79분 + arex_express 라벨 모순(plan db7fae92) 재발.
            //   ~2.5km 이내면 도보 last-mile 합성해 직통을 살린다. 그 밖은 기존 route 유지(안전).
            if (kmFromSeoulStn <= 2.5) {
                const walkM = Math.round(kmFromSeoulStn * 1000 * 1.3);
                const walkMin = Math.max(3, Math.round(walkM / 70));
                lastMile = {
                    method: 'walk', mode: 'walk', instruction: `서울역 → 목적지 도보 약 ${walkMin}분`,
                    step_by_step: [`도보 약 ${walkMin}분 (약 ${walkM}m)`],
                    steps_detail: [{ mode: 'walk', duration: walkMin, distance: walkM, from: '서울역', to: '목적지' }],
                    transfers: 0, total_walk_m: walkM, est_min: walkMin, est_fare_krw: 0,
                    source: 'walk_synth', direction: 'arrival', fromStationName: null, toStationName: null,
                };
            } else {
                return null;
            }
        }
        const lastIsWalk = lastMile.method === 'walk';
        const fare = AREX_EXPRESS_FARE_KRW;
        // 직통 구간 step (rich card 용 — SubwayStep 최소 필드. stationCount:0 = 무정차).
        const expressStep = {
            mode: 'subway',
            line: 'AREX 직통', lineKo: 'AREX 직통(공항철도)', lineEn: 'AREX Express',
            from: ax.from_station, fromRoman: 'Incheon Airport',
            to: '서울역', toRoman: 'Seoul Station',
            duration: ax.express_min,
            stationCount: 0,
        };
        const totalMin = ax.express_min + (lastMile.est_min || 0);
        const totalFare = fare + (lastMile.est_fare_krw || 0);
        // 환승 횟수: 서울역에서 last-mile 로 갈아탐(직통 자체는 무정차 0환승). 도보 last-mile 이면 환승 0.
        const transfers = lastIsWalk ? 0 : (lastMile.transfers || 0) + 1;
        return {
            method: 'subway',
            mode: 'subway',
            instruction: `🚄 AREX 직통 ${ax.from_station}→서울역 ${ax.express_min}분(무정차) → 서울역→목적지 ${lastMile.est_min || 0}분`,
            step_by_step: [
                `AREX 직통열차: ${ax.from_station} → 서울역 (${ax.express_min}분, 무정차·지정좌석, ₩${fare.toLocaleString()})`,
                ...(lastMile.step_by_step || []),
            ],
            steps_detail: [expressStep, ...(lastMile.steps_detail || [])],
            transfers,
            total_walk_m: lastMile.total_walk_m || 0,
            est_min: totalMin,
            est_fare_krw: totalFare,
            source: 'arex_express_synth', // P327 합성 마커 (source!=='naver_fallback' → fallback 경고 미노출)
            direction: 'arrival',
            fromStationName: ax.from_station, // P274/P275 가드 통과 (인천공항N터미널역 → terminal match)
            toStationName: lastMile.toStationName || null,
            _arex_express: true, // 측정/디버깅 마커
        };
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
