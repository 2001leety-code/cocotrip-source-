/**
 * Ordered same-person PostHog funnel — pure query builder + response
 * normalizer + invariant validator (2026-08-24).
 *
 * Replaces the old 4-step `plan_generated`-based funnel. Semantics:
 *
 *   wizard_seen -> preview_success -> payment_started(planType=ai-planner-full)
 *     -> payment_completed(planType=ai-planner-full) -> planner_complete
 *
 * A person only counts at step N if steps 1..N all happened, for THAT person,
 * in non-decreasing timestamp order. `plan_generated` is intentionally absent
 * (removed from this funnel) and tour/other purchases are excluded by the
 * `properties.planType = 'ai-planner-full'` filter on the two payment steps.
 *
 * Why HogQL is written this way (not a chained series of independent uniq()
 * counts, which is what the old funnel did): each step's countIf() condition
 * is a strict AND-extension of the previous step's condition, so c1>=c2>=c3
 * >=c4>=c5 holds structurally, by construction — not by luck of the data.
 * `validateOrderedFunnel` re-checks this server-side anyway (PostHog response
 * parsing can still produce garbage) rather than trusting the query shape.
 *
 * Every function here is pure (no fetch, no env, no Date.now/now default
 * side effects beyond the explicit `now` param) so tests can inspect the
 * generated SQL string and normalizer/validator behavior without hitting
 * PostHog.
 */
import { escapeHogQLString } from './posthog-host.js';

/** Bump this if the step sequence, ordering rule, or planType scoping changes. */
export const SEMANTICS_VERSION = 'ordered-same-person-v1';

/** Only plan type this funnel measures — excludes charter/tour/other purchases. */
export const PLAN_TYPE = 'ai-planner-full';

export const FUNNEL_STEP_DEFS = [
  { id: 'wizard_seen', label: '위저드 노출' },
  { id: 'preview_success', label: '미리보기 생성 성공' },
  { id: 'payment_started', label: '결제 시작 (AI 플래너)' },
  { id: 'payment_completed', label: '결제 완료 (AI 플래너)' },
  { id: 'planner_complete', label: '플랜 생성 완료' },
];

/**
 * Clamp `days` to [1, 366] and derive an explicit [windowStart, windowEnd) as ISO strings.
 * Missing/non-numeric input defaults to 30; an explicit out-of-range number (including 0)
 * clamps to the nearest bound instead of silently falling back to the default.
 */
export function buildFunnelWindow(days, now = new Date()) {
  const hasValue = days !== undefined && days !== null && days !== '';
  const n = Number(days);
  const base = hasValue && Number.isFinite(n) ? n : 30;
  const d = Math.max(1, Math.min(366, base));
  const windowEnd = new Date(now.getTime());
  const windowStart = new Date(windowEnd.getTime() - d * 24 * 60 * 60 * 1000);
  return { days: d, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() };
}

function dt(iso) {
  return `toDateTime('${escapeHogQLString(iso)}')`;
}

/**
 * Per-person first-occurrence timestamp of each step, then a chronological
 * chain check (`tN >= tN-1`) baked into each subsequent countIf(). Same
 * person_id across all five columns (single row per person, single events
 * table scan) — that IS the "same-person" guarantee, not a join.
 */
export function buildOrderedFunnelSQL(windowStartISO, windowEndISO, planType = PLAN_TYPE) {
  const pt = escapeHogQLString(planType);
  return `WITH steps AS (
  SELECT
    person_id,
    minIf(timestamp, event = 'wizard_seen') AS t1,
    minIf(timestamp, event = 'preview_success') AS t2,
    minIf(timestamp, event = 'payment_started' AND properties.planType = '${pt}') AS t3,
    minIf(timestamp, event = 'payment_completed' AND properties.planType = '${pt}') AS t4,
    minIf(timestamp, event = 'planner_complete') AS t5
  FROM events
  WHERE event IN ('wizard_seen', 'preview_success', 'payment_started', 'payment_completed', 'planner_complete')
    AND timestamp >= ${dt(windowStartISO)}
    AND timestamp < ${dt(windowEndISO)}
  GROUP BY person_id
)
SELECT
  countIf(t1 IS NOT NULL) AS c1,
  countIf(t1 IS NOT NULL AND t2 IS NOT NULL AND t2 >= t1) AS c2,
  countIf(t1 IS NOT NULL AND t2 IS NOT NULL AND t2 >= t1 AND t3 IS NOT NULL AND t3 >= t2) AS c3,
  countIf(t1 IS NOT NULL AND t2 IS NOT NULL AND t2 >= t1 AND t3 IS NOT NULL AND t3 >= t2 AND t4 IS NOT NULL AND t4 >= t3) AS c4,
  countIf(t1 IS NOT NULL AND t2 IS NOT NULL AND t2 >= t1 AND t3 IS NOT NULL AND t3 >= t2 AND t4 IS NOT NULL AND t4 >= t3 AND t5 IS NOT NULL AND t5 >= t4) AS c5
FROM steps`;
}

/** Most recent matching event in the window, for the UI's "data as of" display. */
export function buildLatestEventSQL(windowStartISO, windowEndISO, planType = PLAN_TYPE) {
  const pt = escapeHogQLString(planType);
  return `SELECT max(timestamp) AS latest FROM events
WHERE timestamp >= ${dt(windowStartISO)}
  AND timestamp < ${dt(windowEndISO)}
  AND (
    event IN ('wizard_seen', 'preview_success', 'planner_complete')
    OR (event IN ('payment_started', 'payment_completed') AND properties.planType = '${pt}')
  )`;
}

/** rows = PostHog `results` (array of arrays). Returns 5 labeled steps, or null if malformed. */
export function normalizeFunnelCounts(rows) {
  const row = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : null;
  if (!row || row.length < FUNNEL_STEP_DEFS.length) return null;
  return FUNNEL_STEP_DEFS.map((def, i) => ({
    id: def.id,
    label: def.label,
    count: Number(row[i]),
  }));
}

/** rows = PostHog `results` for buildLatestEventSQL. Returns ISO string or null. */
export function normalizeLatestEventAt(rows) {
  const row = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : null;
  const raw = row ? row[0] : null;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Reject rather than present false data: wrong step count/order, non-integer
 * or negative counts, or a downstream step exceeding its upstream step.
 */
export function validateOrderedFunnel(steps) {
  if (!Array.isArray(steps) || steps.length !== FUNNEL_STEP_DEFS.length) {
    return { ok: false, reason: 'STEP_COUNT_MISMATCH' };
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const def = FUNNEL_STEP_DEFS[i];
    if (!step || step.id !== def.id) return { ok: false, reason: 'STEP_ORDER_MISMATCH' };
    if (!Number.isInteger(step.count) || step.count < 0) return { ok: false, reason: 'INVALID_COUNT' };
  }
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].count > steps[i - 1].count) return { ok: false, reason: 'NONMONOTONIC' };
  }
  return { ok: true, reason: null };
}
