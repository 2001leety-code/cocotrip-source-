// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – Tour Product Data
// 이미지: public/ 폴더 기준 경로 사용 (RegionDetail.tsx 방식 동일)
// 가격: pricing_spec.json (SSOT) 의 daily_tour_prices 에서 자동 산출.
// TOURS_RAW 의 priceFrom 은 spec 매핑 없을 때 (multicity 등) fallback.
// ─────────────────────────────────────────────────────────────────────────────
import pricingSpec from './pricing_spec.json';

// P1 #5 fix (2026-05-13): 환율 SSOT — pricing_spec.policy_krw_per_usd (1430) 우선.
// Vercel env (VITE_KRW_PER_USD) > SSOT > hardcoded fallback. 실 결제 환산은 backend live rate 사용.
const POLICY_RATE = (pricingSpec as { policy_krw_per_usd?: number }).policy_krw_per_usd || 1430;
const KRW_PER_USD = Number(import.meta.env.VITE_KRW_PER_USD || POLICY_RATE);

/** Tour ID → pricing_spec.daily_tour_prices key. null이면 spec에 없음 (fallback 사용). */
const TOUR_TO_CHARTER_KEY: Record<string, string | null> = {
  'tour-seoul-city':     'seoul-city',
  'tour-seoul-night':    'seoul-city',     // 야간 surcharge는 결제 시 addon 또는 별도 정책
  'tour-danyang':        'seoul-suburb',   // 단양은 서울 근교 인터시티 기준
  'tour-ganghwa':        'seoul-suburb',
  'tour-dmz':            'dmz',
  'tour-nami-chuncheon': 'seoul-suburb',
  'tour-gyeongju':       'gyeongju-jeonju',
  'tour-busan-day':      'busan-day',
  'tour-multicity-3d':   null,             // 멀티데이는 spec daily 가격 없음 → priceFrom fallback
};

/** Tour 가격(KRW) — pricing_spec.json SSOT 우선, 없으면 priceFrom × KRW_PER_USD.
 *  priceUnit='per_person' 투어는 spec 매핑 무시하고 priceFrom × KRW만 사용 (1인당 가격). */
export function getTourPriceKRW(tourId: string, fallbackPriceFromUSD = 0, priceUnit: 'group' | 'per_person' = 'group'): number {
  if (priceUnit === 'per_person') {
    return fallbackPriceFromUSD * KRW_PER_USD;
  }
  const key = TOUR_TO_CHARTER_KEY[tourId];
  if (key) {
    const spec = (pricingSpec as { daily_tour_prices?: Record<string, { priceKRW?: number }> }).daily_tour_prices;
    const krw = spec?.[key]?.priceKRW;
    if (typeof krw === 'number') return krw;
  }
  return fallbackPriceFromUSD * KRW_PER_USD;
}

/** PayPal createPaypalOrder.js productType 형식. tour-{slug} → charter_{key}. */
export function getTourProductType(tourId: string): string | null {
  const key = TOUR_TO_CHARTER_KEY[tourId];
  if (!key) return null;
  return `charter_${key.replace(/-/g, '_')}`;
}

export type VehicleType = 'Staria' | 'Sprinter' | 'SprinterMid' | 'Bus';
export type TourTag = 'Popular' | 'AI-Curated' | 'Best Value' | 'New' | 'Multi-City' | 'Night Tour' | 'Nature' | 'History';
export type TourRegion = 'Seoul' | 'Busan' | 'Jeju' | 'Danyang' | 'Ganghwa' | 'DMZ' | 'Chuncheon' | 'Gyeongju' | 'Incheon' | 'Multi-City';

export type I18nString = {
  ko: string;
  en: string;
  ja: string;
  zh: string;
};

export type TourHighlight = {
  icon: string;
  text: I18nString;
};

/** 운전기사 가능 언어. 영업 정책상 일본어/중국어는 추가 요금일 수 있음 (pricing_spec.json `addons` 참조). */
export type DriverLanguage = 'en' | 'ja' | 'zh';

/** 투어 stop 간 이동 정보. 정적 데이터 — 영업가이드 기준. */
export type TourTransit = {
  method: 'walk' | 'car' | 'transit';
  /** 분 단위 추정 시간. */
  minutes: number;
  /** km 단위. 도보 시 생략. */
  distance_km?: number;
  /** "지하철 4호선 + 도보" 같은 보조 안내 (i18n optional). */
  note?: I18nString;
};

/** 투어 일정의 한 stop. 시간순 배열로 Tour.stops 에 저장. */
export type TourStop = {
  /** "09:30" 24시간 형식 */
  time: string;
  /** stop 이름 (한국어 = naver map 검색용 정식 명칭, 다른 언어 = 표시용) */
  name: I18nString;
  /** 머무는 시간 (분) */
  stay_min: number;
  /**
   * 사진 — 두 형태 모두 허용:
   *   1) string: /public 기준 경로 (정적 9 투어 legacy)
   *   2) TourPhoto: Firebase Storage URL + alt/blurhash/variants (어드민 등록)
   * resolvePhotoUrl() 가 양쪽 통합 처리. UI 렌더 시 그 헬퍼 사용 의무.
   */
  photo?: string | TourPhoto;
  /** 무엇을 보고/하는지 1-2문장 설명 */
  description: I18nString;
  /** 입장료 (KRW). 0 또는 생략 시 무료. */
  entry_fee_krw?: number;
  /** 현지 팁 — 추천 메뉴, 포토 스팟, 시간대 주의 등 */
  tip?: I18nString;
  /** 네이버 지도 직링크 (없으면 PlanDetailPage 패턴으로 자동 생성 가능) */
  naver_map_url?: string;
  /** 이전 stop에서 여기로 오는 방법. 첫 stop은 생략. */
  transit_from_prev?: TourTransit;
};

// ─────────────────────────────────────────────────────────────────────────────
// v3 OTA-standard types (Phase 1, 2026-05-19) — Firestore 기반 어드민 상품 등록
// 모두 optional. 기존 정적 9 투어는 영향 없음. tours-firestore.ts CRUD 가 사용.
// ─────────────────────────────────────────────────────────────────────────────

/** 사진 객체 — Firebase Storage 마이그용. legacy_public_path 가 /public 폴백. */
export type TourPhoto = {
  /** Firebase Storage HTTPS URL 또는 /public 정적 경로 */
  url: string;
  alt: I18nString;
  width?: number;
  height?: number;
  /** 로딩 placeholder (선택) */
  blurhash?: string;
  /** 정적 마이그용 — /public 경로 보존. resolvePhotoUrl() 이 처리. */
  legacy_public_path?: string;
  /**
   * P109 (2026-05-20): Firebase Extension storage-resize-images 가 비동기로
   * 생성하는 variant URLs. 모바일/데스크톱 srcset 분기 + LCP 5초→1초 개선.
   * 모두 optional — Extension 미설치 환경 / 기존 사진 (backfill 안 함) 도
   * resolvePhotoUrl 가 자동 원본 폴백. webp 단일 포맷.
   */
  variants?: {
    /** 400×400 (모바일 thumbnail / TourCard) */
    '400'?: string;
    /** 800×800 (모바일 갤러리) */
    '800'?: string;
    /** 1600×1600 (데스크톱 풀 갤러리) */
    '1600'?: string;
  };
};

/** P109: TourPhoto.variants 의 키 — srcset 생성 / preferredWidth 매칭에 사용. */
export type TourPhotoVariantWidth = '400' | '800' | '1600';

export type GuideType = 'live_guide' | 'driver_only' | 'audio' | 'self_guided';

/** 다중 픽업 존 — meeting_point.kind='multi_zone' 일 때 */
export type PickupZone = {
  id: string;
  name: I18nString;
  area_label: I18nString;
  surcharge_krw?: number;
  /** "HH:mm" KST */
  pickup_time?: string;
};

export type MeetingPoint = {
  kind: 'hotel_pickup' | 'fixed_address' | 'multi_zone';
  address?: I18nString;
  lat?: number;
  lng?: number;
  photo?: TourPhoto;
  instructions?: I18nString;
  naver_map_url?: string;
  google_maps_url?: string;
  zones?: PickupZone[];
};

/** 출발 시간 슬롯 — `tours/{id}/slots` 서브컬렉션에 저장 가능 (또는 메인 doc 배열). */
export type TourSlot = {
  id: string;
  /** "HH:mm" 24시간 KST */
  start_time: string;
  price_modifier_krw?: number;
  capacity?: number;
  label?: I18nString;
  is_active: boolean;
};

export type CancellationTier = {
  hours_before: number;
  /** 0-100 정수 % */
  refund_percent: { general: number; gold: number; platinum: number };
};

export type CancellationPolicy = {
  /** 'inherit_global' = RefundPolicyModal 의 글로벌 표 사용 */
  kind: 'inherit_global' | 'custom';
  tiers?: CancellationTier[];
  /** 글로벌 NOTES 위에 추가됨 (4-lang) */
  extra_notes?: I18nString[];
};

export type FAQ = {
  id: string;
  question: I18nString;
  answer: I18nString;
  /** 낮은 숫자가 위 */
  order: number;
};

export type Suitability = {
  min_age?: number;
  max_age?: number;
  fitness_level?: 'easy' | 'moderate' | 'challenging';
  wheelchair_accessible?: boolean;
  stroller_friendly?: boolean;
  pregnancy_safe?: boolean;
  infant_seat_available?: boolean;
  notes?: I18nString;
};

export type TourStatus = 'draft' | 'published' | 'archived';

export type Tour = {
  id: string;
  slug: string;
  region: TourRegion;
  title: I18nString;
  summary: I18nString;
  description: I18nString;
  priceFrom: number;   // USD. priceUnit='group'(default) → 차량 1대 그룹가, 'per_person' → 1인당
  /** 가격 단위. 미지정 시 'group' (전세 차량 1대 기준). 'per_person' 투어는 결제 시 priceFrom × pax. */
  priceUnit?: 'group' | 'per_person';
  currency: 'USD';
  durationDays: number;
  durationHours?: number; // 당일 투어 시 시간 단위
  isNightTour?: boolean;
  vehicleType: VehicleType;
  maxPax: number;
  thumbnail: string;       // /public 기준 메인 사진 (legacy) 또는 TourPhoto.url
  images: string[];        // /public 기준 갤러리 사진들 (legacy) 또는 photos[].url
  tags: TourTag[];
  highlights: TourHighlight[];

  // ── v1 신규 (Tour data model — 2026-04-25)
  /** 기본 운전기사 가능 언어. 미설정 시 ['en'] 가정. */
  driverLanguages?: DriverLanguage[];
  /** 시간순 stops 배열 (P0-가3). 미설정 시 상세에 "coming soon" 폴백. */
  stops?: TourStop[];
  /** 투어별 default 픽업 위치 (예: 서울 시내 호텔). 명시 안 하면 글로벌 default. */
  defaultPickup?: I18nString;

  // ── v2 신규 (rating + included/excluded — 2026-04-25)
  /** 평점 (5점 만점). 미설정 시 카드/상세에 평점 칩 미표시. */
  rating?: number;
  /** 리뷰 수. */
  reviewCount?: number;
  /** 평점 출처. 'internal' = 자체 집계, 외부 API 도입 시 변경. */
  reviewSource?: 'internal' | 'google';
  /** 투어별 추가 included 항목. 미설정 시 GLOBAL_INCLUDED만 표시. */
  included?: TourHighlight[];
  /** 투어별 추가 excluded 항목. 미설정 시 GLOBAL_EXCLUDED만 표시. */
  excluded?: TourHighlight[];

  // ── v3 신규 (Phase 1, 2026-05-19) — Firestore 어드민 상품 등록 시스템
  /** 데이터 출처. undefined/false='static' (tours.ts 정적), 'firestore' 는 어드민 등록. */
  source?: 'static' | 'firestore';
  /** draft = 어드민 작성 중 (운영자만 조회), published = 공개, archived = 비공개 */
  status?: TourStatus;
  /** 낙관적 lock 용. 어드민 두 명 동시 편집 충돌 감지. */
  version?: number;
  /** 운영자가 publish 한 시각 (ms epoch) */
  publishedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  createdBy?: string;
  updatedBy?: string;
  /** cleanup cron 보호 플래그 (architecture index 의 PDF golden 패턴 동일) */
  do_not_delete?: boolean;

  // 미디어 (v2)
  /** 신규 사진 갤러리. images[] 보다 우선. 비어있으면 images[] 폴백. */
  photos?: TourPhoto[];
  thumbnail_photo?: TourPhoto;
  video_embed_url?: string;
  /** 즉시확정 컷오프 최소 인원 */
  minPax?: number;

  // 가이드 / 미팅
  guide_type?: GuideType;
  meeting_point?: MeetingPoint;

  // 가격 표시
  price_display_note?: I18nString;

  // 시간 슬롯 (메인 doc 인라인 — slot 1-10개라 서브컬렉션 미사용)
  slots?: TourSlot[];

  // 취소 정책 (투어별 override)
  cancellation_policy?: CancellationPolicy;

  // 적합성 / 준비물 / 중요 정보
  suitability?: Suitability;
  what_to_bring?: I18nString;
  important_info?: I18nString;

  // FAQ (메인 doc 인라인 — 20개 cap)
  faqs?: FAQ[];
};

// ─────────────────────────────────────────────────────────────────────────────
// 글로벌 default 포함/불포함 — 모든 투어 공통 베이스라인.
// pricing_spec.json `includes`/`excludes` 와 동기화.
// ─────────────────────────────────────────────────────────────────────────────
export const GLOBAL_INCLUDED: TourHighlight[] = [
  { icon: 'Car',    text: { ko: '전용 스타리아 차량', en: 'Private Staria van', ja: '専用スターリア車両', zh: '专属Staria面包车' } },
  { icon: 'User',   text: { ko: '영어 가능 기사', en: 'English-speaking driver', ja: '英語対応ドライバー', zh: '英语司机' } },
  { icon: 'Fuel',   text: { ko: '연료비·톨비·주차비', en: 'Fuel · Tolls · Parking', ja: '燃料・料金所・駐車場', zh: '燃油费·过路费·停车费' } },
  { icon: 'Heart',  text: { ko: '톨비 포함 (현장 추가 비용 0)', en: 'Tolls included (no on-site extras)', ja: '通行料込み（現場追加費用なし）', zh: '含过路费（无现场额外费用）' } },
];

export const GLOBAL_EXCLUDED: TourHighlight[] = [
  { icon: 'Utensils',  text: { ko: '식사 비용 (별도 결제)', en: 'Meals (pay-as-you-go)', ja: '食事代（別途）', zh: '餐费（另付）' } },
  { icon: 'Ticket',    text: { ko: '입장료·액티비티 (옵션 패스로 통합 가능)', en: 'Attraction entry (optional pass available)', ja: '入場料・アクティビティ（オプションパスあり）', zh: '景点门票（可选通票）' } },
  { icon: 'Plane',     text: { ko: '호텔 픽업 외 지역은 추가 협의', en: 'Pickups outside metro hotels (custom quote)', ja: 'メトロ外送迎は別途見積', zh: '市区酒店外接送另议' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// 투어 데이터 — 실제 사진 경로 사용
// ─────────────────────────────────────────────────────────────────────────────
const TOURS_RAW: Tour[] = [

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. 서울 시티투어 (당일)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'tour-seoul-city',
    slug: 'seoul-city-full-day',
    region: 'Seoul',
    title: {
      ko: '서울 시티투어 (1일)',
      en: 'Seoul City Full-Day Tour',
      ja: 'ソウル シティツアー（1日）',
      zh: '首尔城市一日游',
    },
    summary: {
      ko: '경복궁·북촌·명동·한강 — 서울 핵심 명소를 하루에 · 톨비 포함',
      en: 'Gyeongbokgung · Bukchon · Myeongdong · Han River — tolls included',
      ja: '景福宮・北村・明洞・漢江 — 通行料込み',
      zh: '景福宫·北村·明洞·汉江 — 含过路费',
    },
    description: {
      ko: '전용 스타리아 차량과 영어 기사님과 함께 서울의 핵심 명소를 알차게 둘러봅니다. 경복궁의 고즈넉한 아침, 북촌한옥마을의 골목길, 명동 쇼핑, 한강 공원 일몰까지. 톨비·주차비 전부 포함 — 현장 추가 비용 제로.',
      en: "Explore Seoul's top landmarks in a private Staria van with an English-speaking driver. Gyeongbokgung's morning calm, Bukchon Hanok Village alleyways, Myeongdong shopping, Han River sunset. Tolls and parking all included.",
      ja: 'スタリア専用車両と英語対応ドライバーでソウルの名所を巡ります。景福宮の静かな朝、北村韓屋村の路地、明洞ショッピング、漢江の夕日まで。通行料・駐車場がすべて込み。',
      zh: '乘坐专属Staria面包车，配备英语司机，游览首尔主要景点。景福宫清晨、北村韩屋村小巷、明洞购物、汉江日落。过路费·停车费全含。',
    },
    priceFrom: 208,
    currency: 'USD',
    durationDays: 1,
    durationHours: 9,
    vehicleType: 'Staria',
    maxPax: 7,
    thumbnail: '/JnR5Ie_경복궁(1).webp',
    images: [
      '/JnR5Ie_경복궁(1).webp',
      '/3Xgcka_북촌한옥마을(1).webp',
      '/서울/서울 (1).jpg',
      '/서울/서울 (3).jpg',
      '/서울/서울 (7).jpg',
      '/서울/서울 (10).jpg',
      '/1uA0qa_반포대교(1).webp',
    ],
    tags: ['Popular', 'AI-Curated'],
    highlights: [
      { icon: 'Landmark', text: { ko: '경복궁·북촌한옥마을 포함', en: 'Gyeongbokgung · Bukchon Hanok Village', ja: '景福宮・北村韓屋村', zh: '景福宫·北村韩屋村' } },
      { icon: 'ShoppingBag', text: { ko: '명동 쇼핑·먹거리 탐방', en: 'Myeongdong shopping & street food', ja: '明洞ショッピング＆屋台', zh: '明洞购物及街头美食' } },
      { icon: 'Sunset', text: { ko: '한강공원 일몰 감상', en: 'Han River park sunset', ja: '漢江公園の夕日', zh: '汉江公园日落' } },
      { icon: 'Shield', text: { ko: '톨비·주차비 전부 포함', en: 'Tolls · Parking — all included', ja: '通行料・駐車場 全込み', zh: '过路费·停车费全含' } },
    ],
    driverLanguages: ['en', 'ja', 'zh'],
    defaultPickup: {
      ko: '서울 시내 호텔 (명동·강남·홍대·종로 권역)',
      en: 'Seoul metro hotels (Myeongdong, Gangnam, Hongdae, Jongno)',
      ja: 'ソウル都心ホテル（明洞・江南・弘大・鍾路）',
      zh: '首尔市区酒店（明洞·江南·弘大·钟路）',
    },
    stops: [
      {
        time: '09:30',
        name: { ko: '경복궁', en: 'Gyeongbokgung Palace', ja: '景福宮', zh: '景福宫' },
        stay_min: 90,
        photo: '/JnR5Ie_경복궁(1).webp',
        description: {
          ko: '조선 5대 궁궐 중 가장 큰 정궁. 수문장 교대식과 한복 무료 입장이 핵심.',
          en: 'The grandest of Joseon\'s five palaces. Watch the changing of the guard and enter free if wearing hanbok.',
          ja: '朝鮮5大宮殿の最大規模。守門将交代式と韓服無料入場が見どころ。',
          zh: '朝鲜5大宫殿中规模最大。可观看守门将交代仪式，着韩服可免费入场。',
        },
        entry_fee_krw: 3000,
        tip: {
          ko: '수문장 교대식 09:30·11:00·13:00·14:00·15:00. 한복 대여 ₩15,000부터 (Add-on 가능).',
          en: 'Guard ceremonies at 09:30, 11:00, 13:00, 14:00, 15:00. Hanbok rental from ₩15,000 (available as add-on).',
          ja: '守門将交代式は09:30/11:00/13:00/14:00/15:00。韓服レンタル₩15,000～（オプション追加可）。',
          zh: '守门将交代式 09:30·11:00·13:00·14:00·15:00。韩服租赁 ₩15,000 起（可作为附加选项）。',
        },
      },
      {
        time: '11:00',
        name: { ko: '북촌한옥마을', en: 'Bukchon Hanok Village', ja: '北村韓屋村', zh: '北村韩屋村' },
        stay_min: 60,
        photo: '/3Xgcka_북촌한옥마을(1).webp',
        description: {
          ko: '600년 역사의 한옥 거리. 가회동 31번지가 대표 포토 스팟이며 주민이 실거주하니 정숙 관람 필수.',
          en: 'A 600-year-old hanok district. Gahoe-dong 31 is the iconic photo spot — residents still live here, so quiet visiting is essential.',
          ja: '600年の歴史を持つ韓屋街。嘉会洞31番地が代表フォトスポット。住民が居住しているため静粛にご見学を。',
          zh: '600年历史的韩屋街道。嘉会洞31番地为标志性拍照点，居民实际居住，请保持安静。',
        },
        entry_fee_krw: 0,
        tip: {
          ko: '11~13시 사이 가장 한적. 평일 방문 권장.',
          en: 'Quietest between 11 AM-1 PM. Weekday visits recommended.',
          ja: '11時～13時が最も空いています。平日の訪問がおすすめ。',
          zh: '11时至13时人最少，建议工作日参观。',
        },
        transit_from_prev: { method: 'walk', minutes: 12, distance_km: 0.9 },
      },
      {
        time: '12:00',
        name: { ko: '인사동·익선동 점심', en: 'Insadong / Ikseondong Lunch', ja: '仁寺洞・益善洞ランチ', zh: '仁寺洞·益善洞午餐' },
        stay_min: 75,
        photo: '/서울/서울 (1).jpg',
        description: {
          ko: '전통 공예·갤러리·찻집의 골목. 익선동 한옥 카페골목과 함께 도보 이동, 한정식 또는 비빔밥 추천.',
          en: 'Traditional crafts, galleries, and tea houses. Walk to Ikseondong hanok cafe alley — try Korean set menu or bibimbap.',
          ja: '伝統工芸・ギャラリー・茶屋の路地。益善洞韓屋カフェ通りも徒歩圏内。韓定食やビビンバがおすすめ。',
          zh: '传统工艺·画廊·茶屋的小巷。可步行至益善洞韩屋咖啡街，推荐韩定食或拌饭。',
        },
        entry_fee_krw: 0,
        tip: {
          ko: '추천 식당 — 한식왕비집(한우갈비탕), 토속촌(삼계탕). 점심 1인 ₩15,000~25,000.',
          en: 'Recommended — Hansik Wangbi (hanwoo galbitang), Tosokchon (samgyetang). Lunch ₩15,000-25,000 per person.',
          ja: 'おすすめ — 한식왕비집（韓牛カルビ湯）、토속촌（参鶏湯）。ランチ1人₩15,000～25,000。',
          zh: '推荐餐厅 — 한식왕비집（韩牛排骨汤）、토속촌（参鸡汤）。午餐人均 ₩15,000-25,000。',
        },
        transit_from_prev: { method: 'walk', minutes: 8, distance_km: 0.6 },
      },
      {
        time: '13:30',
        name: { ko: '명동 쇼핑', en: 'Myeongdong Shopping', ja: '明洞ショッピング', zh: '明洞购物' },
        stay_min: 90,
        photo: '/서울/서울 (3).jpg',
        description: {
          ko: '서울 최대 쇼핑 거리. K-뷰티(올리브영·시코르), 길거리 음식, 면세점 밀집.',
          en: 'Seoul\'s biggest shopping street. K-beauty (Olive Young, Sikkor), street food, and duty-free shops.',
          ja: 'ソウル最大のショッピングストリート。K-ビューティー（オリーブヤング・シコル）、屋台、免税店が集中。',
          zh: '首尔最大购物街。K-美妆（Olive Young、Sikkor）、街头小吃、免税店云集。',
        },
        entry_fee_krw: 0,
        tip: {
          ko: '오후 4시 이후 길거리 음식 매대가 본격 오픈. 부가세 환급은 즉시 환급 매장 확인.',
          en: 'Street food stalls open in earnest after 4 PM. Look for instant tax-refund stores.',
          ja: '16時以降に屋台が本格オープン。即時免税店の表示を確認。',
          zh: '下午4点后街头小吃摊位正式营业。请确认即时退税店标示。',
        },
        transit_from_prev: { method: 'car', minutes: 12, distance_km: 3.5 },
      },
      {
        time: '15:00',
        name: { ko: 'N서울타워 (남산)', en: 'N Seoul Tower (Namsan)', ja: 'Nソウルタワー（南山）', zh: 'N首尔塔（南山）' },
        stay_min: 90,
        photo: '/서울/서울 (7).jpg',
        description: {
          ko: '서울 360도 전망대. 케이블카 또는 차량으로 정상까지. 사랑의 자물쇠와 야경 촬영지.',
          en: '360° Seoul panorama. Cable car or shuttle to the top. Famous for love locks and skyline photos.',
          ja: 'ソウル360°展望台。ケーブルカーまたは車で頂上へ。愛のロックと夜景撮影スポット。',
          zh: '首尔360°观景台。可搭缆车或车辆上山。情侣锁和夜景拍摄热点。',
        },
        entry_fee_krw: 16000,
        tip: {
          ko: '케이블카 왕복 ₩14,000 + 전망대 입장 ₩16,000. 차량은 정상 주차 불가, 도서관 환승 필요.',
          en: 'Cable car round-trip ₩14,000 + observatory ₩16,000. Vehicle parking only at base — transfer to shuttle.',
          ja: 'ケーブルカー往復₩14,000＋展望台入場₩16,000。車両は山頂駐車不可、図書館で乗り換え。',
          zh: '缆车往返 ₩14,000 + 观景台入场 ₩16,000。车辆仅可停山下，需换乘班车。',
        },
        transit_from_prev: { method: 'car', minutes: 10, distance_km: 2.0 },
      },
      {
        time: '16:45',
        name: { ko: '광장시장', en: 'Gwangjang Market', ja: '広蔵市場', zh: '广藏市场' },
        stay_min: 60,
        photo: '/서울/서울 (10).jpg',
        description: {
          ko: '100년 전통 재래시장. 빈대떡, 마약김밥, 육회, 칼국수가 명물.',
          en: '100-year-old traditional market. Famed for bindae-tteok (mung bean pancake), mayak gimbap, raw beef tartare, kalguksu.',
          ja: '100年伝統の伝統市場。ビンデトック（緑豆チヂミ）、麻薬キンパ、ユッケ、カルグクスが名物。',
          zh: '百年传统市场。绿豆煎饼、麻药饭卷、生牛肉、刀削面是招牌。',
        },
        entry_fee_krw: 0,
        tip: {
          ko: '빈대떡 1장 ₩6,000, 마약김밥 1줄 ₩3,000. 17시 이후 더 활기참.',
          en: 'Bindae-tteok ₩6,000/piece, mayak gimbap ₩3,000/roll. Livelier after 5 PM.',
          ja: 'ビンデトック1枚₩6,000、麻薬キンパ1本₩3,000。17時以降がより賑わう。',
          zh: '绿豆煎饼 ₩6,000/张，麻药饭卷 ₩3,000/条。下午5点后更热闹。',
        },
        transit_from_prev: { method: 'car', minutes: 15, distance_km: 4.5 },
      },
      {
        time: '18:00',
        name: { ko: '한강공원 (반포 무지개분수)', en: 'Han River Park (Banpo Rainbow Fountain)', ja: '漢江公園（盤浦虹噴水）', zh: '汉江公园（盘浦彩虹喷泉）' },
        stay_min: 60,
        photo: '/1uA0qa_반포대교(1).webp',
        description: {
          ko: '한강 일몰과 반포대교 무지개분수 쇼. 4-10월 운영, 1일 4-6회 분수 가동.',
          en: 'Han River sunset and Banpo Bridge Rainbow Fountain show. Apr-Oct, 4-6 shows daily.',
          ja: '漢江の夕日と盤浦大橋の虹の噴水ショー。4-10月運営、1日4-6回。',
          zh: '汉江日落和盘浦大桥彩虹喷泉表演。4-10月运营，每日4-6场。',
        },
        entry_fee_krw: 0,
        tip: {
          ko: '분수 시간표는 시즌마다 변경 — 영업가이드에 미리 확인. 도시락 또는 치맥 추천.',
          en: 'Fountain schedule varies by season — confirm with our concierge. BYO picnic or chimaek recommended.',
          ja: '噴水スケジュールは季節により変動 — コンシェルジュに事前確認。お弁当やチメク推奨。',
          zh: '喷泉时间随季节变化 — 请提前向礼宾确认。建议自备便当或炸鸡啤酒。',
        },
        transit_from_prev: { method: 'car', minutes: 25, distance_km: 9.0 },
      },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. 서울 나이트투어
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'tour-seoul-night',
    slug: 'seoul-night-tour',
    region: 'Seoul',
    isNightTour: true,
    title: {
      ko: '서울 나이트투어',
      en: 'Seoul Night Tour',
      ja: 'ソウル ナイトツアー',
      zh: '首尔夜游',
    },
    summary: {
      ko: '명동 집합 → 북악스카이웨이 → 반포대교 무지개분수 → 해방촌 → 명동 드랍',
      en: 'Myeongdong meet · Bukak Skyway · Banpo Rainbow Fountain · Haebangchon · Myeongdong drop-off',
      ja: '明洞集合・北岳スカイウェイ・盤浦大橋虹噴水・解放村・明洞ドロップオフ',
      zh: '明洞集合·北岳天路·盘浦大桥彩虹喷泉·解放村·明洞下车',
    },
    description: {
      ko: '오후 6시 명동역 3번 출구 작은 공원에서 모임 → 북악스카이웨이 야경 드라이브 (40분) → 반포대교 달빛무지개분수 (2시간) → 해방촌 골목 산책 (1시간) → 다시 명동 드랍. 약 5시간 코스.',
      en: 'Meet 6 PM at the small park by Myeongdong Station Exit 3 → Bukak Skyway night drive (40 min) → Banpo Rainbow Fountain (2 h) → Haebangchon stroll (1 h) → drop-off back at Myeongdong. ~5-hour itinerary.',
      ja: '18時に明洞駅3番出口の小さな公園に集合 → 北岳スカイウェイ夜景ドライブ（40分）→ 盤浦大橋月光虹噴水（2時間）→ 解放村散策（1時間）→ 明洞ドロップオフ。約5時間コース。',
      zh: '18:00在明洞站3号出口的小公园集合 → 北岳天路夜景驾车（40分钟）→ 盘浦大桥月光彩虹喷泉（2小时）→ 解放村漫步（1小时）→ 返回明洞下车。约5小时行程。',
    },
    priceFrom: 49,
    priceUnit: 'per_person',
    currency: 'USD',
    durationDays: 1,
    durationHours: 5,
    vehicleType: 'Staria',
    maxPax: 7,
    thumbnail: '/J7FqPa_서울 밤도깨비 야시장(1).webp',
    images: [
      '/J7FqPa_서울 밤도깨비 야시장(1).webp',
      '/1uA0qa_반포대교(1).webp',
      '/Type1_반포대교_한국관광공사 이범수_1uA0qa(1).jpg',
      '/서울/서울 (14).jpg',
      '/서울/서울 (15).jpg',
      '/서울/서울 (18).jpg',
      '/Type1_광장시장_한국관광공사 이범수_84cpaa(1).jpg',
    ],
    tags: ['Popular', 'Night Tour'],
    highlights: [
      { icon: 'Mountain', text: { ko: '북악스카이웨이 야경 드라이브 (40분)', en: 'Bukak Skyway night drive (40 min)', ja: '北岳スカイウェイ夜景ドライブ（40分）', zh: '北岳天路夜景驾车（40分钟）' } },
      { icon: 'Sparkles', text: { ko: '반포대교 달빛무지개분수 (2시간)', en: 'Banpo Rainbow Fountain (2 h)', ja: '盤浦大橋月光虹噴水（2時間）', zh: '盘浦大桥月光彩虹喷泉（2小时）' } },
      { icon: 'Utensils', text: { ko: '해방촌 골목 산책 (1시간)', en: 'Haebangchon alley stroll (1 h)', ja: '解放村路地散策（1時間）', zh: '解放村漫步（1小时）' } },
      { icon: 'Shield', text: { ko: '톨비·주차비 전부 포함', en: 'Tolls · Parking — all included', ja: '通行料・駐車場 全込み', zh: '过路费·停车费全含' } },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. 단양 1일 투어
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'tour-danyang',
    slug: 'danyang-day-tour',
    region: 'Danyang',
    title: {
      ko: '단양 자연 투어 (1일)',
      en: 'Danyang Nature Day Tour',
      ja: '丹陽 自然ツアー（1日）',
      zh: '丹阳自然一日游',
    },
    summary: {
      ko: '도담삼봉·만천하스카이워크·고수동굴·단양강 잔도 — 서울 당일치기',
      en: 'Dodamsambong · Mancheonha Skywalk · Gosu Cave · Danyang River Trail — day trip from Seoul',
      ja: '島潭三峯・万川下スカイウォーク・高首洞窟・丹陽江桟道 — ソウルから日帰り',
      zh: '岛潭三峰·万天河天空走廊·高首洞窟·丹阳江栈道 — 首尔当天往返',
    },
    description: {
      ko: '남한강의 절경 속 단양의 대표 명소를 하루에 모두 담습니다. 삼봉이 우뚝 솟은 도담삼봉, 스릴 만점 만천하스카이워크, 신비로운 고수동굴, 남한강을 따라 걷는 단양강 잔도까지. 서울에서 왕복 전용 차량으로 당일 코스.',
      en: "Take in all of Danyang's highlights in one day. The iconic Dodamsambong rock formation, thrilling Mancheonha Skywalk, mystical Gosu Cave, and the scenic Danyang River cliff trail. Round trip from Seoul in a private vehicle.",
      ja: '南漢江の絶景の中、丹陽の代表スポットを1日で巡ります。島潭三峯の雄大な岩山、スリル満点の万天下スカイウォーク、神秘的な高首洞窟、南漢江に沿って歩く丹陽江桟道まで。ソウルから専用車で日帰りコース。',
      zh: '一天游览丹阳所有代表性景点。标志性的岛潭三峰、刺激的万天河天空走廊、神秘的高首洞窟，以及沿南汉江步行的丹阳江栈道。乘坐专属车辆从首尔当天往返。',
    },
    priceFrom: 250,
    currency: 'USD',
    durationDays: 1,
    durationHours: 11,
    vehicleType: 'Staria',
    maxPax: 7,
    thumbnail: '/Type1_도담삼봉_한국관광공사 김지호_m9M3Ka(2).jpg',
    images: [
      '/Type1_도담삼봉_한국관광공사 김지호_m9M3Ka(2).jpg',
      '/Type1_만천하스카이워크_한국관광공사 김지호_dAeuea(1).jpg',
      '/Type1_고수동굴_우창민_OKkx36(1).jpg',
      '/Type1_고수동굴_우창민_bq6ita(1).jpg',
      '/단양/단양 (1).jpg',
      '/단양/단양 (3).jpg',
      '/단양/단양 (5).jpg',
      '/Type1_단양강 잔도_한국관광공사 김지호_6yEHMa(1).jpg',
      '/Type1_단양 구인사_심현우_I9Wwhg(1).jpg',
    ],
    tags: ['Nature', 'Popular'],
    highlights: [
      { icon: 'Mountain', text: { ko: '도담삼봉 — 단양 8경 1위', en: 'Dodamsambong — Danyang No.1 Scenic Spot', ja: '島潭三峯 — 丹陽八景1位', zh: '岛潭三峰 — 丹阳八景第一' } },
      { icon: 'Wind', text: { ko: '만천하스카이워크 (스릴 보장)', en: 'Mancheonha Skywalk (vertigo guaranteed)', ja: '万天下スカイウォーク（スリル保証）', zh: '万天河天空走廊（刺激保证）' } },
      { icon: 'Layers', text: { ko: '고수동굴 탐험', en: 'Gosu Cave exploration', ja: '高首洞窟探検', zh: '高首洞窟探险' } },
      { icon: 'Shield', text: { ko: '서울↔단양 왕복 · 톨비 포함', en: 'Seoul↔Danyang round trip · Tolls incl.', ja: 'ソウル↔丹陽往復 · 通行料込み', zh: '首尔↔丹阳往返 · 含过路费' } },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. 인천 강화도 투어
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'tour-ganghwa',
    slug: 'incheon-ganghwa-tour',
    region: 'Ganghwa',
    title: {
      ko: '인천·강화도 투어 (1일)',
      en: 'Incheon & Ganghwa Island Tour',
      ja: '仁川・江華島ツアー（1日）',
      zh: '仁川·江华岛一日游',
    },
    summary: {
      ko: '강화도 마니산·전등사·강화갯벌·인천 차이나타운 — 서울 당일치기',
      en: 'Manisan Peak · Jeondeungsa Temple · Ganghwa Tidal Flat · Incheon Chinatown — from Seoul',
      ja: '摩尼山・伝灯寺・江華干潟・仁川チャイナタウン — ソウルから日帰り',
      zh: '摩尼山·传灯寺·江华滩涂·仁川唐人街 — 首尔当天往返',
    },
    description: {
      ko: '한국의 역사와 자연이 공존하는 강화도를 하루에 탐방합니다. 단군이 하늘에 제사를 올렸다는 마니산 참성단, 한국에서 가장 오래된 사찰 전등사, 수도권 최고의 갯벌 체험, 인천 차이나타운까지. 역사와 자연과 음식을 한 번에.',
      en: "Discover Ganghwa Island where Korean history and nature coexist. Manisan, the sacred altar of the founding myth, Jeondeungsa — one of Korea's oldest temples, the region's best tidal flat experience, and Incheon's vibrant Chinatown.",
      ja: '韓国の歴史と自然が共存する江華島を1日で探索。檀君が天に祭祀を捧げたとされる摩尼山参聖壇、韓国最古の寺院のひとつ伝灯寺、首都圏最高の干潟体験、仁川チャイナタウンまで。',
      zh: '一天探索历史与自然共存的江华岛。据说是檀君祭天之地的摩尼山参圣坛、韩国最古老寺院之一传灯寺、首都圈最佳滩涂体验，以及仁川唐人街。',
    },
    priceFrom: 220,
    currency: 'USD',
    durationDays: 1,
    durationHours: 9,
    vehicleType: 'Staria',
    maxPax: 7,
    thumbnail: '/region-ganghwa.webp',
    images: [
      '/region-ganghwa.webp',
      '/강화도/강화도 (1).jpg',
      '/강화도/강화도 (2).jpg',
      '/강화도/강화도 (4).jpg',
      '/강화도/강화도 (6).jpg',
      '/강화도/강화도 (8).jpg',
      '/강화도/강화도 (10).jpg',
      '/인천/인천 (1).jpg',
      '/인천/인천 (3).jpg',
    ],
    tags: ['History', 'Nature'],
    highlights: [
      { icon: 'Landmark', text: { ko: '마니산 참성단 (단군 성지)', en: 'Manisan — sacred Dangun altar', ja: '摩尼山参聖壇（檀君聖地）', zh: '摩尼山参圣坛（檀君圣地）' } },
      { icon: 'Church', text: { ko: '전등사 — 한국 최고 사찰 중 하나', en: 'Jeondeungsa — one of Korea\'s oldest temples', ja: '伝灯寺 — 韓国最古の寺院のひとつ', zh: '传灯寺 — 韩国最古老寺院之一' } },
      { icon: 'Waves', text: { ko: '강화 갯벌 체험 (선택)', en: 'Ganghwa tidal flat experience (optional)', ja: '江華干潟体験（任意）', zh: '江华滩涂体验（可选）' } },
      { icon: 'Shield', text: { ko: '서울↔강화도 왕복 · 톨비 포함', en: 'Seoul↔Ganghwa round trip · Tolls incl.', ja: 'ソウル↔江華島往復 · 通行料込み', zh: '首尔↔江华岛往返 · 含过路费' } },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. DMZ 파주 투어
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'tour-dmz',
    slug: 'dmz-paju-tour',
    region: 'DMZ',
    title: {
      ko: 'DMZ 파주 투어 (1일)',
      en: 'DMZ & Paju Day Tour',
      ja: 'DMZ・坡州 ツアー（1日）',
      zh: 'DMZ非军事区·坡州一日游',
    },
    summary: {
      ko: '판문점·JSA·제3땅굴·도라산역·임진각 — 세계 유일 분단 현장을 직접 보세요',
      en: 'Panmunjom · JSA · 3rd Infiltration Tunnel · Dorasan Station · Imjingak — witness history',
      ja: '板門店・JSA・第3トンネル・都羅山駅・臨津閣 — 世界唯一の分断現場を目撃',
      zh: '板门店·联合安全区·第3地道·都罗山站·临津阁 — 亲历世界唯一分裂现场',
    },
    description: {
      ko: '세계에서 유일하게 분단된 한반도의 역사적 현장 DMZ를 방문합니다. 남북이 마주한 판문점 공동경비구역(JSA), 북한이 뚫은 제3땅굴, 세상에서 가장 한가한 기차역 도라산역, 임진각 평화누리공원까지. 미리 신청 필요.',
      en: "Visit the DMZ, the world's most geopolitically charged border zone. The Joint Security Area (JSA) where North and South face each other, the eerie 3rd Infiltration Tunnel, Dorasan Station — the last stop before North Korea — and Imjingak Peace Park.",
      ja: '世界唯一の分断された朝鮮半島の歴史的現場DMZを訪問。南北が向き合う板門店共同警備区域（JSA）、北朝鮮が掘った第3トンネル、世界で最も静かな都羅山駅、臨津閣平和ヌリ公園まで。事前申請が必要。',
      zh: '参观世界上地缘政治最紧张的边境地带DMZ。南北对峙的板门店联合安全区（JSA）、朝鲜挖掘的第三地道、"世界上最闲"的都罗山站，以及临津阁和平广场。需提前申请。',
    },
    priceFrom: 230,
    currency: 'USD',
    durationDays: 1,
    durationHours: 9,
    vehicleType: 'Staria',
    maxPax: 7,
    thumbnail: '/region-dmz.webp',
    images: [
      '/region-dmz.webp',
      '/파주_dmz/파주 (1).jpg',
      '/파주_dmz/파주 (2).jpg',
      '/파주_dmz/파주 (3).jpg',
      '/파주_dmz/파주 (4).jpg',
      '/파주_dmz/파주 (5).jpg',
      '/파주_dmz/파주 (6).jpg',
      '/파주_dmz/파주 (7).jpg',
      '/파주_dmz/파주 (9).jpg',
    ],
    tags: ['History', 'Popular', 'AI-Curated'],
    highlights: [
      { icon: 'Flag', text: { ko: '판문점 JSA 공동경비구역 견학', en: 'Panmunjom JSA — Joint Security Area visit', ja: '板門店JSA共同警備区域見学', zh: '板门店联合安全区参观' } },
      { icon: 'ArrowDown', text: { ko: '제3땅굴 내부 투어', en: '3rd Infiltration Tunnel interior tour', ja: '第3トンネル内部ツアー', zh: '第三地道内部参观' } },
      { icon: 'Train', text: { ko: '도라산역 — 북쪽 방면 마지막 역', en: 'Dorasan Station — last stop before North Korea', ja: '都羅山駅 — 北朝鮮前最後の駅', zh: '都罗山站 — 前往朝鲜前的最后一站' } },
      { icon: 'Shield', text: { ko: '서울↔파주 왕복 · 톨비 포함', en: 'Seoul↔Paju round trip · Tolls incl.', ja: 'ソウル↔坡州往復 · 通行料込み', zh: '首尔↔坡州往返 · 含过路费' } },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. 남이섬 · 춘천 투어
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'tour-nami-chuncheon',
    slug: 'nami-island-chuncheon',
    region: 'Chuncheon',
    title: {
      ko: '남이섬·춘천 투어 (1일)',
      en: 'Nami Island & Chuncheon Tour',
      ja: 'ナミ島・春川 ツアー（1日）',
      zh: '南怡岛·春川一日游',
    },
    summary: {
      ko: '드라마 촬영지 남이섬·닭갈비 맛집·소양강 스카이워크 — 드라마 팬 필수 코스',
      en: 'Drama-famous Nami Island · Chuncheon Dakgalbi · Soyang River Skywalk — K-drama bucket list',
      ja: 'ドラマ聖地ナミ島・春川タッカルビ・昭陽江スカイウォーク — K-ドラマファン必訪',
      zh: '韩剧圣地南怡岛·春川辣炒鸡·昭阳江天空走廊 — 韩剧迷必去打卡',
    },
    description: {
      ko: '겨울연가로 유명해진 낭만의 남이섬과 닭갈비·막국수로 유명한 춘천을 함께 즐기는 코스. 배편으로 남이섬에 입도해 메타세쿼이아 길을 산책하고, 소양강 스카이워크에서 강원도 절경을 감상한 뒤 정통 춘천 닭갈비로 마무리.',
      en: "Combine the romance of Nami Island — made famous by the K-drama Winter Sonata — with Chuncheon's iconic Dakgalbi (spicy chicken). Ferry to Nami, walk the metasequoia-lined paths, enjoy the Soyang River Skywalk, then finish with authentic Chuncheon Dakgalbi.",
      ja: '冬のソナタで有名になったロマンチックなナミ島と、タッカルビ・マッコクスで有名な春川を合わせて楽しむコース。船でナミ島に渡りメタセコイア並木を散歩、昭陽江スカイウォークで絶景を満喫し、本場の春川タッカルビでしめくくり。',
      zh: '将因韩剧《冬季恋歌》而闻名的浪漫南怡岛与以辣炒鸡出名的春川完美结合。乘船登上南怡岛，漫步水杉小路，在昭阳江天空走廊欣赏江原道绝景，最后品尝正宗春川辣炒鸡。',
    },
    priceFrom: 220,
    currency: 'USD',
    durationDays: 1,
    durationHours: 10,
    vehicleType: 'Staria',
    maxPax: 7,
    thumbnail: '/Type1_남이섬_라이브스튜디오 김학리_nAXeHa(2).jpg',
    images: [
      '/Type1_남이섬_라이브스튜디오 김학리_nAXeHa(2).jpg',
      '/춘천/춘천 (1).jpeg',
      '/춘천/춘천 (2).jpeg',
      '/춘천/춘천 (3).jpeg',
      '/춘천/춘천 (4).jpeg',
      '/춘천/춘천 (5).jpeg',
      '/춘천/춘천 (6).jpeg',
      '/hero-chuncheon.webp',
    ],
    tags: ['Popular', 'AI-Curated'],
    highlights: [
      { icon: 'Boat', text: { ko: '남이섬 배편 포함 입도', en: 'Nami Island ferry tickets included', ja: 'ナミ島フェリー乗船券込み', zh: '含南怡岛渡轮票' } },
      { icon: 'Trees', text: { ko: '메타세쿼이아 길 산책', en: 'Metasequoia-lined path walk', ja: 'メタセコイア並木の散歩', zh: '水杉小路漫步' } },
      { icon: 'Utensils', text: { ko: '춘천 정통 닭갈비 맛집 (선택)', en: 'Authentic Chuncheon Dakgalbi (optional)', ja: '本場春川タッカルビ（任意）', zh: '正宗春川辣炒鸡（可选）' } },
      { icon: 'Shield', text: { ko: '서울↔춘천 왕복 · 톨비 포함', en: 'Seoul↔Chuncheon round trip · Tolls incl.', ja: 'ソウル↔春川往復 · 通行料込み', zh: '首尔↔春川往返 · 含过路费' } },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. 경주 1일 투어
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'tour-gyeongju',
    slug: 'gyeongju-day-tour',
    region: 'Gyeongju',
    title: {
      ko: '경주 역사 투어 (1일)',
      en: 'Gyeongju History Day Tour',
      ja: '慶州 歴史ツアー（1日）',
      zh: '庆州历史一日游',
    },
    summary: {
      ko: '불국사·석굴암·첨성대·대릉원·황리단길 — 야외 박물관 도시 경주',
      en: 'Bulguksa · Seokguram · Cheomseongdae · Daereungwon · Hwangridangil — Korea\'s open-air museum',
      ja: '仏国寺・石窟庵・瞻星台・大陵苑・黄理団キル — 屋外博物館都市・慶州',
      zh: '佛国寺·石窟庵·瞻星台·大陵苑·皇理团街 — 露天博物馆城市庆州',
    },
    description: {
      ko: '유네스코 세계유산의 도시 경주에서 신라 천년의 역사를 하루에 담습니다. 동양 최대 불교 사원 불국사, 신비로운 토함산 석굴암, 동양에서 가장 오래된 천문대 첨성대, 신라 왕릉이 즐비한 대릉원, 인스타 성지 황리단길까지.',
      en: "A full day in Gyeongju, UNESCO World Heritage city. Bulguksa — one of Asia's greatest Buddhist temples — Seokguram Grotto, Cheomseongdae Observatory (Asia's oldest), the royal tumuli of Daereungwon, and trendy Hwangridangil street.",
      ja: 'ユネスコ世界遺産の都市・慶州で新羅千年の歴史を1日で体験。東洋最大の仏教寺院・仏国寺、神秘的な吐含山石窟庵、東洋最古の天文台・瞻星台、新羅王陵が連なる大陵苑、インスタ映えスポット黄理団キルまで。',
      zh: '在联合国教科文组织世界遗产城市庆州，用一天时间体验新罗千年历史。亚洲最大佛教寺院佛国寺、神秘的石窟庵、亚洲最古老天文台瞻星台、新罗王陵林立的大陵苑，以及Instagram圣地皇理团街。',
    },
    priceFrom: 260,
    currency: 'USD',
    durationDays: 1,
    durationHours: 11,
    vehicleType: 'Staria',
    maxPax: 7,
    thumbnail: '/Type1_불국사_두드림_z0WAPa.jpg',
    images: [
      '/Type1_불국사_두드림_z0WAPa.jpg',
      '/Type1_첨성대_한국관광공사 김지호_r4H57a.jpg',
      '/Type1_대릉원(천마총)_한국관광공사, 엠엠피 김진규_651iea(1).jpg',
      '/Type1_황리단길_한국관광공사 김지호_p6JHdG.jpg',
      '/경주/경주 (1).jpg',
      '/경주/경주 (3).jpg',
      '/경주/경주 (5).jpg',
      '/경주/경주 (7).jpg',
      '/경주/경주 (10).jpg',
    ],
    tags: ['History', 'Popular'],
    highlights: [
      { icon: 'Church', text: { ko: '불국사·석굴암 — 유네스코 세계유산', en: 'Bulguksa & Seokguram — UNESCO World Heritage', ja: '仏国寺・石窟庵 — ユネスコ世界遺産', zh: '佛国寺·石窟庵 — 联合国教科文组织世界遗产' } },
      { icon: 'Star', text: { ko: '첨성대 — 동양 최고(最古) 천문대', en: 'Cheomseongdae — Asia\'s oldest observatory', ja: '瞻星台 — 東洋最古の天文台', zh: '瞻星台 — 亚洲最古老天文台' } },
      { icon: 'Landmark', text: { ko: '대릉원·황리단길 포함', en: 'Daereungwon Tumuli & Hwangridangil', ja: '大陵苑・黄理団キル', zh: '大陵苑·皇理团街' } },
      { icon: 'Shield', text: { ko: '서울↔경주 왕복 · 톨비 포함', en: 'Seoul↔Gyeongju round trip · Tolls incl.', ja: 'ソウル↔慶州往復 · 通行料込み', zh: '首尔↔庆州往返 · 含过路费' } },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 8. 부산 1일 투어 (당일)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'tour-busan-day',
    slug: 'busan-day-tour',
    region: 'Busan',
    title: {
      ko: '부산 시티투어 (1일)',
      en: 'Busan City Day Tour',
      ja: '釜山 シティツアー（1日）',
      zh: '釜山城市一日游',
    },
    summary: {
      ko: '해운대·광안리·감천문화마을·자갈치시장·태종대 — 부산 하이라이트',
      en: 'Haeundae · Gwangalli · Gamcheon · Jagalchi Market · Taejongdae — Busan highlights',
      ja: '海雲台・広安里・甘川文化村・チャガルチ市場・太宗台 — 釜山ハイライト',
      zh: '海云台·广安里·甘川文化村·札嘎其市场·太宗台 — 釜山精华',
    },
    description: {
      ko: '부산의 화려한 해변과 문화를 하루에 압축합니다. 새벽 해운대 해수욕장 산책, 이색적인 감천문화마을, 신선한 해산물 자갈치시장, 광안대교가 보이는 광안리 해변, 웅장한 태종대 절벽까지. 당일 코스로 부산 알차게 즐기기.',
      en: "Busan's beaches, art, and seafood — all in one day. Dawn walk at Haeundae, colorful Gamcheon Culture Village, fresh seafood at Jagalchi Market, Gwangalli Beach with Gwangan Bridge views, and the dramatic cliffs of Taejongdae.",
      ja: '釜山のビーチと文化を1日でギュッと詰め込みます。夜明けの海雲台散歩、ユニークな甘川文化村、鮮魚のチャガルチ市場、広安大橋が望める広安里ビーチ、雄大な太宗台の断崖まで。',
      zh: '一天压缩感受釜山的海滩与文化。黎明时分漫步海云台、色彩斑斓的甘川文化村、新鲜海鲜的札嘎其市场、可欣赏广安大桥的广安里海滩，以及壮观的太宗台悬崖。',
    },
    priceFrom: 327, // from spec.daily_tour_prices.busan-day.priceUSD — SSOT 일치 (B9-38: $415→$327, ₩572K→₩450K 시장 평균)
    currency: 'USD',
    durationDays: 1,
    durationHours: 10, // spec.daily_tour_prices.busan-day.hours 일치 (B9-38: 12→10, 시장 평균 KKday/Klook/KoreaTravelEasy 9-10h)
    vehicleType: 'Staria',
    maxPax: 7,
    thumbnail: '/Type1_광안대교, 도시를 품다_최영근_XA2xTa(1).jpg',
    images: [
      '/Type1_광안대교, 도시를 품다_최영근_XA2xTa(1).jpg',
      '/Type1_해동용궁사_한국관광공사 김지호_Ha9TWa.jpg',
      '/Type1_자갈치시장_IR 스튜디오_LNrJOa.jpg',
      '/Type1_깡통야시장_한국관광공사 김지호_sS5JDa(1).jpg',
      '/부산/부산 (1).jpg',
      '/부산/부산 (3).jpg',
      '/부산/부산 (5).jpg',
      '/부산/부산 (7).jpg',
    ],
    tags: ['Popular', 'Best Value'],
    highlights: [
      { icon: 'Waves', text: { ko: '해운대·광안리 해변', en: 'Haeundae & Gwangalli Beach', ja: '海雲台・広安里ビーチ', zh: '海云台·广安里海滩' } },
      { icon: 'Camera', text: { ko: '감천문화마을 포토스팟', en: 'Gamcheon Culture Village photo spots', ja: '甘川文化村フォトスポット', zh: '甘川文化村拍照打卡' } },
      { icon: 'Fish', text: { ko: '자갈치시장 해산물 (선택)', en: 'Jagalchi Market fresh seafood (optional)', ja: 'チャガルチ市場の鮮魚（任意）', zh: '札嘎其市场新鲜海鲜（可选）' } },
      // 출발지 명확화 — 사용자 가격 의문 해소 (서울↔부산 왕복 라벨이 부정확했음)
      { icon: 'Shield', text: { ko: '부산 권역 1일 · 출발지 협의 · 톨비 포함', en: 'Busan region 1-day · Pickup location TBA · Tolls incl.', ja: '釜山エリア1日 · 出発地別途相談 · 通行料込み', zh: '釜山地区一日 · 出发地另议 · 含过路费' } },
    ],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 9. 서울·경주·부산 멀티시티 3일 2박
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: 'tour-multicity-3d',
    slug: 'korea-multicity-3d2n',
    region: 'Multi-City',
    title: {
      ko: '한국 멀티시티 3일 2박 (서울·경주·부산)',
      en: 'Korea Multi-City 3D2N (Seoul · Gyeongju · Busan)',
      ja: '韓国マルチシティ 3日2泊（ソウル・慶州・釜山）',
      zh: '韩国多城市三天两夜（首尔·庆州·釜山）',
    },
    summary: {
      ko: '서울 명소 → 경주 천년고도 → 부산 해변 — 한국 핵심 3도시 완전정복',
      en: 'Seoul highlights → Gyeongju ancient capital → Busan beaches — Korea\'s 3 must-see cities',
      ja: 'ソウル名所 → 慶州千年古都 → 釜山ビーチ — 韓国3大都市完全制覇',
      zh: '首尔名胜→庆州千年古都→釜山海滩 — 韩国三大必游城市完全攻略',
    },
    description: {
      ko: '한국 여행의 정수를 3일에 담은 최고 인기 코스. 1일차 서울 경복궁·북촌, 2일차 경주 불국사·첨성대·황리단길, 3일차 부산 해운대·감천문화마을·자갈치시장까지. 스프린터 전용 차량으로 이동하며 호텔 2박 포함.',
      en: "Korea's ultimate 3-day itinerary. Day 1: Seoul's Gyeongbokgung & Bukchon. Day 2: Gyeongju's Bulguksa, Cheomseongdae, and Hwangridangil. Day 3: Busan's Haeundae, Gamcheon, and Jagalchi. Private Sprinter van throughout, 2 nights hotel included.",
      ja: '韓国旅行の精髄を3日に詰め込んだ最人気コース。1日目ソウル景福宮・北村、2日目慶州仏国寺・瞻星台・黄理団キル、3日目釜山海雲台・甘川文化村・チャガルチ市場まで。スプリンター専用車両で移動、ホテル2泊込み。',
      zh: '韩国旅游精华三日行程。第1天：首尔景福宫·北村。第2天：庆州佛国寺·瞻星台·皇理团街。第3天：釜山海云台·甘川文化村·札嘎其市场。全程专属Sprinter面包车，含2晚酒店。',
    },
    priceFrom: 580,
    currency: 'USD',
    durationDays: 3,
    vehicleType: 'Sprinter',
    maxPax: 10,
    thumbnail: '/hero-gyeongju.webp',
    images: [
      '/hero-gyeongju.webp',
      '/JnR5Ie_경복궁(1).webp',
      '/Type1_불국사_두드림_z0WAPa.jpg',
      '/Type1_광안대교, 도시를 품다_최영근_XA2xTa(1).jpg',
      '/hero-busan-real.webp',
      '/경주/경주 (2).jpg',
      '/부산/부산 (2).jpg',
    ],
    tags: ['Popular', 'Multi-City', 'AI-Curated'],
    highlights: [
      { icon: 'MapPin', text: { ko: '서울·경주·부산 3도시', en: 'Seoul · Gyeongju · Busan — 3 cities', ja: 'ソウル・慶州・釜山 3都市', zh: '首尔·庆州·釜山三城市' } },
      { icon: 'Hotel', text: { ko: '호텔 2박 포함', en: '2 nights hotel included', ja: 'ホテル2泊込み', zh: '含2晚酒店' } },
      { icon: 'Car', text: { ko: '스프린터 전용 차량 (10인 이하)', en: 'Private Sprinter van (up to 10 pax)', ja: 'スプリンター専用車両（10名以下）', zh: '专属Sprinter面包车（最多10人）' } },
      { icon: 'Shield', text: { ko: '톨비·주차비 전부 포함', en: 'Tolls · Parking — all included', ja: '通行料・駐車場 全込み', zh: '过路费·停车费全含' } },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 투어별 메타 오버라이드 (rating + 추가 driverLanguages)
// 본문 객체에 일일이 박지 않고 한 곳에서 관리. v2 amendment 2026-04-25.
// ─────────────────────────────────────────────────────────────────────────────
const TOUR_META: Record<string, Partial<Tour>> = {
  'tour-seoul-city':     { rating: 4.9, reviewCount: 87,  reviewSource: 'internal' },
  'tour-seoul-night':    { driverLanguages: ['en', 'ja', 'zh'], rating: 4.8, reviewCount: 54,  reviewSource: 'internal' },
  'tour-danyang':        { driverLanguages: ['en', 'ja', 'zh'], rating: 4.7, reviewCount: 31,  reviewSource: 'internal' },
  'tour-ganghwa':        { driverLanguages: ['en', 'ja', 'zh'], rating: 4.7, reviewCount: 28,  reviewSource: 'internal' },
  'tour-dmz':            { driverLanguages: ['en', 'ja', 'zh'], rating: 4.9, reviewCount: 142, reviewSource: 'internal' },
  'tour-nami-chuncheon': { driverLanguages: ['en', 'ja', 'zh'], rating: 4.8, reviewCount: 96,  reviewSource: 'internal' },
  'tour-gyeongju':       { driverLanguages: ['en', 'ja', 'zh'], rating: 4.8, reviewCount: 47,  reviewSource: 'internal' },
  'tour-busan-day':      { driverLanguages: ['en', 'ja', 'zh'], rating: 4.7, reviewCount: 38,  reviewSource: 'internal' },
  'tour-multicity-3d':   { driverLanguages: ['en', 'ja', 'zh'], rating: 4.9, reviewCount: 23,  reviewSource: 'internal' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 투어별 stops 데이터 — 본문에 박지 않고 ID로 매핑 (서울 시티는 본문 우선).
// 영업가이드 + Korea Tourism Org 자료 기반 초안. 사용자 검수 후 운영 정책에 맞춰 갱신.
// ─────────────────────────────────────────────────────────────────────────────
const TOUR_STOPS_BY_ID: Record<string, TourStop[]> = {
  'tour-seoul-night': [
    {
      time: '18:00',
      name: { ko: '명동역 3번출구 작은 공원 (집합)', en: 'Myeongdong Station Exit 3 Small Park (Meeting Point)', ja: '明洞駅3番出口の小さな公園（集合）', zh: '明洞站3号出口的小公园（集合）' },
      stay_min: 10,
      description: {
        ko: '저녁 6시 정각 명동역 3번 출구 옆 작은 공원에서 가이드와 만나 출발. 전용 스타리아 차량 픽업.',
        en: 'Meet your guide at 6 PM sharp at the small park beside Myeongdong Station Exit 3. Private Staria pickup.',
        ja: '18時ちょうどに明洞駅3番出口横の小さな公園でガイドと合流。専用スタリアでピックアップ。',
        zh: '18:00在明洞站3号出口旁的小公园与导游会合，专属Staria车辆接送出发。',
      },
      entry_fee_krw: 0,
      tip: { ko: '명동역 3번 출구는 명동성당 방향. 시간 엄수 — 차량 정차 가능 시간 짧음.', en: 'Exit 3 faces Myeongdong Cathedral. Be on time — limited vehicle wait window.', ja: '3番出口は明洞聖堂方面。車の停車時間が短いため時間厳守。', zh: '3号出口朝明洞圣堂方向。请准时—车辆停靠时间有限。' },
    },
    {
      time: '18:25', name: { ko: '북악스카이웨이', en: 'Bukak Skyway', ja: '北岳スカイウェイ', zh: '北岳天路' },
      stay_min: 40, photo: '/서울/서울 (14).jpg',
      description: { ko: '북악산 능선을 따라 이어지는 야경 드라이브 코스. 팔각정 전망대에서 서울 도심 야경 한눈에.', en: 'Scenic ridgeline drive on Bukak Mountain. Stop at Palgakjeong Pavilion for a panoramic Seoul night skyline.', ja: '北岳山の稜線をたどる夜景ドライブ。八角亭展望台からソウル都心の夜景を一望。', zh: '沿北岳山山脊的夜景驾车路线，在八角亭观景台俯瞰首尔市区夜景。' },
      entry_fee_krw: 0,
      tip: { ko: '팔각정 무료 전망. 차량에서 짧게 내려 사진 촬영 가능.', en: 'Palgakjeong viewpoint is free. Quick photo stops by car.', ja: '八角亭は無料展望。車を停めて短時間撮影可能。', zh: '八角亭免费观景，可短暂停车拍照。' },
      transit_from_prev: { method: 'car', minutes: 15, distance_km: 8.0 },
    },
    {
      time: '19:35', name: { ko: '반포대교 달빛무지개분수', en: 'Banpo Bridge Rainbow Fountain', ja: '盤浦大橋月光虹噴水', zh: '盘浦大桥月光彩虹喷泉' },
      stay_min: 120, photo: '/1uA0qa_반포대교(1).webp',
      description: { ko: '4-10월 한정 야간 분수쇼와 한강 야경. 분수쇼 관람 + 한강공원 산책 + 야식 포장마차까지 2시간 여유롭게.', en: 'April-October night fountain show + Han River views. 2 hours: fountain show, riverside stroll, and street-food stalls.', ja: '4-10月限定の夜の噴水ショー＋漢江夜景。ショー観賞、漢江公園散策、屋台まで2時間ゆったり。', zh: '4-10月限定夜间喷泉表演＋汉江夜景。2小时含喷泉表演、江边漫步、夜宵摊位。' },
      entry_fee_krw: 0,
      tip: { ko: '쇼 시간표 시즌별 변동 (보통 20:00·20:30·21:00). 가이드가 현장 안내. 11-3월은 분수 비운영.', en: 'Show times vary seasonally (typically 8/8:30/9 PM). Guide will brief on site. Fountain off Nov-Mar.', ja: 'ショー時間は季節変動（通常20:00·20:30·21:00）。11-3月は噴水休止。', zh: '表演时间随季节变化（通常20:00/20:30/21:00）。11-3月喷泉停运。' },
      transit_from_prev: { method: 'car', minutes: 25, distance_km: 14.0 },
    },
    {
      time: '22:00', name: { ko: '해방촌', en: 'Haebangchon', ja: '解放村', zh: '解放村' },
      stay_min: 60, photo: '/서울/해방촌-남산야경.jpg',
      description: { ko: '남산 자락 옛 달동네에 자리잡은 핫플 골목. 루프탑 바, 빈티지 카페, 외국인 친화 펍이 모인 야경 산책 코스.', en: "Trendy hillside neighborhood under Namsan — rooftop bars, vintage cafés, expat-friendly pubs lit up at night.", ja: '南山の麓、レトロな路地に若者文化が集う街。ルーフトップバーやヴィンテージカフェの夜景散策。', zh: '南山脚下的潮人街区，云集天台酒吧、复古咖啡馆、外国人友好酒馆的夜景漫步路线。' },
      entry_fee_krw: 0,
      tip: { ko: '신흥시장·해방촌 오거리 추천. 카페/바 1잔 별도 결제. 가이드가 추천 코스 안내.', en: 'Sinheung Market and HBC 5-way junction recommended. Drinks paid separately. Guide will suggest spots.', ja: '新興市場・解放村五差路がおすすめ。カフェ・バー代は別途。', zh: '推荐新兴市场和解放村五路口。饮品另付。导游会推荐路线。' },
      transit_from_prev: { method: 'car', minutes: 20, distance_km: 7.5 },
    },
    {
      time: '23:05', name: { ko: '명동 드랍오프', en: 'Drop-off at Myeongdong', ja: '明洞ドロップオフ', zh: '明洞下车' },
      stay_min: 0,
      description: { ko: '명동역 3번 출구 인근 안전 지점에 도착 후 투어 종료. 호텔이 명동권이면 호텔 앞 추가 드랍 가능 (사전 협의).', en: 'Tour ends near Myeongdong Station Exit 3. Hotel drop-off available within Myeongdong area (request in advance).', ja: '明洞駅3番出口付近で解散。明洞圏のホテルは事前依頼で前まで送迎可。', zh: '在明洞站3号出口附近结束行程。明洞区酒店可提前申请送至门口。' },
      entry_fee_krw: 0,
      tip: { ko: '늦은 시간이라 명동 식당가 일부 영업 종료. 야식 원하면 해방촌에서 미리.', en: 'Many Myeongdong restaurants closed at this hour — eat in Haebangchon if hungry.', ja: '明洞の飲食店は閉店多数。夜食は解放村で済ませて。', zh: '明洞餐厅此时多已打烊，宵夜请在解放村解决。' },
      transit_from_prev: { method: 'car', minutes: 10, distance_km: 3.5 },
    },
  ],

  'tour-danyang': [
    { time: '09:30', name: { ko: '도담삼봉', en: 'Dodamsambong', ja: '島潭三峯', zh: '岛潭三峰' }, stay_min: 60, photo: '/Type1_도담삼봉_한국관광공사 김지호_m9M3Ka(2).jpg',
      description: { ko: '남한강 위 세 봉우리. 단양의 상징적 풍경, 정도전 일화 유명.', en: 'Three rocky peaks rising from Namhangang River, the icon of Danyang.', ja: '南漢江に三つの岩峰がそびえる丹陽の象徴。', zh: '南汉江上三座岩峰，丹阳的标志景观。' },
      entry_fee_krw: 0, tip: { ko: '유람선 ₩13,000으로 가까이 감상 가능.', en: 'Sightseeing boat ₩13,000 for closer view.', ja: '遊覧船₩13,000で近くから観賞可能。', zh: '可乘游船₩13,000近距离观赏。' } },
    { time: '10:45', name: { ko: '단양강 잔도', en: 'Danyanggang Cliff Trail', ja: '丹陽江桟道', zh: '丹阳江栈道' }, stay_min: 90, photo: '/Type1_단양강 잔도_한국관광공사 김지호_6yEHMa(1).jpg',
      description: { ko: '절벽 위 1.2km 데크길. 남한강 절경을 따라 걸으며 사진 명소.', en: '1.2km cliff-side deck along the Namhangang River — a scenic photo trail.', ja: '崖沿いに1.2kmのデッキ歩道。南漢江の絶景。', zh: '崖边1.2km栈道，沿南汉江绝景拍照。' },
      entry_fee_krw: 0, transit_from_prev: { method: 'car', minutes: 10, distance_km: 7 } },
    { time: '12:30', name: { ko: '점심 — 마늘정식', en: 'Garlic-Set Lunch', ja: 'ニンニク定食ランチ', zh: '大蒜套餐午餐' }, stay_min: 60,
      description: { ko: '단양 명물 마늘 요리 한정식 (성원마늘약선요리, 장다리식당 등).', en: 'Danyang specialty garlic-themed Korean set menu.', ja: '丹陽名物のニンニク韓定食。', zh: '丹阳特色大蒜韩定食。' },
      entry_fee_krw: 0, tip: { ko: '1인 ₩20,000~30,000. 마늘닭, 마늘갈비 추천.', en: '₩20-30k per person. Try garlic chicken or garlic ribs.', ja: '1人₩20,000~30,000。ニンニクチキン·カルビ推奨。', zh: '人均₩20-30k。推荐蒜鸡、蒜排。' },
      transit_from_prev: { method: 'car', minutes: 8, distance_km: 5 } },
    { time: '14:00', name: { ko: '만천하스카이워크', en: 'Mancheonha Skywalk', ja: '万天下スカイウォーク', zh: '万天河天空走廊' }, stay_min: 75, photo: '/Type1_만천하스카이워크_한국관광공사 김지호_dAeuea(1).jpg',
      description: { ko: '지상 80m 강화유리 전망대. 단양강 360° 풍경, 짚라인 옵션.', en: '80m-high glass-floor observatory with 360° view; zipline optional.', ja: '地上80mのガラス展望台。360°ビュー、ジップラインも。', zh: '80米高玻璃观景台，360°景观，可选高空滑索。' },
      entry_fee_krw: 4000, tip: { ko: '짚라인 ₩42,000 별도. 고소공포증 주의.', en: 'Zipline ₩42,000 extra. Not for fear of heights.', ja: 'ジップライン₩42,000別途。高所恐怖症は注意。', zh: '高空滑索₩42,000另付。恐高慎入。' },
      transit_from_prev: { method: 'car', minutes: 15, distance_km: 9 } },
    { time: '15:45', name: { ko: '고수동굴', en: 'Gosu Cave', ja: '高首洞窟', zh: '高首洞窟' }, stay_min: 75, photo: '/Type1_고수동굴_우창민_OKkx36(1).jpg',
      description: { ko: '천연기념물 석회동굴. 1.7km 코스, 종유석·석순 장관.', en: 'Natural monument limestone cave. 1.7km course of stalactites/stalagmites.', ja: '天然記念物の石灰洞窟。1.7kmコース、鍾乳石が見事。', zh: '国家级石灰岩洞窟，1.7km路线，钟乳石壮观。' },
      entry_fee_krw: 9000, tip: { ko: '동굴 내 일정 온도 15°C. 미끄러우니 운동화.', en: 'Cave is 15°C year-round; wear sneakers (slippery).', ja: '洞内15°C一定。滑るのでスニーカー必須。', zh: '洞内常年15°C，路面湿滑请穿运动鞋。' },
      transit_from_prev: { method: 'car', minutes: 18, distance_km: 11 } },
  ],

  'tour-ganghwa': [
    { time: '10:30', name: { ko: '전등사', en: 'Jeondeungsa Temple', ja: '伝燈寺', zh: '传灯寺' }, stay_min: 75,
      description: { ko: '천년 고찰. 산성 안의 사찰로 단군 유적과 이어진다.', en: 'Millennium-old temple within Samrangseong Fortress, tied to Dangun lore.', ja: '1000年の古刹。三郎城内、檀君伝説と関連。', zh: '千年古刹，位于三郎城内，与檀君传说相连。' },
      entry_fee_krw: 4000, tip: { ko: '사찰 입장 시 모자 벗기. 사진 촬영 일부 제한.', en: 'Remove hats inside; photography limited in some halls.', ja: '入場時帽子を脱ぐ。一部撮影制限。', zh: '入殿请脱帽，部分殿堂禁拍照。' } },
    { time: '12:15', name: { ko: '점심 — 강화 인삼한정식', en: 'Lunch — Ganghwa Ginseng Set', ja: 'ランチ — 江華人参定食', zh: '午餐 — 江华人参定食' }, stay_min: 75,
      description: { ko: '강화 인삼 명물. 인삼 닭백숙·전·튀김 코스.', en: "Ganghwa's signature ginseng course — chicken stew, pancake, fried set.", ja: '江華人参の定食。鶏湯、チヂミ、揚物コース。', zh: '江华人参定食。人参鸡汤、煎饼、炸物。' },
      entry_fee_krw: 0, tip: { ko: '1인 ₩25,000~35,000. 동원아트홀 인근 권장.', en: '₩25-35k pp. Restaurants near Dongwon Art Hall recommended.', ja: '1人₩25,000~35,000。Dongwon Art Hall周辺推奨。', zh: '人均₩25-35k。推荐Dongwon艺术厅附近。' },
      transit_from_prev: { method: 'car', minutes: 12, distance_km: 8 } },
    { time: '14:00', name: { ko: '광성보', en: 'Gwangseongbo Fortress', ja: '広城堡', zh: '广城堡' }, stay_min: 60,
      description: { ko: '신미양요 격전지 해안 요새. 바다와 어우러진 사적지.', en: 'Coastal fortress of the 1871 US-Korea Battle. Sea-side historic site.', ja: '辛未洋擾の戦跡。海辺の史跡。', zh: '辛未洋扰激战地，海边古迹。' },
      entry_fee_krw: 1100, tip: { ko: '느린 산책 코스. 운동화 권장.', en: 'Easy walking course; sneakers recommended.', ja: 'ゆっくり散策コース。運動靴推奨。', zh: '慢步路线，建议运动鞋。' },
      transit_from_prev: { method: 'car', minutes: 18, distance_km: 12 } },
    { time: '15:30', name: { ko: '동막해변', en: 'Dongmak Beach', ja: '東幕海辺', zh: '东幕海边' }, stay_min: 60,
      description: { ko: '서해 갯벌과 일몰 명소. 조개 캐기·갯벌 체험 가능.', en: 'West Sea mudflat and sunset spot; clam digging available.', ja: '西海の干潟と夕日スポット。潮干狩り体験可能。', zh: '西海滩涂与日落胜地，可挖蛤。' },
      entry_fee_krw: 0, tip: { ko: '물때표 미리 확인. 갯벌 들어갈 시 장화 대여.', en: 'Check tide chart; rent boots before entering mudflats.', ja: '潮見表確認。長靴レンタル可能。', zh: '请查潮汐时间，下滩前租雨鞋。' },
      transit_from_prev: { method: 'car', minutes: 15, distance_km: 10 } },
  ],

  'tour-dmz': [
    { time: '08:30', name: { ko: '임진각 평화공원', en: 'Imjingak Peace Park', ja: '臨津閣平和公園', zh: '临津阁和平公园' }, stay_min: 60,
      description: { ko: '분단의 상징 공원. 자유의 다리, 평화의 종, 망배단.', en: 'Park symbolizing division — Freedom Bridge, Peace Bell, Mangbaedan.', ja: '分断の象徴公園。自由の橋、平和の鐘、望拜壇。', zh: '分裂象征公园。自由之桥、和平之钟、望拜坛。' },
      entry_fee_krw: 0, tip: { ko: '주차장 입구에서 통합 신청서 작성 (여권 지참).', en: 'Combo permit form at entrance (passport required).', ja: '入口で総合申請書記入（パスポート必須）。', zh: '入口处填写综合申请表（请带护照）。' } },
    { time: '10:00', name: { ko: '제3땅굴', en: '3rd Tunnel', ja: '第3トンネル', zh: '第三隧道' }, stay_min: 75,
      description: { ko: '북한이 판 침투 땅굴. 73m 아래 모노레일 또는 도보 진입.', en: 'North Korean infiltration tunnel; descend 73m by monorail or walking.', ja: '北朝鮮の侵入トンネル。73m下までモノレールまたは徒歩。', zh: '朝鲜挖的渗透隧道，可乘单轨或步行下73m。' },
      entry_fee_krw: 7700, tip: { ko: '입장료는 도라산·통일촌 통합권. 헬멧·카메라 보관 필수.', en: 'Combo ticket with Dorasan & Unification Village. Helmet required, no cameras inside.', ja: '都羅山·統一村との通票。ヘルメット必須、カメラ預け。', zh: '与都罗山·统一村通票。需戴头盔、相机寄存。' },
      transit_from_prev: { method: 'car', minutes: 12, distance_km: 7 } },
    { time: '11:45', name: { ko: '도라산 전망대', en: 'Dorasan Observatory', ja: '都羅山展望台', zh: '都罗山观景台' }, stay_min: 45,
      description: { ko: '북한 개성공단·송악산 조망. 망원경으로 북측 마을 관찰.', en: 'View Kaesong Industrial Region and Mt. Songak; binoculars to observe NK villages.', ja: '北朝鮮·開城工業団地と松岳山を望む。望遠鏡で北側の村を観察。', zh: '远眺朝鲜开城工业区和松岳山，望远镜观察北方村庄。' },
      entry_fee_krw: 0, tip: { ko: '날씨 맑은 날 가시거리 좋음. 망원경 ₩500.', en: 'Clear days = better visibility. Binoculars ₩500 each.', ja: '晴天なら視界良好。望遠鏡₩500。', zh: '晴天视野最佳。望远镜₩500。' },
      transit_from_prev: { method: 'car', minutes: 8, distance_km: 5 } },
    { time: '12:45', name: { ko: '도라산역', en: 'Dorasan Station', ja: '都羅山駅', zh: '都罗山站' }, stay_min: 30,
      description: { ko: '남북 연결 철도역. "Pyongyang →" 방향판 포토 스팟.', en: 'Inter-Korean railway station with iconic "To Pyongyang" sign photo spot.', ja: '南北連結鉄道駅。"平壌→"の方向板フォトスポット。', zh: '南北连接铁路站，"开往平壤"路牌拍照点。' },
      entry_fee_krw: 0, tip: { ko: '입장권 패스 포함. 통일 우표 기념품샵.', en: 'Included in combo pass. Unification stamps souvenir shop.', ja: '通票に含まれる。統一切手土産。', zh: '含在通票内。统一邮票纪念品店。' },
      transit_from_prev: { method: 'car', minutes: 5, distance_km: 3 } },
    { time: '13:30', name: { ko: '통일촌 점심', en: 'Unification Village Lunch', ja: '統一村ランチ', zh: '统一村午餐' }, stay_min: 75,
      description: { ko: '민통선 안 마을 식당. 마을 콩으로 만든 청국장·두부 정식.', en: 'Restaurant in Civilian Control Zone village; cheonggukjang and tofu sets.', ja: '民統線内の村レストラン。村産大豆の清麹醤·豆腐定食。', zh: '民统线内村庄餐馆。村产大豆制成的清麹酱·豆腐定食。' },
      entry_fee_krw: 0, tip: { ko: '1인 ₩15,000~20,000. 마을 콩나물·된장 구매 가능.', en: '₩15-20k pp. Village soybean sprouts and miso for sale.', ja: '1人₩15,000~20,000。村のもやしや味噌販売。', zh: '人均₩15-20k。村产豆芽、大酱可购。' },
      transit_from_prev: { method: 'car', minutes: 6, distance_km: 4 } },
  ],

  'tour-nami-chuncheon': [
    { time: '09:30', name: { ko: '남이섬', en: 'Nami Island', ja: '南怡島', zh: '南怡岛' }, stay_min: 180,
      description: { ko: '겨울연가 촬영지로 유명한 반달형 섬. 메타세쿼이아 길과 자전거 추천.', en: 'Half-moon island famous from Winter Sonata. Metasequoia path, rental bikes.', ja: '「冬のソナタ」ロケ地で有名な半月島。メタセコイア並木、自転車。', zh: '《冬季恋歌》取景地半月岛。水杉小道、可租自行车。' },
      entry_fee_krw: 16000, tip: { ko: '도선료 ₩16,000 (왕복). 짚와이어 ₩44,000 옵션.', en: 'Ferry ₩16,000 round-trip. Zipwire option ₩44,000.', ja: 'フェリー往復₩16,000。ジップワイヤ₩44,000。', zh: '渡轮往返₩16,000。可选高空索道₩44,000。' } },
    { time: '13:00', name: { ko: '점심 — 가평 잣국수', en: 'Lunch — Gapyeong Pine Nut Noodles', ja: 'ランチ — 加平松の実麺', zh: '午餐 — 加平松子面' }, stay_min: 60,
      description: { ko: '가평 명물 잣 들어간 시원한 국수.', en: "Gapyeong's famous chilled noodles with pine nuts.", ja: '加平名物の冷たい松の実麺。', zh: '加平特色冷面，配松子。' },
      entry_fee_krw: 0, tip: { ko: '1인 ₩12,000~15,000. 호명별곡, 산뜻한 잣국수 추천.', en: '₩12-15k pp. Try Homyeong-byeolgok or local jat-guksu spots.', ja: '1人₩12,000~15,000。Homyeong-byeolgok等推奨。', zh: '人均₩12-15k。推荐Homyeong-byeolgok等。' },
      transit_from_prev: { method: 'car', minutes: 15, distance_km: 8 } },
    { time: '14:30', name: { ko: '쁘띠프랑스', en: 'Petite France', ja: 'プチフランス', zh: '小法兰西' }, stay_min: 90,
      description: { ko: '프랑스 마을 테마파크. 별주부전 등 K-드라마 촬영지.', en: 'French-themed village park. K-drama filming locations like Beethoven Virus.', ja: 'フランステーマパーク。Kドラマロケ地。', zh: '法国主题村庄主题公园。多部韩剧取景。' },
      entry_fee_krw: 12000, tip: { ko: '인형극·마리오네트 공연 시간표 미리 확인.', en: 'Check puppet show schedule beforehand.', ja: '人形劇のスケジュール確認推奨。', zh: '请提前确认木偶戏时间表。' },
      transit_from_prev: { method: 'car', minutes: 25, distance_km: 18 } },
    { time: '16:30', name: { ko: '춘천 닭갈비 골목', en: 'Chuncheon Dakgalbi Alley', ja: '春川タッカルビ通り', zh: '春川炒鸡排街' }, stay_min: 90,
      description: { ko: '춘천 명동 닭갈비 거리. 매콤한 닭갈비와 막국수 결합 메뉴.', en: 'Chuncheon Myeongdong dakgalbi alley — spicy chicken stir-fry with makguksu.', ja: '春川明洞タッカルビ通り。タッカルビとマッククス。', zh: '春川明洞炒鸡排街。辣味鸡排配荞麦冷面。' },
      entry_fee_krw: 0, tip: { ko: '1인 ₩14,000~18,000. 춘천 닭갈비1번지·우성닭갈비 추천.', en: '₩14-18k pp. Chuncheon Dakgalbi 1st St., Useong recommended.', ja: '1人₩14,000~18,000。춘천닭갈비1번지·우성推奨。', zh: '人均₩14-18k。推荐春川炒鸡排1号街、又圣等。' },
      transit_from_prev: { method: 'car', minutes: 30, distance_km: 22 } },
  ],

  'tour-gyeongju': [
    { time: '10:00', name: { ko: '불국사', en: 'Bulguksa Temple', ja: '仏国寺', zh: '佛国寺' }, stay_min: 90,
      description: { ko: 'UNESCO 세계유산. 다보탑·석가탑·청운교 등 신라 불교 미술의 정수.', en: 'UNESCO World Heritage. Dabotap & Seokgatap pagodas, the pinnacle of Silla Buddhist art.', ja: 'ユネスコ世界遺産。多宝塔·釈迦塔など新羅仏教美術の精華。', zh: '联合国教科文组织世界遗产。多宝塔·释迦塔等新罗佛教艺术精华。' },
      entry_fee_krw: 6000, tip: { ko: '오전 도착 권장 (햇빛 좋고 한적). 입구에서 한복 무료 입장.', en: 'Arrive in morning (best light, fewer crowds). Free entry in hanbok.', ja: '午前推奨。韓服着用なら無料。', zh: '建议早晨到访。着韩服免费入场。' } },
    { time: '12:00', name: { ko: '석굴암', en: 'Seokguram Grotto', ja: '石窟庵', zh: '石窟庵' }, stay_min: 60,
      description: { ko: '8세기 석굴 사원. 본존불상이 동해 일출 방향. 자연 채광이 신비로움.', en: '8th-century stone-cave temple. Buddha statue faces East Sea sunrise.', ja: '8世紀の石窟寺院。本尊仏は東海の日の出方向。', zh: '8世纪石窟寺院。本尊佛朝向东海日出方向。' },
      entry_fee_krw: 6000, tip: { ko: '석굴 내부 사진 촬영 금지. 한 줄로 천천히 입장.', en: 'No photography inside; single-file entry.', ja: '内部撮影禁止。一列で入場。', zh: '洞内禁止拍照，单列入场。' },
      transit_from_prev: { method: 'car', minutes: 15, distance_km: 4 } },
    { time: '13:30', name: { ko: '점심 — 경주 한정식', en: 'Lunch — Gyeongju Hanjeongsik', ja: 'ランチ — 慶州韓定食', zh: '午餐 — 庆州韩定食' }, stay_min: 75,
      description: { ko: '신라 궁중요리 컨셉의 한정식. 보리굴비·황남빵 디저트.', en: 'Hanjeongsik in Silla royal cuisine style. Boriguibi and Hwangnam-bbang dessert.', ja: '新羅宮中料理風の韓定食。麦塩漬け·黄南パン。', zh: '新罗宫廷料理风格韩定食。麦盐渍鱼·黄南面包。' },
      entry_fee_krw: 0, tip: { ko: '1인 ₩30,000~50,000. 명승가, 큰가야 한정식 추천.', en: '₩30-50k pp. Myeongseunga or Keun Gaya recommended.', ja: '1人₩30,000~50,000。Myeongseunga, Keun Gaya推奨。', zh: '人均₩30-50k。推荐明胜家、큰가야等。' },
      transit_from_prev: { method: 'car', minutes: 18, distance_km: 9 } },
    { time: '15:00', name: { ko: '대릉원·천마총', en: 'Daereungwon & Cheonmachong', ja: '大陵苑·天馬塚', zh: '大陵苑·天马冢' }, stay_min: 90,
      description: { ko: '신라 왕족 고분군. 천마총 내부 관람 가능, 황남대총 외관.', en: 'Royal Silla burial mounds. Enter Cheonmachong; view Hwangnam-daechong.', ja: '新羅王族墳墓群。天馬塚内部見学可能。', zh: '新罗王族墓群。可入天马冢，观皇南大冢外观。' },
      entry_fee_krw: 3000, tip: { ko: '주변 첨성대·계림 함께 도보 산책 (30분).', en: 'Walk to Cheomseongdae and Gyerim Forest nearby (30 min).', ja: '徒歩で瞻星台·鶏林も(30分)。', zh: '可步行至瞻星台·鸡林（30分）。' },
      transit_from_prev: { method: 'car', minutes: 12, distance_km: 6 } },
    { time: '17:00', name: { ko: '동궁과 월지 (안압지)', en: 'Donggung Palace & Wolji Pond', ja: '東宮と月池（雁鴨池）', zh: '东宫与月池（雁鸭池）' }, stay_min: 75,
      description: { ko: '신라 별궁터. 일몰 후 야경 조명이 환상적, 신라 기와 반영.', en: 'Silla detached palace site; after-sunset reflections of illuminated rooflines.', ja: '新羅別宮跡。日没後のライトアップが幻想的。', zh: '新罗别宫遗址，日落后灯光倒影梦幻。' },
      entry_fee_krw: 3000, tip: { ko: '일몰 30분 전 도착 권장. 야경 사진 명소.', en: 'Arrive 30 min before sunset; iconic night-photo spot.', ja: '日没30分前推奨。夜景フォトスポット。', zh: '建议日落前30分到达。夜景拍照胜地。' },
      transit_from_prev: { method: 'car', minutes: 6, distance_km: 3 } },
  ],

  'tour-busan-day': [
    { time: '09:30', name: { ko: '감천문화마을', en: 'Gamcheon Culture Village', ja: '甘川文化村', zh: '甘川文化村' }, stay_min: 90, photo: '/부산/부산 (1).jpg',
      description: { ko: '산비탈 알록달록 마을. 어린왕자 포토 스팟·골목 스탬프투어.', en: 'Colorful hillside village; Little Prince photo spot, alley stamp tour.', ja: '山肌のカラフルな村。星の王子さまフォトスポット·路地スタンプ。', zh: '山坡彩色村庄。小王子拍照点·小巷盖章游。' },
      entry_fee_krw: 0, tip: { ko: '관광안내소 ₩2,000 지도 구매 → 스탬프 8개 모으면 기념품.', en: 'Buy ₩2,000 map at info center; 8 stamps earn a souvenir.', ja: '案内所で₩2,000の地図購入→スタンプ8個で記念品。', zh: '游客中心购₩2,000地图，集8章可得纪念品。' } },
    { time: '11:30', name: { ko: '자갈치시장 + 점심', en: 'Jagalchi Market + Lunch', ja: 'チャガルチ市場+ランチ', zh: '札嘎其市场+午餐' }, stay_min: 90,
      description: { ko: '한국 최대 수산시장. 회·해산물 즉석 식사. 부산 명물.', en: "Korea's largest fish market. On-the-spot raw fish and seafood platters.", ja: '韓国最大の水産市場。刺身·海鮮その場で。', zh: '韩国最大水产市场。生鱼片·海鲜现场品尝。' },
      entry_fee_krw: 0, tip: { ko: '2층 식당가 추천. 1인 ₩30,000부터.', en: '2nd-floor restaurants recommended. From ₩30,000 per person.', ja: '2階の食堂街推奨。1人₩30,000から。', zh: '推荐2楼餐厅街。人均₩30,000起。' },
      transit_from_prev: { method: 'car', minutes: 15, distance_km: 6 } },
    { time: '13:30', name: { ko: '용두산공원·부산타워', en: 'Yongdusan Park & Busan Tower', ja: '龍頭山公園·釜山タワー', zh: '龙头山公园·釜山塔' }, stay_min: 75,
      description: { ko: '부산 도심 정원과 120m 전망탑. 부산항 360° 조망.', en: 'Downtown garden and 120m observation tower with 360° harbor view.', ja: '釜山市内庭園と120m展望塔。港の360°ビュー。', zh: '釜山市区花园和120m观景塔。港口360°景观。' },
      entry_fee_krw: 12000, tip: { ko: '광복로 쇼핑거리 도보 5분.', en: '5-min walk to Gwangbok-ro shopping street.', ja: '光復路ショッピング街まで徒歩5分。', zh: '步行5分至光复路购物街。' },
      transit_from_prev: { method: 'car', minutes: 8, distance_km: 3 } },
    { time: '15:15', name: { ko: '광안리 해변', en: 'Gwangalli Beach', ja: '広安里ビーチ', zh: '广安里海滩' }, stay_min: 60, photo: '/부산/부산 (3).jpg',
      description: { ko: '광안대교 전망 해변. SUP·요트 액티비티, 해변 카페 인기.', en: 'Beach with Gwangan Bridge view; SUP/yacht activities, café row.', ja: '広安大橋ビュービーチ。SUP·ヨット·カフェ。', zh: '可观广安大桥的海滩。SUP·游艇·咖啡馆。' },
      entry_fee_krw: 0, tip: { ko: '저녁 야경 추천. 광안대교 라이트쇼 21시(주말).', en: 'Evening view recommended; bridge light show 21:00 (weekends).', ja: '夜景推奨。21時の橋ライトショー(週末)。', zh: '推荐傍晚夜景，21点桥梁灯光秀(周末)。' },
      transit_from_prev: { method: 'car', minutes: 18, distance_km: 9 } },
    { time: '16:45', name: { ko: '해운대', en: 'Haeundae Beach', ja: '海雲台', zh: '海云台' }, stay_min: 75, photo: '/부산/부산 (7).jpg',
      description: { ko: '한국 대표 해변. 겨울에도 백사장 산책, 동백섬 누리마루 APEC하우스.', en: "Korea's top beach. Winter beach walks, Dongbaekseom & Nurimaru APEC House.", ja: '韓国代表ビーチ。冬の散歩、東柏島·ヌリマルAPECハウス。', zh: '韩国代表海滩。冬日散步、东柏岛·韩流亚太APEC会馆。' },
      entry_fee_krw: 0, tip: { ko: '동백섬 산책로 (40분 round) 강추.', en: 'Dongbaekseom walking loop (40 min) highly recommended.', ja: '東柏島周遊コース(40分)推奨。', zh: '强烈推荐东柏岛环路(40分)。' },
      transit_from_prev: { method: 'car', minutes: 12, distance_km: 5 } },
  ],

  'tour-multicity-3d': [
    { time: 'D1 09:30', name: { ko: '서울 — 경복궁', en: 'Day 1 — Gyeongbokgung', ja: 'D1 — 景福宮', zh: 'D1 — 景福宫' }, stay_min: 90,
      description: { ko: '조선 정궁. 수문장 교대식 09:30. 한복 입장 무료.', en: 'Joseon main palace. Guard ceremony 09:30. Free entry in hanbok.', ja: '朝鮮正宮。9:30衛兵交代。韓服無料。', zh: '朝鲜正宫。9:30换岗仪式。韩服免费。' },
      entry_fee_krw: 3000 },
    { time: 'D1 12:00', name: { ko: '서울 — 북촌·인사동', en: 'Day 1 — Bukchon & Insadong', ja: 'D1 — 北村·仁寺洞', zh: 'D1 — 北村·仁寺洞' }, stay_min: 150,
      description: { ko: '한옥 골목과 전통 공예 거리. 점심 + 도보 산책.', en: 'Hanok alleys and traditional crafts street. Lunch + walking tour.', ja: '韓屋路地と伝統工芸街。ランチ+散歩。', zh: '韩屋小巷与传统工艺街。午餐+步行。' },
      entry_fee_krw: 0, transit_from_prev: { method: 'car', minutes: 8, distance_km: 2 } },
    { time: 'D2 08:30', name: { ko: '안동 — 하회마을', en: 'Day 2 — Andong Hahoe Folk Village', ja: 'D2 — 安東河回村', zh: 'D2 — 安东河回村' }, stay_min: 180,
      description: { ko: 'UNESCO 세계유산 전통마을. 양반 문화·하회별신굿탈놀이.', en: 'UNESCO World Heritage village. Yangban culture, mask dance show.', ja: 'ユネスコ伝統村。両班文化·河回別神タル劇。', zh: '联合国教科文遗产村。两班文化·河回别神面舞。' },
      entry_fee_krw: 5000, tip: { ko: '서울→안동 차량 2시간 30분. 출발 06:00.', en: 'Seoul→Andong 2.5h drive; depart 06:00.', ja: 'ソウル→安東2時間半。6:00出発。', zh: '首尔→安东车程2.5小时，6:00出发。' } },
    { time: 'D2 14:00', name: { ko: '경주 — 불국사·석굴암', en: 'Day 2 — Bulguksa & Seokguram', ja: 'D2 — 仏国寺·石窟庵', zh: 'D2 — 佛国寺·石窟庵' }, stay_min: 180,
      description: { ko: '신라 불교 미술의 정수. UNESCO 세계유산 2곳.', en: 'Pinnacle of Silla Buddhist art. Two UNESCO World Heritage sites.', ja: '新羅仏教美術の精華。ユネスコ2件。', zh: '新罗佛教艺术精华。两处联合国教科文遗产。' },
      entry_fee_krw: 12000, transit_from_prev: { method: 'car', minutes: 90, distance_km: 130 } },
    { time: 'D3 09:00', name: { ko: '부산 — 감천문화마을', en: 'Day 3 — Gamcheon Village', ja: 'D3 — 甘川文化村', zh: 'D3 — 甘川文化村' }, stay_min: 90, photo: '/부산/부산 (1).jpg',
      description: { ko: '산비탈 알록달록 마을. 부산의 마추픽추.', en: 'Colorful hillside village — "Machu Picchu of Busan".', ja: '山肌のカラフル村。釜山のマチュピチュ。', zh: '山坡彩色村庄。釜山的马丘比丘。' },
      entry_fee_krw: 0, tip: { ko: '경주에서 부산 차량 1시간. 호텔 체크인 후 출발.', en: 'Gyeongju→Busan 1h drive; depart after hotel check-in.', ja: '慶州→釜山1時間。ホテルチェックイン後。', zh: '庆州→釜山1小时。酒店入住后出发。' } },
    { time: 'D3 12:00', name: { ko: '부산 — 자갈치시장 + 광안리', en: 'Day 3 — Jagalchi & Gwangalli', ja: 'D3 — チャガルチ·広安里', zh: 'D3 — 札嘎其·广安里' }, stay_min: 240,
      description: { ko: '점심(회) + 광안대교 야경 + 해운대까지 부산 정수 코스.', en: 'Sashimi lunch + Gwangan Bridge view + Haeundae — essential Busan.', ja: '刺身ランチ+広安大橋夜景+海雲台の釜山エッセンス。', zh: '生鱼片午餐+广安大桥夜景+海云台。釜山精华。' },
      entry_fee_krw: 0, transit_from_prev: { method: 'car', minutes: 15, distance_km: 8 } },
  ],
};

export const TOURS: Tour[] = TOURS_RAW.map((t) => {
  const priceKRW = getTourPriceKRW(t.id, t.priceFrom, t.priceUnit);
  // priceFrom (USD) 도 spec 기반으로 자동 갱신. spec 없으면 raw priceFrom 유지.
  // priceUnit='per_person' 투어는 spec 무시하고 raw priceFrom (USD) 그대로 사용.
  const priceFromUSD = (t.priceUnit !== 'per_person' && TOUR_TO_CHARTER_KEY[t.id])
    ? Math.round(priceKRW / KRW_PER_USD)
    : t.priceFrom;
  return {
    ...t,
    ...TOUR_META[t.id],
    // raw에 stops 있으면 우선, 없으면 ID 매핑 사용
    stops: t.stops || TOUR_STOPS_BY_ID[t.id],
    priceFrom: priceFromUSD,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// 유틸 함수
// ─────────────────────────────────────────────────────────────────────────────
export function getTourBySlug(slug: string): Tour | undefined {
  return TOURS.find(t => t.slug === slug);
}

export function getToursByRegion(region: TourRegion | 'All'): Tour[] {
  if (region === 'All') return TOURS;
  return TOURS.filter(t => t.region === region);
}

// PR-A: own-tour upsell matcher (flag: VITE_FEATURE_OWN_TOUR_UPSELL)
// Match itinerary place names against tour stop names (ko).
// Priority: stop overlap >= minOverlap, fallback: region name substring match.
// Returns empty array when no match => nothing rendered.
//
// @param itineraryPlaceNames  all stop names from the generated plan
// @param regionName           result.meta.regions[0]
// @param minOverlap           overlap threshold, default 2
export function getMatchedOwnTours(
  itineraryPlaceNames: string[],
  regionName: string,
  minOverlap = 2,
): Tour[] {
  const normalise = (s: string) => s.replace(/\s/g, '').toLowerCase();
  const planSet = new Set(itineraryPlaceNames.map(normalise));

  // Pass 1: stop name overlap >= minOverlap
  const byStop = TOURS.filter(tour => {
    const stops = tour.stops || TOUR_STOPS_BY_ID[tour.id] || [];
    const overlap = stops.filter(st => planSet.has(normalise(st.name.ko))).length;
    return overlap >= minOverlap;
  });

  if (byStop.length > 0) return byStop;

  // Pass 2: region fallback (substring match both ways)
  const regionNorm = normalise(regionName);
  const byRegion = TOURS.filter(tour => {
    const reg = normalise(tour.region);
    return reg.includes(regionNorm) || regionNorm.includes(reg);
  });

  return byRegion;
}

export const TOUR_REGIONS: Array<{ key: TourRegion | 'All'; label: I18nString }> = [
  { key: 'All',        label: { ko: '전체',    en: 'All',        ja: 'すべて',     zh: '全部'   } },
  { key: 'Seoul',      label: { ko: '서울',    en: 'Seoul',      ja: 'ソウル',     zh: '首尔'   } },
  { key: 'DMZ',        label: { ko: 'DMZ·파주', en: 'DMZ',       ja: 'DMZ・坡州',  zh: 'DMZ'   } },
  { key: 'Ganghwa',    label: { ko: '강화도',  en: 'Ganghwa',    ja: '江華島',     zh: '江华岛' } },
  { key: 'Chuncheon',  label: { ko: '춘천',    en: 'Chuncheon',  ja: '春川',       zh: '春川'   } },
  { key: 'Danyang',    label: { ko: '단양',    en: 'Danyang',    ja: '丹陽',       zh: '丹阳'   } },
  { key: 'Gyeongju',   label: { ko: '경주',    en: 'Gyeongju',   ja: '慶州',       zh: '庆州'   } },
  { key: 'Busan',      label: { ko: '부산',    en: 'Busan',      ja: '釜山',       zh: '釜山'   } },
  { key: 'Multi-City', label: { ko: '멀티시티', en: 'Multi-City', ja: 'マルチ',    zh: '多城市' } },
];
