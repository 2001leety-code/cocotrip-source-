/**
 * Phase 4 — 3-pass A/B test mode decider.
 *
 * Resolves whether a single planner invocation should run the legacy 1-pass
 * pipeline or the 3-pass pipeline (api/_ai_core/threePassPipeline.js).
 *
 * Decision precedence (highest to lowest):
 *   1. PLANNER_MODE env var == '3pass'  → force all requests to 3-pass.
 *      (Used when operator is ready to flip the whole population.)
 *   2. PLANNER_MODE env var == 'legacy' AND PLANNER_AB_3PASS_PCT unset (or 0)
 *                                       → all requests use legacy.
 *   3. PLANNER_AB_3PASS_PCT integer in [1, 100] → hash-based bucketing per
 *      user identifier. PCT% of distinct identifiers map to 3-pass,
 *      remainder map to legacy. Same identifier always lands in the same
 *      bucket (deterministic — required so a user does not flip mode mid-
 *      revision; revisions of an existing plan inherit original bucket).
 *
 * Hash function: SHA-256 of identifier → first 8 hex chars → parse as
 * unsigned int → mod 100. Yields a near-uniform distribution across 0-99.
 * For PCT=10, ~10% of identifiers (bucket < 10) map to 3-pass.
 *
 * Identifier selection (in order, first non-empty wins):
 *   uid > guestEmail > sessionId
 * All inputs are normalized (trim + lowercase) so trivial whitespace/case
 * differences do not split a single user across buckets.
 *
 * SAFETY-CRITICAL (CLAUDE.md J): mode decision has NO bearing on dietary
 * validation. Both 1-pass and 3-pass pipelines run validateResponse() and
 * hasCriticalDietaryViolation() identically (see geminiPipeline.js).
 *
 * @module api/_ai_core/plannerMode
 */
import { createHash } from 'node:crypto';

const VALID_MODES = new Set(['legacy', '3pass']);

/**
 * Parse PLANNER_AB_3PASS_PCT env value into a sanitized integer in [0, 100].
 * Non-integer / negative / > 100 inputs collapse to 0 (treat as disabled).
 *
 * @param {string|undefined} raw
 * @returns {number} integer 0-100
 */
export function parsePct(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/**
 * Pick a stable identifier from the three possible inputs. Returns the
 * normalized identifier (trim + lowercase) or null if nothing usable.
 *
 * @param {object} ids
 * @param {string|null} [ids.uid]         Firebase auth uid (preferred).
 * @param {string|null} [ids.guestEmail]  Authenticated email (next best).
 * @param {string|null} [ids.sessionId]   Anonymous session id (last resort).
 * @returns {string|null}
 */
export function pickIdentifier({ uid, guestEmail, sessionId } = {}) {
  for (const raw of [uid, guestEmail, sessionId]) {
    if (typeof raw === 'string') {
      const v = raw.trim().toLowerCase();
      if (v) return v;
    }
  }
  return null;
}

/**
 * Hash an identifier to a uniform integer in [0, 99]. Deterministic — same
 * identifier always yields the same bucket. Used internally by
 * `decidePlannerMode`; exported for unit-test introspection.
 *
 * @param {string} identifier  Already-normalized (trim + lowercase).
 * @returns {number} integer 0-99
 */
export function bucketFor(identifier) {
  const h = createHash('sha256').update(identifier, 'utf8').digest('hex');
  const head = h.slice(0, 8);              // 32-bit hex
  const n = Number.parseInt(head, 16);     // 0..2^32-1
  return n % 100;                          // uniform-ish 0-99
}

/**
 * Decide which planner pipeline to run for this request.
 *
 * @param {object} args
 * @param {string|null} [args.uid]
 * @param {string|null} [args.guestEmail]
 * @param {string|null} [args.sessionId]
 * @param {boolean}     [args.isAdminBypass]  P102 (2026-05-20): admin Test Mode
 *                                            (ADMIN-BYPASS-* orderId) → always
 *                                            'legacy'. 3-pass 는 Pass1+Pass2+
 *                                            Pass3 로 90-150s + retry 시 5분
 *                                            cap 도달 → Test Mode 5min timeout.
 *                                            Test Mode 의 목적은 빠른 happy-path
 *                                            검증이라 A/B bucketing 면역 필요.
 * @param {object}      [args.env]            Optional env override (for tests).
 *                                            Defaults to process.env.
 * @returns {{ mode: 'legacy'|'3pass', reason: string, bucket: number|null }}
 *   - mode:   final pipeline to run
 *   - reason: human-readable trace (logged for analytics — e.g.
 *             'env-override', 'pct-bucketing', 'no-identifier-fallback',
 *             'admin-bypass-force-legacy')
 *   - bucket: assigned bucket [0, 99] when hash-bucketed, else null
 */
export function decidePlannerMode({ uid, guestEmail, sessionId, isAdminBypass, env } = {}) {
  // Precedence 0 (P102): ADMIN-BYPASS- orderId → force legacy regardless of
  // env override or A/B bucketing. Customer flow (no admin bypass) unaffected.
  if (isAdminBypass) {
    return { mode: 'legacy', reason: 'admin-bypass-force-legacy', bucket: null };
  }

  const envSource = env || process.env;
  const rawMode = String(envSource.PLANNER_MODE || '').trim().toLowerCase();
  const pct = parsePct(envSource.PLANNER_AB_3PASS_PCT);

  // Precedence 1: PLANNER_MODE='3pass' forces 3pass for everyone.
  if (rawMode === '3pass') {
    return { mode: '3pass', reason: 'env-override-3pass', bucket: null };
  }

  // Precedence 2: PLANNER_MODE='legacy' (or any non-3pass value) + PCT=0 → legacy.
  if (pct === 0) {
    return { mode: 'legacy', reason: 'ab-disabled', bucket: null };
  }

  // Precedence 3: hash-based bucketing.
  const id = pickIdentifier({ uid, guestEmail, sessionId });
  if (!id) {
    // No stable identifier (rare — verifyUserToken guarantees an email, but
    // guards against future regressions). Fall back to legacy.
    return { mode: 'legacy', reason: 'no-identifier-fallback', bucket: null };
  }

  const bucket = bucketFor(id);
  const mode = bucket < pct ? '3pass' : 'legacy';
  return { mode, reason: 'pct-bucketing', bucket };
}

/**
 * Validate a free-form mode string and return only canonical values.
 * Anything outside the allowed set collapses to 'legacy' (safe default).
 *
 * @param {string} mode
 * @returns {'legacy'|'3pass'}
 */
export function normalizeMode(mode) {
  const v = String(mode || '').trim().toLowerCase();
  return VALID_MODES.has(v) ? v : 'legacy';
}
