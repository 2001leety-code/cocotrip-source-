import { afterEach, describe, expect, it, vi } from 'vitest';
import nampo from '../../src/data/zone_courses/busan_nampo_packed.json';
import haeundae from '../../src/data/zone_courses/busan_haeundae_standard.json';
import seomyeon from '../../src/data/zone_courses/busan_seomyeon_standard.json';

const sdk = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return { generateContent: sdk.generateContent };
    }
  },
}));

import {
  expandBlocksToItinerary,
  expandBlocksToItineraryMultiCity,
  selectBlocksMultiCity,
  selectBlocksWithGemini,
} from '../../api/_ai_core/blockMode.js';
import { runDuplicateStopGate } from '../../api/_ai_core/finalItineraryGate.js';

function block(id: string, city: string, block_type = 'city_day') {
  return {
    id, city, zone: city, theme: id, intensity: 'standard', block_type,
    duration_min: 480, dietary_options: [], status: 'published',
    stops: [
      { order: 1, category: 'lodging', name: `${city} Hotel`, stay_min: 0, start_time_offset_min: 0 },
      { order: 2, category: 'culture', name: `Spot ${id}`, stay_min: 60, start_time_offset_min: 0 },
    ],
  };
}

function respond(day_selections: unknown[]) {
  sdk.generateContent.mockResolvedValue({
    response: {
      text: () => JSON.stringify({ day_selections }),
      usageMetadata: { cachedContentTokenCount: 7, promptTokenCount: 9, candidatesTokenCount: 2 },
    },
  });
}

function expectSingleGeminiCallAndMetadata(selection: Awaited<ReturnType<typeof selectBlocksWithGemini>>) {
  expect(sdk.generateContent).toHaveBeenCalledTimes(1);
  expect(selection).toMatchObject({ language: 'en', cacheMetadata: { cached: 7, total: 9, output: 2 } });
}

const input = { durationDays: 2, language: 'en', area: 'seoul', startDate: '2026-09-01', dietPrefs: [] };

afterEach(() => sdk.generateContent.mockReset());

describe('block-mode duplicate selection repair', () => {
  it('keeps valid distinct choices unchanged', async () => {
    const blocks = [block('a', 'seoul'), block('b', 'seoul'), block('c', 'seoul')];
    respond([{ day: 1, block_id: 'b', tweak_notes: 'keep b' }, { day: 2, block_id: 'a', tweak_notes: 'keep a' }]);
    const selected = await selectBlocksWithGemini(blocks, input, { apiKey: 'test' });
    expectSingleGeminiCallAndMetadata(selected);
    expect(selected.day_selections).toEqual([
      { day: 1, block_id: 'b', tweak_notes: 'keep b' },
      { day: 2, block_id: 'a', tweak_notes: 'keep a' },
    ]);
  });

  it('repairs repeated Nampo with unused Seomyeon, fixing the real Jagalchi duplicate at the final gate', async () => {
    const blocks = [nampo, haeundae, seomyeon];
    const busanInput = { ...input, durationDays: 3, area: 'busan' };
    const original = { day_selections: [
      { day: 1, block_id: nampo.id },
      { day: 2, block_id: nampo.id },
      { day: 3, block_id: haeundae.id },
    ] };
    const originalItinerary = expandBlocksToItinerary(original, blocks, busanInput);
    const originalGate = runDuplicateStopGate(originalItinerary);
    expect(originalGate.ok).toBe(false);
    expect(originalGate.duplicates).toContainEqual({ name: '자갈치시장', count: 2 });

    respond([
      { day: 1, block_id: nampo.id, tweak_notes: 'keep first' },
      { day: 2, block_id: nampo.id, tweak_notes: 'misleading rationale' },
      { day: 3, block_id: haeundae.id, tweak_notes: 'preserve later choice' },
    ]);
    const selected = await selectBlocksWithGemini(blocks, busanInput, { apiKey: 'test' });
    expectSingleGeminiCallAndMetadata(selected);
    expect(selected.day_selections.map((d) => d.block_id)).toEqual([
      nampo.id, seomyeon.id, haeundae.id,
    ]);
    expect(selected.day_selections[1].tweak_notes).toBe('');
    expect(selected.day_selections[2].tweak_notes).toBe('preserve later choice');
    const itinerary = expandBlocksToItinerary(selected, blocks, busanInput);
    expect(runDuplicateStopGate(itinerary).ok).toBe(true);
  });

  it('repairs repeated round-robin fallback caused by missing or invalid Gemini IDs', async () => {
    const blocks = [block('a', 'seoul'), block('b', 'seoul'), block('c', 'seoul')];
    respond([{ day: 1, block_id: 'missing' }]);
    const selected = await selectBlocksWithGemini(blocks, input, { apiKey: 'test' });
    expect(selected.day_selections.map((d) => d.block_id)).toEqual(['a', 'b']);
    expect(selected.day_selections[1].tweak_notes).toBe('auto-fallback (Gemini omitted day)');
    expectSingleGeminiCallAndMetadata(selected);
  });

  it('reserves later valid choices before repairing an earlier duplicate (A,A,B → A,C,B)', async () => {
    const blocks = [block('a', 'seoul'), block('b', 'seoul'), block('c', 'seoul')];
    respond([{ day: 1, block_id: 'a' }, { day: 2, block_id: 'a' }, { day: 3, block_id: 'b' }]);
    const selected = await selectBlocksWithGemini(blocks, { ...input, durationDays: 3 }, { apiKey: 'test' });
    expect(selected.day_selections.map((d) => d.block_id)).toEqual(['a', 'c', 'b']);
    expectSingleGeminiCallAndMetadata(selected);
  });

  it('replaces only from the expected multi-city pool and preserves distinct choices', async () => {
    const cityBlocksList = [
      { city: 'seoul', blocks: [block('s1', 'seoul'), block('s2', 'seoul'), block('s3', 'seoul')] },
      { city: 'busan', blocks: [block('b1', 'busan'), block('b2', 'busan')] },
    ];
    respond([
      { day: 1, city: 'seoul', block_id: 's1', tweak_notes: 'one' },
      { day: 2, city: 'seoul', block_id: 's1', tweak_notes: 'duplicate' },
      { day: 3, city: 'busan', block_id: 'b1', tweak_notes: 'preserve' },
    ]);
    const selected = await selectBlocksMultiCity(cityBlocksList, { ...input, durationDays: 3 }, { apiKey: 'test' }, ['seoul', 'seoul', 'busan']);
    expectSingleGeminiCallAndMetadata(selected);
    expect(selected.day_selections.map((d) => [d.city, d.block_id])).toEqual([
      ['seoul', 's1'], ['seoul', 's2'], ['busan', 'b1'],
    ]);
    expect(selected.day_selections[1].tweak_notes).toBe('');
    const itinerary = expandBlocksToItineraryMultiCity(selected, cityBlocksList, { ...input, durationDays: 3 });
    expect(runDuplicateStopGate(itinerary).ok).toBe(true);
  });

  it('does not use an activity block when replacing a repeated city-day block', async () => {
    const cityBlocksList = [{ city: 'seoul', blocks: [
      block('trail', 'seoul', 'trekking'), block('a', 'seoul'), block('b', 'seoul'),
    ] }];
    respond([{ day: 1, city: 'seoul', block_id: 'a' }, { day: 2, city: 'seoul', block_id: 'a' }]);
    const selected = await selectBlocksMultiCity(cityBlocksList, input, { apiKey: 'test' }, ['seoul', 'seoul']);
    expectSingleGeminiCallAndMetadata(selected);
    expect(selected.day_selections.map((d) => d.block_id)).toEqual(['a', 'b']);
  });

  it('leaves duplicate selection for the existing terminal gate when no unused block exists', async () => {
    const blocks = [block('a', 'seoul')];
    respond([{ day: 1, block_id: 'a' }, { day: 2, block_id: 'a' }]);
    const selected = await selectBlocksWithGemini(blocks, input, { apiKey: 'test' });
    expectSingleGeminiCallAndMetadata(selected);
    const itinerary = expandBlocksToItinerary(selected, blocks, input);
    expect(runDuplicateStopGate(itinerary).ok).toBe(false);
  });

  it('does not replace repeated activity selections with an activity or general fallback', async () => {
    const blocks = [block('trail', 'seoul', 'trekking'), block('city', 'seoul')];
    respond([{ day: 1, block_id: 'trail' }, { day: 2, block_id: 'trail' }]);
    const selected = await selectBlocksWithGemini(blocks, input, { apiKey: 'test' });
    expectSingleGeminiCallAndMetadata(selected);
    expect(selected.day_selections.map((d) => d.block_id)).toEqual(['trail', 'trail']);
  });
});
