// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – Trip.com 어필리에이트 링크 빌더
// Allianceid: 4831212 / SID: 76964637
// ─────────────────────────────────────────────────────────────────────────────

const TRIP_AFF = 'Allianceid=4831212&SID=76964637&trip_sub1=cocotrip';

export const AFFILIATE_CONFIG = {
  tripcom: {
    hotel:    'https://www.trip.com/hotels/list',
    flight:   'https://www.trip.com/flights',
    activity: 'https://www.trip.com/travel-guide',
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

/* ── Hotels ──────────────────────────────────────────── */
export function buildAccommodationLinks(hotelName: string, region: string) {
  const cityId = CITY_IDS[region] ?? CITY_IDS.Seoul;
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

/* ── Flights ─────────────────────────────────────────── */
export function buildFlightLink(destinationCode: string) {
  const cityCodeMap: Record<string, string> = {
    ICN: 'Seoul', GMP: 'Seoul', PUS: 'Busan', CJU: 'Jeju',
    ICN_T1: 'Seoul', ICN_T2: 'Seoul', ALREADY: 'Seoul',
  };
  const dest = cityCodeMap[destinationCode] || 'Seoul';
  return {
    label: 'Trip.com Flights',
    url: `${AFFILIATE_CONFIG.tripcom.flight}?dcity=&acity=${encodeURIComponent(dest)}&${TRIP_AFF}`,
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

/* ── Car Rentals ─────────────────────────────────────── */
export function buildCarLink(city: string) {
  return {
    label: 'Trip.com Car Rental',
    url: `${AFFILIATE_CONFIG.tripcom.car}?pickup=${encodeURIComponent(city)}&${TRIP_AFF}`,
  };
}

/* ── Airport Pickup Prices (own service) ─────────────── */
export const PICKUP_PRICES: Record<string, { destination: string; price: string }[]> = {
  ICN: [
    { destination: '서울 도심', price: '₩124,800' },
    { destination: '강남/잠실', price: '₩145,600' },
    { destination: '가평/남이섬', price: '₩208,000' },
  ],
  GMP: [
    { destination: '서울 도심', price: '₩83,200' },
    { destination: '강남/잠실', price: '₩93,600' },
  ],
  PUS: [{ destination: '부산 시내', price: '₩83,200' }],
  CJU: [{ destination: '제주 시내', price: '₩72,800' }],
};
