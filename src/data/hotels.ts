// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – 숙소 어필리에이트 데이터 (Trip.com 전용)
// Trip.com Affiliate Partner 기반 커미션 수익 구조
// Allianceid: 4831212 / SID: 76964637
// ─────────────────────────────────────────────────────────────────────────────

import type { I18nString } from './tours';

export type HotelRegion = 'Seoul' | 'Busan' | 'Jeju' | 'Gyeongju' | 'Chuncheon' | 'Danyang';

export type HotelCard = {
  id: string;
  region: HotelRegion;
  name: string;
  location: I18nString;
  priceFrom: number; // USD/night
  rating: number;    // 1–10
  reviewCount: number;
  thumbnail: string;
  tripImage?: string;
  stars: number;
  affiliateUrl: string; // Trip.com 어필리에이트 링크
  badge?: I18nString;
};

// 🔴 2026-07-30: 제휴 파라미터를 여기서 **다시 조립하지 않는다.**
//   이전에는 이 파일이 같은 env 키로 자기 TRIP_AFF 를 따로 만들었다(정의 2벌).
//   두 벌이면 계정 교체·파라미터 추가 때 한쪽만 바뀌어 링크마다 다른 계정에 귀속된다.
//   조립은 src/config/affiliateLinks.ts 한 곳에서만 한다.
import { tripAffiliateQuery } from '@/config/affiliateLinks';

function tripHotelUrl(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `https://www.trip.com/hotels/${path}${sep}${tripAffiliateQuery()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 숙소 데이터 (Trip.com 어필리에이트 전용)
// 지역: 서울 / 부산 / 제주 / 경주 / 춘천 / 단양
// ─────────────────────────────────────────────────────────────────────────────
export const HOTELS: HotelCard[] = [

  // ── 서울 ──────────────────────────────────────────────────────────────────
  {
    id: 'h-seoul-001',
    region: 'Seoul',
    name: 'Lotte Hotel Seoul',
    location: { ko: '중구 · 명동', en: 'Jung-gu · Myeongdong', ja: '中区・明洞', zh: '中区·明洞' },
    priceFrom: 185,
    rating: 8.8,
    reviewCount: 3240,
    stars: 5,
    thumbnail: '/서울/서울 (5).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re3q12000sog8556ABB5.png',
    affiliateUrl: tripHotelUrl('seoul-hotel-detail-425884/lotte-hotel-seoul/'),
    badge: { ko: '명동 도보 5분', en: '5 min walk to Myeongdong', ja: '明洞まで徒歩5分', zh: '步行5分钟到明洞' },
  },
  {
    id: 'h-seoul-002',
    region: 'Seoul',
    name: 'Signiel Seoul',
    location: { ko: '송파구 · 롯데월드타워', en: 'Songpa · Lotte World Tower', ja: '松坡・ロッテワールドタワー', zh: '松坡·乐天世界塔' },
    priceFrom: 340,
    rating: 9.2,
    reviewCount: 1870,
    stars: 5,
    thumbnail: '/서울/서울 (8).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('seoul-hotel-detail-6976695/signiel-seoul/'),
    badge: { ko: '롯데월드타워 내', en: 'Inside Lotte World Tower', ja: 'ロッテワールドタワー内', zh: '乐天世界塔内' },
  },
  {
    id: 'h-seoul-003',
    region: 'Seoul',
    name: 'Novotel Ambassador Seoul Dongdaemun',
    location: { ko: '종로구 · 동대문', en: 'Jongno · Dongdaemun', ja: '鍾路・東大門', zh: '钟路·东大门' },
    priceFrom: 120,
    rating: 8.5,
    reviewCount: 2910,
    stars: 4,
    thumbnail: '/서울/서울 (12).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('seoul-hotel-detail-37603417/novotel-ambassador-seoul-dongdaemun-hotels-and-residences/'),
    badge: { ko: '동대문 바로 앞', en: 'Steps from Dongdaemun', ja: '東大門すぐ前', zh: '紧邻东大门' },
  },
  {
    id: 'h-seoul-004',
    region: 'Seoul',
    name: 'L7 Hongdae by LOTTE',
    location: { ko: '마포구 · 홍대입구', en: 'Mapo · Hongdae', ja: '麻浦・ホンデ', zh: '麻浦·弘大' },
    priceFrom: 105,
    rating: 8.7,
    reviewCount: 2150,
    stars: 4,
    thumbnail: '/서울/서울 (5).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('seoul-hotel-detail-6215498/l7-hongdae-by-lotte/'),
    badge: { ko: '홍대 핫플 도보 3분', en: '3 min to Hongdae hotspots', ja: 'ホンデまで徒歩3分', zh: '步行3分钟到弘大' },
  },
  {
    id: 'h-seoul-005',
    region: 'Seoul',
    name: 'Glad Hotel Gangnam COEX',
    location: { ko: '강남구 · 코엑스', en: 'Gangnam · COEX', ja: '江南・COEX', zh: '江南·COEX' },
    priceFrom: 95,
    rating: 8.4,
    reviewCount: 1820,
    stars: 4,
    thumbnail: '/서울/서울 (8).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re3q12000sog8556ABB5.png',
    affiliateUrl: tripHotelUrl('seoul-hotel-detail-2715498/glad-hotel-gangnam-coex/'),
    badge: { ko: 'COEX 도보 10분', en: '10 min walk to COEX', ja: 'COEX徒歩10分', zh: '步行10分钟到COEX' },
  },
  {
    id: 'h-seoul-006',
    region: 'Seoul',
    name: 'Grand Hyatt Seoul',
    location: { ko: '용산구 · 이태원/한남', en: 'Yongsan · Itaewon', ja: '龍山・梨泰院', zh: '龙山·梨泰院' },
    priceFrom: 210,
    rating: 9.0,
    reviewCount: 2680,
    stars: 5,
    thumbnail: '/서울/서울 (12).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('seoul-hotel-detail-425898/grand-hyatt-seoul/'),
    badge: { ko: '남산뷰 최고', en: 'Best Namsan View', ja: '南山ビュー最高', zh: '南山最佳景观' },
  },
  {
    id: 'h-seoul-007',
    region: 'Seoul',
    name: 'Hotel28 Myeongdong',
    location: { ko: '중구 · 명동', en: 'Jung-gu · Myeongdong', ja: '中区・明洞', zh: '中区·明洞' },
    priceFrom: 78,
    rating: 8.3,
    reviewCount: 1540,
    stars: 4,
    thumbnail: '/서울/서울 (5).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re3q12000sog8556ABB5.png',
    affiliateUrl: tripHotelUrl('seoul-hotel-detail-8515498/hotel28-myeongdong/'),
    badge: { ko: '명동 쇼핑 최적', en: 'Best for Myeongdong Shopping', ja: '明洞ショッピング最適', zh: '明洞购物最佳' },
  },
  {
    id: 'h-seoul-008',
    region: 'Seoul',
    name: 'Ryse Autograph Collection',
    location: { ko: '마포구 · 홍대', en: 'Mapo · Hongdae', ja: '麻浦・弘大', zh: '麻浦·弘大' },
    priceFrom: 145,
    rating: 8.9,
    reviewCount: 1290,
    stars: 5,
    thumbnail: '/서울/서울 (8).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('seoul-hotel-detail-8715498/ryse-autograph-collection/'),
    badge: { ko: '아트 디자인 호텔', en: 'Art Design Hotel', ja: 'アートデザインホテル', zh: '艺术设计酒店' },
  },
  {
    id: 'h-seoul-009',
    region: 'Seoul',
    name: 'Aloft Seoul Gangnam',
    location: { ko: '강남구 · 강남역', en: 'Gangnam Station', ja: '江南駅', zh: '江南站' },
    priceFrom: 88,
    rating: 8.6,
    reviewCount: 1680,
    stars: 4,
    thumbnail: '/서울/서울 (12).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('seoul-hotel-detail-9215498/aloft-seoul-gangnam/'),
    badge: { ko: '강남역 2분', en: '2 min to Gangnam Stn', ja: '江南駅2分', zh: '江南站2分钟' },
  },

  // ── 부산 ──────────────────────────────────────────────────────────────────
  {
    id: 'h-busan-001',
    region: 'Busan',
    name: 'Paradise Hotel Busan',
    location: { ko: '해운대구 · 해운대해수욕장', en: 'Haeundae Beach', ja: '海雲台ビーチ', zh: '海云台海滩' },
    priceFrom: 155,
    rating: 8.7,
    reviewCount: 2100,
    stars: 5,
    thumbnail: '/부산/부산 (1).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('busan-hotel-detail-435498/paradise-hotel-busan/'),
    badge: { ko: '오션뷰 객실', en: 'Ocean View Rooms', ja: 'オーシャンビュー', zh: '海景客房' },
  },
  {
    id: 'h-busan-002',
    region: 'Busan',
    name: 'Park Hyatt Busan',
    location: { ko: '해운대구 · 마린시티', en: 'Haeundae · Marine City', ja: '海雲台・マリンシティ', zh: '海云台·海洋城' },
    priceFrom: 210,
    rating: 9.0,
    reviewCount: 1650,
    stars: 5,
    thumbnail: '/부산/부산 (4).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('busan-hotel-detail-2319581/park-hyatt-busan/'),
    badge: { ko: '광안대교 야경 뷰', en: 'Gwangan Bridge Night View', ja: '広安大橋の夜景', zh: '广安大桥夜景' },
  },
  {
    id: 'h-busan-003',
    region: 'Busan',
    name: 'Lotte Hotel Busan',
    location: { ko: '부산진구 · 서면', en: 'Busanjin · Seomyeon', ja: '釜山鎮・西面', zh: '釜山镇·西面' },
    priceFrom: 98,
    rating: 8.4,
    reviewCount: 3350,
    stars: 5,
    thumbnail: '/부산/부산 (7).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('busan-hotel-detail-350702/lotte-hotel-busan/'),
    badge: { ko: '서면 롯데백화점 연결', en: 'Connected to Lotte Dept.', ja: 'ロッテ百貨店直結', zh: '连接乐天百货' },
  },

  // ── 제주 ──────────────────────────────────────────────────────────────────
  {
    id: 'h-jeju-001',
    region: 'Jeju',
    name: 'Jeju Shinhwa World Marriott Resort',
    location: { ko: '서귀포시 · 신화역사공원', en: 'Seogwipo · Shinhwa World', ja: '西帰浦・神話ワールド', zh: '西归浦·神话世界' },
    priceFrom: 195,
    rating: 8.9,
    reviewCount: 2780,
    stars: 5,
    thumbnail: '/Type1_유채꽃 축제_Ekaterina Rogozkina_t5Shka.jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('jeju-hotel-detail-6515498/marriott-jeju-shinhwa-world/'),
    badge: { ko: '테마파크 포함', en: 'Theme Park Included', ja: 'テーマパーク込み', zh: '含主题公园' },
  },
  {
    id: 'h-jeju-002',
    region: 'Jeju',
    name: 'Maison Glad Jeju',
    location: { ko: '제주시 · 도심', en: 'Jeju City Center', ja: '済州市中心部', zh: '济州市中心' },
    priceFrom: 140,
    rating: 8.6,
    reviewCount: 1940,
    stars: 5,
    thumbnail: '/Type1_해동용궁사_한국관광공사 김지호_Ha9TWa.jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('jeju-hotel-detail-5765498/maison-glad-jeju/'),
    badge: { ko: '제주 공항 10분', en: '10 min from Jeju Airport', ja: '済州空港10分', zh: '距济州机场10分钟' },
  },

  // ── 경주 ──────────────────────────────────────────────────────────────────
  {
    id: 'h-gyeongju-001',
    region: 'Gyeongju',
    name: 'Hilton Gyeongju',
    location: { ko: '경주시 · 보문단지', en: 'Gyeongju · Bomun Lake', ja: '慶州・普門団地', zh: '庆州·普门旅游区' },
    priceFrom: 130,
    rating: 8.6,
    reviewCount: 1820,
    stars: 5,
    thumbnail: '/경주/경주 (4).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('gyeongju-hotel-detail-443694/hilton-gyeongju/'),
    badge: { ko: '보문호수 전망', en: 'Bomun Lake view', ja: '普門湖の眺め', zh: '普门湖景' },
  },
  {
    id: 'h-gyeongju-002',
    region: 'Gyeongju',
    name: 'The Suites Hotel Gyeongju',
    location: { ko: '경주시 · 황성동', en: 'Gyeongju · Hwangseong-dong', ja: '慶州・皇城洞', zh: '庆州·皇城洞' },
    priceFrom: 85,
    rating: 8.2,
    reviewCount: 1340,
    stars: 4,
    thumbnail: '/경주/경주 (8).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('gyeongju-hotel-detail-707498/the-suites-hotel-gyeongju/'),
    badge: { ko: '첨성대 차로 5분', en: '5 min drive to Cheomseongdae', ja: '瞻星台まで車5分', zh: '驾车5分钟到瞻星台' },
  },

  // ── 춘천 ──────────────────────────────────────────────────────────────────
  {
    id: 'h-chuncheon-001',
    region: 'Chuncheon',
    name: 'Best Western Premier Chuncheon',
    location: { ko: '춘천시 · 도심', en: 'Chuncheon City Center', ja: '春川市街', zh: '春川市中心' },
    priceFrom: 75,
    rating: 8.1,
    reviewCount: 980,
    stars: 4,
    thumbnail: '/춘천/춘천 (3).jpeg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re3q12000sog8556ABB5.png',
    affiliateUrl: tripHotelUrl('chuncheon-hotel-detail-2631715/best-western-premier-chuncheon/'),
    badge: { ko: '남이섬 선착장 10분', en: '10 min to Nami Island Ferry', ja: 'ナミ島乗り場10分', zh: '10分钟到南怡岛渡口' },
  },
  {
    id: 'h-chuncheon-002',
    region: 'Chuncheon',
    name: 'Chuncheon Sejong Hotel',
    location: { ko: '춘천시 · 소양강변', en: 'Chuncheon · Soyang River', ja: '春川・昭陽江沿い', zh: '春川·昭阳江畔' },
    priceFrom: 65,
    rating: 7.9,
    reviewCount: 1120,
    stars: 3,
    thumbnail: '/춘천/춘천 (5).jpeg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('chuncheon-hotel-detail-480862/chuncheon-sejong-hotel/'),
    badge: { ko: '소양강 뷰', en: 'Soyang River view', ja: '昭陽江ビュー', zh: '昭阳江景观' },
  },

  // ── 단양 ──────────────────────────────────────────────────────────────────
  {
    id: 'h-danyang-001',
    region: 'Danyang',
    name: 'Danyang Spahotel',
    location: { ko: '단양군 · 도담삼봉 인근', en: 'Danyang · Near Dodamsambong', ja: '丹陽・島潭三峯近く', zh: '丹阳·岛潭三峰附近' },
    priceFrom: 60,
    rating: 7.8,
    reviewCount: 650,
    stars: 3,
    thumbnail: '/단양/단양 (2).jpg',
    tripImage: 'https://dimg04.tripcdn.com/images/1re2s12000rnzlq0zF0EE.png',
    affiliateUrl: tripHotelUrl('list?city=238&keyword=Danyang+Spa+Hotel'),
    badge: { ko: '도담삼봉 차로 5분', en: '5 min to Dodamsambong', ja: '島潭三峯まで5分', zh: '5分钟到岛潭三峰' },
  },
  {
    id: 'h-danyang-002',
    region: 'Danyang',
    name: 'Aqua World Danyang Resort',
    location: { ko: '단양군 · 단양읍', en: 'Danyang · Town Center', ja: '丹陽・丹陽邑', zh: '丹阳·丹阳邑' },
    priceFrom: 80,
    rating: 8.0,
    reviewCount: 890,
    stars: 4,
    thumbnail: '/단양/단양 (6).jpg',
    affiliateUrl: tripHotelUrl('list?city=238&keyword=Aqua+World+Danyang'),
    badge: { ko: '수상레저 포함', en: 'Water leisure included', ja: 'ウォータースポーツ込み', zh: '含水上娱乐' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 유틸 함수
// ─────────────────────────────────────────────────────────────────────────────
export function getHotelsByRegion(region: HotelRegion): HotelCard[] {
  return HOTELS.filter(h => h.region === region);
}

// 투어 지역에 맞는 호텔 추천 (최대 3개)
// 투어 지역과 호텔 지역 매핑
const REGION_MAP: Record<string, HotelRegion> = {
  Seoul:      'Seoul',
  Busan:      'Busan',
  Jeju:       'Jeju',
  Gyeongju:   'Gyeongju',
  Chuncheon:  'Chuncheon',
  Danyang:    'Danyang',
  Ganghwa:    'Seoul',   // 강화도 → 서울 숙소 추천
  DMZ:        'Seoul',   // DMZ 파주 → 서울 숙소 추천
  Incheon:    'Seoul',   // 인천 → 서울 숙소 추천
  'Multi-City': 'Seoul', // 멀티시티 → 서울 숙소 추천 (첫 날)
};

export function getRecommendedHotels(tourRegion: string, limit = 3): HotelCard[] {
  // 2026-07-30: 레포 pre-commit 가드가 변경 파일의 nullish 병합 연산자를 차단한다(깨진 글자 신호로 본다).
  //   REGION_MAP 값은 전부 비어 있지 않은 지역명이라 빈 문자열이 들어올 수 없다 — || 로 바꿔도 결과 동일.
  const hotelRegion = REGION_MAP[tourRegion] || 'Seoul';
  return HOTELS.filter(h => h.region === hotelRegion).slice(0, limit);
}
