// Pure formatting helpers -- extracted from legacy PlannerPage.tsx.
import { DATE_LOCALE } from '../constants';

export function formatDate(dateStr: string, lang: string) {
  return new Date(dateStr).toLocaleDateString(DATE_LOCALE[lang] ?? 'en-US', {
    month: 'long', day: 'numeric', weekday: 'short',
  });
}

// City name to API area key conversion.
// 2026-05-05 regression fix: 이전엔 .includes('seoul') 만 체크해서 Korean('서울') /
// Japanese('ソウル') / Chinese('首尔') 사용자가 mainCity 로 localized name 을 보내면
// 모두 area = (raw localized) 로 전달 → backend AREA_TO_CITY 매칭 실패 → food_index
// city 매칭 실패 → recommended_restaurants 빈 array → 식당 10개 카드 미노출.
// 4-lang 별칭 모두 매칭 (CocoTrip 지원 도시 5개 + 추가 도시 8개).
const CITY_ALIASES: Record<string, string[]> = {
  seoul_city: ['seoul', '서울', 'ソウル', '首尔'],
  busan:     ['busan', '부산', '釜山'],
  jeju:      ['jeju', '제주', '済州', '济州'],
  gyeongju:  ['gyeongju', '경주', '慶州', '庆州'],
  jeonju:    ['jeonju', '전주', '全州'],
  incheon:   ['incheon', '인천', '仁川'],
  suwon:     ['suwon', '수원', '水原'],
  gangneung: ['gangneung', '강릉', '江陵'],
  yeosu:     ['yeosu', '여수', '丽水', '麗水'],
  daegu:     ['daegu', '대구', '大邱'],
  daejeon:   ['daejeon', '대전', '大田'],
  gwangju:   ['gwangju', '광주', '光州'],
};

export function cityNameToAreaKey(cityName: string): string {
  const name = (cityName || '').toLowerCase().trim();
  for (const [key, aliases] of Object.entries(CITY_ALIASES)) {
    if (aliases.some((a) => name.includes(a.toLowerCase()))) return key;
  }
  return name || 'seoul_city';
}
