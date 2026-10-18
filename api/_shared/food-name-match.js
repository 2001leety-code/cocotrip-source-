/**
 * Select one food-index row by an exact, nonblank canonical name or established
 * English alias. Trust is deliberately checked only after identity is unique.
 * No fuzzy/brand matching, row deduplication, or coordinate-based rescue.
 */
import { isRowCityConsistent } from './food-row-provenance.js';

function normalizedName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function findSelectedFoodRow(stop, foodIndex, {
  dayCity = '',
  normalizeCity = normalizedName,
} = {}) {
  if (!stop || !Array.isArray(foodIndex)) return null;
  const names = [stop.name || stop.name_ko, stop.display_name || stop.name_en]
    .map(normalizedName).filter(Boolean);
  if (names.length === 0) return null;

  // Preserve the area-key normalization already used by dbMatcher/blockMode.
  const cityKey = (value) => normalizeCity(typeof value === 'string' ? value.split('_')[0] : '');
  const stopCity = cityKey(stop.city);
  const expectedCity = cityKey(dayCity);
  // An explicit stop/day contradiction cannot be repaired by matching coordinates.
  if (stopCity && expectedCity && stopCity !== expectedCity) return null;

  const candidates = foodIndex.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const canonical = typeof row.name === 'string' ? row.name.split('|')[0] : '';
    const rowNames = [canonical, row.nameEn].map(normalizedName).filter(Boolean);
    if (!rowNames.some((name) => names.includes(name))) return false;
    const rowCity = cityKey(row.city);
    if (rowCity && stopCity && rowCity !== stopCity) return false;
    if (rowCity && expectedCity && rowCity !== expectedCity) return false;
    // With a known city, a row whose address names another city is not that city's row.
    if ((expectedCity || stopCity) && !isRowCityConsistent(row)) return false;
    return true;
  });

  // Preserve ambiguity, including trusted/unverified pairs and duplicate rows.
  return candidates.length === 1 ? candidates[0] : null;
}
