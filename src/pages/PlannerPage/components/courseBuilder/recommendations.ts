/**
 * 코스 빌더 추천 장소 — 정적 attractions DB (2026-07-04 MVP).
 *
 * 소스 = src/data/attractions/*.json (4개 파일 ~200곳, 4-lang 이름·좌표·도시·요금).
 * 프론트 번들 정적 데이터라 무료·오프라인·즉시. zone_courses(Firestore) 연동은 2차.
 * ⚠️ api/_food_index.json 은 백엔드 전용(1.2MB) — 절대 임포트 금지 (CLAUDE.md B-1).
 */
import museums from '@/data/attractions/museums.json';
import nightSpots from '@/data/attractions/night_spots.json';
import temples from '@/data/attractions/temples.json';
import themes from '@/data/attractions/themes.json';

export interface RecoPlace {
  key: string;
  name: { ko: string; en: string; ja: string; zh: string };
  theme: string;
  city: string;
  lat: number;
  lng: number;
  rating?: number;
  entry_fee_krw?: number;
}

// 4개 파일 병합 + key 중복 제거 — 같은 장소가 여러 테마 파일에 실려 있음
// (예: national_museum_korea 가 museums+themes 양쪽). 중복 key 는 React 렌더 오류.
const ALL: RecoPlace[] = (() => {
  const byKey = new Map<string, RecoPlace>();
  for (const p of ([] as RecoPlace[]).concat(
    museums as RecoPlace[], nightSpots as RecoPlace[], temples as RecoPlace[], themes as RecoPlace[],
  )) {
    if (!byKey.has(p.key)) byKey.set(p.key, p);
  }
  return [...byKey.values()];
})();

/**
 * 도시 필터 목록 — 장소 수 상위 도시만 (기본 12개).
 * 데이터에 도시가 49종이나 있어 전부 칩으로 깔면 UI 폭주(실측 3200px 스트립) + 무의미.
 */
export function recoCities(limit = 12): string[] {
  const count = new Map<string, number>();
  for (const p of ALL) {
    if (p.city) count.set(p.city, (count.get(p.city) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([c]) => c);
}

/** 도시별 추천 — rating 내림차순, limit 개. city 미지정이면 전체 상위. */
export function recoForCity(city: string | null, limit = 12): RecoPlace[] {
  const pool = city ? ALL.filter((p) => p.city === city) : ALL;
  return [...pool].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, limit);
}
