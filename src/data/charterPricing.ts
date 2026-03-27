// src/data/charterPricing.ts
// 코코트립 스타리아 전세차량 요금표 (최대 8인승)
// 모든 요금 VAT 포함

export const VEHICLE_INFO = {
  name: '현대 스타리아',
  maxPassengers: 8,
  features: ['최대 8인 탑승', '대형 캐리어 수납 가능', '전좌석 프리미엄 시트', '영어 소통 가능 기사'],
};

// ────────────────────────────────────────
// 공항 픽업/샌딩 요금 (편도, 차량 1대)
// ────────────────────────────────────────
export const AIRPORT_TRANSFER_PRICES: Record<string, {
  ko: string; en: string; priceKRW: number; priceUSD: number; durationMin: number;
}> = {
  'seoul-central': {
    ko: '서울 도심 (명동·홍대·종로·용산)',
    en: 'Seoul City Center (Myeongdong, Hongdae, Jongno)',
    priceKRW: 124800,
    priceUSD: 90,
    durationMin: 60,
  },
  'seoul-gangnam': {
    ko: '서울 강남·잠실·송파',
    en: 'Seoul Gangnam / Jamsil / Songpa',
    priceKRW: 145600,
    priceUSD: 105,
    durationMin: 80,
  },
  'suwon-yongin': {
    ko: '수원·용인',
    en: 'Suwon / Yongin',
    priceKRW: 150000,
    priceUSD: 115,
    durationMin: 90,
  },
  'gapyeong-nami': {
    ko: '가평·남이섬',
    en: 'Gapyeong / Nami Island',
    priceKRW: 208000,
    priceUSD: 150,
    durationMin: 110,
  },
  'chuncheon': {
    ko: '춘천',
    en: 'Chuncheon',
    priceKRW: 220000,
    priceUSD: 165,
    durationMin: 120,
  },
  'pyeongchang-yongpyong': {
    ko: '평창·용평·알펜시아',
    en: 'Pyeongchang / Yongpyong / Alpensia',
    priceKRW: 332800,
    priceUSD: 240,
    durationMin: 160,
  },
  'gangneung-sokcho': {
    ko: '강릉·속초',
    en: 'Gangneung / Sokcho',
    priceKRW: 364000,
    priceUSD: 265,
    durationMin: 180,
  },
  'busan': {
    ko: '부산 (직행)',
    en: 'Busan (Direct)',
    priceKRW: 600000,
    priceUSD: 450,
    durationMin: 270,
  },
};

// ────────────────────────────────────────
// 일일 전세 투어 요금 (서울 출발, 차량 1대)
// ────────────────────────────────────────
export const DAILY_TOUR_PRICES: Record<string, {
  ko: string; en: string;
  priceKRW: number; priceUSD: number;
  hours: number;
  spots: string[];
  keywords: string[];
}> = {
  'seoul-city': {
    ko: '서울 시내 투어',
    en: 'Seoul City Tour',
    priceKRW: 291200,
    priceUSD: 210,
    hours: 8,
    spots: ['경복궁', '홍대', '명동', '북촌', '인사동', '성수', '한강'],
    keywords: ['seoul', '서울', 'gyeongbokgung', 'hongdae', 'myeongdong', 'bukchon'],
  },
  'seoul-suburb': {
    ko: '서울 근교 투어 (남이섬·가평·수원)',
    en: 'Seoul Suburb Tour (Nami Island, Gapyeong, Suwon)',
    priceKRW: 343200,
    priceUSD: 250,
    hours: 8,
    spots: ['남이섬', '가평', '알파카월드', '수원화성', '레일바이크', '쁘띠프랑스', '아침고요수목원'],
    keywords: ['nami', '남이섬', 'alpaca', '알파카', 'suwon', '수원', 'gapyeong', '가평', 'railbike', '레일바이크'],
  },
  'dmz': {
    ko: 'DMZ 투어',
    en: 'DMZ Tour',
    priceKRW: 343200,
    priceUSD: 250,
    hours: 8,
    spots: ['DMZ', '임진각', '제3땅굴', '도라산역', '파주'],
    keywords: ['dmz', '비무장지대', 'imjingak', '임진각', 'panmunjom', '판문점'],
  },
  'gangwon': {
    ko: '강원도 당일 투어 (춘천·강릉·속초)',
    en: 'Gangwon Day Tour (Chuncheon, Gangneung, Sokcho)',
    priceKRW: 436800,
    priceUSD: 315,
    hours: 10,
    spots: ['춘천', '강릉', '속초', '설악산', '경포대', '정동진'],
    keywords: ['chuncheon', '춘천', 'gangneung', '강릉', 'sokcho', '속초', 'seoraksan', '설악산'],
  },
  'ski-resort': {
    ko: '스키 리조트 투어 (용평·알펜시아·하이원)',
    en: 'Ski Resort Tour (Yongpyong, Alpensia, High1)',
    priceKRW: 416000,
    priceUSD: 300,
    hours: 10,
    spots: ['용평', '알펜시아', '하이원', '비발디파크', '평창'],
    keywords: ['yongpyong', '용평', 'alpensia', '알펜시아', 'ski', '스키', 'high1', '하이원', 'vivaldi'],
  },
  'gyeongju-jeonju': {
    ko: '경주·전주 투어',
    en: 'Gyeongju / Jeonju Tour',
    priceKRW: 468000,
    priceUSD: 340,
    hours: 10,
    spots: ['경주', '불국사', '석굴암', '전주한옥마을', '전주'],
    keywords: ['gyeongju', '경주', 'bulguksa', '불국사', 'jeonju', '전주'],
  },
  'busan-day': {
    ko: '부산 당일 투어',
    en: 'Busan Day Tour',
    priceKRW: 572000,
    priceUSD: 415,
    hours: 12,
    spots: ['부산', '해운대', '감천문화마을', '자갈치시장', '광안리'],
    keywords: ['busan', '부산', 'haeundae', '해운대', 'gamcheon', '감천'],
  },
};

// ────────────────────────────────────────
// 추가 요금표
// ────────────────────────────────────────
export const EXTRA_CHARGES = {
  overtimePerHour: 35000,
  nightSurchargePercent: 20,
  peakSeasonPercent: 10,
  roundTripDiscountPercent: 10,
  englishGuidePerDay: 80000,
  airportPicketService: 20000,
  childSeatPerTrip: 20000,
};

// ────────────────────────────────────────
// K-pop 콘서트 셔틀 요금
// ────────────────────────────────────────
export const KPOP_SHUTTLE = {
  pricePerPerson: 26000,
  maxPassengers: 8,
  pricePerVehicle: 208000,
  vehicleType: '현대 스타리아',
  includes: ['호텔 픽업', '공연장 이동', '공연 후 귀환', '24시간 기사 대기'],
  venues: [
    { name: '인스파이어 아레나', nameEn: 'Inspire Arena', location: '인천 영종도', locationEn: 'Yeongdo, Incheon' },
    { name: '잠실올림픽주경기장', nameEn: 'Jamsil Olympic Stadium', location: '서울 송파', locationEn: 'Songpa, Seoul' },
    { name: 'KSPO돔 (체조경기장)', nameEn: 'KSPO Dome', location: '서울 송파', locationEn: 'Songpa, Seoul' },
    { name: '고척스카이돔', nameEn: 'Gocheok Sky Dome', location: '서울 구로', locationEn: 'Guro, Seoul' },
    { name: '수원월드컵경기장', nameEn: 'Suwon World Cup Stadium', location: '수원', locationEn: 'Suwon' },
  ],
  pickupPoints: ['명동', '홍대', '강남역', '동대문'],
};

// 전세차량 기본 요금 (공항 픽업 편도)
export const CHARTER_BASE_PRICE = 160000;

// ────────────────────────────────────────
// AI 플래너 코스 자동 감지 함수
// ────────────────────────────────────────
export function detectCharterRecommendation(places: { name: string; nameEn?: string }[]): {
  recommended: boolean;
  tourType: string | null;
  pricing: typeof DAILY_TOUR_PRICES[string] | null;
  reason: string;
} {
  const allText = places
    .map((p) => `${p.name} ${p.nameEn ?? ''}`)
    .join(' ')
    .toLowerCase();

  for (const [key, tour] of Object.entries(DAILY_TOUR_PRICES)) {
    const matched = tour.keywords.some((kw) => allText.includes(kw.toLowerCase()));
    if (matched) {
      const isSeoulOnly = key === 'seoul-city';
      return {
        recommended: true,
        tourType: key,
        pricing: tour,
        reason: isSeoulOnly
          ? '짐이 많거나 이동이 불편한 경우 전세차량을 추천합니다.'
          : '이 코스는 대중교통으로 이동이 불편합니다. 전세차량을 강력 추천합니다.',
      };
    }
  }

  return { recommended: false, tourType: null, pricing: null, reason: '' };
}
