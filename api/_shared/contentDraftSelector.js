/**
 * 마케팅 콘텐츠 직원 — 소재 셀렉터 (순수 함수, 단위 테스트 100%).
 *
 * 2026-06-10 자가운영 에이전시 P3. _food_index.json(평점 4.5+ 맛집)에서 오늘의 소재 1곳을 **결정적**으로 선택.
 * 네트워크·AI 0. 사실(이름/도시/평점/가격)은 코드가 DB에서 뽑아 잠근다 → AI 환각 차단의 1층.
 *
 * v1 = 맛집만. 명소(_korea_spots.json)는 구조 확정 후 v2.
 * 데이터 풍부한 도시 화이트리스트(서울 1853·부산 323·제주 180) — 빈약 도시(경주/전주) 반복 회피.
 */

const CITY_LABEL = { seoul: '서울', busan: '부산', jeju: '제주', gyeongju: '경주', jeonju: '전주', daegu: '대구', incheon: '인천' };
const DEFAULT_CITIES = ['seoul', 'busan', 'jeju'];

/** KST 기준 epoch-day — 결정적 rotation 인덱스 (같은 날=같은 소재, 다음 날=다음 소재). */
export function kstDayIndex(nowReal = new Date()) {
  const ms = nowReal instanceof Date ? nowReal.getTime() : Number(nowReal) || Date.now();
  return Math.floor((ms + 9 * 3600 * 1000) / 86_400_000);
}

/**
 * food_index 배열 → 고품질 + 화이트리스트 도시 + 필수필드 충족 소재 후보 (결정적 정렬).
 * @param {Array} foodArray - _food_index.json (배열)
 * @param {{cities?: string[], minRating?: number, minReviews?: number}} [opts]
 */
export function selectFoodMaterials(foodArray, opts = {}) {
  const cities = new Set(opts.cities || DEFAULT_CITIES);
  const minRating = opts.minRating != null ? opts.minRating : 4.5;
  const minReviews = opts.minReviews != null ? opts.minReviews : 50;
  return (Array.isArray(foodArray) ? foodArray : [])
    .filter((e) => e && cities.has(e.city) && e.name && e.nameEn
      && Number(e.rating) >= minRating && Number(e.reviewCount) >= minReviews)
    .sort((a, b) => String(a.placeId || a.name).localeCompare(String(b.placeId || b.name))) // 결정적 순서
    .map((e) => ({
      name: e.name,
      nameEn: e.nameEn,
      city: e.city,
      cityLabel: CITY_LABEL[e.city] || e.city,
      dong: e.dong || '',
      cuisine: e.cuisine || '',
      cuisineKo: e.cuisineKo || '',
      rating: Number(e.rating),
      reviewCount: Number(e.reviewCount),
      // 'Unknown'/'미정' 가격은 빈 문자열 → 프롬프트/표시에서 가격 주장 안 함 (환각·오정보 방지).
      priceLabel: e.priceLabel && e.priceLabel !== 'Unknown' ? e.priceLabel : '',
      priceLabelKo: e.priceLabelKo && e.priceLabelKo !== '미정' ? e.priceLabelKo : '',
    }));
}

/** 후보 리스트에서 dayIndex 로 결정적 1곳 선택 (rotation). 빈 리스트 → null. */
export function pickDailyMaterial(materials, dayIndex) {
  if (!Array.isArray(materials) || materials.length === 0) return null;
  const n = materials.length;
  const i = (((Number(dayIndex) || 0) % n) + n) % n;
  return materials[i];
}
