import { afterEach, describe, expect, it, vi } from 'vitest';

const { alert } = vi.hoisted(() => ({ alert: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: alert }));
import { createMealDraftHandler } from '../../api/meal-plan-draft.js';
import { createPlanMealOptionsHandler } from '../../api/plan-meal-options.js';

const response = () => ({ writeHead: vi.fn(), end: vi.fn() });
const policy = { readIpLimit: 1, expensiveIpLimit: 1, actorLimit: 1, routeQueryLimit: 1 };

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('meal endpoint hang warnings', () => {
  it.each([
    ['draft', () => createMealDraftHandler({ authenticate: async () => ({ ok: false }) }), { method: 'POST' }, 401],
    ['options', () => createPlanMealOptionsHandler(), { method: 'GET' }, 405],
  ])('%s clears its timer on early return', async (_name, factory, req, code) => {
    vi.useFakeTimers();
    const res = response();
    await factory()(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(code, expect.anything());
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(150000);
    expect(alert).not.toHaveBeenCalled();
  });
  it.each(['draft', 'options'])('%s warns after 150 seconds with only stage and elapsed time and clears the timer', async kind => {
    vi.useFakeTimers();
    let resolveStep!: (value: unknown) => void;
    const pending = new Promise(resolve => { resolveStep = resolve; });
    const res = response();
    const handler = kind === 'draft'
      ? createMealDraftHandler({ authenticate: () => pending })
      : createPlanMealOptionsHandler({ db: { collection: () => ({ doc: () => ({ get: () => pending }) }) }, executionPolicy: policy, checkRateLimit: async () => ({ ok: true }) });
    const req = kind === 'draft' ? { method: 'POST' } : { method: 'POST', body: { planId: 'private-plan', action: 'load' } };
    const result = handler(req, res);
    await vi.advanceTimersByTimeAsync(150000);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(expect.objectContaining({ channel: 'admin', message: `${kind === 'draft' ? 'meal-plan-draft step=authenticate' : 'plan-meal-options step=load-plan'} elapsedMs=150000` }));
    resolveStep(kind === 'draft' ? { ok: false } : { exists: false });
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
