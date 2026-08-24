/**
 * Reproduces two real, known-wrong rows in api/_food_index.json against
 * isValidExactCityFoodRow (2026-08-24, planner-trust-course #3) — uses the
 * ACTUAL production index (not a mock), so this locks the real fix rather
 * than a synthetic fixture. Per CLAUDE.md, the huge source JSON itself is
 * never edited here — only the row-integrity gate that filters it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isValidExactCityFoodRow, getExactCityGeneralFoodCandidates } from '../../api/_food_helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const foodIndex = JSON.parse(readFileSync(join(__dirname, '../../api/_food_index.json'), 'utf-8'));

describe('food-helper row integrity — real known-wrong rows (#3)', () => {
  it('a Busan-tagged row whose real address is in Gyeonggi (Everhalal near Everland) is excluded', () => {
    const row = foodIndex.find((r: any) => /Everhalal/i.test(r.nameEn || r.name || '') && r.city === 'busan');
    expect(row, 'fixture row must exist in the real index').toBeTruthy();
    expect(row.address).not.toMatch(/부산|busan/i);
    expect(isValidExactCityFoodRow(row, 'busan')).toBe(false);
  });

  it('every real Busan-city row that survives the gate actually has a Busan address', () => {
    const busanRows = foodIndex.filter((r: any) => r.city === 'busan');
    const valid = busanRows.filter((r: any) => isValidExactCityFoodRow(r, 'busan'));
    const mismatched = valid.filter((r: any) => !/부산|busan/i.test(r.address || ''));
    expect(mismatched).toEqual([]);
  });

  it('Incheon retail/mart rows (화수할인마트, 뉴월드마트) are excluded from exact-city candidates', () => {
    const marts = foodIndex.filter((r: any) => r.city === 'incheon' && /마트|슈퍼/.test(r.name || ''));
    expect(marts.length, 'fixture rows must exist in the real index').toBeGreaterThan(0);
    for (const row of marts) {
      expect(isValidExactCityFoodRow(row, 'incheon')).toBe(false);
    }
    const candidates = getExactCityGeneralFoodCandidates('incheon', 50);
    const candidateNames = candidates.map((r: any) => r.nameEn || r.name);
    for (const row of marts) {
      expect(candidateNames).not.toContain(row.nameEn || row.name);
    }
  });
});
