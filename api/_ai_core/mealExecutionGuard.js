import { createHash } from 'node:crypto';
import { checkIpRateLimit, getClientIp } from '../_shared/ip-rate-limit.js';

const fields = {
  readIpLimit: 'MEAL_VERIFICATION_READ_IP_LIMIT',
  expensiveIpLimit: 'MEAL_VERIFICATION_EXPENSIVE_IP_LIMIT',
  actorLimit: 'MEAL_VERIFICATION_ACTOR_LIMIT',
  routeQueryLimit: 'MEAL_VERIFICATION_ROUTE_QUERY_LIMIT',
};
const validLimit = value => Number.isSafeInteger(value) && value > 0;
const invalidPolicy = () => ({ status: 'policy_unconfigured', policy: null });

export function readMealExecutionPolicy(env = process.env) {
  const policy = {};
  for (const [field, key] of Object.entries(fields)) {
    const value = env[key];
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return invalidPolicy();
    const number = Number(value);
    if (!validLimit(number)) return invalidPolicy();
    policy[field] = number;
  }
  return { status: 'ok', policy };
}

export async function checkMealExecutionRate({ req, db, phase, actorKey, policy, checkRate = checkIpRateLimit }) {
  if (!policy || !Object.keys(fields).every(key => validLimit(policy[key])) || !['read', 'expensive'].includes(phase)) {
    return { ok: false, status: 503, reason: 'policy_unconfigured', retryAfterSec: null };
  }
  if (!req || (phase === 'expensive' && (typeof actorKey !== 'string' || !actorKey.trim()))) {
    return { ok: false, status: 503, reason: 'rate_limit_unavailable', retryAfterSec: null };
  }
  const ip = getClientIp(req);
  const buckets = [{ ip, collection: `meal_verification_${phase}_ip_limits`, maxRequests: phase === 'read' ? policy.readIpLimit : policy.expensiveIpLimit }];
  if (phase === 'expensive') {
    const actorHash = createHash('sha256').update(actorKey).digest('hex');
    buckets.push({ ip: actorHash, collection: 'meal_verification_actor_limits', maxRequests: policy.actorLimit });
  }
  try {
    for (const bucket of buckets) {
      const result = await checkRate({ db, ...bucket });
      if (!result || result.degraded || typeof result.ok !== 'boolean') return { ok: false, status: 503, reason: 'rate_limit_unavailable', retryAfterSec: null };
      if (!result.ok) {
        if (result.status !== 429) return { ok: false, status: 503, reason: 'rate_limit_unavailable', retryAfterSec: null };
        return { ok: false, status: 429, reason: 'rate_limited', retryAfterSec: result.retryAfterSec || null };
      }
    }
  } catch {
    return { ok: false, status: 503, reason: 'rate_limit_unavailable', retryAfterSec: null };
  }
  return { ok: true, status: 200, reason: null, retryAfterSec: null };
}

// Counts logical route queries, not downstream HTTP calls made by a route provider.
export function createMealRouteBudget(limit) {
  if (!validLimit(limit)) throw new TypeError('A positive integer route query limit is required');
  let used = 0;
  let exceeded = false;
  const assert = () => {
    if (used >= limit) {
      exceeded = true;
      const error = new Error('Meal route query budget exhausted');
      error.code = 'MEAL_ROUTE_BUDGET_EXHAUSTED';
      throw error;
    }
  };
  return {
    consume() { assert(); used += 1; },
    assert,
    assertNotExceeded() { if (exceeded) { const error = new Error('Meal route query budget exhausted'); error.code = 'MEAL_ROUTE_BUDGET_EXHAUSTED'; throw error; } },
    get used() { return used; },
  };
}
