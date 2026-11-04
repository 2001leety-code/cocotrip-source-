import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeDay1Block } from '../../api/_ai_core/day1BlockPlacement.js';

type Stop = { id: string; category: string; stay_min: number };
const stops: Stop[] = [
  { id: 'a', category: 'culture', stay_min: 30 },
  { id: 'b', category: 'culture', stay_min: 30 },
  { id: 'c', category: 'culture', stay_min: 30 },
];
function fixture(input = stops) {
  const known = new Map<string, number>();
  const key = (a: Stop, b: Stop) => `${a.id}>${b.id}`;
  const lookupLeg = vi.fn(async (a: Stop, b: Stop) => { known.set(key(a, b), 10); return 10; });
  const lookupReturn = vi.fn(async () => 10);
  return { input, known, key, lookupLeg, lookupReturn, options: {
    oneDay: true, mealWindows: {}, readyMin: 540, tourEndMin: 1200, deadlineMin: 1199, buffer: 5,
    knownLeg: (a: Stop, b: Stop) => known.get(key(a, b)), lookupLeg, lookupReturn, stayOf: (s: Stop) => s.stay_min,
  } };
}
afterEach(() => vi.restoreAllMocks());

describe('day-one placement resource budgets', () => {
  it('reports lookup exhaustion as unknown, not an infeasible or verified schedule', async () => {
    const f = fixture();
    const result = await placeDay1Block(f.input, { ...f.options, maxResolvedLegs: 1 });
    expect(result).toMatchObject({ status: 'budget_exhausted' });
    expect(f.lookupLeg.mock.calls.length + f.lookupReturn.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('reports elapsed exhaustion after a slow lookup as unknown', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const f = fixture();
    f.lookupLeg.mockImplementation(async (a, b) => { f.known.set(f.key(a, b), 10); now += 101; return 10; });
    const result = await placeDay1Block(f.input, { ...f.options, maxElapsedMs: 100 });
    expect(result).toMatchObject({ status: 'budget_exhausted' });
  });

  it('reports search exhaustion as unknown rather than infeasibility', async () => {
    const f = fixture();
    const result = await placeDay1Block(f.input, { ...f.options, maxSearchStates: 1 });
    expect(result).toMatchObject({ status: 'budget_exhausted' });
    expect(f.lookupLeg).not.toHaveBeenCalled();
    expect(f.lookupReturn).not.toHaveBeenCalled();
  });

  it('does not consume lookup budget for an already known terminal leg', async () => {
    const f = fixture(stops.slice(0, 2));
    const terminal: Stop = { id: 'airport', category: 'airport', stay_min: 0 };
    for (const s of f.input) f.known.set(f.key(s, terminal), 10);
    const result = await placeDay1Block(f.input, { ...f.options, terminal: { stop: terminal, time: 800 }, maxResolvedLegs: 1 });
    expect(result.status).toBe('feasible');
    expect(f.lookupLeg).toHaveBeenCalledTimes(1);
    expect(f.lookupReturn).not.toHaveBeenCalled();
  });
});
