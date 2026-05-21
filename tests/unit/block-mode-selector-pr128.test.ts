/**
 * PR #P128 (2026-05-21) — block-mode selector unit tests.
 *
 * Source: api/_ai_core/blockMode.js
 *
 * Validates:
 *   1. getBlockModeEnv parsing — disabled / enabled / auto
 *   2. shouldUseBlockMode — env=disabled forces ineligible
 *   3. shouldUseBlockMode — insufficient blocks (< 3) → ineligible
 *   4. shouldUseBlockMode — env=enabled forces eligible (if 3+ blocks)
 *   5. fetchAvailableBlocks — filters by city + status='published'
 *   6. fetchAvailableBlocks — dietary filter (halal/vegan)
 *   7. matchFoodPlaceholder — city filter + dietary tag filter
 *   8. matchFoodPlaceholder — dietary required but no match → null (caller throws)
 *   9. expandBlocksToItinerary — stops + start_time + day.date computation
 *  10. expandBlocksToItinerary — SAFETY-CRITICAL throw for unmet dietary
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getBlockModeEnv,
  shouldUseBlockMode,
  fetchAvailableBlocks,
  matchFoodPlaceholder,
  expandBlocksToItinerary,
} from '../../api/_ai_core/blockMode.js';

// fixture: minimal valid block
function makeBlock(id: string, city: string, opts: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    city,
    zone: opts.zone || 'Test',
    theme: opts.theme || 'Test theme',
    intensity: opts.intensity || 'standard',
    block_type: opts.block_type || 'city_day',
    duration_min: 480,
    stops: opts.stops || [
      {
        order: 1,
        category: 'lodging',
        name: 'Hotel',
        name_i18n: { ko: '호텔', en: 'Hotel', ja: 'Hotel', zh: 'Hotel' },
        address: 'Seoul',
        stay_min: 0,
        entry_fee_krw: 0,
        reservation_required: false,
        start_time_offset_min: 0,
      },
      {
        order: 2,
        category: 'culture',
        name: 'Palace',
        name_i18n: { ko: '경복궁', en: 'Palace', ja: 'Palace', zh: 'Palace' },
        address: 'Seoul',
        stay_min: 90,
        entry_fee_krw: 3000,
        reservation_required: false,
        start_time_offset_min: 0,
      },
      {
        order: 3,
        category: 'food',
        name: '',
        name_i18n: { ko: '', en: '', ja: '', zh: '' },
        address: 'Seoul',
        stay_min: 60,
        entry_fee_krw: 0,
        reservation_required: false,
        placeholder: 'verified_lunch',
        preferred_dietary: [],
        start_time_offset_min: 90,
      },
    ],
    dietary_options: opts.dietary_options || [],
    status: opts.status || 'published',
    best_for: opts.best_for || [],
    unsuitable_for: opts.unsuitable_for || [],
    passport_required: false,
    requires_advance_booking: false,
    transit_matrix: {},
    source: 'cocotrip_curated',
    verified_at: '2026-05-21',
    verified_by: 'test',
    last_review_date: '2026-05-21',
    theme_i18n: { ko: 'Test', en: 'Test', ja: 'Test', zh: 'Test' },
    ...opts,
  };
}

describe('getBlockModeEnv', () => {
  const originalEnv = process.env.PLANNER_BLOCK_MODE;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PLANNER_BLOCK_MODE;
    else process.env.PLANNER_BLOCK_MODE = originalEnv;
  });

  it('returns "auto" when unset', () => {
    delete process.env.PLANNER_BLOCK_MODE;
    expect(getBlockModeEnv()).toBe('auto');
  });

  it('parses "enabled" / "disabled" / case-insensitive + strips CRLF (P102 pattern)', () => {
    process.env.PLANNER_BLOCK_MODE = 'enabled';
    expect(getBlockModeEnv()).toBe('enabled');
    process.env.PLANNER_BLOCK_MODE = 'DISABLED';
    expect(getBlockModeEnv()).toBe('disabled');
    process.env.PLANNER_BLOCK_MODE = ' enabled\r\n';
    expect(getBlockModeEnv()).toBe('enabled');
    process.env.PLANNER_BLOCK_MODE = 'invalid';
    expect(getBlockModeEnv()).toBe('auto');
  });
});

describe('shouldUseBlockMode', () => {
  const original = process.env.PLANNER_BLOCK_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.PLANNER_BLOCK_MODE;
    else process.env.PLANNER_BLOCK_MODE = original;
  });

  it('env=disabled → ineligible regardless of block count', () => {
    process.env.PLANNER_BLOCK_MODE = 'disabled';
    const blocks = [makeBlock('A', 'seoul'), makeBlock('B', 'seoul'), makeBlock('C', 'seoul')];
    const r = shouldUseBlockMode('seoul', 3, [], blocks);
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('env_disabled');
  });

  it('< 3 blocks → ineligible (auto)', () => {
    delete process.env.PLANNER_BLOCK_MODE;
    const r = shouldUseBlockMode('seoul', 3, [], [makeBlock('A', 'seoul'), makeBlock('B', 'seoul')]);
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/insufficient_blocks/);
  });

  it('env=enabled + 3 blocks → eligible', () => {
    process.env.PLANNER_BLOCK_MODE = 'enabled';
    const blocks = [makeBlock('A', 'seoul'), makeBlock('B', 'seoul'), makeBlock('C', 'seoul')];
    const r = shouldUseBlockMode('seoul', 3, [], blocks);
    expect(r.eligible).toBe(true);
    expect(r.reason).toBe('env_enabled');
  });

  it('auto + 3+ blocks → eligible', () => {
    delete process.env.PLANNER_BLOCK_MODE;
    const blocks = [makeBlock('A', 'seoul'), makeBlock('B', 'seoul'), makeBlock('C', 'seoul'), makeBlock('D', 'seoul')];
    const r = shouldUseBlockMode('seoul', 5, [], blocks);
    expect(r.eligible).toBe(true);
    expect(r.reason).toBe('auto_eligible');
  });
});

describe('fetchAvailableBlocks', () => {
  function makeMockDb(docs: Array<{ id: string; data: Record<string, unknown> }>) {
    return {
      collection() {
        return {
          where() { return this; },
          get: async () => ({
            empty: docs.length === 0,
            forEach: (cb: (d: { id: string; data: () => Record<string, unknown> }) => void) => {
              for (const d of docs) cb({ id: d.id, data: () => d.data });
            },
          }),
        };
      },
    };
  }

  it('returns city_day blocks only (filters out trekking)', async () => {
    const db = makeMockDb([
      { id: 'A', data: makeBlock('A', 'seoul', { block_type: 'city_day' }) },
      { id: 'B', data: makeBlock('B', 'seoul', { block_type: 'trekking' }) },
    ]);
    const blocks = await fetchAvailableBlocks(db, 'seoul');
    expect(blocks.map((b) => b.id)).toEqual(['A']);
  });

  it('dietary filter — only halal blocks for halal user', async () => {
    const db = makeMockDb([
      { id: 'A', data: makeBlock('A', 'seoul', { dietary_options: ['halal'] }) },
      { id: 'B', data: makeBlock('B', 'seoul', { dietary_options: [] }) },
    ]);
    const blocks = await fetchAvailableBlocks(db, 'seoul', { dietaryRequired: ['halal'] });
    expect(blocks.map((b) => b.id)).toEqual(['A']);
  });

  it('handles Firestore exception gracefully', async () => {
    const errDb = {
      collection() {
        return {
          where() { return this; },
          get: async () => { throw new Error('index missing'); },
        };
      },
    };
    const blocks = await fetchAvailableBlocks(errDb, 'seoul');
    expect(blocks).toEqual([]);
  });
});

describe('matchFoodPlaceholder', () => {
  const foodIndex = [
    { name: '비건집', display_name: 'Vegan House', city: 'seoul', address: 'Seoul', type: 'restaurant', dietary_tags: ['vegan'], rating: 4.6, reviews: 200 },
    { name: '할랄집', display_name: 'Halal House', city: 'seoul', address: 'Seoul', type: 'restaurant', dietary_tags: ['halal'], rating: 4.5, reviews: 100 },
    { name: '일반집', display_name: 'Regular House', city: 'seoul', address: 'Seoul', type: 'restaurant', dietary_tags: [], rating: 4.7, reviews: 300 },
    { name: '부산집', display_name: 'Busan House', city: 'busan', address: 'Busan', type: 'restaurant', dietary_tags: [], rating: 4.8, reviews: 400 },
  ];

  it('returns highest-rated city-matched restaurant when no dietary restriction', () => {
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch' }, foodIndex, 'seoul', []);
    expect(r).toBeTruthy();
    expect(r.name).toBe('일반집'); // highest rating × log(reviews)
  });

  it('filters by dietary tag (vegan)', () => {
    const r = matchFoodPlaceholder({ placeholder: 'verified_lunch' }, foodIndex, 'seoul', ['vegan']);
    expect(r?.name).toBe('비건집');
  });

  it('returns null when dietary required but no match', () => {
    const r = matchFoodPlaceholder(
      { placeholder: 'verified_lunch' },
      [{ name: 'X', city: 'seoul', type: 'restaurant', dietary_tags: [] }],
      'seoul',
      ['vegan'],
    );
    expect(r).toBeNull();
  });
});

describe('expandBlocksToItinerary', () => {
  it('builds days[] with start_time computed from block offsets', () => {
    const block = makeBlock('A', 'seoul');
    const sel = { day_selections: [{ day: 1, block_id: 'A', tweak_notes: 'test' }] };
    const out = expandBlocksToItinerary(sel, [block], { durationDays: 1, language: 'en', area: 'seoul', startDate: '2026-06-01' });
    expect(out.days).toHaveLength(1);
    expect(out.days[0].day).toBe(1);
    expect(out.days[0].date).toBe('2026-06-01');
    expect(out.days[0].stops[0].start_time).toBe('09:00');
    expect(out.days[0].stops[1].start_time).toBe('09:00'); // offset_min=0
    expect(out.days[0].stops[2].start_time).toBe('10:30'); // offset_min=90
    expect(out.days[0].source_block_id).toBe('A');
  });

  it('throws BLOCK_MODE_DIETARY_UNSATISFIED when food placeholder cannot match vegan', () => {
    const block = makeBlock('A', 'seoul');
    const sel = { day_selections: [{ day: 1, block_id: 'A' }] };
    expect(() => expandBlocksToItinerary(sel, [block], {
      durationDays: 1,
      dietPrefs: ['vegan'],
      foodIndex: [
        { name: '일반집', city: 'seoul', type: 'restaurant', dietary_tags: [], rating: 4, reviews: 100 },
      ],
      area: 'seoul',
      language: 'en',
    })).toThrowError(/dietary/i);
  });
});
