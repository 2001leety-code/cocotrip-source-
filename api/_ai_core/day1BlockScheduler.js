// Pure scheduling over already matched stops. Transport lookups belong to the caller.
// A budget limit is not evidence that a schedule is impossible.
export function solveDay1BlockSchedule(stops, options = {}) {
  const n = stops.length;
  const maxStates = Number(options.maxStates) || 100000;
  if (n > 20) return { status: 'budget_exhausted', reason: 'mask_capacity', explored: 0 };
  const ready = Number(options.readyMin);
  const endOfTour = Number(options.tourEndMin);
  const deadline = Number.isFinite(options.deadlineMin) ? options.deadlineMin : 1439;
  const buffer = Number.isFinite(options.buffer) ? options.buffer : 5;
  const windows = options.mealWindows || {};
  const required = (options.requireLunch ? 1 : 0) | (options.requireDinner ? 2 : 0);
  const mustKeep = (options.mustKeepIndices || []).reduce((mask, i) => mask | (1 << i), 0);
  const terminal = options.terminal;
  if (!Number.isFinite(ready) || !Number.isFinite(endOfTour)) return { status: 'invalid_input', explored: 0 };
  const stay = stops.map((s) => {
    const value = s.stay_min;
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 60;
  });
  const isFood = (s) => s.category === 'food' && s.cafe_not_meal !== true && s._blockMealRole !== 'cafe';
  const isCafe = (s) => s.category === 'cafe' || s.cafe_not_meal === true || s._blockMealRole === 'cafe';
  const roleOptions = stops.map((s) => {
    if (!isFood(s)) return [{ role: null, mask: 0, from: ready, to: endOfTour - 1 }];
    if (s._blockMealRole === 'breakfast') return [{ role: 'breakfast', mask: 4, from: Math.max(ready, 360), to: Math.min(659, endOfTour - 1) }];
    const open = ['lunch', 'dinner'].filter((r) => windows[r] && Number.isFinite(windows[r].from) && Number.isFinite(windows[r].to));
    const preferred = s._blockMealRole;
    const roles = open.includes(preferred) ? [preferred] : open;
    return roles.map((role) => ({ role, mask: role === 'lunch' ? 1 : 2, from: Math.max(ready, windows[role].from), to: windows[role].to }));
  });
  const leg = (a, b) => {
    const value = Number(options.transitMinutes(a, b));
    if (value === Infinity) return Infinity;
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const popcount = (mask) => { let count = 0; for (; mask; mask &= mask - 1) count++; return count; };
  const score = (mask, covered) => {
    let legacy = 0, visits = 0, cafes = 0, foods = 0;
    stops.forEach((s, i) => {
      if (!(mask & (1 << i))) return;
      if (isCafe(s)) cafes++;
      else if (isFood(s)) foods++;
      else { visits++; if (s._day1LegacyPriority === true) legacy++; }
    });
    return [popcount(covered & 3), legacy, visits, cafes, foods, popcount(mask)];
  };
  const compare = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };
  const lexBefore = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i];
    return a.length < b.length;
  };
  const memo = new Map();
  let explored = 0, exhausted = false, best = null;
  const visit = (mask, last, time, covered, indices, starts, roles) => {
    if (++explored > maxStates) { exhausted = true; return; }
    const key = `${mask}:${last}:${covered}`;
    const prev = memo.get(key);
    if (prev && (prev.time < time || (prev.time === time && !lexBefore(indices, prev.indices)))) return;
    memo.set(key, { time, indices });
    const arrivalAtTerminal = terminal ? (last < 0 ? ready : time + Number(terminal.transitMinutes(last) || 0) + buffer) : time;
    const returnMin = !terminal && last >= 0 ? Number(options.returnMinutes ? options.returnMinutes(last) : 0) : 0;
    const terminalFits = terminal ? arrivalAtTerminal <= terminal.time && ready <= terminal.time : time + returnMin < 1440;
    if ((covered & required) === required && (!options.atLeastOneMeal || covered !== 0) && (mask & mustKeep) === mustKeep && terminalFits) {
      const quality = score(mask, covered);
      const cmp = best ? compare(quality, best.quality) : 1;
      if (!best || cmp > 0 || (cmp === 0 && (time + returnMin < best.finish || (time + returnMin === best.finish && lexBefore(indices, best.indices))))) {
        best = { indices: [...indices], starts: [...starts], roles: [...roles], covered, quality, finish: time + returnMin };
      }
    }
    for (let i = 0; i < n && !exhausted; i++) {
      if (mask & (1 << i)) continue;
      if (options.fixedOrder && options.fixedOrder[indices.length] !== i) continue;
      const arrival = last < 0 ? ready : time + leg(last, i) + buffer;
      for (const role of roleOptions[i]) {
        if (role.mask && (covered & role.mask)) continue; // Alternatives are choices for one meal slot, not extra meals.
        const start = Math.max(arrival, role.from);
        const end = start + stay[i];
        if (start > role.to || start >= 1440 || end > deadline || end >= 1440) continue;
        visit(mask | (1 << i), i, end, covered | role.mask, [...indices, i], [...starts, start], [...roles, role.role]);
      }
    }
  };
  visit(0, -1, ready, 0, [], [], []);
  if (exhausted) return { status: 'budget_exhausted', explored, best };
  if (!best) return { status: 'proven_infeasible', explored };
  const selected = new Set(best.indices);
  return { status: 'feasible', ...best, removedIndices: stops.map((_, i) => i).filter((i) => !selected.has(i)), explored };
}
