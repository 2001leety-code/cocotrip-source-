export interface KpopConcert {
  id: string;
  artist: string;
  tourName: string;
  venue: string;
  venueKo: string;
  location: string;
  locationKo: string;
  dates: string[];
  dateDisplay: string;
  dateDisplayKo: string;
  shuttleAvailable: boolean;
  pickupPoints: string[];
  pickupPointsKo: string[];
  oneWayPrice: number;
  roundTripPrice: number;
  note: string;
  noteKo: string;
  naverMapUrl: string;
  highlight: boolean;
  soldOut: boolean;
}

export const KPOP_CONCERTS: KpopConcert[] = [
  {
    id: 'bts-goyang-1',
    artist: 'BTS',
    tourName: "BTS WORLD TOUR 'ARIRANG'",
    venue: 'Goyang Sports Complex Main Stadium',
    venueKo: '고양종합운동장 주경기장',
    location: 'Goyang, Gyeonggi-do',
    locationKo: '경기도 고양시',
    dates: ['2026-04-09', '2026-04-11', '2026-04-12'],
    dateDisplay: 'Apr 9, 11, 12, 2026',
    dateDisplayKo: '2026년 4월 9, 11, 12일',
    shuttleAvailable: true,
    pickupPoints: ['Hongdae', 'Myeongdong', 'Gangnam', 'Sinchon'],
    pickupPointsKo: ['홍대', '명동', '강남', '신촌'],
    oneWayPrice: 35000,
    roundTripPrice: 65000,
    note: 'Sold out — shuttle available for ticket holders',
    noteKo: '티켓 매진 — 티켓 보유자 셔틀 운행',
    naverMapUrl: 'https://map.naver.com/v5/search/%EA%B3%A0%EC%96%91%EC%A2%85%ED%95%A9%EC%9A%B4%EB%8F%99%EC%9E%A5',
    highlight: true,
    soldOut: true,
  },
  {
    id: 'inspire-apr-2026',
    artist: 'K-pop Artists',
    tourName: 'INSPIRE Arena Concert',
    venue: 'INSPIRE Arena',
    venueKo: '인스파이어 아레나',
    location: 'Incheon (near Airport)',
    locationKo: '인천 (공항 인근)',
    dates: ['2026-04-17', '2026-04-18', '2026-04-19'],
    dateDisplay: 'Apr 17-19, 2026',
    dateDisplayKo: '2026년 4월 17~19일',
    shuttleAvailable: true,
    pickupPoints: ['Hongdae', 'Myeongdong', 'Gangnam'],
    pickupPointsKo: ['홍대', '명동', '강남'],
    oneWayPrice: 35000,
    roundTripPrice: 65000,
    note: 'Near Incheon Airport — perfect for departure day',
    noteKo: '인천공항 인근 — 귀국 당일 관람 추천',
    naverMapUrl: 'https://map.naver.com/v5/search/%EC%9D%B8%EC%8A%A4%ED%8C%8C%EC%9D%B4%EC%96%B4%EC%95%84%EB%A0%88%EB%82%98',
    highlight: false,
    soldOut: false,
  },
  {
    id: 'ioi-jamsil-2026',
    artist: 'I.O.I',
    tourName: '2026 I.O.I Concert Tour: LOOP in SEOUL',
    venue: 'Jamsil Indoor Stadium',
    venueKo: '잠실실내체육관',
    location: 'Jamsil, Seoul',
    locationKo: '서울 잠실',
    dates: ['2026-05-29', '2026-05-30', '2026-05-31'],
    dateDisplay: 'May 29-31, 2026',
    dateDisplayKo: '2026년 5월 29~31일',
    shuttleAvailable: true,
    pickupPoints: ['Hongdae', 'Myeongdong', 'Gangnam'],
    pickupPointsKo: ['홍대', '명동', '강남'],
    oneWayPrice: 35000,
    roundTripPrice: 65000,
    note: 'I.O.I reunion concert',
    noteKo: 'I.O.I 재결합 콘서트',
    naverMapUrl: 'https://map.naver.com/v5/search/%EC%9E%A0%EC%8B%A4%EC%8B%A4%EB%82%B4%EC%B2%B4%EC%9C%A1%EA%B4%80',
    highlight: false,
    soldOut: false,
  },
  {
    id: 'myk-festa-kspo',
    artist: 'WayV, aespa, ITZY',
    tourName: 'MyK Festa K-POP Concert',
    venue: 'KSPO Dome',
    venueKo: 'KSPO돔',
    location: 'Olympic Park, Seoul',
    locationKo: '서울 올림픽공원',
    dates: ['2026-06-12', '2026-06-13'],
    dateDisplay: 'Jun 12-13, 2026',
    dateDisplayKo: '2026년 6월 12~13일',
    shuttleAvailable: true,
    pickupPoints: ['Hongdae', 'Myeongdong', 'Gangnam'],
    pickupPointsKo: ['홍대', '명동', '강남'],
    oneWayPrice: 35000,
    roundTripPrice: 65000,
    note: 'WayV, aespa, ITZY and more',
    noteKo: 'WayV, aespa, ITZY 등 출연',
    naverMapUrl: 'https://map.naver.com/v5/search/KSPO%EB%8F%94',
    highlight: false,
    soldOut: false,
  },
];

/** Filter out concerts whose last date has passed */
export function getUpcomingConcerts(): KpopConcert[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return KPOP_CONCERTS.filter(c => {
    const lastDate = new Date(c.dates[c.dates.length - 1]);
    lastDate.setHours(23, 59, 59, 999);
    return lastDate >= today;
  });
}
