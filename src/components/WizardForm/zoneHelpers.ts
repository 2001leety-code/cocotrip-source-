// 2026-05-13 PR #393 후속: zoneData lazy-split. CITY_NAME_BY_KEY + cityNameToZoneKey
// 만 별도 모듈로 추출 → main planner chunk 에서 zoneData arrays (SEOUL_ZONES 등
// 600 줄, ~28KB) 분리. ZoneRecommender (lazy) 만 무거운 데이터 fetch.
//
// 사용처:
// - WizardForm/index.tsx — cityNameToZoneKey (extraCities → cityKeys, swap 로직)
// - WizardForm/WizardStep2Details.tsx — CITY_NAME_BY_KEY (다도시 도시 라벨)
// - PlannerPage 등 기타 호출자 동일
//
// getZoneByKey, getZonesForCity, ZONES_BY_CITY, SEOUL_ZONES 등 heavy data 는
// 그대로 zoneData.ts 에 남김 (ZoneRecommender 가 lazy import 로 fetch).
// handleGenerate 의 getZoneByKey 도 dynamic import 로 전환 (zoneData.ts).

/** 도시 키 → 4언어 이름 + emoji. ZoneRecommender 와 WizardStep2Details (다도시
 *  도시 라벨) 가 사용. heavy data 와 다르게 row 10개 (~1KB) 라서 eager OK. */
export const CITY_NAME_BY_KEY: Record<string, { ko: string; en: string; ja: string; zh: string; icon: string }> = {
  seoul:     { ko: '서울',   en: 'Seoul',     ja: 'ソウル',   zh: '首尔',   icon: '🏙️' },
  busan:     { ko: '부산',   en: 'Busan',     ja: '釜山',     zh: '釜山',   icon: '🌊' },
  jeju:      { ko: '제주',   en: 'Jeju',      ja: '済州',     zh: '济州',   icon: '🌴' },
  gyeongju:  { ko: '경주',   en: 'Gyeongju',  ja: '慶州',     zh: '庆州',   icon: '🏛️' },
  jeonju:    { ko: '전주',   en: 'Jeonju',    ja: '全州',     zh: '全州',   icon: '🍱' },
  gangneung: { ko: '강릉',   en: 'Gangneung', ja: '江陵',     zh: '江陵',   icon: '☕' },
  incheon:   { ko: '인천',   en: 'Incheon',   ja: '仁川',     zh: '仁川',   icon: '✈️' },
  suwon:     { ko: '수원',   en: 'Suwon',     ja: '水原',     zh: '水原',   icon: '🏯' },
  yeosu:     { ko: '여수',   en: 'Yeosu',     ja: '麗水',     zh: '丽水',   icon: '🌃' },
  daegu:     { ko: '대구',   en: 'Daegu',     ja: '大邱',     zh: '大邱',   icon: '🚄' },
};

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
