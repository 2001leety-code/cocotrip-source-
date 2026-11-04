import { solveDay1BlockSchedule } from './day1BlockScheduler.js';
import { proveDepartureMealExemption, recordDepartureMealExemption } from './departureMealExemption.js';

// The search sees immutable numeric lower bounds. Only a selected candidate path requests missing legs.
export async function placeDay1Block(stops, options) {
  const windows = { ...options.mealWindows };
  const exemption = {};
  if (options.oneDay && options.exemptionContext) {
    for (const role of ['lunch', 'dinner']) {
      if (!windows[role]) continue;
      const candidates = stops.filter((s) => s.category === 'food' && s.cafe_not_meal !== true
        && s._blockMealRole !== 'cafe' && s._blockMealRole !== 'breakfast'
        && (!['lunch', 'dinner'].includes(s._blockMealRole) || !windows[s._blockMealRole] || s._blockMealRole === role));
      const shortest = [...candidates].sort((a, b) => options.stayOf(a) - options.stayOf(b))[0];
      const proof = shortest && proveDepartureMealExemption(role, options.stayOf(shortest), options.exemptionContext);
      if (proof) { recordDepartureMealExemption(exemption, role, proof, shortest); windows[role] = null; }
    }
  }
  const returns = new Map();
  const terminal = options.terminal;
  const pureOptions = {
    readyMin: options.readyMin, tourEndMin: options.tourEndMin, deadlineMin: options.deadlineMin,
    buffer: options.buffer, mealWindows: windows,
    requireLunch: options.oneDay && !!windows.lunch, requireDinner: options.oneDay && !!windows.dinner,
    atLeastOneMeal: !options.oneDay,
    transitMinutes: (a, b) => options.knownLeg(stops[a], stops[b]),
    returnMinutes: (i) => returns.get(i) || 0,
    terminal: terminal ? { time: terminal.time, transitMinutes: (i) => options.knownLeg(stops[i], terminal.stop) || 0 } : null,
  };
  const limit = stops.length * (stops.length + 2) + 1;
  const started = Date.now();
  const maxElapsedMs = Number(options.maxElapsedMs) || 120000;
  const maxResolvedLegs = Number(options.maxResolvedLegs) || Math.min(128, Math.max(1, stops.length * (stops.length + 2)));
  const maxSearchStates = Number(options.maxSearchStates) || 1000000;
  let exploredTotal = 0;
  let resolvedLegs = 0;
  const exhausted = (reason) => ({ status: 'budget_exhausted', reason, exemption, resolvedLegs, explored: exploredTotal });
  const lookup = async (action) => {
    const remaining = maxElapsedMs - (Date.now() - started);
    if (remaining <= 0 || resolvedLegs >= maxResolvedLegs) return null;
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(action).then((value) => ({ value })),
        new Promise((resolve) => { timer = setTimeout(() => resolve(null), remaining); }),
      ]);
      if (result) resolvedLegs++;
      return result;
    } finally { clearTimeout(timer); }
  };
  for (let pass = 0; pass <= limit; pass++) {
    if (Date.now() - started >= maxElapsedMs) return exhausted('elapsed_budget');
    if (exploredTotal >= maxSearchStates) return exhausted('search_budget');
    const candidate = solveDay1BlockSchedule(stops, { ...pureOptions, maxStates: Math.min(100000, maxSearchStates - exploredTotal) });
    exploredTotal += candidate.explored || 0;
    if (candidate.status !== 'feasible') return { ...candidate, exemption, resolvedLegs };
    let learned = 0;
    for (let i = 1; i < candidate.indices.length; i++) {
      const prev = stops[candidate.indices[i - 1]], next = stops[candidate.indices[i]];
      if (options.knownLeg(prev, next) === undefined) {
        if (!await lookup(() => options.lookupLeg(prev, next))) return exhausted('lookup_budget');
        learned++;
      }
    }
    const last = candidate.indices[candidate.indices.length - 1];
    if (last !== undefined) {
      if (terminal) {
        if (options.knownLeg(stops[last], terminal.stop) === undefined) {
          if (!await lookup(() => options.lookupLeg(stops[last], terminal.stop))) return exhausted('lookup_budget');
          learned++;
        }
      } else if (!returns.has(last)) {
        const result = await lookup(() => options.lookupReturn(stops[last]));
        if (!result) return exhausted('lookup_budget');
        returns.set(last, result.value); learned++;
      }
    }
    // A path attaining the optimistic retention bound and verified with real legs is sufficient.
    // Do not query every direction merely to optimize the travel tie-breaker.
    if (Date.now() - started >= maxElapsedMs) return exhausted('elapsed_budget');
    if (exploredTotal >= maxSearchStates) return exhausted('search_budget');
    const verified = solveDay1BlockSchedule(stops, {
      ...pureOptions, maxStates: Math.min(100000, maxSearchStates - exploredTotal), fixedOrder: candidate.indices, mustKeepIndices: candidate.indices,
      requireLunch: pureOptions.requireLunch || !!(candidate.covered & 1),
      requireDinner: pureOptions.requireDinner || !!(candidate.covered & 2),
    });
    exploredTotal += verified.explored || 0;
    if (verified.status === 'feasible') return { ...verified, exemption, resolvedLegs, passes: pass + 1 };
    if (!learned) return { status: 'budget_exhausted', reason: 'verification_stalled', exemption, resolvedLegs };
  }
  return { status: 'budget_exhausted', reason: 'leg_resolution_budget', exemption, resolvedLegs };
}
