import { describe, expect, it } from 'vitest';
import { solveDay1BlockSchedule } from '../../api/_ai_core/day1BlockScheduler.js';

type Stop = { category: string; stay_min: number; _blockMealRole?: string; _day1LegacyPriority?: boolean; cafe_not_meal?: boolean };
type Options = { readyMin: number; tourEndMin: number; deadlineMin: number; buffer: number; mealWindows: Record<string, { from: number; to: number }>; requireLunch: boolean; requireDinner: boolean; transitMinutes: (a: number, b: number) => number; maxStates: number };

// Enumerate every subset and every permutation; assign each food independently.
// This intentionally has no state memoization or dominance pruning.
function oracle(stops: Stop[], options: Options) {
  let best: number[] | null = null;
  const better = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };
  const examine = (order: number[]) => {
    const assignments = (at: number, time: number, roles: Set<string>) => {
      if (at === order.length) {
        if ((options.requireLunch && !roles.has('lunch')) || (options.requireDinner && !roles.has('dinner'))) return;
        let legacy = 0, sights = 0, cafes = 0, foods = 0;
        for (const index of order) {
          const stop = stops[index];
          if (stop.category === 'cafe' || stop.cafe_not_meal || stop._blockMealRole === 'cafe') cafes++;
          else if (stop.category === 'food') foods++;
          else { sights++; if (stop._day1LegacyPriority) legacy++; }
        }
        const score = [Number(roles.has('lunch')) + Number(roles.has('dinner')), legacy, sights, cafes, foods, order.length];
        if (!best || better(score, best)) best = score;
        return;
      }
      const index = order[at];
      const stop = stops[index];
      const arrival = at === 0 ? options.readyMin : time + options.transitMinutes(order[at - 1], index) + options.buffer;
      const food = stop.category === 'food' && !stop.cafe_not_meal && stop._blockMealRole !== 'cafe';
      const preferred = stop._blockMealRole;
      const open = ['lunch', 'dinner'].filter((role) => options.mealWindows[role]);
      const choices = food ? (preferred && open.includes(preferred) ? [preferred] : open) : [null];
      for (const role of choices) {
        // Alternatives fill one meal slot; counting multiple restaurants in that slot would inflate the score.
        if (role && roles.has(role)) continue;
        const window = role ? options.mealWindows[role] : { from: options.readyMin, to: options.tourEndMin - 1 };
        const start = Math.max(arrival, window.from, options.readyMin);
        const end = start + stop.stay_min;
        if (start > window.to || start >= 1440 || end > options.deadlineMin || end >= 1440) continue;
        const next = new Set(roles);
        if (role) next.add(role);
        assignments(at + 1, end, next);
      }
    };
    assignments(0, options.readyMin, new Set());
  };
  for (let subset = 0; subset < 2 ** stops.length; subset++) {
    const members = stops.map((_, i) => i).filter((i) => subset & (1 << i));
    const permute = (prefix: number[], remaining: number[]) => {
      if (!remaining.length) { examine(prefix); return; }
      remaining.forEach((value, i) => permute([...prefix, value], [...remaining.slice(0, i), ...remaining.slice(i + 1)]));
    };
    permute([], members);
  }
  return best;
}

function random(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
}

describe('day 1 block scheduler: independent exhaustive oracle', () => {
  it('matches optimal meal coverage and retained priorities for 18 directional-travel cases without mutating inputs', () => {
    const rnd = random(20261102);
    let compared = 0;
    for (let test = 0; test < 18; test++) {
      const n = 4 + (rnd() % 3);
      const stops: Stop[] = Array.from({ length: n }, (_, i) => ({
        category: i < 2 ? 'food' : i === 2 && test % 3 === 0 ? 'cafe' : 'culture',
        stay_min: 30 + 15 * (rnd() % 4),
        ...(i === 0 ? { _blockMealRole: 'lunch' } : i === 1 ? { _blockMealRole: 'dinner' } : {}),
        ...(i >= 3 && rnd() % 2 === 0 ? { _day1LegacyPriority: true } : {}),
      }));
      const matrix = Array.from({ length: n }, () => Array.from({ length: n }, () => 5 + 10 * (rnd() % 5)));
      const options: Options = {
        readyMin: 650 + 10 * (test % 4), tourEndMin: 1250, deadlineMin: 1030 + 25 * (test % 8), buffer: 5,
        mealWindows: { lunch: { from: 660, to: 900 }, dinner: { from: 1020, to: 1200 } },
        requireLunch: test % 4 !== 0, requireDinner: test % 3 !== 0,
        transitMinutes: (a, b) => matrix[a][b], maxStates: 1000000,
      };
      const snapshot = structuredClone(stops);
      const matrixSnapshot = structuredClone(matrix);
      const optionsSnapshot = { ...options, mealWindows: structuredClone(options.mealWindows) };
      const expected = oracle(stops, options);
      const actual = solveDay1BlockSchedule(stops, options);
      expect(stops, `case ${test} mutates stops`).toEqual(snapshot);
      expect(matrix, `case ${test} mutates legs`).toEqual(matrixSnapshot);
      expect(options, `case ${test} mutates options`).toEqual(optionsSnapshot);
      if (actual.status === 'budget_exhausted') continue;
      compared++;
      if (expected === null) expect(actual.status, `case ${test}`).toBe('proven_infeasible');
      else { expect(actual.status, `case ${test}`).toBe('feasible'); expect(actual.quality, `case ${test}`).toEqual(expected); }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('does not count a cafe or a single restaurant as two required meals', () => {
    const opts: Options = { readyMin: 660, tourEndMin: 1320, deadlineMin: 1310, buffer: 5,
      mealWindows: { lunch: { from: 660, to: 900 }, dinner: { from: 1020, to: 1260 } },
      requireLunch: true, requireDinner: true, transitMinutes: () => 10, maxStates: 100000 };
    const stops: Stop[] = [{ category: 'food', stay_min: 45 }, { category: 'food', stay_min: 45, _blockMealRole: 'cafe' }, { category: 'culture', stay_min: 30 }, { category: 'cafe', stay_min: 30 }];
    expect(oracle(stops, opts)).toBeNull();
    const result = solveDay1BlockSchedule(stops, opts);
    if (result.status !== 'budget_exhausted') expect(result.status).toBe('proven_infeasible');
  });

  it('chooses only one restaurant per meal slot instead of inflating the food score', () => {
    const opts: Options = { readyMin: 660, tourEndMin: 1320, deadlineMin: 1310, buffer: 5,
      mealWindows: { lunch: { from: 660, to: 900 }, dinner: { from: 1020, to: 1260 } },
      requireLunch: true, requireDinner: true, transitMinutes: () => 0, maxStates: 100000 };
    const stops: Stop[] = [
      { category: 'food', stay_min: 30, _blockMealRole: 'lunch' },
      { category: 'food', stay_min: 30, _blockMealRole: 'lunch' },
      { category: 'food', stay_min: 30, _blockMealRole: 'lunch' },
      { category: 'food', stay_min: 30, _blockMealRole: 'dinner' },
      { category: 'culture', stay_min: 30 },
    ];
    const expected = oracle(stops, opts);
    expect(expected).toEqual([2, 0, 1, 0, 2, 3]);
    const result = solveDay1BlockSchedule(stops, opts);
    expect(result.status).toBe('feasible');
    expect(result.quality).toEqual(expected);
    expect(result.roles.filter((role: string | null) => role === 'lunch')).toHaveLength(1);
    expect(result.roles.filter((role: string | null) => role === 'dinner')).toHaveLength(1);
    expect(result.indices.filter((index: number) => stops[index].category === 'food')).toHaveLength(2);
  });

});
