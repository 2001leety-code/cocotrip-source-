// WizardForm shared data: city chips, airport mapping, activity/food keys.
// Kept as .tsx because icon constants contain JSX.
import type { ReactNode } from 'react';
import {
  Music2, Sparkles, Shirt, UtensilsCrossed, Moon, Camera, ShoppingBag,
  Film, Landmark, Mountain, Plane, Building2, Waves, TreePine, Castle, Ship, Compass, Snowflake, Palmtree,
  Fish, Beef, Coffee, Wine, Anchor, Flag, FerrisWheel, Tent,
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
