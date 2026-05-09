// WizardForm shared data: city chips, airport mapping, activity/food keys.
// Kept as .tsx because icon constants contain JSX.
import type { ReactNode } from 'react';
import {
  Music2, Sparkles, Shirt, UtensilsCrossed, Moon, Camera, ShoppingBag,
  Film, Landmark, Mountain, Plane, Building2, Waves, TreePine, Castle, Ship, Compass, Snowflake, Palmtree,
  Fish, Beef, Coffee, Wine, Anchor, Flag, FerrisWheel, Tent,
  Bike, PersonStanding, Footprints, Trees, Music, BookOpen, Heart, Sunset,
} from 'lucide-react';
import type { Locale } from 'date-fns';
import { enUS, ko, ja, zhCN } from 'date-fns/locale';

export type AirportOption = { value: string; label: string };

export const CITY_CHIPS: { key: string; icon: ReactNode }[] = [
  { key: 'seoul',     icon: <Building2 className="w-4 h-4" /> },
  { key: 'busan',     icon: <Waves className="w-4 h-4" /> },
  { key: 'jeju',      icon: <Palmtree className="w-4 h-4" /> },
  { key: 'gyeongju',  icon: <Landmark className="w-4 h-4" /> },
  { key: 'jeonju',    icon: <Compass className="w-4 h-4" /> },
  { key: 'gangneung', icon: <Snowflake className="w-4 h-4" /> },
  { key: 'incheon',   icon: <Plane className="w-4 h-4" /> },
  { key: 'suwon',     icon: <Castle className="w-4 h-4" /> },
  { key: 'yeosu',     icon: <Ship className="w-4 h-4" /> },
  { key: 'daegu',     icon: <TreePine className="w-4 h-4" /> },
];

export const AIRPORT_OPTIONS: Record<string, AirportOption[]> = {
  seoul: [
    { value: 'ICN_T1', label: 'ICN Terminal 1' },
    { value: 'ICN_T2', label: 'ICN Terminal 2' },
    { value: 'GMP',    label: 'Gimpo Airport' },
    { value: 'ALREADY', label: 'Already in Seoul' },
  ],
  incheon: [
    { value: 'ICN_T1', label: 'ICN Terminal 1' },
    { value: 'ICN_T2', label: 'ICN Terminal 2' },
    { value: 'ALREADY', label: 'Already in Incheon' },
  ],
  busan: [
    { value: 'PUS',    label: 'Gimhae Airport (PUS)' },
    { value: 'ICN_T1', label: 'ICN Terminal 1' },
    { value: 'ALREADY', label: 'Already in Busan' },
  ],
  gyeongju: [
    { value: 'PUS',    label: 'Gimhae Airport (PUS)' },
    { value: 'ICN_T1', label: 'ICN Terminal 1' },
    { value: 'ALREADY', label: 'Already in Korea' },
  ],
  daegu: [
    { value: 'TAE',    label: 'Daegu Airport (TAE)' },
    { value: 'PUS',    label: 'Gimhae Airport (PUS)' },
    { value: 'ALREADY', label: 'Already in Daegu' },
  ],
  jeju: [
    { value: 'CJU',    label: 'Jeju Airport (CJU)' },
    { value: 'ICN_T1', label: 'ICN Terminal 1' },
    { value: 'ALREADY', label: 'Already in Jeju' },
  ],
  jeonju: [
    { value: 'MWX',    label: 'Muan Airport (MWX)' },
    { value: 'ICN_T1', label: 'ICN Terminal 1' },
    { value: 'ALREADY', label: 'Already in Korea' },
  ],
  gangneung: [
    { value: 'YNY',    label: 'Yangyang Airport (YNY)' },
    { value: 'ICN_T1', label: 'ICN Terminal 1' },
    { value: 'ALREADY', label: 'Already in Korea' },
  ],
  yeosu: [
    { value: 'RSU',    label: 'Yeosu Airport (RSU)' },
    { value: 'ICN_T1', label: 'ICN Terminal 1' },
    { value: 'ALREADY', label: 'Already in Korea' },
  ],
  suwon: [
    { value: 'ICN_T1', label: 'ICN Terminal 1' },
    { value: 'ICN_T2', label: 'ICN Terminal 2' },
    { value: 'GMP',    label: 'Gimpo Airport' },
    { value: 'ALREADY', label: 'Already in Korea' },
  ],
};

export const AIRPORT_DISPLAY: Record<string, string> = {
  ICN_T1: 'ICN T1', ICN_T2: 'ICN T2', GMP: 'Gimpo',
  PUS: 'Gimhae (PUS)', CJU: 'Jeju (CJU)', TAE: 'Daegu (TAE)',
  KWJ: 'Gwangju (KWJ)', MWX: 'Muan (MWX)', YNY: 'Yangyang (YNY)',
  RSU: 'Yeosu (RSU)', ALREADY: 'Already in KR',
};

export const ACTIVITY_ICON_MAP: Record<string, ReactNode> = {
  Kpop:     <Music2 className="w-5 h-5" />,
  Kbeauty:  <Sparkles className="w-5 h-5" />,
  Hanbok:   <Shirt className="w-5 h-5" />,
  Food:     <UtensilsCrossed className="w-5 h-5" />,
  Night:    <Moon className="w-5 h-5" />,
  Photo:    <Camera className="w-5 h-5" />,
  Shopping: <ShoppingBag className="w-5 h-5" />,
  Drama:    <Film className="w-5 h-5" />,
  Temple:   <Landmark className="w-5 h-5" />,
  Dmz:      <Mountain className="w-5 h-5" />,
};

export const ACTIVITY_KEYS = [
  'Kpop', 'Kbeauty', 'Hanbok', 'Food', 'Night',
  'Photo', 'Shopping', 'Drama', 'Temple', 'Dmz',
] as const;

// P9 (2026-04-24): per-city activity chip mapping. Universal chips (Food/
// Photo/Shopping/Night) always render; city-specific chips append below.
// DMZ tour only meaningful when 서울 selected, 깡통시장 only for 부산, etc.
//
// Multi-city plan: takes UNION of all selected cities' chips so a Seoul+Busan
// trip shows DMZ + Jagalchi together. Universal 4 are deduplicated.
export const UNIVERSAL_ACTIVITIES = ['Food', 'Photo', 'Shopping', 'Night'] as const;

export const CITY_ACTIVITIES: Record<string, readonly string[]> = {
  seoul:     ['Kpop', 'Kbeauty', 'Hanbok', 'Drama', 'Temple', 'Dmz', 'Palace'],
  busan:     ['Jagalchi', 'Gamcheon', 'Haeundae', 'BusanFood'],
  jeju:      ['OlleTrail', 'Hallasan', 'Haenyeo', 'JejuFood'],
  gyeongju:  ['Bulguksa', 'Anapji', 'GyeongjuHanok'],
  jeonju:    ['HanokVillage', 'Makgeolli', 'JeonjuFood'],
  gangneung: ['CoffeeStreet', 'GangneungBeach'],
  yeosu:     ['YeosuLights', 'CableCar'],
  suwon:     ['Hwaseong'],
  incheon:   ['ChinaTown'],
  daegu:     ['DaeguTower'],
};

// Resolve mainCityKey + extraCityKeys → ordered list of activity keys,
// universal first then city-specific (deduped, preserves first-seen order).
export function getActivitiesForCities(cityKeys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of UNIVERSAL_ACTIVITIES) { seen.add(k); out.push(k); }
  for (const ck of cityKeys) {
    const list = CITY_ACTIVITIES[ck] || [];
    for (const a of list) {
      if (!seen.has(a)) { seen.add(a); out.push(a); }
    }
  }
  return out;
}

// Icons for new city-specific chips. Existing icons in ACTIVITY_ICON_MAP
// remain for the 10 universal/seoul-original chips.
// 2026-05-09 (UI variety): expanded chip icons merge below for unified lookup.
export const CITY_ACTIVITY_ICONS: Record<string, ReactNode> = {
  Palace:        <Castle className="w-5 h-5" />,
  Jagalchi:      <Fish className="w-5 h-5" />,
  Gamcheon:      <Camera className="w-5 h-5" />,
  Haeundae:      <Waves className="w-5 h-5" />,
  BusanFood:     <UtensilsCrossed className="w-5 h-5" />,
  OlleTrail:     <TreePine className="w-5 h-5" />,
  Hallasan:      <Mountain className="w-5 h-5" />,
  Haenyeo:       <Anchor className="w-5 h-5" />,
  JejuFood:      <Fish className="w-5 h-5" />,
  Bulguksa:      <Landmark className="w-5 h-5" />,
  Anapji:        <Sparkles className="w-5 h-5" />,
  GyeongjuHanok: <Tent className="w-5 h-5" />,
  HanokVillage:  <Tent className="w-5 h-5" />,
  Makgeolli:     <Wine className="w-5 h-5" />,
  JeonjuFood:    <UtensilsCrossed className="w-5 h-5" />,
  CoffeeStreet:  <Coffee className="w-5 h-5" />,
  GangneungBeach:<Waves className="w-5 h-5" />,
  YeosuLights:   <Sparkles className="w-5 h-5" />,
  CableCar:      <FerrisWheel className="w-5 h-5" />,
  Hwaseong:      <Castle className="w-5 h-5" />,
  ChinaTown:     <Flag className="w-5 h-5" />,
  DaeguTower:    <Building2 className="w-5 h-5" />,
};

// 2026-05-09 (UI variety): "선택지가 너무 많아지는 게 걱정이지만 돈 안 들이고
// 할 수 있는 것 추가 필요" 사용자 신고에 대응. 메인 chips는 그대로 유지하고
// "+ Show more activities" 버튼 클릭 시에만 노출되는 sub-chips 정의.
// 무료(₩0) 활동을 강조해 가격 민감 외국인 여행자 만족도 ↑.
//
// 그룹 분류:
//   - outdoor: 야외/액티브 (트레킹·자전거·러닝·산책)
//   - culture_free: 무료 문화 (무료 박물관·시장 관람·K-스트리트)
//   - wellness: 웰니스 (찜질방·한강 피크닉)
//
// `free: true` 인 항목은 UI에 ₩0 배지 노출.
export interface ExpandedActivity {
  key: string;
  free: boolean;
  group: 'outdoor' | 'culture_free' | 'wellness';
}

export const ACTIVITY_CHIPS_EXPANDED: ExpandedActivity[] = [
  // 야외 / 액티브 — 모두 무료
  { key: 'Trekking',           free: true, group: 'outdoor' },
  { key: 'HangangBike',        free: true, group: 'outdoor' },
  { key: 'HangangRun',         free: true, group: 'outdoor' },
  { key: 'CheonggyecheonWalk', free: true, group: 'outdoor' },
  { key: 'SeoulDoolegil',      free: true, group: 'outdoor' },
  { key: 'NamsanHike',         free: true, group: 'outdoor' },
  // 무료 문화
  { key: 'FreeMuseum',         free: true, group: 'culture_free' },
  { key: 'GwangjangView',      free: true, group: 'culture_free' },
  { key: 'KpopStreetWatch',    free: true, group: 'culture_free' },
  { key: 'BookstoreCafe',      free: false, group: 'culture_free' },
  // 웰니스
  { key: 'Jjimjilbang',        free: false, group: 'wellness' },
  { key: 'HangangPicnic',      free: true, group: 'wellness' },
];

// 확장 chip 아이콘 — 위 그룹 순서와 동일.
export const EXPANDED_ACTIVITY_ICONS: Record<string, ReactNode> = {
  Trekking:           <Mountain className="w-5 h-5" />,
  HangangBike:        <Bike className="w-5 h-5" />,
  HangangRun:         <PersonStanding className="w-5 h-5" />,
  CheonggyecheonWalk: <Footprints className="w-5 h-5" />,
  SeoulDoolegil:      <Trees className="w-5 h-5" />,
  NamsanHike:         <Mountain className="w-5 h-5" />,
  FreeMuseum:         <BookOpen className="w-5 h-5" />,
  GwangjangView:      <Tent className="w-5 h-5" />,
  KpopStreetWatch:    <Music className="w-5 h-5" />,
  BookstoreCafe:      <Coffee className="w-5 h-5" />,
  Jjimjilbang:        <Heart className="w-5 h-5" />,
  HangangPicnic:      <Sunset className="w-5 h-5" />,
};

// P10 (2026-04-24): 'Halal' moved out of style preferences into ALLERGY_KEYS
// (renamed "Dietary Restrictions") because it is a religious obligation, not
// a flavor preference. Same reasoning for 'Vegan' — it's a hard restriction
// when chosen, not a flavor.
export const FOOD_STYLE_KEYS = ['Seafood', 'Meat', 'Street'] as const;

export const FOOD_STYLE_ICONS: Record<string, ReactNode> = {
  Seafood: <Fish className="w-5 h-5" />,
  Meat: <Beef className="w-5 h-5" />,
  Street: <ShoppingBag className="w-5 h-5" />,
};

// 'None' must remain LAST — Step1Food's toggle treats it as the "clear all"
// option (selected when allergies array is empty).
export const ALLERGY_KEYS = ['Halal', 'Vegan', 'Nuts', 'Shellfish', 'Gluten', 'Dairy', 'None'] as const;
export const PRICE_KEYS = ['Budget', 'Moderate', 'Premium', 'Any'] as const;

// P10 매운맛 4단계 슬라이더 (Step1Food에서 사용).
// none = 안 매운 음식만, mild = 가벼운 매콤, medium = 김치 정도, hot = 불닭/엽기떡볶이.
export const SPICE_LEVEL_KEYS = ['none', 'mild', 'medium', 'hot'] as const;
export type SpiceLevel = typeof SPICE_LEVEL_KEYS[number];

// P10 한식 버킷리스트 — Step1Food에서 multi-select.
// 외국인 인지도 높은 메뉴 위주로 8개. Gemini 프롬프트에 inject되어
// 일정에 자연스럽게 배치되도록 함.
export const KOREAN_BUCKET_LIST = [
  'kbbq', 'kfc', 'tteokbokki', 'bibimbap', 'samgyetang', 'naengmyeon', 'jokbal', 'sundubu',
] as const;
export type BucketDish = typeof KOREAN_BUCKET_LIST[number];

export const LOCALE_MAP: Record<string, Locale> = { en: enUS, ko, ja, zh: zhCN };
