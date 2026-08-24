// ─────────────────────────────────────────────────────────────────────────────
// planner-trust-course (2026-08-24) — getExactCityTrustedDietaryCandidates
// must AND multi-select dietary restrictions on the SAME row, not OR them.
//
// Bug: `for (const diet of diets) { ...; if (evidence) { out.push(...); break; } }`
// pushes a row the instant ANY one requested diet matches. A Halal+Vegan
// request would then surface a halal-only restaurant (no vegan option at
// all) labeled as satisfying "Halal & Vegan" — a real dietary-safety risk
// for a traveler who needs BOTH honored on the same stop.
//
// Fix: every requested diet must independently resolve trusted evidence on
// the row before it counts as a candidate, and every requested diet's
// evidence/tier is preserved (not collapsed to one).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 2026-08-24 (planner-trust-course #3, row-integrity): every fixture row now
// carries lat/lng inside Korea + a placeId — getExactCity* candidates now
// reject rows missing finite Korea coordinates or any stable place identity
// (real _food_index.json rows always have both; only these test fixtures
// needed updating to stay realistic).
const ROWS = [
  // halal-only, friendly tier (no explicit verification_status -> derived)
  { city: 'gyeongju', name: 'Halal Only House|', nameEn: 'Halal Only House', address: 'Gyeongju-si 1', lat: 35.84, lng: 129.21, placeId: 'p1', dietary_tags: ['halal'], source: 'manual_review' },
  // vegan-only, friendly tier
  { city: 'gyeongju', name: 'Vegan Only Cafe|', nameEn: 'Vegan Only Cafe', address: 'Gyeongju-si 2', lat: 35.84, lng: 129.22, placeId: 'p2', dietary_tags: ['vegan'], source: 'manual_review' },
  // BOTH halal AND vegan on the same row — the only row that should satisfy a Halal+Vegan request
  { city: 'gyeongju', name: 'Dual Diet Table|', nameEn: 'Dual Diet Table', address: 'Gyeongju-si 3', lat: 35.84, lng: 129.23, placeId: 'p3', dietary_tags: ['halal', 'vegan'], source: 'manual_review' },
  // halal certified tier (explicit, manual)
  { city: 'gyeongju', name: 'Certified Halal Grill|', nameEn: 'Certified Halal Grill', address: 'Gyeongju-si 4', lat: 35.84, lng: 129.24, placeId: 'p4', dietary_tags: ['halal'], verification_status: 'halal_certified', source: 'manual_review' },
  // vegetarian-labeled row -> vegetarian requests may be covered by vegan too, tested separately
  { city: 'gyeongju', name: 'Veggie Spot|', nameEn: 'Veggie Spot', address: 'Gyeongju-si 5', lat: 35.84, lng: 129.25, placeId: 'p5', dietary_tags: ['vegan'], source: 'manual_review' },
  // quarantined source -> must stay excluded even though tags match (unverified)
  { city: 'gyeongju', name: 'Naver Guess Halal|', nameEn: 'Naver Guess Halal', address: 'Gyeongju-si 6', lat: 35.84, lng: 129.26, placeId: 'p6', dietary_tags: ['halal', 'vegan'], source: 'naver_local' },
  // different city -> must never leak in as if it were Gyeongju
  { city: 'seoul', name: 'Seoul Dual Diet|', nameEn: 'Seoul Dual Diet', address: 'Seoul 1', lat: 37.55, lng: 126.98, placeId: 'p7', dietary_tags: ['halal', 'vegan'], source: 'manual_review' },
];

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: (path: string, enc?: unknown) => {
      if (String(path).includes('_food_index.json')) return JSON.stringify(ROWS);
      return actual.readFileSync(path, enc as never);
    },
  };
});

async function freshFoodHelper() {
  vi.resetModules();
  return import('../../api/_food_helper.js');
}

describe('getExactCityTrustedDietaryCandidates — AND not OR', () => {
  beforeEach(() => vi.clearAllMocks());

  it('single diet (Halal) matches every halal-tagged exact-city row', async () => {
    const { getExactCityTrustedDietaryCandidates } = await freshFoodHelper();
    const out = getExactCityTrustedDietaryCandidates('gyeongju', ['Halal']);
    const names = out.map((c: any) => c.row.nameEn);
    expect(names).toEqual(expect.arrayContaining(['Halal Only House', 'Dual Diet Table', 'Certified Halal Grill']));
    expect(names).not.toContain('Vegan Only Cafe');
    expect(names).not.toContain('Naver Guess Halal'); // quarantined source stays excluded
    expect(names).not.toContain('Seoul Dual Diet'); // exact-city only
  });

  it('🔴 SAFETY: Halal+Vegan requires BOTH on the SAME row (AND) — halal-only or vegan-only never qualifies', async () => {
    const { getExactCityTrustedDietaryCandidates } = await freshFoodHelper();
    const out = getExactCityTrustedDietaryCandidates('gyeongju', ['Halal', 'Vegan']);
    const names = out.map((c: any) => c.row.nameEn);
    // Old OR bug would have included Halal Only House / Vegan Only Cafe / Certified Halal Grill too.
    expect(names).toEqual(['Dual Diet Table']);
  });

  it('every requested diet keeps its own evidence entry (no tier collapse)', async () => {
    const { getExactCityTrustedDietaryCandidates } = await freshFoodHelper();
    const out = getExactCityTrustedDietaryCandidates('gyeongju', ['Halal', 'Vegan']);
    expect(out).toHaveLength(1);
    const evidence = out[0].evidence;
    expect(evidence).toHaveLength(2);
    expect(evidence.map((e: any) => e.diet).sort()).toEqual(['halal', 'vegan']);
  });

  it('Vegetarian request is covered by a vegan-tagged row (vegetarian never covers halal-only)', async () => {
    const { getExactCityTrustedDietaryCandidates } = await freshFoodHelper();
    const out = getExactCityTrustedDietaryCandidates('gyeongju', ['Vegetarian']);
    const names = out.map((c: any) => c.row.nameEn);
    expect(names).toEqual(expect.arrayContaining(['Vegan Only Cafe', 'Dual Diet Table', 'Veggie Spot']));
    expect(names).not.toContain('Halal Only House');
  });

  it('halal_certified never mislabels a muslim_friendly-only row, and vice versa', async () => {
    const { getExactCityTrustedFoodContext } = await freshFoodHelper();
    const { contextString } = getExactCityTrustedFoodContext({ cityKey: 'gyeongju', dietaryList: ['Halal'], language: 'en' });
    // Certified Halal Grill -> CERTIFIED tier line present
    expect(contextString).toMatch(/Certified Halal Grill[\s\S]*?CERTIFIED/);
    // Halal Only House (derived, no explicit certified status) -> FRIENDLY, never CERTIFIED
    const friendlyBlockMatch = contextString.match(/Halal Only House[\s\S]*?(?=\n\n {2}•|---$)/);
    expect(friendlyBlockMatch).toBeTruthy();
    expect(friendlyBlockMatch![0]).toMatch(/FRIENDLY \(not certified\)/);
    expect(friendlyBlockMatch![0]).not.toMatch(/CERTIFIED\]/);
  });

  it('no exact-city trusted candidate -> empty (caller fails closed, no cross-city substitution)', async () => {
    const { getExactCityTrustedDietaryCandidates } = await freshFoodHelper();
    expect(getExactCityTrustedDietaryCandidates('busan', ['Halal', 'Vegan'])).toEqual([]);
  });
});
