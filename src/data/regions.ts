/**
 * 지역 페이지 id 의 단일 원천 (2026-08-23).
 *
 * 왜 만드는가: 같은 9개 목록이 네 곳에 흩어져 있었다 —
 *   `src/lib/seoRoutes.ts`(색인 경로) · `src/pages/RegionDetail.tsx`(사진 표) ·
 *   `src/components/region/regionTourSource.ts`(투어 매핑) · `src/sections/Regions.tsx`(구 홈 카드).
 * 어긋나도 아무도 몰랐고, 실제로 **9개 전부 색인 대상 페이지에서 들어오는 앵커가 0개**였다
 * (구 홈 카드는 `<div onClick={navigate}>` 라 크롤러에게는 링크가 아니고 키보드로도 못 간다).
 *
 * 이 배열이 진실이고, `tests/unit/region-inbound-links.test.ts` 가 네 곳과 대조한다.
 * 순서 = 화면 노출 순서(구 홈 카드 순서를 그대로 유지).
 */
export const REGION_IDS = [
  'seoul',
  'chuncheon',
  'paju',
  'ganghwa',
  'busan',
  'danyang',
  'incheon',
  'gyeongju',
  'jeonju',
] as const;

export type RegionId = (typeof REGION_IDS)[number];

export function regionPath(id: string): string {
  return `/region/${id}`;
}
