/**
 * Departure airport inference for multi-city plans.
 *
 * Extracted verbatim from api/ai-planner-full.js L47-72 (P129, 2026-05-21).
 * Pure function — no side effects, ESM-importable for tests.
 *
 * PDF-issue-4 fix (2026-05-14): 다도시 plan 의 마지막 city 가 arrival_airport
 * 와 다른 도시면 그 city 기본 공항으로 자동 추론 (예: 부산 입국 → 서울 마지막
 * → ICN 출국). 단도시거나 regions/cities 미정이면 arrival_airport 그대로.
 *
 * planner-intent-v1 (2026-08-24): city resolution now goes through
 * `resolveUiCityKey` (api/_shared/cityResolver.js) — the SSOT for the 10
 * wizard cities in ko/en/ja/zh — instead of an ad-hoc substring scan. The old
 * `last.includes(key)` matched "notseoul".includes('seoul') === true, so a
 * departure city that merely CONTAINED another city's name as a substring
 * silently inferred the wrong airport. resolveUiCityKey never cross-matches.
 */
import { resolveUiCityKey } from '../_shared/cityResolver.js';

// ── UI city key → default airport (PDF-issue-4 / planner-intent-v1).
//    SAFETY (tests/unit/departure-airport-derive-launch.test.ts, P-launch
//    2026-05-31): international-service airports ONLY. gyeongju/gangneung/
//    yeosu/suwon/jeonju have no international departures (or none at all) —
//    auto-assigning one of those as a foreign traveller's exit airport is a
//    missed-flight risk, so they are deliberately left OUT of this table and
//    fall back to arrivalAirport instead. A traveller may still pick RSU/YNY
//    explicitly (departure_airport body field) — this table is auto-inference
//    only, not the set of valid airports.
export const CITY_DEFAULT_AIRPORT = {
  seoul: 'ICN',
  incheon: 'ICN',
  busan: 'PUS',
  jeju: 'CJU',
  daegu: 'TAE',
};

/**
 * @param {string} arrivalAirport
 * @param {string[]} regions
 * @param {string[]} cities
 * @param {string} [departureCityKey] — planner-intent-v1 (2026-08-24): the city the
 *   traveller EXPLICITLY marked as their exit in the Wizard cycle. When present it
 *   wins over "last raw region" — the raw order is the order the cities were picked
 *   in, not the order they'll be visited, so a Seoul→Busan pick with an explicit
 *   Seoul exit used to route the traveller to PUS (= missed flight).
 */
// area/region convention elsewhere in this repo is "<cityKey>_city" (e.g.
// requestShaper's `area` default 'seoul_city') — an exact-match resolver has
// to know that suffix is there, or every one of those legacy values would
// fail closed to "unresolved" instead of resolving cleanly.
function resolveCityToken(token) {
  return resolveUiCityKey(String(token || '').split('_')[0]);
}

export function inferDepartureAirport(arrivalAirport, regions, cities, departureCityKey = '') {
  const explicitKey = resolveCityToken(departureCityKey);
  if (explicitKey && CITY_DEFAULT_AIRPORT[explicitKey]) return CITY_DEFAULT_AIRPORT[explicitKey];

  // 다도시 plan 만 처리. 단도시거나 regions/cities 미정이면 arrival_airport 그대로.
  const list = Array.isArray(regions) && regions.length > 0
    ? regions
    : (Array.isArray(cities) && cities.length > 0 ? cities : null);
  if (!list || list.length <= 1) return arrivalAirport;

  const lastKey = resolveCityToken(list[list.length - 1]);
  if (lastKey && CITY_DEFAULT_AIRPORT[lastKey]) return CITY_DEFAULT_AIRPORT[lastKey];
  return arrivalAirport;
}
