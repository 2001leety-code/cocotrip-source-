/**
 * Catalogue provenance normalization (2026-10-10, Task A).
 *
 * A food-index row whose address contradicts its own `city` field (real case:
 * "Everhalal - Halal Bulgogi near Everland", city:"busan", address in Yongin)
 * must not count as exact-city evidence for dietary coverage, prompt
 * injection or deterministic replacement. Missing data stays unknown:
 * isRowCityConsistent() === true means "no established contradiction", never
 * "verified" or "dietary-safe". The index JSON itself is never edited.
 *
 * Also locks two fail-safe fixes in the dietary trust SSOT:
 *   - isDietaryTrusted reads tags via dietaryTagsOfRow (tag + dietary_tags)
 *   - deriveVerificationStatus: explicit source outside the allowlist -> unverified,
 *     absent source keeps the legacy Google-base friendly tier.
 */
import { describe, it, expect, vi } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRowCityConsistent } from '../../api/_shared/food-row-provenance.js';
import {
  deriveVerificationStatus, isDietaryTrusted, checkDietaryCoverage, DIETARY_TAGS,
} from '../../api/_shared/dietary-trust.js';
import { replaceViolatingFoodStops } from '../../api/_ai_core/dietaryStopReplacer.js';

type FoodRow = Record<string, unknown> & { name?: string; nameEn?: string; city?: string; address?: string; tag?: string };

// getFoodContext lazy-loads _food_index.json via fs.readFileSync — swap in a
// fixture only while MOCK_ROWS is set; real-index reads go to the actual fs.
let MOCK_ROWS: FoodRow[] | null = null;
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: (path: string, enc?: unknown) => {
      if (MOCK_ROWS && String(path).includes('_food_index.json')) return JSON.stringify(MOCK_ROWS);
      return actual.readFileSync(path, enc as never);
    },
  };
});

async function loadFoodContext(rows: FoodRow[]) {
  MOCK_ROWS = rows;
  vi.resetModules();
  const mod = await import('../../api/_food_helper.js');
  return mod.getFoodContext;
}

const YONGIN_ADDR = '경기도 용인시 처인구 포곡읍 마성리 23-3번지';

const mk = (over: Record<string, unknown> = {}): FoodRow => ({
  name: '테스트식당', nameEn: 'Test Place', city: 'busan', tag: 'halal', lat: 35.16, lng: 129.16,
  rating: 4.7, reviewCount: 100, placeId: 'x', ...over,
});

describe('isRowCityConsistent — contract', () => {
  it('missing address / city / non-object stays unknown (true, not a verification claim)', () => {
    expect(isRowCityConsistent({ city: 'busan' })).toBe(true);
    expect(isRowCityConsistent({ city: 'busan', address: '   ' })).toBe(true);
    expect(isRowCityConsistent({ address: YONGIN_ADDR })).toBe(true);
    expect(isRowCityConsistent(null)).toBe(true);
    expect(isRowCityConsistent(undefined)).toBe(true);
  });

  it('city with no alias list in cityResolver stays unknown (true)', () => {
    expect(isRowCityConsistent({ city: 'yongin', address: YONGIN_ADDR })).toBe(true);
    expect(isRowCityConsistent({ city: 'atlantis', address: 'Seoul 1' })).toBe(true);
  });

  it('Busan-tagged row with a Yongin address is inconsistent (false)', () => {
    expect(isRowCityConsistent({ city: 'busan', address: YONGIN_ADDR })).toBe(false);
  });

  it('city field case/spacing is normalized like cityResolver keys', () => {
    expect(isRowCityConsistent({ city: ' Busan ', address: YONGIN_ADDR })).toBe(false);
    expect(isRowCityConsistent({ city: 'BUSAN', address: '부산광역시 해운대구 우동 1' })).toBe(true);
  });

  it('any ko/en/ja alias in the address counts, case-insensitive', () => {
    expect(isRowCityConsistent({ city: 'busan', address: '부산광역시 해운대구 우동 1' })).toBe(true);
    expect(isRowCityConsistent({ city: 'busan', address: '12 Haeundae-gu, BUSAN' })).toBe(true);
    expect(isRowCityConsistent({ city: 'busan', address: '釜山広域市 海雲台区' })).toBe(true);
    expect(isRowCityConsistent({ city: 'seoul', address: '서울특별시 종로구 1' })).toBe(true);
    expect(isRowCityConsistent({ city: 'seoul', address: '경기도 수원시 팔달구 1' })).toBe(false);
  });
});

describe('isRowCityConsistent — address that names no city is unknown, not a contradiction', () => {
  it('district-only address (no city/province token) keeps the row', () => {
    expect(isRowCityConsistent({ city: 'seoul', address: '3F 관악구 봉천동 관악로14길 11 3층' })).toBe(true);
  });

  it('address naming a different known city excludes', () => {
    expect(isRowCityConsistent({ city: 'busan', address: '서울특별시 종로구 대명길 34 2층' })).toBe(false);
    expect(isRowCityConsistent({ city: 'seoul', address: '12 Gangneung-daero, Gangneung' })).toBe(false);
  });

  it('address naming its own city keeps', () => {
    expect(isRowCityConsistent({ city: 'seoul', address: '서울특별시 관악구 봉천동 1' })).toBe(true);
  });

  it('address naming own + another city keeps (own city present = no established contradiction)', () => {
    expect(isRowCityConsistent({ city: 'busan', address: '부산광역시 중구 서울식당 1' })).toBe(true);
  });
});

describe('deriveVerificationStatus — explicit unknown source fails safe', () => {
  it('absent / empty source keeps the legacy Google-base friendly tier', () => {
    expect(deriveVerificationStatus(mk({}))).toBe('muslim_friendly');
    expect(deriveVerificationStatus(mk({ tag: 'vegan' }))).toBe('vegan_options');
    expect(deriveVerificationStatus(mk({ source: '' }))).toBe('muslim_friendly');
    expect(deriveVerificationStatus(mk({ source: null }))).toBe('muslim_friendly');
  });

  it('explicit source outside the allowlist -> unverified (never a friendly/certified tier)', () => {
    expect(deriveVerificationStatus(mk({ source: 'trend_harness_promoted' }))).toBe('unverified');
    expect(deriveVerificationStatus(mk({ source: 'future_collector', tag: 'vegan' }))).toBe('unverified');
    expect(isDietaryTrusted(mk({ source: 'future_collector' }))).toBe(false);
  });

  it('operator manual promotion is still preserved regardless of source', () => {
    expect(deriveVerificationStatus(mk({ source: 'future_collector', verification_status: 'halal_certified' }))).toBe('halal_certified');
  });

  it('non-dietary rows still need no tier', () => {
    expect(deriveVerificationStatus(mk({ tag: 'general', source: 'future_collector' }))).toBeNull();
  });
});

describe('isDietaryTrusted — reads tags via dietaryTagsOfRow', () => {
  it('dietary_tags-only quarantined row is NOT trusted (was trusted when only r.tag was read)', () => {
    expect(isDietaryTrusted({ name: 'n', dietary_tags: ['halal'], source: 'naver_local' })).toBe(false);
    expect(isDietaryTrusted({ name: 'n', tag: 'general', dietary_tags: ['Vegan'], source: 'naver_local' })).toBe(false);
  });

  it('dietary_tags-only legacy (no source) row keeps the friendly tier', () => {
    expect(isDietaryTrusted({ name: 'n', dietary_tags: ['Vegan'] })).toBe(true);
  });

  it('explicit verification_status still decides when present', () => {
    expect(isDietaryTrusted({ name: 'n', dietary_tags: ['halal'], verification_status: 'unverified' })).toBe(false);
    expect(isDietaryTrusted({ name: 'n', tag: 'halal', verification_status: 'halal_certified', source: 'naver_local' })).toBe(true);
  });

  it('non-dietary rows stay trusted (no dietary claim)', () => {
    expect(isDietaryTrusted({ name: 'n', tag: 'general', source: 'naver_local' })).toBe(true);
    expect(isDietaryTrusted({ name: 'n' })).toBe(true);
  });
});

describe('checkDietaryCoverage — inconsistent row is not exact-city evidence', () => {
  it('Busan halal coverage from a Yongin-address row alone = missing (no relaxation)', () => {
    const cov = checkDietaryCoverage([mk({ address: YONGIN_ADDR })], ['busan'], ['Halal']);
    expect(cov.ok).toBe(false);
    expect(cov.missing).toEqual([{ city: 'busan', diet: 'halal' }]);
  });

  it('a consistent Busan-address row restores coverage', () => {
    const idx = [mk({ address: YONGIN_ADDR }), mk({ name: '부산할랄', address: '부산광역시 금정구 1' })];
    expect(checkDietaryCoverage(idx, ['busan'], ['Halal']).ok).toBe(true);
  });

  it('legacy fixture without address keeps its current behavior', () => {
    expect(checkDietaryCoverage([mk({})], ['busan'], ['Halal']).ok).toBe(true);
  });
});

describe('replaceViolatingFoodStops — inconsistent row is never a replacement', () => {
  const plan = () => ({
    days: [{ day: 1, stops: [{ name: '위반식당', display_name: 'Bad Place', category: 'food', lat: 37.276, lng: 127.19, tip: 'x' }] }],
  });
  const violation = [{ type: 'dietary_violation', severity: 'critical', stop: '위반식당', diet: 'halal', category: 'food' }];

  it('Yongin-address Busan row within 8km is rejected -> failed, stop untouched', () => {
    const it0 = plan();
    const idx = [mk({ name: '에버할랄', address: YONGIN_ADDR, lat: 37.2763, lng: 127.1946 })];
    const r = replaceViolatingFoodStops(it0, violation, idx, ['Halal'], 'busan');
    expect(r.replaced).toBe(0);
    expect(r.failed).toBe(1);
    expect(it0.days[0].stops[0].name).toBe('위반식당');
  });

  it('same row without address (unknown) is still eligible — legacy behavior', () => {
    const it0 = plan();
    const idx = [mk({ name: '에버할랄', lat: 37.2763, lng: 127.1946 })];
    const r = replaceViolatingFoodStops(it0, violation, idx, ['Halal'], 'busan');
    expect(r.replaced).toBe(1);
  });
});

describe('getFoodContext — exact-city provenance + no all-city relaxation for safety diets', () => {
  const rows: FoodRow[] = [
    mk({ name: '에버할랄', nameEn: 'Yongin Halal', address: YONGIN_ADDR }),
    mk({ name: '부산할랄', nameEn: 'Busan Halal', address: '부산광역시 금정구 1' }),
    mk({ name: '서울할랄', nameEn: 'Seoul Halal', city: 'seoul', address: '서울특별시 용산구 1', lat: 37.53, lng: 126.99 }),
    mk({ name: '서울일반', nameEn: 'Seoul General', city: 'seoul', tag: 'general', address: '서울특별시 중구 1', lat: 37.56, lng: 126.98 }),
    mk({ name: '부산일반', nameEn: 'Busan General', tag: 'general', address: '부산광역시 중구 1' }),
    mk({ name: '부산비건', nameEn: 'Busan Vegan', tag: 'vegan', address: '부산광역시 수영구 1' }),
  ];

  it('Halal in Busan: only the consistent Busan row; no Yongin row, no Seoul row', async () => {
    const getFoodContext = await loadFoodContext(rows);
    const ctx = getFoodContext('busan', ['Halal'], 'Any', 10);
    expect(ctx).toContain('Busan Halal');
    expect(ctx).not.toContain('Yongin Halal');
    expect(ctx).not.toContain('Seoul Halal');
    expect(ctx).not.toContain('General');
  });

  it('Vegetarian request also skips all-city relaxation', async () => {
    const getFoodContext = await loadFoodContext(rows);
    const ctx = getFoodContext('busan', ['Vegetarian'], 'Any', 10);
    expect(ctx).not.toContain('Seoul');
    expect(ctx).not.toContain('Yongin Halal');
    // acceptTagsForDiet('vegetarian') = vegetarian/vegan — a vegan row covers it,
    // a general row must never sit under the "Recommended Vegetarian" heading.
    expect(ctx).toContain('Busan Vegan');
    expect(ctx).not.toContain('General');
    expect(ctx).not.toContain('Busan Halal');
  });

  it('non-safety request keeps the existing all-city relaxation', async () => {
    const getFoodContext = await loadFoodContext(rows);
    const ctx = getFoodContext('busan', [], 'Any', 10);
    expect(ctx).toContain('Seoul General');
  });
});

describe('real index — measured drop of trusted dietary rows (no data edits)', () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));

  async function realIndex(): Promise<FoodRow[]> {
    MOCK_ROWS = null;
    const fs = await vi.importActual<typeof import('fs')>('fs');
    return JSON.parse(fs.readFileSync(join(__dirname, '../../api/_food_index.json'), 'utf-8')) as FoodRow[];
  }

  it('names every trusted dietary row the predicate drops, per city; Everhalal (busan) is among them', async () => {
    const index = await realIndex();
    const dropped: Record<string, string[]> = {};
    for (const r of index) {
      if (!DIETARY_TAGS.includes(String(r.tag || '').toLowerCase())) continue;
      if (!isDietaryTrusted(r) || isRowCityConsistent(r)) continue;
      const city = String(r.city || '');
      (dropped[city] = dropped[city] || []).push(`${r.nameEn || r.name} [${r.tag}] @ ${r.address}`);
    }
    // Measurement evidence for the deferred batch — counts are NOT asserted exactly.
    console.info('[food-row-provenance] trusted dietary rows dropped per city:', JSON.stringify(
      Object.fromEntries(Object.entries(dropped).map(([c, names]) => [c, { count: names.length, names }])), null, 2));
    // 2026-10-10 city-key remap: Everhalal is now city=yongin, so no busan row is dropped; the predicate must still drop it when labelled busan.
    expect((dropped.busan || []).some((n) => /Everhalal/i.test(n))).toBe(false);
    const ever = index.find((r) => /Everhalal/i.test(String(r.nameEn || r.name)));
    expect(ever).toBeTruthy();
    expect(isRowCityConsistent({ ...ever!, city: 'busan' })).toBe(false);
  });

  it('Seoul and Busan halal/vegan coverage survives the predicate', async () => {
    const index = await realIndex();
    for (const city of ['seoul', 'busan']) {
      for (const diet of ['halal', 'vegan']) {
        expect(checkDietaryCoverage(index, [city], [diet]).ok, `${city}:${diet} coverage lost`).toBe(true);
      }
    }
  });

  it('no real row with an explicit non-quarantine, non-allowlisted source gains trust by derivation', async () => {
    const index = await realIndex();
    const leaked = index.filter((r) =>
      DIETARY_TAGS.includes(String(r.tag || '').toLowerCase())
      && !r.verification_status
      && r.source && !['naver_local', 'ai_curated_2026_05_21'].includes(String(r.source))
      && isDietaryTrusted(r));
    expect(leaked.map((r) => r.nameEn || r.name)).toEqual([]);
  });
});
