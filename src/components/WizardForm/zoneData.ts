// Sprint 2 #5 — recommended lodging zones for users without a booked hotel.
// Each zone includes localized name + description + nightly price band so the
// wizard can render rich cards. Keep the data inline (not in i18n.json) since
// these are tied to specific physical zones and don't need parity validation.
//
// Coverage: seoul, busan, jeju, gyeongju, jeonju, gangneung, incheon, suwon,
// yeosu, daegu. The wizard falls back to "skip recommendation" when mainCity
// is not in this map.

export type Zone = {
  /** Stable key used in form state + backend prompt injection. */
  key: string;
  /** District-level name in 4 locales. */
  name: { ko: string; en: string; ja: string; zh: string };
  /** 1-line vibe description in 4 locales. */
  desc: { ko: string; en: string; ja: string; zh: string };
  /** Indicative nightly KRW range (used as label, not strict). */
  nightlyKRW: string;
  /** Single emoji used in UI. Pure presentational. */
  icon: string;
  /** "Best for" tag, max 2-3 words. */
  bestFor: { ko: string; en: string; ja: string; zh: string };
  /** 2026-05-03: zone hub로 사용할 한국어 주소 (Naver geocoding 친화적). 사용자가
   *  특정 호텔을 안 정하고 zone만 골랐을 때, 백엔드 RouteAgent가 이 주소를
   *  hotel_address fallback으로 사용해서 공항↔zone 단계별 환승 경로를 계산함.
   *  실제 호텔이 아니므로 UI는 "<zone> 지역 (<address> 기준)" 식으로 표기. */
  anchorAddress: string;
};

export const SEOUL_ZONES: Zone[] = [
  {
    key: 'myeongdong',
    name: { ko: '명동', en: 'Myeongdong', ja: '明洞', zh: '明洞' },
    desc: {
      ko: '쇼핑·관광 중심지, 외국인 여행 가장 익숙한 동네',
      en: 'Shopping + sightseeing hub, most foreigner-friendly',
      ja: 'ショッピング・観光の中心地、外国人に最も慣れた街',
      zh: '购物观光中心，外国游客最熟悉的街区',
    },
    nightlyKRW: '₩120k-220k',
    icon: '🛍️',
    bestFor: { ko: '첫 방문', en: 'First visit', ja: '初訪問', zh: '初次访问' },
    anchorAddress: '서울 중구 명동역',
  },
  {
    key: 'hongdae',
    name: { ko: '홍대', en: 'Hongdae', ja: '弘大', zh: '弘大' },
    desc: {
      ko: '젊은 문화·인디 거리·심야 카페 — 활기 + 가성비',
      en: 'Youth culture, indie shops, late-night cafés — vibrant + budget',
      ja: '若者文化・インディーショップ・深夜カフェ — 活気 + コスパ',
      zh: '青年文化·独立小店·深夜咖啡 — 活力且性价比高',
    },
    nightlyKRW: '₩80k-150k',
    icon: '🎸',
    bestFor: { ko: '20-30대', en: '20s-30s', ja: '20-30代', zh: '20-30岁' },
    anchorAddress: '서울 마포구 홍익대학교',
  },
  {
    key: 'gangnam',
    name: { ko: '강남', en: 'Gangnam', ja: '江南', zh: '江南' },
    desc: {
      ko: '고급 쇼핑·럭셔리 호텔·세련된 카페·뷰티',
      en: 'Upscale shopping, luxury hotels, polished cafés, K-beauty',
      ja: '高級ショッピング・ラグジュアリーホテル・洗練されたカフェ・美容',
      zh: '高端购物·奢华酒店·精致咖啡馆·美容',
    },
    nightlyKRW: '₩200k-450k',
    icon: '✨',
    bestFor: { ko: '럭셔리', en: 'Luxury', ja: 'ラグジュアリー', zh: '奢华' },
    anchorAddress: '서울 강남구 강남역',
  },
  {
    key: 'itaewon',
    name: { ko: '이태원', en: 'Itaewon', ja: '梨泰院', zh: '梨泰院' },
    desc: {
      ko: '국제적 분위기·다국적 음식·외국인 친화 바',
      en: 'International vibe, world cuisine, foreigner-friendly bars',
      ja: '国際的な雰囲気・多国籍料理・外国人に優しいバー',
      zh: '国际氛围·多国美食·外国人友好酒吧',
    },
    nightlyKRW: '₩120k-200k',
    icon: '🌍',
    bestFor: { ko: '미식·바', en: 'Food + bars', ja: 'グルメ・バー', zh: '美食·酒吧' },
    anchorAddress: '서울 용산구 이태원역',
  },
  {
    key: 'jongno',
    name: { ko: '종로', en: 'Jongno', ja: '鍾路', zh: '钟路' },
    desc: {
      ko: '경복궁·북촌 한옥마을 — 전통 + 도심 접근성',
      en: 'Gyeongbokgung + Bukchon — heritage with central access',
      ja: '景福宮・北村韓屋村 — 伝統と都心アクセス',
      zh: '景福宫·北村韩屋村 — 传统与市中心便利',
    },
    nightlyKRW: '₩100k-180k',
    icon: '🏯',
    bestFor: { ko: '전통/문화', en: 'Heritage', ja: '伝統・文化', zh: '传统文化' },
    anchorAddress: '서울 종로구 종각역',
  },
  {
    key: 'jamsil',
    name: { ko: '잠실', en: 'Jamsil', ja: '蚕室', zh: '蚕室' },
    desc: {
      ko: '롯데월드·롯데타워·석촌호수 — 가족 여행 / 야경',
      en: 'Lotte World, Lotte Tower, Seokchon Lake — family + skyline',
      ja: 'ロッテワールド・ロッテタワー・石村湖 — 家族旅行・夜景',
      zh: '乐天世界·乐天塔·石村湖 — 亲子游·夜景',
    },
    nightlyKRW: '₩140k-300k',
    icon: '🎢',
    bestFor: { ko: '가족·테마파크', en: 'Family + theme park', ja: '家族・テーマパーク', zh: '亲子·主题乐园' },
    anchorAddress: '서울 송파구 잠실역',
  },
];

export const BUSAN_ZONES: Zone[] = [
  {
    key: 'haeundae',
    name: { ko: '해운대', en: 'Haeundae', ja: '海雲台', zh: '海云台' },
    desc: {
      ko: '해변 + 럭셔리 호텔 + K-드라마 촬영지',
      en: 'Beachfront, luxury hotels, K-drama filming spots',
      ja: 'ビーチフロント・高級ホテル・韓ドラ撮影地',
      zh: '海滨·豪华酒店·韩剧取景地',
    },
    nightlyKRW: '₩150k-380k',
    icon: '🏖️',
    bestFor: { ko: '바다·휴양', en: 'Beach + resort', ja: 'ビーチ・リゾート', zh: '海滩·度假' },
    anchorAddress: '부산 해운대구 해운대역',
  },
  {
    key: 'gwangalli',
    name: { ko: '광안리', en: 'Gwangalli', ja: '広安里', zh: '广安里' },
    desc: {
      ko: '광안대교 야경·파인 다이닝·SNS 핫플',
      en: 'Gwangan bridge night view, fine dining, IG hotspots',
      ja: '広安大橋の夜景・ファインダイニング・SNS人気',
      zh: '广安大桥夜景·精致餐饮·网红打卡地',
    },
    nightlyKRW: '₩100k-220k',
    icon: '🌉',
    bestFor: { ko: '야경·미식', en: 'Nightlife + food', ja: '夜景・グルメ', zh: '夜景·美食' },
    anchorAddress: '부산 수영구 광안리해수욕장',
  },
  {
    key: 'seomyeon',
    name: { ko: '서면', en: 'Seomyeon', ja: '西面', zh: '西面' },
    desc: {
      ko: '부산 도심 교통 허브·쇼핑·중급 호텔 다수',
      en: 'Busan downtown transit hub, shopping, plenty of mid-range hotels',
      ja: '釜山都心の交通ハブ・ショッピング・中価格ホテル多数',
      zh: '釜山市中心交通枢纽·购物·众多中档酒店',
    },
    nightlyKRW: '₩90k-160k',
    icon: '🚆',
    bestFor: { ko: '교통·접근성', en: 'Transit hub', ja: '交通至便', zh: '交通便利' },
    anchorAddress: '부산 부산진구 서면역',
  },
  {
    key: 'nampo',
    name: { ko: '남포동', en: 'Nampo', ja: '南浦洞', zh: '南浦洞' },
    desc: {
      ko: '자갈치시장·국제시장·전통 부산',
      en: 'Jagalchi seafood market, Gukje market, traditional Busan',
      ja: 'チャガルチ市場・国際市場・伝統的な釜山',
      zh: '札嘎其市场·国际市场·传统釜山',
    },
    nightlyKRW: '₩80k-140k',
    icon: '🐟',
    bestFor: { ko: '시장·전통', en: 'Markets + heritage', ja: '市場・伝統', zh: '市场·传统' },
    anchorAddress: '부산 중구 남포역',
  },
];

export const JEJU_ZONES: Zone[] = [
  {
    key: 'jeju_city',
    name: { ko: '제주시', en: 'Jeju City', ja: '済州市', zh: '济州市' },
    desc: {
      ko: '공항 인접·면세점·동문시장 — 첫 도착 거점',
      en: 'Near airport, duty-free, Dongmun market — first-arrival hub',
      ja: '空港至近・免税店・東門市場 — 初到着の拠点',
      zh: '邻近机场·免税店·东门市场 — 首站枢纽',
    },
    nightlyKRW: '₩80k-180k',
    icon: '✈️',
    bestFor: { ko: '공항 가까이', en: 'Near airport', ja: '空港近く', zh: '邻近机场' },
    anchorAddress: '제주 제주시 제주국제공항',
  },
  {
    key: 'seogwipo',
    name: { ko: '서귀포', en: 'Seogwipo', ja: '西帰浦', zh: '西归浦' },
    desc: {
      ko: '천지연 폭포·중문 리조트·해녀 문화',
      en: 'Cheonjiyeon falls, Jungmun resorts, haenyeo (sea-women) culture',
      ja: '天地淵滝・中文リゾート・海女文化',
      zh: '天地渊瀑布·中文度假区·海女文化',
    },
    nightlyKRW: '₩140k-380k',
    icon: '🌊',
    bestFor: { ko: '리조트·자연', en: 'Resorts + nature', ja: 'リゾート・自然', zh: '度假·自然' },
    anchorAddress: '제주 서귀포시 중문관광단지',
  },
  {
    key: 'aewol',
    name: { ko: '애월', en: 'Aewol', ja: '涯月', zh: '涯月' },
    desc: {
      ko: '서쪽 해안·감성 카페·SNS 핫플 (드라이브 추천)',
      en: 'West coast, mood cafés, IG hotspots (drive-friendly)',
      ja: '西海岸・雰囲気カフェ・SNS人気 (ドライブ推奨)',
      zh: '西海岸·氛围咖啡馆·网红地 (推荐自驾)',
    },
    nightlyKRW: '₩100k-260k',
    icon: '☕',
    bestFor: { ko: '카페·드라이브', en: 'Cafés + drives', ja: 'カフェ・ドライブ', zh: '咖啡·自驾' },
    anchorAddress: '제주 제주시 애월읍',
  },
];

export const GYEONGJU_ZONES: Zone[] = [
  {
    key: 'bomun',
    name: { ko: '보문관광단지', en: 'Bomun Resort', ja: '普門観光団地', zh: '普门观光区' },
    desc: {
      ko: '경주 호수 리조트 단지·특급 호텔·보문호 야경',
      en: 'Lakeside resort cluster — premium hotels, Bomun Lake at night',
      ja: '湖畔リゾート群・高級ホテル・普門湖の夜景',
      zh: '湖畔度假区·高级酒店·普门湖夜景',
    },
    nightlyKRW: '₩140k-380k',
    icon: '🏞️',
    bestFor: { ko: '리조트', en: 'Resort', ja: 'リゾート', zh: '度假' },
    anchorAddress: '경주시 보문관광단지',
  },
  {
    key: 'hwangnidan',
    name: { ko: '황리단길', en: 'Hwangnidan-gil', ja: '皇理団キル', zh: '皇理团街' },
    desc: {
      ko: '대릉원 옆 한옥 게스트하우스·SNS 카페 거리',
      en: 'Hanok guesthouses next to Daereungwon — Insta café strip',
      ja: '大陵苑横の韓屋ゲストハウス・SNSカフェ通り',
      zh: '大陵苑旁韩屋民宿·网红咖啡街',
    },
    nightlyKRW: '₩90k-180k',
    icon: '🏯',
    bestFor: { ko: '한옥·SNS', en: 'Hanok + IG', ja: '韓屋・SNS', zh: '韩屋·网红' },
    anchorAddress: '경주시 황리단길',
  },
  {
    key: 'gyeongju_downtown',
    name: { ko: '경주 시내', en: 'Gyeongju Downtown', ja: '慶州市内', zh: '庆州市区' },
    desc: {
      ko: '경주역·고속버스터미널 인근 — 가성비 비즈니스 호텔',
      en: 'Near Gyeongju station + bus terminal — budget business hotels',
      ja: '慶州駅・高速バスターミナル付近 — コスパビジネスホテル',
      zh: '庆州站·客运站附近 — 性价比商务酒店',
    },
    nightlyKRW: '₩70k-130k',
    icon: '🚉',
    bestFor: { ko: '교통', en: 'Transit', ja: '交通', zh: '交通' },
    anchorAddress: '경주시 경주역',
  },
];

export const JEONJU_ZONES: Zone[] = [
  {
    key: 'hanok_village',
    name: { ko: '한옥마을', en: 'Hanok Village', ja: '韓屋村', zh: '韩屋村' },
    desc: {
      ko: '700채 한옥·한복 체험·전통 음식 — 전주의 핵심',
      en: '700 hanok homes, hanbok rentals, traditional food — Jeonju core',
      ja: '700軒の韓屋・韓服体験・伝統料理 — 全州の中心',
      zh: '700座韩屋·韩服体验·传统美食 — 全州核心',
    },
    nightlyKRW: '₩90k-220k',
    icon: '🏯',
    bestFor: { ko: '전통·체험', en: 'Heritage stay', ja: '伝統・体験', zh: '传统·体验' },
    anchorAddress: '전주시 완산구 한옥마을',
  },
  {
    key: 'gaengnidan',
    name: { ko: '객리단길', en: 'Gaengnidan-gil', ja: 'カンニダンギル', zh: '客里团街' },
    desc: {
      ko: '한옥마을 옆 트렌디 카페·바·맛집 거리',
      en: 'Trendy café/bar/eatery street next to Hanok Village',
      ja: '韓屋村横のトレンディカフェ・バー・グルメ街',
      zh: '韩屋村旁潮流咖啡·酒吧·美食街',
    },
    nightlyKRW: '₩80k-160k',
    icon: '☕',
    bestFor: { ko: '카페·미식', en: 'Café + food', ja: 'カフェ・グルメ', zh: '咖啡·美食' },
    anchorAddress: '전주시 완산구 객리단길',
  },
  {
    key: 'jeonju_station',
    name: { ko: '전주역', en: 'Jeonju Station', ja: '全州駅', zh: '全州站' },
    desc: {
      ko: 'KTX 환승 거점·신시가지·비즈니스 호텔',
      en: 'KTX hub, new commercial district, business hotels',
      ja: 'KTXハブ・新市街・ビジネスホテル',
      zh: 'KTX枢纽·新市区·商务酒店',
    },
    nightlyKRW: '₩70k-120k',
    icon: '🚄',
    bestFor: { ko: '교통', en: 'Transit', ja: '交通', zh: '交通' },
    anchorAddress: '전주시 덕진구 전주역',
  },
];

export const GANGNEUNG_ZONES: Zone[] = [
  {
    key: 'gyeongpo',
    name: { ko: '경포·강문해변', en: 'Gyeongpo Beach', ja: '鏡浦・江門海岸', zh: '镜浦·江门海滩' },
    desc: {
      ko: '강릉 대표 해변·해변 펜션·일출 명소',
      en: "Gangneung's signature beach — pensions + sunrise viewpoint",
      ja: '江陵を代表するビーチ・海辺ペンション・日の出名所',
      zh: '江陵代表海滩·海边民宿·日出胜地',
    },
    nightlyKRW: '₩100k-260k',
    icon: '🌅',
    bestFor: { ko: '해변·일출', en: 'Beach + sunrise', ja: 'ビーチ・日の出', zh: '海滩·日出' },
    anchorAddress: '강릉시 경포해변',
  },
  {
    key: 'anmok_coffee',
    name: { ko: '안목해변 카페거리', en: 'Anmok Coffee Street', ja: '安木海岸カフェ通り', zh: '安木海滩咖啡街' },
    desc: {
      ko: '바다뷰 카페 거리·강릉 커피 문화의 발상지',
      en: 'Sea-view café strip — birthplace of Gangneung coffee culture',
      ja: '海ビューカフェ通り・江陵コーヒー文化の発祥地',
      zh: '海景咖啡街·江陵咖啡文化发源地',
    },
    nightlyKRW: '₩90k-200k',
    icon: '☕',
    bestFor: { ko: '카페·바다', en: 'Café + sea', ja: 'カフェ・海', zh: '咖啡·海景' },
    anchorAddress: '강릉시 안목해변',
  },
  {
    key: 'gangneung_station',
    name: { ko: 'KTX 강릉역', en: 'KTX Gangneung Station', ja: 'KTX江陵駅', zh: 'KTX江陵站' },
    desc: {
      ko: 'KTX 종착역 인근·중앙시장·도심 비즈니스 호텔',
      en: 'KTX terminus, Jungang Market, downtown business hotels',
      ja: 'KTX終着駅近く・中央市場・市街ビジネスホテル',
      zh: 'KTX终点站附近·中央市场·市区商务酒店',
    },
    nightlyKRW: '₩70k-130k',
    icon: '🚄',
    bestFor: { ko: '교통', en: 'Transit', ja: '交通', zh: '交通' },
    anchorAddress: '강릉시 강릉역',
  },
];

export const INCHEON_ZONES: Zone[] = [
  {
    key: 'songdo',
    name: { ko: '송도', en: 'Songdo', ja: '松島', zh: '松岛' },
    desc: {
      ko: '국제도시·센트럴파크·럭셔리 호텔·트라이볼 야경',
      en: 'International city, Central Park, luxury hotels, Tri-bowl skyline',
      ja: '国際都市・セントラルパーク・高級ホテル・トライボウル夜景',
      zh: '国际新城·中央公园·豪华酒店·Tri-bowl夜景',
    },
    nightlyKRW: '₩140k-320k',
    icon: '🌆',
    bestFor: { ko: '럭셔리·신도시', en: 'Luxury + new city', ja: '高級・新都市', zh: '奢华·新城' },
    anchorAddress: '인천 연수구 송도국제도시',
  },
  {
    key: 'chinatown_wolmi',
    name: { ko: '차이나타운·월미도', en: 'Chinatown · Wolmido', ja: 'チャイナタウン・月尾島', zh: '中华街·月尾岛' },
    desc: {
      ko: '한국 유일 차이나타운·해안 산책로·테마파크',
      en: "Korea's only Chinatown, coastal promenade, retro theme park",
      ja: '韓国唯一のチャイナタウン・海岸遊歩道・レトロテーマパーク',
      zh: '韩国唯一中华街·海岸步道·复古游乐园',
    },
    nightlyKRW: '₩70k-150k',
    icon: '🏮',
    bestFor: { ko: '관광·먹거리', en: 'Sightseeing + food', ja: '観光・グルメ', zh: '观光·美食' },
    anchorAddress: '인천 중구 차이나타운',
  },
  {
    key: 'yeongjong_airport',
    name: { ko: '영종도·공항 인근', en: 'Yeongjong / Airport', ja: '永宗島・空港近く', zh: '永宗岛·机场附近' },
    desc: {
      ko: '인천공항 셔틀·환승 호텔·파라다이스시티',
      en: 'Incheon airport shuttle, transit hotels, Paradise City resort',
      ja: '仁川空港シャトル・乗り継ぎホテル・パラダイスシティ',
      zh: '仁川机场班车·过境酒店·百乐达斯城',
    },
    nightlyKRW: '₩100k-280k',
    icon: '✈️',
    bestFor: { ko: '공항·환승', en: 'Airport / layover', ja: '空港・乗継', zh: '机场·中转' },
    anchorAddress: '인천 중구 영종도',
  },
];

export const SUWON_ZONES: Zone[] = [
  {
    key: 'haenggung',
    name: { ko: '행궁동', en: 'Haenggung-dong', ja: '行宮洞', zh: '行宫洞' },
    desc: {
      ko: '수원화성·행궁 옆·전통 거리·게스트하우스',
      en: 'Next to Hwaseong Fortress + Haenggung — heritage + guesthouses',
      ja: '水原華城・行宮横・伝統通り・ゲストハウス',
      zh: '水原华城·行宫旁·传统街区·民宿',
    },
    nightlyKRW: '₩70k-150k',
    icon: '🏯',
    bestFor: { ko: '전통·문화', en: 'Heritage', ja: '伝統・文化', zh: '传统·文化' },
    anchorAddress: '수원시 팔달구 행궁동',
  },
  {
    key: 'suwon_station',
    name: { ko: '수원역·인계동', en: 'Suwon Station / Ingye', ja: '水原駅・仁渓洞', zh: '水原站·仁溪洞' },
    desc: {
      ko: '도심 교통 허브·중급 비즈니스 호텔·맛집',
      en: 'Downtown transit hub, mid-range business hotels, restaurants',
      ja: '都心交通ハブ・中価格ビジネスホテル・グルメ',
      zh: '市区交通枢纽·中档商务酒店·美食',
    },
    nightlyKRW: '₩80k-160k',
    icon: '🚆',
    bestFor: { ko: '교통·미식', en: 'Transit + food', ja: '交通・グルメ', zh: '交通·美食' },
    anchorAddress: '수원시 팔달구 수원역',
  },
  {
    key: 'gwanggyo',
    name: { ko: '광교', en: 'Gwanggyo', ja: '光教', zh: '光教' },
    desc: {
      ko: '신도시·컨벤션센터·호수공원·고급 호텔',
      en: 'New city, convention center, lake park, upscale hotels',
      ja: '新都市・コンベンションセンター・湖公園・高級ホテル',
      zh: '新城·会展中心·湖公园·高档酒店',
    },
    nightlyKRW: '₩120k-260k',
    icon: '🌆',
    bestFor: { ko: '비즈니스', en: 'Business', ja: 'ビジネス', zh: '商务' },
    anchorAddress: '수원시 영통구 광교',
  },
];

export const YEOSU_ZONES: Zone[] = [
  {
    key: 'dolsan',
    name: { ko: '돌산·여수밤바다', en: 'Dolsan / Yeosu Night Sea', ja: '突山・麗水夜の海', zh: '突山·丽水夜海' },
    desc: {
      ko: '돌산대교 야경·해상 케이블카·바다 펜션',
      en: 'Dolsan Bridge night view, ocean cable car, sea-view pensions',
      ja: '突山大橋の夜景・海上ケーブルカー・海ビューペンション',
      zh: '突山大桥夜景·海上缆车·海景民宿',
    },
    nightlyKRW: '₩100k-260k',
    icon: '🌉',
    bestFor: { ko: '야경·바다', en: 'Night view + sea', ja: '夜景・海', zh: '夜景·海景' },
    anchorAddress: '여수시 돌산읍',
  },
  {
    key: 'yeosu_expo',
    name: { ko: '여수엑스포역', en: 'Yeosu Expo Station', ja: '麗水EXPO駅', zh: '丽水世博站' },
    desc: {
      ko: 'KTX 종착역·엑스포 단지·해양 리조트',
      en: 'KTX terminus, Expo grounds, marine resorts',
      ja: 'KTX終着駅・EXPO団地・マリンリゾート',
      zh: 'KTX终点站·世博园区·海洋度假',
    },
    nightlyKRW: '₩110k-280k',
    icon: '🚄',
    bestFor: { ko: '교통·리조트', en: 'Transit + resort', ja: '交通・リゾート', zh: '交通·度假' },
    anchorAddress: '여수시 엑스포역',
  },
  {
    key: 'jungang_dong',
    name: { ko: '시내·이순신광장', en: 'Downtown / Yi Sun-sin Sq', ja: '市内・李舜臣広場', zh: '市区·李舜臣广场' },
    desc: {
      ko: '낭만포차거리·전통시장·중저가 호텔',
      en: 'Romantic pojangmacha alley, traditional market, budget hotels',
      ja: 'ロマンチック屋台通り・伝統市場・中低価格ホテル',
      zh: '浪漫路边摊街·传统市场·中低价酒店',
    },
    nightlyKRW: '₩70k-130k',
    icon: '🍻',
    bestFor: { ko: '도심·먹거리', en: 'Downtown + food', ja: '市内・グルメ', zh: '市区·美食' },
    anchorAddress: '여수시 중앙동',
  },
];

export const DAEGU_ZONES: Zone[] = [
  {
    key: 'dongseongro',
    name: { ko: '동성로', en: 'Dongseong-ro', ja: '東城路', zh: '东城路' },
    desc: {
      ko: '대구 최대 번화가·쇼핑·맛집·중구 도심',
      en: "Daegu's main shopping street — food, retail, central Jung-gu",
      ja: '大邱最大の繁華街・ショッピング・グルメ・中区都心',
      zh: '大邱最大繁华街·购物·美食·中区市中心',
    },
    nightlyKRW: '₩80k-180k',
    icon: '🛍️',
    bestFor: { ko: '도심·쇼핑', en: 'Downtown + shopping', ja: '都心・買い物', zh: '市区·购物' },
    anchorAddress: '대구 중구 동성로',
  },
  {
    key: 'suseong',
    name: { ko: '수성구', en: 'Suseong-gu', ja: '寿城区', zh: '寿城区' },
    desc: {
      ko: '수성못·고급 주거지·조용한 카페·범어동',
      en: 'Suseong Lake, upscale residential, quiet cafés, Beomeo-dong',
      ja: '寿城池・高級住宅地・静かなカフェ・凡魚洞',
      zh: '寿城湖·高档住宅区·静谧咖啡馆·凡鱼洞',
    },
    nightlyKRW: '₩100k-220k',
    icon: '🏞️',
    bestFor: { ko: '조용함', en: 'Quiet', ja: '静か', zh: '静谧' },
    anchorAddress: '대구 수성구 수성못',
  },
  {
    key: 'dongdaegu',
    name: { ko: '동대구역', en: 'Dongdaegu Station', ja: '東大邱駅', zh: '东大邱站' },
    desc: {
      ko: 'KTX·SRT 환승 허브·신세계백화점·비즈니스 호텔',
      en: 'KTX/SRT transit hub, Shinsegae dept store, business hotels',
      ja: 'KTX・SRT乗換ハブ・新世界百貨店・ビジネスホテル',
      zh: 'KTX·SRT换乘枢纽·新世界百货·商务酒店',
    },
    nightlyKRW: '₩80k-160k',
    icon: '🚄',
    bestFor: { ko: '교통', en: 'Transit', ja: '交通', zh: '交通' },
    anchorAddress: '대구 동구 동대구역',
  },
];

/** Map of cityKey → zone list. Falls back to [] for unsupported cities. */
export const ZONES_BY_CITY: Record<string, Zone[]> = {
  seoul: SEOUL_ZONES,
  busan: BUSAN_ZONES,
  jeju: JEJU_ZONES,
  gyeongju: GYEONGJU_ZONES,
  jeonju: JEONJU_ZONES,
  gangneung: GANGNEUNG_ZONES,
  incheon: INCHEON_ZONES,
  suwon: SUWON_ZONES,
  yeosu: YEOSU_ZONES,
  daegu: DAEGU_ZONES,
};

export function getZonesForCity(cityKey: string | undefined): Zone[] {
  if (!cityKey) return [];
  return ZONES_BY_CITY[cityKey] || [];
}

// 다도시 plan 에서 zone 키 글로벌 reverse lookup. zone 키는 ZONES_BY_CITY 전체에서
// unique (myeongdong/haeundae/jungmun 등) 라서 도시 모름 상태로도 찾을 수 있음.
// 사용처: WizardForm submit 시 zone anchorAddress lookup, zone → mainCity auto-swap.
export function getZoneByKey(zoneKey: string | undefined): { zone: Zone; cityKey: string } | undefined {
  if (!zoneKey) return undefined;
  for (const [cityKey, zones] of Object.entries(ZONES_BY_CITY)) {
    const zone = zones.find(z => z.key === zoneKey);
    if (zone) return { zone, cityKey };
  }
  return undefined;
}

// city name (사용자 언어 ko/en/ja/zh) → ZONES_BY_CITY 키 (e.g. 'seoul'/'busan').
// 다도시 plan 에서 extraCities (이름 배열) 를 cityKey 배열로 변환할 때 사용.
// 별도 helper인 이유: PlannerPage/lib/formatters.ts 의 cityNameToAreaKey 는
// 'seoul_city' 같은 backend area 키 체계라 zoneData 키 ('seoul') 와 다름.
const NAME_TO_ZONE_CITY_KEY: Record<string, string> = {
  // English
  'seoul': 'seoul', 'busan': 'busan', 'jeju': 'jeju',
  'gyeongju': 'gyeongju', 'jeonju': 'jeonju', 'gangneung': 'gangneung',
  'incheon': 'incheon', 'suwon': 'suwon', 'yeosu': 'yeosu', 'daegu': 'daegu',
  // Korean
  '서울': 'seoul', '부산': 'busan', '제주': 'jeju',
  '경주': 'gyeongju', '전주': 'jeonju', '강릉': 'gangneung',
  '인천': 'incheon', '수원': 'suwon', '여수': 'yeosu', '대구': 'daegu',
  // Japanese
  'ソウル': 'seoul', '釜山': 'busan', '済州': 'jeju',
  '慶州': 'gyeongju', '全州': 'jeonju', '江陵': 'gangneung',
  '仁川': 'incheon', '水原': 'suwon', '麗水': 'yeosu', '大邱': 'daegu',
  // Chinese (Simplified)
  '首尔': 'seoul', '济州': 'jeju', '庆州': 'gyeongju', '丽水': 'yeosu',
  // Chinese (Traditional/Japanese 釜山 동일)
};

export function cityNameToZoneKey(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const trimmed = name.trim();
  return NAME_TO_ZONE_CITY_KEY[trimmed.toLowerCase()] || NAME_TO_ZONE_CITY_KEY[trimmed] || undefined;
}
