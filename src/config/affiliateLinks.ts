const EXPEDIA_AFFCID = import.meta.env.VITE_EXPEDIA_AFFCID || '1110l29051';

export const AFFILIATE_CONFIG = {
  expedia: {
    hotel:    'https://www.expedia.com/Hotel-Search',
    flight:   'https://www.expedia.com/Flights',
    activity: 'https://www.expedia.com/things-to-do/search',
    car:      'https://www.expedia.com/carsearch',
    package:  'https://www.expedia.com/Vacation-Packages',
    affcid:   EXPEDIA_AFFCID,
  },
};

/* ── Hotels ──────────────────────────────────────────── */
export function buildAccommodationLinks(hotelName: string, region: string) {
  const query = encodeURIComponent(`${hotelName} ${region}`);
  return [
    {
      provider: 'expedia',
      label: 'Expedia Hotels',
      url: `${AFFILIATE_CONFIG.expedia.hotel}?destination=${query}&AFFCID=${EXPEDIA_AFFCID}`,
      color: '#FBCE04',
    },
  ];
}

/* ── Flights ─────────────────────────────────────────── */
export function buildFlightLink(destinationCode: string) {
  const cityCodeMap: Record<string, string> = {
    ICN: 'Seoul (ICN)', GMP: 'Seoul (GMP)', PUS: 'Busan (PUS)', CJU: 'Jeju (CJU)',
    ICN_T1: 'Seoul (ICN)', ICN_T2: 'Seoul (ICN)', ALREADY: 'Seoul',
  };
  const dest = cityCodeMap[destinationCode] || 'Seoul (ICN)';
  return {
    label: 'Expedia Flights',
    url: `${AFFILIATE_CONFIG.expedia.flight}?trip=roundtrip&leg1=to:${encodeURIComponent(dest)}&AFFCID=${EXPEDIA_AFFCID}`,
  };
}

/* ── Activities / Tours ──────────────────────────────── */
export function buildTourLinks(placeName: string, region: string) {
  const query = encodeURIComponent(`${placeName} ${region}`);
  return [
    {
      provider: 'expedia',
      label: 'Expedia Activities',
      url: `${AFFILIATE_CONFIG.expedia.activity}?location=${query}&AFFCID=${EXPEDIA_AFFCID}`,
    },
  ];
}

/* ── Car Rentals ─────────────────────────────────────── */
export function buildCarLink(city: string) {
  return {
    label: 'Expedia Car Rental',
    url: `${AFFILIATE_CONFIG.expedia.car}?pickUpPlace=${encodeURIComponent(city)}&AFFCID=${EXPEDIA_AFFCID}`,
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
