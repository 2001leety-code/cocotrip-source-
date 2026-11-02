import { describe, expect, it, vi } from 'vitest';
import { checkMealExecutionRate, createMealRouteBudget, readMealExecutionPolicy } from '../../api/_ai_core/mealExecutionGuard.js';

const env = {
  MEAL_VERIFICATION_READ_IP_LIMIT: '10',
  MEAL_VERIFICATION_EXPENSIVE_IP_LIMIT: '3',
  MEAL_VERIFICATION_ACTOR_LIMIT: '2',
  MEAL_VERIFICATION_ROUTE_QUERY_LIMIT: '1',
};
const policy = { readIpLimit: 10, expensiveIpLimit: 3, actorLimit: 2, routeQueryLimit: 1 };
const req = { headers: { 'x-forwarded-for': '192.0.2.1, 192.0.2.2' } };

describe('meal execution guard', () => {
  it('requires all four explicit positive safe integer settings', () => {
    expect(readMealExecutionPolicy(env)).toEqual({ status: 'ok', policy });
    for (const value of [undefined, '', '0', '-1', '1.5', ' 1', '1e3', '9007199254740992']) {
      expect(readMealExecutionPolicy({ ...env, MEAL_VERIFICATION_ROUTE_QUERY_LIMIT: value })).toEqual({ status: 'policy_unconfigured', policy: null });
    }
    expect(readMealExecutionPolicy({})).toEqual({ status: 'policy_unconfigured', policy: null });
  });
  it('uses one shared expensive IP bucket and a hashed actor bucket; reads use a separate IP bucket', async () => {
    const checkRate = vi.fn().mockResolvedValue({ ok: true });
    const run = (phase, actorKey) => checkMealExecutionRate({ req, db: {}, phase, actorKey, policy, checkRate });
    expect((await run('expensive', 'person-a')).ok).toBe(true);
    expect((await run('expensive', 'person-b')).ok).toBe(true);
    expect((await run('read', 'person-a')).ok).toBe(true);
    const calls = checkRate.mock.calls.map(([args]) => args);
    expect(calls[0]).toMatchObject({ ip: '192.0.2.1', collection: 'meal_verification_expensive_ip_limits', maxRequests: 3 });
    expect(calls[2]).toMatchObject({ ip: calls[0].ip, collection: calls[0].collection });
    expect(calls[1]).toMatchObject({ collection: 'meal_verification_actor_limits', maxRequests: 2 });
    expect(calls[1].ip).toMatch(/^[a-f0-9]{64}$/);
    expect(calls[1].ip).not.toBe('person-a');
    expect(calls[3].ip).not.toBe(calls[1].ip);
    expect(calls[4]).toMatchObject({ ip: calls[0].ip, collection: 'meal_verification_read_ip_limits', maxRequests: 10 });
  });
  it('fails closed for missing policy, degraded storage, thrown errors, and missing actor', async () => {
    const checkRate = vi.fn().mockResolvedValue({ ok: true, degraded: true });
    expect(await checkMealExecutionRate({ req, db: {}, phase: 'read', policy: null, checkRate })).toMatchObject({ ok: false, status: 503, reason: 'policy_unconfigured' });
    expect(checkRate).not.toHaveBeenCalled();
    expect(await checkMealExecutionRate({ req, db: {}, phase: 'read', policy, checkRate })).toMatchObject({ ok: false, status: 503, reason: 'rate_limit_unavailable' });
    checkRate.mockRejectedValueOnce(new Error('unavailable'));
    expect(await checkMealExecutionRate({ req, db: {}, phase: 'read', policy, checkRate })).toMatchObject({ ok: false, status: 503, reason: 'rate_limit_unavailable' });
    expect(await checkMealExecutionRate({ req, db: {}, phase: 'expensive', policy, checkRate })).toMatchObject({ ok: false, status: 503, reason: 'rate_limit_unavailable' });
  });
  it('propagates rate exhaustion from either bucket', async () => {
    const limit = { ok: false, status: 429, retryAfterSec: 38 };
    const checkRate = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(limit);
    expect(await checkMealExecutionRate({ req, db: {}, phase: 'expensive', actorKey: 'person-a', policy, checkRate })).toEqual({ ok: false, status: 429, reason: 'rate_limited', retryAfterSec: 38 });
    checkRate.mockResolvedValueOnce(limit);
    expect(await checkMealExecutionRate({ req, db: {}, phase: 'read', policy, checkRate })).toMatchObject({ ok: false, status: 429, retryAfterSec: 38 });
  });
  it('allows one logical route query and raises a typed code on the next', () => {
    const budget = createMealRouteBudget(1);
    budget.assert();
    budget.consume();
    expect(budget.used).toBe(1);
    expect(() => budget.consume()).toThrowError(expect.objectContaining({ code: 'MEAL_ROUTE_BUDGET_EXHAUSTED' }));
    expect(budget.used).toBe(1);
    expect(() => createMealRouteBudget(0)).toThrow(TypeError);
  });
});
