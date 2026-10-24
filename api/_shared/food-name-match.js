/**
 * Select one food-index row by an exact, nonblank canonical name, established
 * English alias, or the DB name's head before the first ',' / '|' (2026-10-24).
 * Step 1 uses stop.name only (also "<name> (<nameEn>)" as listed in the prompt);
 * step 2 (display_name / name_en) runs only when step 1 finds no row.
 * Uniqueness is over ALL city-consistent rows (names + aliases), then trust is checked.
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
  const primary = normalizedName(stop.name || stop.name_ko);
  const names = [primary, normalizedName(stop.display_name || stop.name_en)].filter(Boolean);
  if (names.length === 0) return null;

  // Preserve the area-key normalization already used by dbMatcher/blockMode.
  const cityKey = (value) => normalizeCity(typeof value === 'string' ? value.split('_')[0] : '');
  const stopCity = cityKey(stop.city);
  const expectedCity = cityKey(dayCity);
  // An explicit stop/day contradiction cannot be repaired by matching coordinates.
  if (stopCity && expectedCity && stopCity !== expectedCity) return null;

  const baseAliases = (row) => {
    const canonical = typeof row.name === 'string' ? row.name.split('|')[0] : '';
    // 2026-10-24: DB 이름의 첫 ',' 또는 '|' 앞부분도 별칭 — "무채색, 홍대 연남동 맛집 & 술집" ↔ 모델 출력 "무채색".
    //   DB 쪽만 자르고 모델 출력은 자르지 않는다(부분 문자열 매칭 아님). 별칭 때문에 두 행이 맞으면 아래 유일성
    //   검사가 null 로 돌려준다(예: "무쇠김치삼겹" vs "무쇠김치삼겹, 명동 맛집 & 고기집").
    const head = typeof row.name === 'string' ? row.name.split(/[,|]/)[0] : '';
    return [canonical, row.nameEn, head].map(normalizedName).filter(Boolean);
  };
  // 2026-10-24 (O6-r5): 목록 줄 "• 해포 (Haepo) …" 의 "<이름> (<nameEn>)" 통째 복사도 DB 쪽 별칭으로 인정.
  const nameAliases = (row) => {
    const base = baseAliases(row);
    const en = normalizedName(row.nameEn);
    return en ? [...base, ...base.filter((name) => name !== en).map((name) => `${name} (${en})`)] : base;
  };
  const matching = (targets, aliasesOf) => foodIndex.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    if (!aliasesOf(row).some((name) => targets.includes(name))) return false;
    const rowCity = cityKey(row.city);
    if (rowCity && stopCity && rowCity !== stopCity) return false;
    if (rowCity && expectedCity && rowCity !== expectedCity) return false;
    // With a known city, a row whose address names another city is not that city's row.
    if ((expectedCity || stopCity) && !isRowCityConsistent(row)) return false;
    return true;
  });

  // 2026-10-24 (O6-r5): 식별자 우선 — stop.name 후보가 있으면 그것만으로 판정(display_name 이 다른 행 nameEn 과
  //   겹쳐 모호해지지 않게). name 후보가 0개일 때만 display_name/name_en 까지 기존 방식으로 찾는다.
  const byName = primary ? matching([primary], nameAliases) : [];
  const candidates = byName.length > 0 ? byName : matching(names, baseAliases);

  // Preserve ambiguity, including trusted/unverified pairs and duplicate rows.
  return candidates.length === 1 ? candidates[0] : null;
}
