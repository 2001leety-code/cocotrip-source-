/**
 * 지역 페이지 ↔ 투어 상품 연결 표 (2026-08-06).
 *
 * `RegionSeoInfo.tsx` 에서 분리한 이유는 하나뿐이다 — 컴포넌트 파일이 컴포넌트 말고
 * 다른 걸 export 하면 개발 중 화면 갱신(fast refresh)이 깨진다(`react-refresh/only-export-components`).
 * 값 자체는 그 컴포넌트만 쓴다.
 */
import type { TourRegion } from '@/data/tours';

/**
 * 지역 페이지 id → 그 페이지에서 보여줄 투어의 `TourRegion`.
 *
 * ⚠️ 둘은 같은 목록이 아니다. 지역 페이지 id 는 `sections/Regions.tsx` 기준이고
 *    `TourRegion` 은 상품 분류다. 어긋나는 곳만 적어 둔다:
 *      paju    → 'DMZ'      (DMZ·파주 투어의 분류명이 'DMZ')
 *      incheon → 'Ganghwa'  (해당 투어 제목이 "Incheon & Ganghwa" 이고 인천 차이나타운을 실제로 들른다)
 *      jeonju  → 없음       (전주 투어 상품이 아직 없다. 없는 걸 있다고 쓰지 않는다)
 *  잠금 = `tests/unit/region-seo-info.component.test.tsx`
 *    (지역 9개가 전부 이 표에 있는지 + 매핑한 분류가 실제로 투어를 돌려주는지)
 */
export const REGION_TOUR_SOURCE: Record<string, TourRegion | null> = {
  seoul: 'Seoul',
  busan: 'Busan',
  gyeongju: 'Gyeongju',
  danyang: 'Danyang',
  chuncheon: 'Chuncheon',
  ganghwa: 'Ganghwa',
  incheon: 'Ganghwa',
  paju: 'DMZ',
  jeonju: null,
};

/** 3일 멀티시티 투어가 실제로 들르는 도시 (상품 제목 "Seoul · Gyeongju · Busan" 기준). */
export const MULTICITY_REGIONS = new Set(['seoul', 'gyeongju', 'busan']);
