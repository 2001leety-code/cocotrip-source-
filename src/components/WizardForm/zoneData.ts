// Sprint 2 #5 — recommended Seoul lodging zones for users without a booked hotel.
// Each zone includes localized name + description + nightly price band so the
// wizard can render rich cards. Keep the data inline (not in i18n.json) since
// these are tied to specific physical zones and don't need parity validation.
//
// Currently Seoul-only — Busan/Jeju get added once we have validated zones for
// each. The wizard falls back to "skip recommendation" when mainCity is not
// in this map.

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
  },
];

/** Map of cityKey → zone list. Falls back to [] for unsupported cities. */
export const ZONES_BY_CITY: Record<string, Zone[]> = {
  seoul: SEOUL_ZONES,
  busan: BUSAN_ZONES,
  jeju: JEJU_ZONES,
};

export function getZonesForCity(cityKey: string | undefined): Zone[] {
  if (!cityKey) return [];
  return ZONES_BY_CITY[cityKey] || [];
}
