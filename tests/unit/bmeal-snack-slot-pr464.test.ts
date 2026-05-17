/**
 * PR #464 — Audit X-H6 regression slot.
 *
 * Pre-fix: api/_ai_core/responseValidator.js's B-MEAL validator
 * counted food stops in only two windows:
 *   - lunch:  hour ∈ [11, 15)
 *   - dinner: hour ∈ [17, 22)
 * Food stops in the 15:00–16:59 window (the "snack" / late-
 * afternoon meal slot) were counted as NEITHER lunch nor dinner.
 * If Gemini produced a plan where the user's afternoon eating
 * was at 15:30 (e.g. Sulbing bingsoo, Anthracite Coffee), the
 * validator fired a false-positive B-MEAL-LUNCH error → caller
 * triggered a retry → wasted Gemini Pro quota (now partially
 * mitigated by PR #461's retry model, but still avoidable).
 *
 * Post-fix:
 *  1. Explicit `snackCount` filter on hour ∈ [15, 17) — kept
 *     separate from lunchCount for telemetry analysis of
 *     "what proportion of plans use the afternoon slot."
 *  2. `afternoonMealCount = lunchCount + snackCount` satisfies
 *     the lunch requirement. A full day with snack at 15:30 +
 *     dinner at 18:30 now passes. A day with only snack and no
 *     dinner still fails B-MEAL-DINNER.
 *  3. Dinner boundary [17, 22) unchanged — dinner is the
 *     unambiguous main meal.
 *  4. Telemetry log updated to include snack=N alongside
 *     lunch/dinner counts for prod debugging.
 *
 * The lunch+snack OR pass-through is intentionally NOT a third
 * "any meal" lump — separating snack lets the operator measure
 * whether Gemini gravitated to afternoon-cafe culture and adapt
 * the prompt if needed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePatternStructure } from '../../api/_ai_core/responseValidator.js';

const src = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/responseValidator.js'),
  'utf8',
);

type Stop = { category: string; name: string; start_time: string };
type Day = { day: number; city?: string; stops: Stop[] };
type Itinerary = { days: Day[]; arrival_guide?: any; departure_guide?: any };

function fullDayWithFoodAt(times: string[]): Day {
  return {
    day: 2,
    city: 'Seoul',
    stops: [
      { category: 'lodging', name: '서울 호텔 출발', start_time: '09:00' },
      { category: 'attraction', name: 'A', start_time: '10:00' },
      ...times.map((t, idx) => ({ category: 'food', name: `meal ${idx}`, start_time: t })),
      { category: 'attraction', name: 'X', start_time: '23:30' },
      { category: 'lodging', name: '서울 호텔 복귀', start_time: '23:45' },
    ],
  };
}

function makeBookendDay(day: number, label: string): Day {
  return {
    day,
    city: 'Seoul',
    stops: [
      { category: 'lodging', name: `${label} 출발`, start_time: '09:00' },
      { category: 'attraction', name: 'A', start_time: '10:00' },
      { category: 'food', name: '점심 12:30', start_time: '12:30' },
      { category: 'attraction', name: 'B', start_time: '15:00' },
      { category: 'food', name: '저녁 18:30', start_time: '18:30' },
      { category: 'lodging', name: `${label} 복귀`, start_time: '21:00' },
    ],
  };
}

function withDays(midDay: Day, dayCount: number = 3): Itinerary {
  const days: Day[] = [];
  for (let i = 1; i <= dayCount; i++) {
    if (i === 2 && dayCount > 1) days.push(midDay);
    else days.push(makeBookendDay(i, `Day ${i}`));
  }
  return { days, arrival_guide: { airport: 'ICN' }, departure_guide: { airport: 'ICN' } };
}

describe('PR #464 X-H6 — snack slot [15,17) satisfies afternoon-meal requirement', () => {
  it('snack at 15:00 + dinner at 18:30 → no B-MEAL error (full day, was false-positive pre-fix)', () => {
    const errors = validatePatternStructure(withDays(fullDayWithFoodAt(['15:00', '18:30'])), {});
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 2'))).toEqual([]);
  });

  it('snack at 15:30 + dinner at 19:00 → no B-MEAL error (the audit-flagged scenario)', () => {
    const errors = validatePatternStructure(withDays(fullDayWithFoodAt(['15:30', '19:00'])), {});
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 2'))).toEqual([]);
  });

  it('snack at 16:59 (last minute of snack window) + dinner at 17:30 → no B-MEAL error', () => {
    const errors = validatePatternStructure(withDays(fullDayWithFoodAt(['16:59', '17:30'])), {});
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 2'))).toEqual([]);
  });

  it('snack at 15:00 with NO dinner → B-MEAL-DINNER fires (snack does NOT cover dinner)', () => {
    const errors = validatePatternStructure(withDays(fullDayWithFoodAt(['15:00'])), {});
    expect(errors.some((e) => e.includes('B-MEAL-DINNER') && e.includes('Day 2'))).toBe(true);
    expect(errors.some((e) => e.includes('B-MEAL-LUNCH') && e.includes('Day 2'))).toBe(false);
  });

  it('no food at all → both B-MEAL-LUNCH (oh후식사) + B-MEAL-DINNER fire', () => {
    const errors = validatePatternStructure(withDays(fullDayWithFoodAt([])), {});
    expect(errors.some((e) => e.includes('B-MEAL-LUNCH') && e.includes('Day 2'))).toBe(true);
    expect(errors.some((e) => e.includes('B-MEAL-DINNER') && e.includes('Day 2'))).toBe(true);
  });

  it('lunch at 12:00 + dinner at 19:00 (standard meal pattern) still passes', () => {
    const errors = validatePatternStructure(withDays(fullDayWithFoodAt(['12:00', '19:00'])), {});
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 2'))).toEqual([]);
  });

  it('lunch at 12:00 + snack at 15:30 + dinner at 19:00 (3-meal pattern) passes', () => {
    const errors = validatePatternStructure(withDays(fullDayWithFoodAt(['12:00', '15:30', '19:00'])), {});
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 2'))).toEqual([]);
  });

  it('first day (arrival) with only a 15:30 snack — passes (도착일 점심/snack OR 저녁)', () => {
    const arrivalDay = fullDayWithFoodAt(['15:30']);
    arrivalDay.day = 1;
    const itinerary: Itinerary = {
      days: [arrivalDay, makeBookendDay(2, 'Day 2'), makeBookendDay(3, 'Day 3')],
      arrival_guide: { airport: 'ICN' }, departure_guide: { airport: 'ICN' },
    };
    const errors = validatePatternStructure(itinerary, {});
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 1'))).toEqual([]);
  });

  it('last day (departure) with snack at 16:30 + no dinner — passes (출국일 점심/snack OR 저녁)', () => {
    const departureDay = fullDayWithFoodAt(['16:30']);
    departureDay.day = 3;
    const itinerary: Itinerary = {
      days: [makeBookendDay(1, 'Day 1'), makeBookendDay(2, 'Day 2'), departureDay],
      arrival_guide: { airport: 'ICN' }, departure_guide: { airport: 'ICN' },
    };
    const errors = validatePatternStructure(itinerary, {});
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 3'))).toEqual([]);
  });

  it('boundary: snack at exactly 17:00 is dinner (NOT snack) — still counts as dinner', () => {
    // 17:00 should fall into dinner slot [17,22), NOT snack [15,17).
    const errors = validatePatternStructure(withDays(fullDayWithFoodAt(['12:00', '17:00'])), {});
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 2'))).toEqual([]);
  });
});

describe('PR #464 X-H6 — source-level invariants', () => {
  it('declares lunchCount with [11, 15) range (unchanged)', () => {
    expect(src).toMatch(/lunchCount\s*=\s*foodStops\.filter\(\(s\)\s*=>\s*matchHour\(s,\s*11,\s*15\)\)/);
  });

  it('declares NEW snackCount with [15, 17) range', () => {
    expect(src).toMatch(/snackCount\s*=\s*foodStops\.filter\(\(s\)\s*=>\s*matchHour\(s,\s*15,\s*17\)\)/);
  });

  it('declares dinnerCount with [17, 22) range (unchanged)', () => {
    expect(src).toMatch(/dinnerCount\s*=\s*foodStops\.filter\(\(s\)\s*=>\s*matchHour\(s,\s*17,\s*22\)\)/);
  });

  it('declares afternoonMealCount = lunchCount + snackCount', () => {
    expect(src).toMatch(/afternoonMealCount\s*=\s*lunchCount\s*\+\s*snackCount/);
  });

  it('full-day guard uses afternoonMealCount (NOT just lunchCount)', () => {
    expect(src).toMatch(/if\s*\(\s*afternoonMealCount\s*===\s*0\s*\)\s*errors\.push/);
  });

  it('first/last-day guard uses afternoonMealCount (NOT just lunchCount)', () => {
    expect(src).toMatch(/if\s*\(\s*afternoonMealCount\s*===\s*0\s*&&\s*dinnerCount\s*===\s*0\s*\)/);
  });

  it('telemetry log includes snack=N alongside lunch/dinner counts', () => {
    expect(src).toMatch(/foodStops=\$\{foodStops\.length\}\s*lunch=\$\{lunchCount\}\s*snack=\$\{snackCount\}\s*dinner=\$\{dinnerCount\}/);
  });

  it('B-MEAL env flag VALIDATOR_BMEAL_ENABLED still gates the whole block', () => {
    expect(src).toMatch(/process\.env\.VALIDATOR_BMEAL_ENABLED\s*!==\s*['"]false['"]/);
  });
});
