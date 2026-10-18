/**
 * Food row provenance — runtime city/address consistency (2026-10-10).
 *
 * Some real _food_index.json rows carry a `city` field their own address
 * contradicts (e.g. "Everhalal - Halal Bulgogi near Everland" is city:"busan"
 * but its address is in Yongin, Gyeonggi). Such a row must not count as
 * exact-city evidence for dietary coverage, prompt injection, replacement or
 * DB matching. The index itself is never edited here — this is a read-time
 * predicate only.
 *
 * ⚠️ `true` means "no established contradiction" (compatibility), NOT proof
 * of location, verification or dietary safety. Missing address/city or a city
 * with no alias list stays unknown and is left to the existing trust gates.
 */
import { displayNamesFor, UI_CITY_KEYS } from './cityResolver.js';

/**
 * Does `address` name `cityKey` via any cityResolver alias (ko/en/ja/zh,
 * case-insensitive substring)? A city with no alias list never matches.
 * @param {string} address
 * @param {string} cityKey
 * @returns {boolean}
 */
export function addressNamesCity(address, cityKey) {
  const addr = String(address || '').toLowerCase();
  const aliases = displayNamesFor(cityKey);
  return aliases.some((alias) => addr.includes(String(alias).toLowerCase()));
}

// A Korean 시/도/군/특별시/광역시 token (e.g. "경기도", "용인시", "울산광역시"):
// the address names SOME place even when it is not one of the 10 UI cities.
const ADMIN_REGION_TOKEN = /[가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|도|시|군)(?=\s|$)/;

/**
 * Does `address` positively name a place other than `cityKey`: another UI city
 * alias, or a 시/도/군 region token (Yongin, Ulsan, ...)? A district-only
 * address ("관악구 봉천동") names neither -> false (unknown, not a contradiction).
 * Callers check addressNamesCity(own) first; this only runs when own is absent.
 * @param {string} address
 * @param {string} cityKey
 * @returns {boolean}
 */
export function addressNamesOtherCity(address, cityKey) {
  if (UI_CITY_KEYS.some((k) => k !== cityKey && addressNamesCity(address, k))) return true;
  return ADMIN_REGION_TOKEN.test(String(address || ''));
}

/**
 * false only when the row has a nonempty address AND a city with a known
 * alias list AND the address omits every alias of that city AND positively
 * names another place (other UI city or a 시/도/군 region).
 * @param {object} row foodIndex row
 * @returns {boolean}
 */
export function isRowCityConsistent(row) {
  if (!row || typeof row !== 'object') return true;
  const address = String(row.address || '').trim();
  const city = String(row.city || '').trim().toLowerCase();
  if (!address || !city) return true;
  if (displayNamesFor(city).length === 0) return true;
  return addressNamesCity(address, city) || !addressNamesOtherCity(address, city);
}
