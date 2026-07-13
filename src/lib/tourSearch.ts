/**
 * 투어 텍스트 검색 매칭 (UIUX 가이드 P1 홈 검색바 → /tours?q= 라우팅, 2026-07-13).
 * 제목·요약(전 언어)·지역·태그 대소문자 무시 부분일치 — 언어 혼용 입력
 * (예: 영어 UI에서 '부산') 대응 위해 현재 언어만이 아니라 전 언어 값을 검사.
 * 순수 함수 (React/firebase 무접촉) — vitest 직접 테스트용.
 */

export interface SearchableTour {
  title?: Record<string, string | undefined>;
  summary?: Record<string, string | undefined>;
  region?: string;
  tags?: readonly string[];
}

export function matchesTourQuery(tour: SearchableTour, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    ...Object.values(tour.title || {}),
    ...Object.values(tour.summary || {}),
    tour.region,
    ...(tour.tags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}
