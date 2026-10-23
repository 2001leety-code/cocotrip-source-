import { afterEach, describe, expect, it, vi } from 'vitest';
import nampo from '../../src/data/zone_courses/busan_nampo_packed.json';
import haeundae from '../../src/data/zone_courses/busan_haeundae_standard.json';
import seomyeon from '../../src/data/zone_courses/busan_seomyeon_standard.json';
import dmzOdusan from '../../src/data/zone_courses/seoul_dmz_odusan_standard.json';
import dmzTour from '../../src/data/zone_courses/seoul_dmz_tour_standard.json';
import jongno from '../../src/data/zone_courses/seoul_jongno_standard.json';
import myeongdong from '../../src/data/zone_courses/seoul_myeongdong_standard.json';
import { runWithLlmContext } from '../../api/_shared/llm/index.js';

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

// 2026-10-23: 서로 다른 블록이 같은 장소를 공유 — 서울 DMZ 오두산·DMZ 투어 블록이 둘 다 "임진각 평화누리공원".
//   block_id 만 보던 보정이 둘을 통과시켜 종단 중복 게이트가 ×2 로 플랜을 거부했다.
function placeBlock(id: string, places: Array<[string, string]>, block_type = 'city_day', city = 'seoul') {
  return {
    id, city, zone: city, theme: id, intensity: 'standard', block_type,
    duration_min: 480, dietary_options: [], status: 'published',
    stops: places.map(([category, name], i) => ({ order: i + 1, category, name, stay_min: 30, start_time_offset_min: 0 })),
  };
}
const ids = (s: { day_selections: Array<{ block_id: string }> }) => s.day_selections.map((d) => d.block_id);

describe('block-mode repair — overlapping places across different blocks', () => {
  it('real DMZ seeds: originals fail the terminal gate; the second is swapped for a non-overlapping block and the gate passes', async () => {
    const blocks = [dmzOdusan, dmzTour, jongno];
    const original = { day_selections: [{ day: 1, block_id: dmzOdusan.id }, { day: 2, block_id: dmzTour.id }] };
    const originalGate = runDuplicateStopGate(expandBlocksToItinerary(original, blocks, input));
    expect(originalGate.ok).toBe(false);
    expect(originalGate.duplicates).toContainEqual({ name: '임진각 평화누리공원', count: 2 });

    respond([
      { day: 1, block_id: dmzOdusan.id, tweak_notes: 'dmz' },
      { day: 2, block_id: dmzTour.id, tweak_notes: 'the other DMZ rationale' },
    ]);
    const selected = await selectBlocksWithGemini(blocks, input, { apiKey: 'test' });
    expectSingleGeminiCallAndMetadata(selected);
    expect(ids(selected)).toEqual([dmzOdusan.id, jongno.id]);
    expect(selected.day_selections[1].tweak_notes).toBe(''); // 옛 DMZ 설명이 새 장소에 붙지 않게
    const itinerary = expandBlocksToItinerary(selected, blocks, input);
    expect(runDuplicateStopGate(itinerary).ok).toBe(true);
    // 출처 추적도 교체 결과를 따라야 한다 — 날짜별 source_block_id, 2일차 블록 유래 stop 전부 종로.
    expect(itinerary.days.map((d: { source_block_id: string }) => d.source_block_id)).toEqual([dmzOdusan.id, jongno.id]);
    const day2Sources = itinerary.days[1].stops
      .map((s: { source_block_id?: string }) => s.source_block_id)
      .filter((id: string | undefined) => id !== undefined);
    expect(day2Sources.length).toBeGreaterThan(0);
    expect(new Set(day2Sources)).toEqual(new Set([jongno.id]));
    expect(itinerary.days[1].stops.map((s: { name?: string }) => s.name)).not.toContain('임진각 평화누리공원');
  });

  it('same name with different spaces / case overlaps', async () => {
    const blocks = [placeBlock('a', [['culture', 'Gyeongbokgung']]), placeBlock('b', [['culture', '  gyeongBOKgung ']]), placeBlock('c', [['culture', 'Other']])];
    respond([{ day: 1, block_id: 'a' }, { day: 2, block_id: 'b' }]);
    expect(ids(await selectBlocksWithGemini(blocks, input, { apiKey: 'test' }))).toEqual(['a', 'c']);
  });

  it('empty meal placeholders and lodging never count as overlap', async () => {
    const blocks = [
      placeBlock('a', [['lodging', 'Hotel X'], ['food', ''], ['culture', 'A spot']]),
      placeBlock('b', [['lodging', 'Hotel X'], ['food', '   '], ['culture', 'B spot']]),
      placeBlock('c', [['culture', 'C spot']]),
    ];
    respond([{ day: 1, block_id: 'a', tweak_notes: 'a' }, { day: 2, block_id: 'b', tweak_notes: 'keep b' }]);
    const selected = await selectBlocksWithGemini(blocks, input, { apiKey: 'test' });
    expect(ids(selected)).toEqual(['a', 'b']);
    expect(selected.day_selections[1].tweak_notes).toBe('keep b');
  });

  it('a named restaurant counts', async () => {
    const blocks = [placeBlock('a', [['food', 'Tosokchon']]), placeBlock('b', [['food', 'tosokchon']]), placeBlock('c', [['culture', 'C spot']])];
    respond([{ day: 1, block_id: 'a' }, { day: 2, block_id: 'b' }]);
    expect(ids(await selectBlocksWithGemini(blocks, input, { apiKey: 'test' }))).toEqual(['a', 'c']);
  });

  it('checks every original stop, not the 8-stop card summary (overlap on the 9th stop)', async () => {
    const nine = Array.from({ length: 8 }, (_, i): [string, string] => ['culture', `A${i}`]).concat([['culture', 'Shared']]);
    const blocks = [placeBlock('a', nine), placeBlock('b', [['culture', 'Shared']]), placeBlock('c', [['culture', 'C spot']])];
    expect(blocks[0].stops).toHaveLength(9);
    respond([{ day: 1, block_id: 'a' }, { day: 2, block_id: 'b' }]);
    expect(ids(await selectBlocksWithGemini(blocks, input, { apiKey: 'test' }))).toEqual(['a', 'c']);
  });

  it("a replacement block's places feed the next day's check (A,B,D → A,C,E)", async () => {
    const blocks = [
      placeBlock('a', [['culture', 'A spot']]),
      placeBlock('b', [['culture', 'a spot']]),   // A 와 겹침 → C 로
      placeBlock('c', [['culture', 'C spot']]),
      placeBlock('d', [['culture', 'c spot']]),   // 교체로 들어온 C 와 겹침 → E 로
      placeBlock('e', [['culture', 'E spot']]),
    ];
    respond([{ day: 1, block_id: 'a' }, { day: 2, block_id: 'b' }, { day: 3, block_id: 'd' }]);
    expect(ids(await selectBlocksWithGemini(blocks, { ...input, durationDays: 3 }, { apiKey: 'test' }))).toEqual(['a', 'c', 'e']);
  });

  it("an activity block is never replaced, but its places feed the next day's check", async () => {
    const blocks = [
      placeBlock('trail', [['culture', 'Bukhansan']], 'trekking'),
      placeBlock('x', [['culture', 'bukhansan']]),
      placeBlock('y', [['culture', 'Y spot']]),
    ];
    respond([{ day: 1, block_id: 'trail' }, { day: 2, block_id: 'x' }]);
    expect(ids(await selectBlocksWithGemini(blocks, input, { apiKey: 'test' }))).toEqual(['trail', 'y']);
  });

  it('no non-overlapping candidate → the selection stays and the existing terminal gate still blocks', async () => {
    const blocks = [dmzOdusan, dmzTour];
    respond([{ day: 1, block_id: dmzOdusan.id }, { day: 2, block_id: dmzTour.id, tweak_notes: 'kept' }]);
    const selected = await selectBlocksWithGemini(blocks, input, { apiKey: 'test' });
    expect(ids(selected)).toEqual([dmzOdusan.id, dmzTour.id]);
    expect(selected.day_selections[1].tweak_notes).toBe('kept');
    const gate = runDuplicateStopGate(expandBlocksToItinerary(selected, blocks, input));
    expect(gate.ok).toBe(false);
    expect(gate.duplicates).toContainEqual({ name: '임진각 평화누리공원', count: 2 });
  });

  it('a later valid choice stays reserved: an overlapping day is not given a block another day picked', async () => {
    const blocks = [placeBlock('a', [['culture', 'A spot']]), placeBlock('b', [['culture', 'A SPOT']]), placeBlock('c', [['culture', 'C spot']])];
    respond([{ day: 1, block_id: 'a' }, { day: 2, block_id: 'b' }, { day: 3, block_id: 'c' }]);
    // C 는 3일차가 고른 것 — 2일차 교체 후보에서 빠진다(후보 없음 → 원본 유지).
    expect(ids(await selectBlocksWithGemini(blocks, { ...input, durationDays: 3 }, { apiKey: 'test' }))).toEqual(['a', 'b', 'c']);
  });

  it('multi-city: a replacement stays inside that day\'s city pool', async () => {
    const cityBlocksList = [
      { city: 'seoul', blocks: [dmzOdusan, dmzTour] },
      { city: 'busan', blocks: [nampo, haeundae, seomyeon] },
    ];
    respond([
      { day: 1, city: 'seoul', block_id: dmzOdusan.id },
      { day: 2, city: 'seoul', block_id: dmzTour.id },
      { day: 3, city: 'busan', block_id: nampo.id },
    ]);
    const selected = await selectBlocksMultiCity(cityBlocksList, { ...input, durationDays: 3 }, { apiKey: 'test' }, ['seoul', 'seoul', 'busan']);
    expectSingleGeminiCallAndMetadata(selected);
    // 서울에 겹침 없는 후보가 없다 — 부산 블록을 빌려오지 않고 원본 유지.
    expect(selected.day_selections.map((d) => [d.city, d.block_id])).toEqual([
      ['seoul', dmzOdusan.id], ['seoul', dmzTour.id], ['busan', nampo.id],
    ]);
  });

  it('does not mutate the input blocks', async () => {
    const blocks = [dmzOdusan, dmzTour, jongno].map((b) => structuredClone(b));
    const before = JSON.stringify(blocks);
    respond([{ day: 1, block_id: dmzOdusan.id }, { day: 2, block_id: dmzTour.id }]);
    await selectBlocksWithGemini(blocks, input, { apiKey: 'test' });
    expect(JSON.stringify(blocks)).toBe(before);
  });
});

// mock 공급자(실제 CI/daily-health 가 쓰는 것) — available_blocks 를 날짜 순으로 돌려 고른다(mock.js buildMockBlockSelection).
//   충돌 입력을 그대로 둔 채, 선택→확장→종단 게이트가 통과해야 한다.
describe('block-mode repair — mock provider end to end', () => {
  it('seoul 3 days: mock picks both DMZ blocks; repair + expansion pass the terminal gate', async () => {
    const blocks = [dmzOdusan, dmzTour, jongno, myeongdong];
    const seoul3 = { ...input, durationDays: 3 };
    const selected = await runWithLlmContext({ provider: 'mock' }, () => selectBlocksWithGemini(blocks, seoul3, { apiKey: 'test' }));
    expect(ids(selected)).toEqual([dmzOdusan.id, myeongdong.id, jongno.id]); // 원래 mock 선택 = 오두산, DMZ 투어, 종로
    expect(runDuplicateStopGate(expandBlocksToItinerary(selected, blocks, seoul3))).toMatchObject({ ok: true, duplicates: [] });
    expect(sdk.generateContent).not.toHaveBeenCalled();
  });

  it('seoul + busan 5 days: selection → expansion → terminal gate pass', async () => {
    const cityBlocksList = [
      { city: 'seoul', blocks: [dmzOdusan, dmzTour, jongno, myeongdong] },
      { city: 'busan', blocks: [nampo, haeundae, seomyeon] },
    ];
    const five = { ...input, durationDays: 5 };
    const cityPerDay = ['seoul', 'seoul', 'seoul', 'busan', 'busan'];
    const selected = await runWithLlmContext({ provider: 'mock' }, () => selectBlocksMultiCity(cityBlocksList, five, { apiKey: 'test' }, cityPerDay));
    // mock 원래 선택 = 오두산·DMZ 투어·종로·남포·해운대 → 2일차만 명동으로(서울 풀 안).
    expect(selected.day_selections.map((d) => [d.city, d.block_id])).toEqual([
      ['seoul', dmzOdusan.id], ['seoul', myeongdong.id], ['seoul', jongno.id], ['busan', nampo.id], ['busan', haeundae.id],
    ]);
    const itinerary = expandBlocksToItineraryMultiCity(selected, cityBlocksList, five);
    expect(runDuplicateStopGate(itinerary)).toMatchObject({ ok: true, duplicates: [] });
  });
});
