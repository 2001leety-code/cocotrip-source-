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

// GMP is never auto-inferred (not in CITY_DEFAULT_AIRPORT) but a traveller can pick it explicitly.
const AIRPORT_CITY_EXTRA = { GMP: 'seoul' };

/**
 * Airport code ('ICN_T1', 'PUS', 'GMP' …) → the picked city it serves, or '' when it serves none of them.
 * @param {string} airport
 * @param {string[]} cityKeys
 */
export function cityForAirport(airport, cityKeys) {
  const code = String(airport || '').trim().toUpperCase().split('_')[0];
  if (!code) return '';
  const keys = (Array.isArray(cityKeys) ? cityKeys : []).map(resolveCityToken).filter(Boolean);
  return keys.find((k) => CITY_DEFAULT_AIRPORT[k] === code || AIRPORT_CITY_EXTRA[code] === k) || '';
}

/**
 * 2026-11-18: block_mode day-split bookends when the departure airport is known but no exit city
 * was marked. The Wizard sends a picked departure airport as-is and the exit city only when the
 * traveller taps a city chip twice — so Seoul+Busan with ICN out (no chip) split by pick order,
 * ended in Busan, and the 10:00 ICN flight meant leaving the Busan hotel at 02:18 (scenario
 * seoul-busan-zh-5d, every run since at least 2026-09-06). Fill the exit city from the airport and
 * keep day 1 where it already was (first picked city) when no entry city was marked either.
 * Bookends only: requestShaper's arrivalCity/departureCity feed the prepay fingerprint
 * (prepay-coverage.js) and must stay what the traveller sent.
 * @param {string[]} cityKeys — ordered, as picked
 * @param {{arrivalCityKey?: string, departureCityKey?: string}} bookends — explicit Wizard marks
 * @param {string} departureAirport
 * @returns {{arrivalCityKey?: string, departureCityKey?: string}}
 */
export function bookendsWithDepartureAirport(cityKeys, bookends, departureAirport) {
  const cities = Array.isArray(cityKeys) ? cityKeys : [];
  const marked = bookends || {};
  if (marked.departureCityKey || cities.length < 2) return marked;
  const exitCity = cityForAirport(departureAirport, cities);
  // Last city actually visited = last picked one that isn't the marked entry city (the split
  // puts the entry city first). Already served by the departure airport (incl. Seoul↔Incheon
  // sharing ICN) → nothing to fix.
  const entryKey = resolveCityToken(marked.arrivalCityKey);
  const rest = cities.filter((c) => !entryKey || resolveCityToken(c) !== entryKey);
  const lastVisited = rest.length ? rest[rest.length - 1] : cities[cities.length - 1];
  if (!exitCity || cityForAirport(departureAirport, [lastVisited])) return marked;
  return { arrivalCityKey: marked.arrivalCityKey || String(cities[0]), departureCityKey: exitCity };
}
