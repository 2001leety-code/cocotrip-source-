// ─────────────────────────────────────────────────────────────────────────────
// CocoTrip – Tour Product Data
// 이미지: public/ 폴더 기준 경로 사용 (RegionDetail.tsx 방식 동일)
// 가격: MASTER_STAFF_MANUAL 표준가 기준 (스타리아 ₩291,200~ → $208~)
// ─────────────────────────────────────────────────────────────────────────────

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
  /** /public 기준 사진 경로 (선택). 없으면 카드에 placeholder. */
  photo?: string;
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

export type Tour = {
  id: string;
  slug: string;
  region: TourRegion;
  title: I18nString;
  summary: I18nString;
  description: I18nString;
  priceFrom: number;   // USD, per group (vehicle)
  currency: 'USD';
  durationDays: number;
  durationHours?: number; // 당일 투어 시 시간 단위
  isNightTour?: boolean;
  vehicleType: VehicleType;
  maxPax: number;
  thumbnail: string;       // /public 기준 메인 사진
  images: string[];        // /public 기준 갤러리 사진들
  tags: TourTag[];
  highlights: TourHighlight[];

  // ── v1 신규 (Tour data model — 2026-04-25)
  /** 기본 운전기사 가능 언어. 미설정 시 ['en'] 가정. */
  driverLanguages?: DriverLanguage[];
  /** 시간순 stops 배열 (P0-가3). 미설정 시 상세에 "coming soon" 폴백. */
  stops?: TourStop[];
  /** 투어별 default 픽업 위치 (예: 서울 시내 호텔). 명시 안 하면 글로벌 default. */
  defaultPickup?: I18nString;
};

// ─────────────────────────────────────────────────────────────────────────────
// 투어 데이터 — 실제 사진 경로 사용
// ─────────────────────────────────────────────────────────────────────────────
export const TOURS: Tour[] = [

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
      ko: '경복궁·북촌·명동·한강 — 서울 핵심 명소를 하루에 · 팁·톨비 포함',
      en: 'Gyeongbokgung · Bukchon · Myeongdong · Han River — tips & tolls included',
      ja: '景福宮・北村・明洞・漢江 — チップ・料金所込み',
      zh: '景福宫·北村·明洞·汉江 — 含小费·过路费',
    },
    description: {
      ko: '전용 스타리아 차량과 영어 기사님과 함께 서울의 핵심 명소를 알차게 둘러봅니다. 경복궁의 고즈넉한 아침, 북촌한옥마을의 골목길, 명동 쇼핑, 한강 공원 일몰까지. 기사 팁·톨비·주차비 전부 포함 — 현장 추가 비용 제로.',
      en: "Explore Seoul's top landmarks in a private Staria van with an English-speaking driver. Gyeongbokgung's morning calm, Bukchon Hanok Village alleyways, Myeongdong shopping, Han River sunset. Driver tip, tolls, parking all included.",
      ja: 'スタリア専用車両と英語対応ドライバーでソウルの名所を巡ります。景福宮の静かな朝、北村韓屋村の路地、明洞ショッピング、漢江の夕日まで。チップ・料金所・駐車場がすべて込み。',
      zh: '乘坐专属Staria面包车，配备英语司机，游览首尔主要景点。景福宫清晨、北村韩屋村小巷、明洞购物、汉江日落。司机小费·过路费·停车费全含。',
    },
    priceFrom: 208,
    currency: 'USD',
    durationDays: 1,
    durationHours: 9,
    vehicleType: 'Staria',
    maxPax: 8,
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
      { icon: 'Shield', text: { ko: '팁·톨비·주차비 전부 포함', en: 'Tips · Tolls · Parking — all included', ja: 'チップ・料金所・駐車場 全込み', zh: '小费·过路费·停车费全含' } },
    ],
    driverLanguages: ['en', 'ja'],
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
      ko: '반포대교 달빛무지개분수·한강·광장시장 야시장 — 서울의 밤을 전세 차량으로',
      en: 'Banpo Rainbow Fountain · Han River · Gwangjang Night Market — Seoul after dark',
      ja: '盤浦大橋レインボー噴水・漢江・広蔵市場夜市 — 夜のソウルを専用車で',
      zh: '盘浦大桥彩虹喷泉·汉江·广藏市场夜市 — 专属车游首尔夜景',
    },
    description: {
      ko: '서울의 화려한 야경을 전용 차량으로 편하게 즐기세요. 반포대교 달빛무지개분수 야경, 한강 야경 드라이브, 광장시장 야시장 체험, 남산타워 야경까지. 오후 6시 출발 기준 약 4~5시간 코스.',
      en: "Enjoy Seoul's brilliant night scenery from a private Staria. Banpo Rainbow Fountain show, Han River night drive, Gwangjang Market night food stalls, N Seoul Tower lights. ~4-5 hours from 6 PM.",
      ja: '専用スタリアでソウルの夜景を快適にお楽しみください。盤浦大橋レインボー噴水、漢江夜景ドライブ、広蔵市場夜市、Nソウルタワー夜景まで。18時出発、約4〜5時間コース。',
      zh: '乘坐专属Staria，舒适享受首尔夜景。盘浦大桥彩虹喷泉、汉江夜景驾车、广藏市场夜市小吃、N首尔塔夜景。18:00出发，约4-5小时行程。',
    },
    priceFrom: 180,
    currency: 'USD',
    durationDays: 1,
    durationHours: 5,
    vehicleType: 'Staria',
    maxPax: 8,
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
      { icon: 'Sparkles', text: { ko: '반포대교 달빛무지개분수 야경', en: 'Banpo Rainbow Fountain night show', ja: '盤浦大橋レインボー噴水', zh: '盘浦大桥彩虹喷泉夜景' } },
      { icon: 'Utensils', text: { ko: '광장시장 야시장 먹방 투어', en: 'Gwangjang Market night food tour', ja: '広蔵市場夜市グルメ', zh: '广藏市场夜市美食之旅' } },
      { icon: 'Mountain', text: { ko: '남산타워 야경 (선택)', en: 'N Seoul Tower view (optional)', ja: 'Nソウルタワー夜景（任意）', zh: 'N首尔塔夜景（可选）' } },
      { icon: 'Shield', text: { ko: '팁·톨비·주차비 전부 포함', en: 'Tips · Tolls · Parking — all included', ja: 'チップ・料金所・駐車場 全込み', zh: '小费·过路费·停车费全含' } },
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
    maxPax: 8,
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
      { icon: 'Shield', text: { ko: '서울↔단양 왕복 · 팁·톨비 포함', en: 'Seoul↔Danyang round trip · Tips & Tolls incl.', ja: 'ソウル↔丹陽往復 · チップ・料金所込み', zh: '首尔↔丹阳往返 · 含小费·过路费' } },
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
    maxPax: 8,
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
      { icon: 'Shield', text: { ko: '서울↔강화도 왕복 · 팁·톨비 포함', en: 'Seoul↔Ganghwa round trip · Tips & Tolls incl.', ja: 'ソウル↔江華島往復 · チップ・料金所込み', zh: '首尔↔江华岛往返 · 含小费·过路费' } },
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
    maxPax: 8,
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
      { icon: 'Shield', text: { ko: '서울↔파주 왕복 · 팁·톨비 포함', en: 'Seoul↔Paju round trip · Tips & Tolls incl.', ja: 'ソウル↔坡州往復 · チップ・料金所込み', zh: '首尔↔坡州往返 · 含小费·过路费' } },
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
    maxPax: 8,
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
      { icon: 'Shield', text: { ko: '서울↔춘천 왕복 · 팁·톨비 포함', en: 'Seoul↔Chuncheon round trip · Tips & Tolls incl.', ja: 'ソウル↔春川往復 · チップ・料金所込み', zh: '首尔↔春川往返 · 含小费·过路费' } },
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
    maxPax: 8,
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
      { icon: 'Shield', text: { ko: '서울↔경주 왕복 · 팁·톨비 포함', en: 'Seoul↔Gyeongju round trip · Tips & Tolls incl.', ja: 'ソウル↔慶州往復 · チップ・料金所込み', zh: '首尔↔庆州往返 · 含小费·过路费' } },
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
    priceFrom: 280,
    currency: 'USD',
    durationDays: 1,
    durationHours: 10,
    vehicleType: 'Staria',
    maxPax: 8,
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
      { icon: 'Shield', text: { ko: '서울↔부산 왕복 · 팁·톨비 포함', en: 'Seoul↔Busan round trip · Tips & Tolls incl.', ja: 'ソウル↔釜山往復 · チップ・料金所込み', zh: '首尔↔釜山往返 · 含小费·过路费' } },
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
      { icon: 'Shield', text: { ko: '팁·톨비·주차비 전부 포함', en: 'Tips · Tolls · Parking — all included', ja: 'チップ・料金所・駐車場 全込み', zh: '小费·过路费·停车费全含' } },
    ],
  },
];

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
