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
];

/** Map of cityKey → zone list. Currently Seoul only; falls back to [] for others. */
export const ZONES_BY_CITY: Record<string, Zone[]> = {
  seoul: SEOUL_ZONES,
};

export function getZonesForCity(cityKey: string | undefined): Zone[] {
  if (!cityKey) return [];
  return ZONES_BY_CITY[cityKey] || [];
}
