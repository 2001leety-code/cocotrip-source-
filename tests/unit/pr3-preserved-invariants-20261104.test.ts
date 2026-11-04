import { describe, it, expect } from 'vitest';
import { updatePlanEnrichment } from '../../api/_ai_core/planPersister.js';
import { expandBlocksToItinerary } from '../../api/_ai_core/blockMode.js';
import { checkRequiredMeals } from '../../api/_ai_core/responseValidator.js';
import { checkZeroFoodDays } from '../../api/_ai_core/finalItineraryGate.js';
import { applyStopSwap } from '../../api/ai-planner-modify.js';

type AnyRec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const WIN = { meal_windows: { lunch: { from: '11:00', to: '16:59' }, dinner: { from: '17:00', to: '20:59' } } };
const lunchGap = (it: AnyRec) => checkRequiredMeals(it, WIN).filter((e: string) => /B-MEAL-LUNCH/.test(e));

function planWithCafeAtLunch(): AnyRec {
  return {
    days: [{
      day: 1, city: 'seoul',
      stops: [
        { order: 1, name: 'Museum', category: 'sightseeing', start_time: '10:00' },
        { order: 2, name: 'Block Cafe', category: 'food', start_time: '13:00', stay_min: 50, _blockMealRole: 'cafe', _blockMealPreferredMin: 780 },
        { order: 3, name: 'Palace', category: 'sightseeing', start_time: '14:30' },
        { order: 4, name: 'Market', category: 'sightseeing', start_time: '16:00' },
        { order: 5, name: 'Dinner Place', category: 'food', start_time: '18:00', stay_min: 60 },
      ],
    }],
  };
}

describe('PR3 r3 #3 — a block cafe stays "not a meal" through save → modify', () => {
  it('persists the cafe marker and the saved cafe does not count as lunch', async () => {
    const plan = planWithCafeAtLunch();
    plan.days[0].stops[1].cafe_not_meal = true;
    let saved: AnyRec = {};
    const db = { collection: () => ({ doc: () => ({ set: async (value: AnyRec) => { saved = structuredClone(value); } }) }) };
    await updatePlanEnrichment(db, 'test-plan', plan);
    const stored = { days: saved['itinerary.days'] };
    expect(stored.days[0].stops[1].cafe_not_meal).toBe(true);
    expect(lunchGap(stored)).toHaveLength(1);
  });
  it('control: an ordinary lunch restaurant at the same time satisfies the lunch window', () => {
    const plan = planWithCafeAtLunch();
    delete plan.days[0].stops[1]._blockMealRole;
    delete plan.days[0].stops[1]._blockMealPreferredMin;
    expect(lunchGap(plan)).toHaveLength(0);
  });
  it('zero-food check (diet guests): a saved day whose only food stop is the cafe is still a zero-food day', () => {
    const plan = planWithCafeAtLunch();
    plan.days[0].stops.splice(4, 1); // 저녁 제거 → 카페만 남음
    plan.days[0].stops[1].cafe_not_meal = true;
    delete plan.days[0].stops[1]._blockMealRole;
    delete plan.days[0].stops[1]._blockMealPreferredMin;
    expect(checkZeroFoodDays(plan, ['Halal'])).toHaveLength(1);
  });
  it('stop_swap: the restaurant that replaces the saved cafe does not inherit cafe_not_meal and counts as the lunch', () => {
    const plan = planWithCafeAtLunch();
    plan.days[0].stops[1].cafe_not_meal = true;
    delete plan.days[0].stops[1]._blockMealRole;
    delete plan.days[0].stops[1]._blockMealPreferredMin;
    const row = { name: 'New Lunch', nameEn: 'New Lunch', city: 'seoul', address: '서울특별시 중구 세종대로 110', lat: 37.5665, lng: 126.978, rating: 4.5, reviewCount: 50 };
    const r = applyStopSwap({ itinerary: plan, classified: { target: { day_index: 1, stop_order: 2, stop_name: 'cafe' }, raw_text: 'swap the cafe' }, dietPrefs: [], foodIndex: [row], area: 'seoul', language: 'en' });
    expect(r.ok).toBe(true);
    expect(plan.days[0].stops[1].name).toBe('New Lunch');
    expect(plan.days[0].stops[1]).not.toHaveProperty('cafe_not_meal');
    expect(lunchGap(plan)).toHaveLength(0);
  });
  it('clears raw block cafe role metadata only after selecting a meal-capable restaurant', () => {
    const plan = planWithCafeAtLunch();
    plan.days[0].stops[1].cafe_not_meal = true;
    const row = { name: 'Lunch Restaurant', city: 'seoul', lat: 37.5665, lng: 126.978, rating: 4.5, reviewCount: 50 };
    const result = applyStopSwap({ itinerary: plan, classified: { target: { day_index: 1, stop_order: 2 }, raw_text: 'replace cafe with lunch' }, dietPrefs: [], foodIndex: [row], area: 'seoul' });
    expect(result.ok).toBe(true);
    const replacement = plan.days[0].stops[1];
    for (const key of ['cafe_not_meal', '_blockMealRole', '_blockMealPreferredMin']) expect(replacement).not.toHaveProperty(key);
    expect(replacement.start_time).toBe('13:00');
    expect(replacement.stay_min).toBe(50);
    expect(lunchGap(plan)).toHaveLength(0);
  });
  it('rejects a cafe-only candidate without mutating the existing cafe into a meal', () => {
    const plan = planWithCafeAtLunch();
    plan.days[0].stops[1].cafe_not_meal = true;
    const before = structuredClone(plan);
    const result = applyStopSwap({ itinerary: plan, classified: { target: { day_index: 1, stop_order: 2 }, raw_text: 'replace cafe' }, dietPrefs: [], foodIndex: [{ name: 'Coffee Cafe', city: 'seoul', category: 'cafe', lat: 37.5665, lng: 126.978 }], area: 'seoul' });
    expect(result).toMatchObject({ ok: false, code: 'NO_ALTERNATIVE' });
    expect(plan).toEqual(before);
    expect(lunchGap(plan)).toHaveLength(1);
  });
});


describe('multi-day edit dietary invariant', () => {
  it('a Halal block for a multi-day trip expands with dietary evidence', () => {
    const block = {
      id: 'B1', city: 'seoul', zone: '종로', theme: 'test', dietary_options: ['halal'],
      stops: [
        { order: 1, name: '경복궁', category: 'culture', start_time_offset_min: 0, stay_min: 60, lat: 37.5796, lng: 126.977 },
        { order: 2, placeholder: 'verified_lunch', category: 'food', start_time_offset_min: 180, stay_min: 60 },
        { order: 3, name: '북촌', category: 'culture', start_time_offset_min: 300, stay_min: 60, lat: 37.582, lng: 126.983 },
      ],
    };
    const friendly = { name: '무슬림 친화 식당', city: 'seoul', cuisine: 'Korean', rating: 4.2, reviewCount: 300, lat: 37.5717, lng: 126.9858, tag: 'halal', verification_status: 'muslim_friendly' };
    const sel = { day_selections: [{ day: 1, block_id: 'B1', tweak_notes: '' }] };
    const input = { durationDays: 1, dietPrefs: ['Halal'], language: 'en', area: 'seoul', foodIndex: [friendly] };
    const out = expandBlocksToItinerary(sel, [block], { ...input, tripDays: 2 });
    const food = (out.days[0].stops as AnyRec[]).find((s) => s.category === 'food')!;
    expect(food.name).toBe('무슬림 친화 식당');
    expect(food.dietary_evidence[0].verification_status).toBe('muslim_friendly');
  });
});
