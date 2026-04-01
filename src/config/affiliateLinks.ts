export const AFFILIATE_CONFIG = {
  booking: {
    baseUrl: 'https://www.booking.com/searchresults.html',
    aid: import.meta.env.VITE_BOOKING_AID || '',
  },
  agoda: {
    baseUrl: 'https://www.agoda.com/search',
    cid: import.meta.env.VITE_AGODA_CID || '',
  },
  expedia: {
    baseUrl: 'https://www.expedia.com/Hotel-Search',
    affcid: import.meta.env.VITE_EXPEDIA_AFFCID || '1110l29051',
  },
  klook: {
    baseUrl: 'https://www.klook.com/search/',
    aid: import.meta.env.VITE_KLOOK_AID || '',
  },
  viator: {
    baseUrl: 'https://www.viator.com/search/',
    pid: import.meta.env.VITE_VIATOR_PID || '',
  },
  skyscanner: {
    baseUrl: 'https://www.skyscanner.co.kr/transport/flights/',
    aid: import.meta.env.VITE_SKYSCANNER_AID || '',
  },
};

export function buildAccommodationLinks(hotelName: string, region: string) {
  const query = encodeURIComponent(`${hotelName} ${region}`);
  const links: { provider: string; label: string; url: string; color: string }[] = [];

  if (AFFILIATE_CONFIG.booking.aid) {
    links.push({
      provider: 'booking',
      label: 'Booking.com',
      url: `${AFFILIATE_CONFIG.booking.baseUrl}?ss=${query}&aid=${AFFILIATE_CONFIG.booking.aid}`,
      color: '#003580',
    });
  }
  if (AFFILIATE_CONFIG.agoda.cid) {
    links.push({
      provider: 'agoda',
      label: 'Agoda',
      url: `${AFFILIATE_CONFIG.agoda.baseUrl}?q=${query}&cid=${AFFILIATE_CONFIG.agoda.cid}`,
      color: '#5C2D91',
    });
  }
  if (AFFILIATE_CONFIG.expedia.affcid) {
    links.push({
      provider: 'expedia',
      label: 'Expedia',
      url: `${AFFILIATE_CONFIG.expedia.baseUrl}?destination=${query}&AFFCID=${AFFILIATE_CONFIG.expedia.affcid}`,
      color: '#FBCE04',
    });
  }
  return links;
}

export function buildTourLinks(placeName: string, region: string) {
  const query = encodeURIComponent(`${placeName} ${region}`);
  const links: { provider: string; label: string; url: string }[] = [];

  if (AFFILIATE_CONFIG.klook.aid) {
    links.push({
      provider: 'klook',
      label: 'Klook',
      url: `${AFFILIATE_CONFIG.klook.baseUrl}?query=${query}&aff_adid=${AFFILIATE_CONFIG.klook.aid}`,
    });
  }
  if (AFFILIATE_CONFIG.viator.pid) {
    links.push({
      provider: 'viator',
      label: 'Viator',
      url: `${AFFILIATE_CONFIG.viator.baseUrl}${query}?pid=${AFFILIATE_CONFIG.viator.pid}`,
    });
  }
  return links;
}

export function buildFlightLink(destinationCode: string) {
  if (!AFFILIATE_CONFIG.skyscanner.aid) return null;
  const cityCodeMap: Record<string, string> = {
    ICN: 'SEL', GMP: 'SEL', PUS: 'PUS', CJU: 'CJU',
  };
  const cityCode = cityCodeMap[destinationCode] || 'SEL';
  return {
    label: 'Skyscanner',
    url: `${AFFILIATE_CONFIG.skyscanner.baseUrl}anywhere/${cityCode}/?associateId=${AFFILIATE_CONFIG.skyscanner.aid}`,
  };
}

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
