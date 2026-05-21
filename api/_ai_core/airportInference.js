/**
 * Departure airport inference for multi-city plans.
 *
 * Extracted verbatim from api/ai-planner-full.js L47-72 (P129, 2026-05-21).
 * Pure function — no side effects, ESM-importable for tests.
 *
 * PDF-issue-4 fix (2026-05-14): 다도시 plan 의 마지막 city 가 arrival_airport
 * 와 다른 도시면 그 city 기본 공항으로 자동 추론 (예: 부산 입국 → 서울 마지막
 * → ICN 출국). 단도시거나 regions/cities 미정이면 arrival_airport 그대로.
 */

// ── 도시 → 기본 공항 매핑 (PDF-issue-4, 2026-05-14) ─────────────────────────
export const CITY_DEFAULT_AIRPORT = {
  seoul: 'ICN', '서울': 'ICN',
  busan: 'PUS', '부산': 'PUS',
  jeju:  'CJU', '제주': 'CJU',
  daegu: 'TAE', '대구': 'TAE',
};

export function inferDepartureAirport(arrivalAirport, regions, cities) {
  // 다도시 plan 만 처리. 단도시거나 regions/cities 미정이면 arrivalAirport 그대로.
  const list = Array.isArray(regions) && regions.length > 0
    ? regions
    : (Array.isArray(cities) && cities.length > 0 ? cities : null);
  if (!list || list.length <= 1) return arrivalAirport;

  const last = String(list[list.length - 1] || '').toLowerCase().trim();
  if (!last) return arrivalAirport;

  // substring 매칭 (예: "seoul_city" → seoul, "부산광역시" → 부산)
  for (const [key, airport] of Object.entries(CITY_DEFAULT_AIRPORT)) {
    if (last.includes(key)) return airport;
  }
  return arrivalAirport;
}
