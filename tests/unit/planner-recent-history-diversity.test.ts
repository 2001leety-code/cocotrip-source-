import { afterEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent: sdk.generateContent }; } },
}));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordGeminiUsage: vi.fn() }));

import { buildAvoidContext } from '../../api/_ai_core/avoidListQuery.js';
import { calcDiversity } from '../../scripts/validate-planner.cjs';
import { tryRunBlockMode } from '../../api/_ai_core/blockMode.js';

const blocks = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ({
  id: `SYN_${id}`, city: 'seoul', zone: 'seoul', theme: `synthetic ${id}`,
  block_type: 'city_day', status: 'published', duration_min: 480, dietary_options: [],
  stops: [
    { order: 1, category: 'culture', name: `Spot ${id}`, address: 'Seoul Jongno', lat: 37.57, lng: 126.99, stay_min: 45 },
    { order: 2, category: 'food', placeholder: 'verified_lunch', name: '', address: 'Seoul Jongno', lat: 37.57, lng: 126.99, stay_min: 60 },
    { order: 3, category: 'culture', name: `Gallery ${id}`, address: 'Seoul Jongno', lat: 37.57, lng: 126.99, stay_min: 45 },
  ],
}));
const foodIndex = Array.from({ length: 6 }, (_, i) => ({
  name: `Synthetic Restaurant ${i + 1}`, city: 'seoul', type: 'restaurant',
  rating: 5 - i * 0.1, reviewCount: 1000 - i * 100, address: `Seoul Jongno ${i + 1}`,
  lat: 37.57, lng: 126.99, dietary_tags: [],
}));
const savedPlans: Array<Record<string, unknown>> = [];
const fakeDb = {
  collection(name: string) {
    const filters: Array<[string, unknown]> = [];
    const query = {
      orderBy: () => query,
      limit: () => query,
      where: (field: string, _op: string, value: unknown) => { filters.push([field, value]); return query; },
      get: async () => {
        if (name === 'plans') {
          const rows = savedPlans.filter((p) => filters.every(([key, value]) => key === 'uid' ? p.uid === value : key === 'email' ? p.email === value : true));
          return { size: rows.length, forEach: (cb: (doc: { data: () => unknown }) => void) => rows.forEach((p) => cb({ data: () => p })) };
        }
        const city = filters.find(([key]) => key === 'city')?.[1];
        const rows = blocks.filter((b) => b.city === city && filters.some(([key, value]) => key === 'status' && value === b.status));
        return { empty: rows.length === 0, forEach: (cb: (doc: { id: string; data: () => unknown }) => void) => rows.forEach((b) => cb({ id: b.id, data: () => b })) };
      },
    };
    return query;
  },
};

const input = { durationDays: 2, language: 'en', area: 'seoul', foodIndex, dietPrefs: ['Meat'], tour_start_time: '09:00' };
const identity = { uid: 'synthetic-user', requestEmail: undefined };
const selections = (ids: string[]) => ({ day_selections: ids.map((id, i) => ({ day: i + 1, block_id: id })) });
const itineraryStops = (result: { itinerary: { days?: Array<{ stops?: Array<{ name?: string }> }> } }) =>
  (result.itinerary.days || []).flatMap((d) => d.stops || []).map((s) => s.name || '');
const compare = (a: string[], b: string[]) => calcDiversity([
  { scenario: { id: 'seoul-meat-rep1' }, stops: a.map((name) => ({ name })) },
  { scenario: { id: 'seoul-meat-rep2' }, stops: b.map((name) => ({ name })) },
]);

async function generate(ids: string[], history: { foodNames: string[]; blockIds: string[] }) {
  sdk.generateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify(selections(ids)) } });
  return tryRunBlockMode({
    adminDb: fakeDb, regions: ['seoul'], area: 'seoul', apiKey: 'synthetic-only', foodIndex,
    userInput: { ...input, recentFoodNames: history.foodNames, recentBlockIds: history.blockIds },
  });
}

afterEach(() => { sdk.generateContent.mockReset(); vi.unstubAllEnvs(); });
describe('recent plan history reaches actual block selector and food expansion', () => {
  it.each([
    [['SYN_A', 'SYN_B'], ['SYN_C', 'SYN_D']],
    [['SYN_A', 'SYN_C'], ['SYN_E', 'SYN_F']],
    [['SYN_B', 'SYN_E'], ['SYN_D', 'SYN_F']],
  ])('two-day pair %j → %j: baseline restaurant overlap 33.33%, history-connected 0%', async (left, right) => {
    vi.stubEnv('PLANNER_BLOCK_MODE', 'enabled');
    savedPlans.splice(0);
    const emptyHistory = await buildAvoidContext(fakeDb, identity);
    expect(emptyHistory).toEqual({ clause: '', foodNames: [], blockIds: [] });

    const first = await generate(left, emptyHistory);
    expect(first.skipped).toBe(false);
    const firstStops = itineraryStops(first as { itinerary: { days?: Array<{ stops?: Array<{ name?: string }> }> } });
    const firstFood = (first as { itinerary: { days: Array<{ stops: Array<{ category: string; name: string }> }> } }).itinerary.days
      .flatMap((d) => d.stops.filter((s) => s.category === 'food').map((s) => s.name));
    savedPlans.push({ uid: identity.uid, itinerary: (first as { itinerary: unknown }).itinerary, blocksUsed: left });

    const baseline = await generate(right, emptyHistory);
    const baselineStops = itineraryStops(baseline as { itinerary: { days?: Array<{ stops?: Array<{ name?: string }> }> } });
    const baselineOverlap = compare(firstStops, baselineStops);
    expect(baselineOverlap.overlap_count).toBe(2);
    expect(baselineOverlap.overlap_ratio).toBeCloseTo(33.333, 2);

    const history = await buildAvoidContext(fakeDb, identity);
    expect(history.foodNames).toEqual(firstFood);
    expect(history.blockIds).toEqual(left);
    const afterHistory = await generate(right, history);
    const afterHistoryStops = itineraryStops(afterHistory as { itinerary: { days?: Array<{ stops?: Array<{ name?: string }> }> } });
    expect(compare(firstStops, afterHistoryStops).overlap_ratio).toBe(0);
    const selectorPayload = JSON.parse(sdk.generateContent.mock.calls.at(-1)?.[0].contents[0].parts[0].text);
    expect(selectorPayload.recent_block_ids).toEqual(left);

    const repeated = await generate(left, history);
    const repeatedStops = itineraryStops(repeated as { itinerary: { days?: Array<{ stops?: Array<{ name?: string }> }> } });
    const repeatedOverlap = compare(firstStops, repeatedStops);
    expect(repeatedOverlap.overlap_ratio).toBeGreaterThanOrEqual(30);
    expect(repeatedStops.filter((name) => !name.startsWith('Synthetic Restaurant')))
      .toEqual(firstStops.filter((name) => !name.startsWith('Synthetic Restaurant')));
    expect(repeatedStops.filter((name) => name.startsWith('Synthetic Restaurant')))
      .not.toEqual(firstStops.filter((name) => name.startsWith('Synthetic Restaurant')));
    const repeatedSameContext = await generate(left, history);
    expect(itineraryStops(repeatedSameContext as { itinerary: { days?: Array<{ stops?: Array<{ name?: string }> }> } }))
      .toEqual(repeatedStops);
    expect(sdk.generateContent).toHaveBeenCalledTimes(5);
  });

  it('query failure returns empty history and never prevents planning', async () => {
    vi.stubEnv('PLANNER_BLOCK_MODE', 'enabled');
    const brokenDb = { collection: () => ({ orderBy: () => ({ limit: () => ({ where: () => ({ get: async () => { throw new Error('offline synthetic'); } }) }) }) }) };
    const history = await buildAvoidContext(brokenDb, identity);
    expect(history).toEqual({ clause: '', foodNames: [], blockIds: [] });
    const result = await generate(['SYN_A', 'SYN_B'], history);
    expect(result.skipped).toBe(false);
    expect(sdk.generateContent).toHaveBeenCalledTimes(1);
  });

  it('keeps current-plan dedup, dietary safety, and anchored distance guard', async () => {
    const { expandBlocksToItinerary } = await import('../../api/_ai_core/blockMode.js');
    const tinyFood = foodIndex.slice(0, 2);
    const repeatBlock = { ...blocks[0], stops: [blocks[0].stops[1]] };
    const exhausted = expandBlocksToItinerary(selections(['SYN_A', 'SYN_A', 'SYN_A']), [repeatBlock], {
      ...input, foodIndex: tinyFood, recentFoodNames: tinyFood.map((f) => f.name),
    });
    const exhaustedNames = exhausted.days.map((d) => d.stops.find((s) => s.category === 'food')?.name);
    expect(new Set(exhaustedNames.slice(0, 2)).size).toBe(2);
    expect(exhaustedNames[2]).toBe(exhaustedNames[0]);

    expect(() => expandBlocksToItinerary(selections(['SYN_A']), [repeatBlock], {
      ...input, dietPrefs: ['vegan'], foodIndex: foodIndex.map((f) => ({ ...f, dietary_tags: [] })), recentFoodNames: ['Synthetic Restaurant 1'],
    })).toThrow(/unable to satisfy dietary preference/);

    const near = expandBlocksToItinerary(selections(['SYN_A']), [repeatBlock], {
      ...input,
      foodIndex: [
        { ...foodIndex[0], lat: 37.5701, lng: 126.99 },
        { ...foodIndex[1], name: 'Far Recent Alternative', lat: 37.7, lng: 126.99 },
      ],
      recentFoodNames: ['Synthetic Restaurant 1'],
    });
    expect(near.days[0].stops.find((s) => s.category === 'food')?.name).toBe('Synthetic Restaurant 1');
  });

  it('also avoids recent food in multi-city expansion without changing city assignment', async () => {
    const { expandBlocksToItineraryMultiCity } = await import('../../api/_ai_core/blockMode.js');
    const seoul = { ...blocks[0], stops: [blocks[0].stops[1]] };
    const busan = {
      ...seoul, id: 'SYN_BUSAN', city: 'busan', zone: 'busan',
      stops: [{ ...blocks[0].stops[1], address: 'Busan', lat: 35.18, lng: 129.07 }],
    };
    const result = expandBlocksToItineraryMultiCity({ day_selections: [
      { day: 1, city: 'seoul', block_id: seoul.id }, { day: 2, city: 'busan', block_id: busan.id },
    ] }, [{ city: 'seoul', blocks: [seoul] }, { city: 'busan', blocks: [busan] }], {
      ...input, durationDays: 2, foodIndex: [
        ...foodIndex,
        ...foodIndex.map((f) => ({ ...f, name: `Busan ${f.name}`, city: 'busan', lat: 35.18, lng: 129.07 })),
      ],
      recentFoodNames: ['Synthetic Restaurant 1', 'Busan Synthetic Restaurant 1'],
    });
    expect(result.days.map((d) => d.city)).toEqual(['seoul', 'busan']);
    expect(result.days.map((d) => d.stops.find((s) => s.category === 'food')?.name)).toEqual(['Synthetic Restaurant 2', 'Busan Synthetic Restaurant 2']);
  });
});
