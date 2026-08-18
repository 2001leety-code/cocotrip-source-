import { AIRPORT_TRANSFER_PRICES, DAILY_TOUR_PRICES } from '@/data/charterPricing';

type CharterLanguage = 'ko' | 'en' | 'ja' | 'zh';
type JaZhLabel = Record<'ja' | 'zh', string>;
type LocalizedLabel = Record<CharterLanguage, string>;

// 가격 자료는 ko/en 이름만 가진다. 이 사전은 화면에 보이는 이름만 보완하며
// destinationKey, 거리, 시간, 가격, 결제 productType은 바꾸지 않는다.
const AIRPORT_DESTINATION_LABELS: Record<string, JaZhLabel> = {
  'seoul-central': {
    ja: 'ソウル都心（明洞・弘大・鍾路・龍山）',
    zh: '首尔市中心（明洞·弘大·钟路·龙山）',
  },
  'seoul-gangnam': { ja: '江南・蚕室・松坡', zh: '江南·蚕室·松坡' },
  'suwon-yongin': { ja: '水原・龍仁', zh: '水原·龙仁' },
  'gapyeong-nami': { ja: '加平・南怡島', zh: '加平·南怡岛' },
  chuncheon: { ja: '春川', zh: '春川' },
  'pyeongchang-yongpyong': {
    ja: '平昌・龍平・アルペンシア',
    zh: '平昌·龙平·阿尔卑斯',
  },
  'gangneung-sokcho': { ja: '江陵・束草', zh: '江陵·束草' },
  busan: { ja: '釜山（仁川空港直行）', zh: '釜山（仁川机场直达）' },
  'busan-metro': { ja: '釜山市内（金海空港発）', zh: '釜山市区（金海机场出发）' },
  'gimpo-seoul-central': {
    ja: 'ソウル都心（金浦空港発）',
    zh: '首尔市中心（金浦机场出发）',
  },
  'gimpo-seoul-gangnam': {
    ja: 'ソウル江南（金浦空港発）',
    zh: '首尔江南（金浦机场出发）',
  },
  'jeju-metro': { ja: '済州市内（済州空港発）', zh: '济州市区（济州机场出发）' },
};

const DAY_TOUR_DESTINATION_LABELS: Record<string, JaZhLabel> = {
  'seoul-city': { ja: 'ソウル市内ツアー', zh: '首尔市区一日游' },
  'seoul-suburb': {
    ja: 'ソウル近郊ツアー（南怡島・加平・水原）',
    zh: '首尔近郊一日游（南怡岛·加平·水原）',
  },
  dmz: { ja: 'DMZツアー', zh: 'DMZ游' },
  gangwon: {
    ja: '江原道日帰りツアー（春川・江陵・束草）',
    zh: '江原道一日游（春川·江陵·束草）',
  },
  'ski-resort': {
    ja: 'スキーリゾートツアー（龍平・アルペンシア・ハイワン）',
    zh: '滑雪度假村一日游（龙平·阿尔卑斯·High1）',
  },
  'gyeongju-jeonju': { ja: '慶州・全州ツアー', zh: '庆州·全州游' },
  'busan-day': { ja: '釜山日帰りツアー', zh: '釜山一日游' },
};

const MATRIX_DESTINATION_LABELS: Record<string, LocalizedLabel> = {
  SEL_METRO: { ko: '서울 시내', en: 'Seoul', ja: 'ソウル市内', zh: '首尔市区' },
  SEL_GANGNAM: { ko: '서울 강남·잠실', en: 'Gangnam / Jamsil', ja: '江南・蚕室', zh: '江南·蚕室' },
  SUWON: { ko: '수원', en: 'Suwon', ja: '水原', zh: '水原' },
  GAPYEONG: { ko: '가평·남이섬', en: 'Gapyeong / Nami Island', ja: '加平・南怡島', zh: '加平·南怡岛' },
  CHUNCHEON: { ko: '춘천', en: 'Chuncheon', ja: '春川', zh: '春川' },
  PYEONGCHANG: { ko: '평창', en: 'Pyeongchang', ja: '平昌', zh: '平昌' },
  GANGNEUNG: { ko: '강릉', en: 'Gangneung', ja: '江陵', zh: '江陵' },
  SOKCHO: { ko: '속초', en: 'Sokcho', ja: '束草', zh: '束草' },
  BUSAN: { ko: '부산', en: 'Busan', ja: '釜山', zh: '釜山' },
  BUS_METRO: { ko: '부산 시내', en: 'Busan', ja: '釜山市内', zh: '釜山市区' },
  GYEONGJU: { ko: '경주', en: 'Gyeongju', ja: '慶州', zh: '庆州' },
  JEONJU: { ko: '전주', en: 'Jeonju', ja: '全州', zh: '全州' },
  ANDONG: { ko: '안동', en: 'Andong', ja: '安東', zh: '安东' },
  YEOSU: { ko: '여수', en: 'Yeosu', ja: '麗水', zh: '丽水' },
  DAMYANG: { ko: '담양', en: 'Damyang', ja: '潭陽', zh: '潭阳' },
  DAEGU: { ko: '대구', en: 'Daegu', ja: '大邱', zh: '大邱' },
  DAEJEON: { ko: '대전', en: 'Daejeon', ja: '大田', zh: '大田' },
  JEJU_METRO: { ko: '제주 시내', en: 'Jeju', ja: '済州市内', zh: '济州市区' },
  SEOGWIPO: { ko: '서귀포', en: 'Seogwipo', ja: '西帰浦', zh: '西归浦' },
  SEONGSAN: { ko: '성산', en: 'Seongsan', ja: '城山', zh: '城山' },
  HALLASAN: { ko: '한라산', en: 'Hallasan', ja: '漢拏山', zh: '汉拿山' },
};

const KPOP_VENUE_LABELS: Record<string, { name: JaZhLabel; location: JaZhLabel }> = {
  'Inspire Arena': {
    name: { ja: 'インスパイア・アリーナ', zh: 'INSPIRE综艺馆' },
    location: { ja: '仁川・永宗島', zh: '仁川永宗岛' },
  },
  'Jamsil Olympic Stadium': {
    name: { ja: '蚕室オリンピック主競技場', zh: '蚕室奥林匹克主体育场' },
    location: { ja: 'ソウル・松坡', zh: '首尔松坡' },
  },
  'KSPO Dome': {
    name: { ja: 'KSPO DOME（体操競技場）', zh: 'KSPO巨蛋（体操竞技场）' },
    location: { ja: 'ソウル・松坡', zh: '首尔松坡' },
  },
  'Gocheok Sky Dome': {
    name: { ja: '高尺スカイドーム', zh: '高尺天空巨蛋' },
    location: { ja: 'ソウル・九老', zh: '首尔九老' },
  },
  'Suwon World Cup Stadium': {
    name: { ja: '水原ワールドカップ競技場', zh: '水原世界杯体育场' },
    location: { ja: '水原', zh: '水原' },
  },
};

function jaZhLabel(
  labels: Record<string, JaZhLabel>,
  key: string,
  fallback: string,
  language: CharterLanguage,
): string {
  if (language !== 'ja' && language !== 'zh') return fallback;
  return labels[key]?.[language] || fallback;
}

export function airportDestinationLabel(
  key: string,
  fallback: string,
  language: CharterLanguage,
): string {
  return jaZhLabel(AIRPORT_DESTINATION_LABELS, key, fallback, language);
}

export function dayTourDestinationLabel(
  key: string,
  fallback: string,
  language: CharterLanguage,
): string {
  return jaZhLabel(DAY_TOUR_DESTINATION_LABELS, key, fallback, language);
}

export function matrixDestinationLabel(key: string, language: CharterLanguage): string {
  return MATRIX_DESTINATION_LABELS[key]?.[language] || key;
}

// ─────────────────────────────────────────────────────────
// 결제 요약(Step6 quote / CharterNewPage 결제 패널) 전용 — Step3 는 서비스별로
// airportDestinationLabel/dayTourDestinationLabel/matrixDestinationLabel 을 나눠 부르지만,
// 요약 화면은 destinationKey 하나만 들고 있고 그게 어느 서비스에서 왔는지 다시 몰라도 된다.
// 세 사전의 key 네임스페이스가 겹치지 않는다(공항="seoul-central"류 kebab-case,
// 당일투어="dmz"류 kebab-case, 매트릭스="SEL_METRO"류 UPPER_SNAKE — pricing_spec.json 실측 확인)
// 그래서 순서대로 조회만 해도 안전하다. 셋 다 못 찾으면 caller 가 준 기존 fallback,
// 그것도 없으면 raw key(최후수단) — 가격/거리/결제 바디는 전혀 건드리지 않는다.
export function resolveDestinationKeyLabel(
  key: string | null | undefined,
  language: CharterLanguage,
  fallback?: string | null,
): string {
  if (!key) return fallback ?? '-';
  if (key in MATRIX_DESTINATION_LABELS) return matrixDestinationLabel(key, language);
  const airportBase = (AIRPORT_TRANSFER_PRICES as Record<string, { ko: string; en: string } | undefined>)[key];
  if (airportBase) {
    return airportDestinationLabel(key, language === 'ko' ? airportBase.ko : airportBase.en, language);
  }
  const dayTourBase = (DAILY_TOUR_PRICES as Record<string, { ko: string; en: string } | undefined>)[key];
  if (dayTourBase) {
    return dayTourDestinationLabel(key, language === 'ko' ? dayTourBase.ko : dayTourBase.en, language);
  }
  return fallback ?? key;
}

export function kpopVenueLabel(
  englishName: string,
  koreanName: string,
  englishLocation: string,
  koreanLocation: string,
  language: CharterLanguage,
): { title: string; sub: string } {
  if (language === 'ko') return { title: koreanName, sub: koreanLocation };
  if (language === 'en') return { title: englishName, sub: englishLocation };
  const localized = KPOP_VENUE_LABELS[englishName];
  return {
    title: localized?.name[language] || englishName,
    sub: localized?.location[language] || englishLocation,
  };
}
