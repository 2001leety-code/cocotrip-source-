// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – Trip.com 어필리에이트 링크 빌더
// 기본 Allianceid: 4831212 / SID: 76964637 (운영자 본 계정 — 5/8 시점)
//
// 2026-05-08: env-based override 추가.
//   - VITE_TRIPCOM_AFFILIATE_ID  → Allianceid (필수, 미설정 시 기존 4831212 사용)
//   - VITE_TRIPCOM_SID           → SID (선택)
//   - VITE_TRIPCOM_SUB1          → trip_sub1 트래킹 (선택, 기본 'cocotrip')
//
// 어필리에이트 ID 변경 시 (예: 새 Trip.com 계정으로 마이그레이션) Vercel env 만 변경 후 재배포.
//
// 운영자 액션 필요:
//   1. https://www.trip.com/partners/affiliate Trip.com Affiliate Partners 가입
//   2. Allianceid + SID 발급
//   3. Vercel Dashboard → Project Settings → Environment Variables 등록
//   4. 재배포
// ─────────────────────────────────────────────────────────────────────────────

function buildTripAff(): string {
  const env = import.meta.env;
  const allianceId = ((env.VITE_TRIPCOM_AFFILIATE_ID as string | undefined)?.trim()) || '4831212';
  const sid = ((env.VITE_TRIPCOM_SID as string | undefined)?.trim()) || '76964637';
  const sub1 = ((env.VITE_TRIPCOM_SUB1 as string | undefined)?.trim()) || 'cocotrip';
  return `Allianceid=${encodeURIComponent(allianceId)}&SID=${encodeURIComponent(sid)}&trip_sub1=${encodeURIComponent(sub1)}`;
}

const TRIP_AFF = buildTripAff();

export const AFFILIATE_CONFIG = {
  tripcom: {
    hotel:    'https://www.trip.com/hotels/list',
    flight:   'https://www.trip.com/flights',
    activity: 'https://www.trip.com/travel-guide',
    // 2026-05-09 batch 9: Trip.com 카테고리 확장 (eSIM/Activities/Trains).
    attraction: 'https://www.trip.com/things-to-do/list',  // 입장권·체험 (Activities)
    sim:      'https://www.trip.com/sim-cards/list',       // eSIM
    train:    'https://www.trip.com/trains/list',          // KTX/SRT
    car:      'https://www.trip.com/carhire',
    package:  'https://www.trip.com/packages',
  },
};

// Trip.com 도시 ID 매핑
const CITY_IDS: Record<string, number> = {
  Seoul: 274,
  Busan: 759,
  Jeju: 1649,
  Gyeongju: 3786,
  Chuncheon: 3791,
  Danyang: 238,
  Incheon: 3701,
};

// Wizard cityKey (lowercase) → CITY_IDS key. Wizard sends 'seoul'/'busan'/etc.
const CITY_KEY_TO_REGION: Record<string, string> = {
  seoul: 'Seoul',
  busan: 'Busan',
  jeju: 'Jeju',
  gyeongju: 'Gyeongju',
  incheon: 'Incheon',
  chuncheon: 'Chuncheon',
  danyang: 'Danyang',
};

// Korean city names — used as the keyword fallback when we don't have a
// Trip.com numeric city ID. Trip.com's keyword search resolves "전주 한옥마을"
// to Jeonju + the requested district even without city=…, so this keeps the
// CTA usable for cities outside CITY_IDS.
const CITY_KEY_TO_KO: Record<string, string> = {
  seoul: '서울',
  busan: '부산',
  jeju: '제주',
  gyeongju: '경주',
  jeonju: '전주',
  gangneung: '강릉',
  incheon: '인천',
  suwon: '수원',
  yeosu: '여수',
  daegu: '대구',
  chuncheon: '춘천',
  danyang: '단양',
};

/* ── Hotels ──────────────────────────────────────────── */
export function buildAccommodationLinks(hotelName: string, region: string) {
  const cityId = CITY_IDS[region] != null ? CITY_IDS[region] : CITY_IDS.Seoul;
  const keyword = encodeURIComponent(hotelName);
  return [
    {
      provider: 'tripcom',
      label: 'Trip.com Hotels',
      url: `${AFFILIATE_CONFIG.tripcom.hotel}?city=${cityId}&keyword=${keyword}&${TRIP_AFF}`,
      color: '#0073E6',
    },
  ];
}

/**
 * Build a Trip.com hotel-search link pre-filtered to a specific zone (district).
 * Used by WizardForm/ZoneRecommender so users without a booked hotel can browse
 * deals in their selected zone before submitting the AI plan.
 *
 * For cities with a known numeric `city=` ID (Seoul/Busan/Jeju/Gyeongju/Incheon),
 * we narrow by city + keyword. For cities without an ID (Jeonju/Gangneung/Suwon/
 * Yeosu/Daegu), we fall back to a keyword-only search prefixed with the Korean
 * city name, which Trip.com resolves correctly to that city.
 *
 * @param zoneKoName  Korean district name (e.g. "명동", "홍대"). Trip.com matches
 *                    Korean keywords on Korean cities cleanly — passing the en
 *                    name often returns mixed-city results.
 * @param cityKey     Wizard cityKey, lowercase (e.g. "seoul", "busan").
 */
export function buildZoneHotelLink(zoneKoName: string, cityKey: string): string {
  const region = CITY_KEY_TO_REGION[cityKey];
  const cityId = region != null ? CITY_IDS[region] : undefined;
  if (cityId != null) {
    const keyword = encodeURIComponent(zoneKoName);
    return `${AFFILIATE_CONFIG.tripcom.hotel}?city=${cityId}&keyword=${keyword}&${TRIP_AFF}`;
  }
  // Keyword-only fallback: prefix with Korean city name so Trip.com resolves
  // the right city. e.g. "전주 한옥마을" → Jeonju Hanok Village hotels.
  const cityKo = CITY_KEY_TO_KO[cityKey] || '';
  const keyword = encodeURIComponent(`${cityKo} ${zoneKoName}`.trim());
  return `${AFFILIATE_CONFIG.tripcom.hotel}?keyword=${keyword}&${TRIP_AFF}`;
}

/**
 * Trip.com 호텔 리스트 링크 (도시 단위, 키워드 없음).
 * 투어 페이지 하단 "숙소 비교" 소형 CTA 용 — 도시 ID 가 있으면 city= 로 좁히고,
 * 없으면(All/기타) 어필리에이트 파라미터만 붙인 전체 리스트로 폴백.
 *
 * @param cityKey  lowercase cityKey (e.g. "seoul"). 생략/미매칭 시 전체 리스트.
 */
export function buildHotelListLink(cityKey?: string): string {
  const region = cityKey ? CITY_KEY_TO_REGION[cityKey] : undefined;
  const cityId = region != null ? CITY_IDS[region] : undefined;
  if (cityId != null) {
    return `${AFFILIATE_CONFIG.tripcom.hotel}?city=${cityId}&${TRIP_AFF}`;
  }
  return `${AFFILIATE_CONFIG.tripcom.hotel}?${TRIP_AFF}`;
}

/* ── Flights ─────────────────────────────────────────── */
// Default departure city by user language
const DEFAULT_DCITY: Record<string, string> = {
  ko: 'Seoul', ja: 'Tokyo', zh: 'Shanghai', en: 'Los Angeles',
};

export function buildFlightLink(destinationCode: string, language?: string) {
  const cityCodeMap: Record<string, string> = {
    ICN: 'Seoul', GMP: 'Seoul', PUS: 'Busan', CJU: 'Jeju',
    ICN_T1: 'Seoul', ICN_T2: 'Seoul', ALREADY: 'Seoul',
  };
  const dest = cityCodeMap[destinationCode] || 'Seoul';
  const dcity = DEFAULT_DCITY[language || 'ko'] || 'Seoul';
  return {
    label: 'Trip.com Flights',
    url: `${AFFILIATE_CONFIG.tripcom.flight}?dcity=${encodeURIComponent(dcity)}&acity=${encodeURIComponent(dest)}&${TRIP_AFF}`,
  };
}

/* ── Activities / Tours ──────────────────────────────── */
export function buildTourLinks(placeName: string, region: string) {
  const query = encodeURIComponent(`${placeName} ${region}`);
  return [
    {
      provider: 'tripcom',
      label: 'Trip.com Activities',
      url: `${AFFILIATE_CONFIG.tripcom.activity}?keyword=${query}&${TRIP_AFF}`,
    },
  ];
}

/* ── Attractions / Tickets (입장권·체험) ───────────────── */
/**
 * Trip.com 입장권/체험(things-to-do) 검색 링크.
 * AI 플랜의 culture / landmark / kpop 카테고리 stop 카드에서 활용.
 *
 * @param placeName  사용자 언어 표시명 (e.g. "Gyeongbokgung Palace", "경복궁")
 *                   한국어 stop 의 경우 한국어명 그대로 사용 — Trip.com 영문/한글 모두 인식.
 * @param cityKey    Wizard cityKey (lowercase, e.g. "seoul"). 도시명을 키워드 prefix 로 추가해
 *                   다른 도시 동명 명소 매칭률 ↓.
 */
export function buildAttractionLink(placeName: string, cityKey?: string): string {
  const cityKo = cityKey ? (CITY_KEY_TO_KO[cityKey] || '') : '';
  const keyword = encodeURIComponent(cityKo ? `${cityKo} ${placeName}`.trim() : placeName);
  return `${AFFILIATE_CONFIG.tripcom.attraction}?keyword=${keyword}&${TRIP_AFF}`;
}

/* ── eSIM (Trip.com 단일) ─────────────────────────────── */
/**
 * Trip.com eSIM 검색 링크 — Korea destination 고정.
 * batch 9: Airalo/Yesim 별도 가입 회피 → Trip.com 단일화.
 */
export function buildEsimLink(): string {
  return `${AFFILIATE_CONFIG.tripcom.sim}?keyword=${encodeURIComponent('Korea')}&${TRIP_AFF}`;
}

/* ── Trains (KTX/SRT) ─────────────────────────────────── */
// Trip.com Trains 도시명 매핑 — Trip.com Trains 검색은 영문 도시명 키워드 인식.
const CITY_KEY_TO_TRAIN_EN: Record<string, string> = {
  seoul: 'Seoul',
  busan: 'Busan',
  jeju: 'Jeju',
  gyeongju: 'Gyeongju',
  jeonju: 'Jeonju',
  gangneung: 'Gangneung',
  daegu: 'Daegu',
  yeosu: 'Yeosu',
  suwon: 'Suwon',
  chuncheon: 'Chuncheon',
  danyang: 'Danyang',
  incheon: 'Incheon',
};

/**
 * Trip.com 기차(KTX/SRT) 검색 링크.
 * 출발/도착 도시가 명확하면 dcity/acity, 1개 도시뿐이면 keyword=Korea KTX fallback.
 *
 * @param fromCityKey  출발 도시 (lowercase wizard cityKey)
 * @param toCityKey    도착 도시 (선택)
 */
export function buildTrainLink(fromCityKey?: string, toCityKey?: string): string {
  const dcity = fromCityKey ? CITY_KEY_TO_TRAIN_EN[fromCityKey] : '';
  const acity = toCityKey ? CITY_KEY_TO_TRAIN_EN[toCityKey] : '';
  if (dcity && acity && dcity !== acity) {
    return `${AFFILIATE_CONFIG.tripcom.train}?dcity=${encodeURIComponent(dcity)}&acity=${encodeURIComponent(acity)}&${TRIP_AFF}`;
  }
  return `${AFFILIATE_CONFIG.tripcom.train}?keyword=${encodeURIComponent('Korea KTX')}&${TRIP_AFF}`;
}

/* ── Car Rentals ─────────────────────────────────────── */
export function buildCarLink(city: string) {
  return {
    label: 'Trip.com Car Rental',
    url: `${AFFILIATE_CONFIG.tripcom.car}?pickup=${encodeURIComponent(city)}&${TRIP_AFF}`,
  };
}

/* ── Airport Pickup Prices (own service) ─────────────── */
// 옵션 C-FINAL (2026-05-12): SSOT 단일화 — pricing_spec.json:airport_transfer_prices 에서 동적 import.
//   기존 hardcode (PUS/GMP/ICN/CJU 4 도시 × 8개 가격) → SSOT 자동 매핑.
//   PR #381 의 PUS=₩77K / GMP 90K/100K / busan=₩660K 변경 시 SSOT 1 곳만 수정.
// 사용처: 현재 UI 소비자 없음(2026-07-26, AirportPickupCard 삭제). 가격 파리티 테스트
//   tests/unit/charterPricing.test.ts 가 SSOT 대조용으로 사용하므로 유지한다.
//
// 매핑 규칙: 공항 코드 → AIRPORT_TRANSFER_PRICES 의 키 목록 + 한국어 라벨.
//   각 항목은 productType 변환 (createPaypalOrder.js `airport_<key>` 규약) 도 가능하도록 key 보존.
import { AIRPORT_TRANSFER_PRICES } from '@/data/charterPricing';

type AirportPickupRoute = { destination: string; key: string; price: string };

const PICKUP_ROUTES_BY_AIRPORT: Record<string, { destination: string; key: string }[]> = {
  ICN: [
    { destination: '서울 도심', key: 'seoul-central' },
    { destination: '강남/잠실', key: 'seoul-gangnam' },
    { destination: '가평/남이섬', key: 'gapyeong-nami' },
    { destination: '수원·용인', key: 'suwon-yongin' },
    { destination: '춘천', key: 'chuncheon' },
  ],
  GMP: [
    { destination: '서울 도심', key: 'gimpo-seoul-central' },
    { destination: '강남/잠실', key: 'gimpo-seoul-gangnam' },
  ],
  PUS: [{ destination: '부산 시내', key: 'busan-metro' }],
  CJU: [{ destination: '제주 시내', key: 'jeju-metro' }],
};

function formatKRW(amount: number): string {
  return `₩${amount.toLocaleString('en-US')}`;
}

function buildPickupPrices(): Record<string, AirportPickupRoute[]> {
  const out: Record<string, AirportPickupRoute[]> = {};
  for (const [airport, routes] of Object.entries(PICKUP_ROUTES_BY_AIRPORT)) {
    out[airport] = routes
      .map(r => {
        const entry = AIRPORT_TRANSFER_PRICES[r.key];
        if (!entry) return null; // SSOT 누락 시 항목 생략 (안전)
        return { destination: r.destination, key: r.key, price: formatKRW(entry.priceKRW) };
      })
      .filter((r): r is AirportPickupRoute => r != null);
  }
  return out;
}

export const PICKUP_PRICES: Record<string, AirportPickupRoute[]> = buildPickupPrices();
