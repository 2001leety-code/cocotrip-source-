import { throttledTelegramAlert } from './_shared/telegram-throttle.js';
import { readMealExecutionPolicy, checkMealExecutionRate, createMealRouteBudget } from './_ai_core/mealExecutionGuard.js';
import { randomUUID } from 'node:crypto';
import { initAdminDb } from './_shared/firebase-admin.js';
import { verifyMealActor } from './_ai_core/mealActor.js';
import { loadMealFoodRows } from './_ai_core/mealFoodRows.js';
import { createMealRouteProvider } from './_ai_core/mealRouteProvider.js';
import { createMealPlanService, mealPlanRevision, mealDatabaseVersion } from './_ai_core/mealPlanIntegration.js';

export const maxDuration = 180;
const HANG_WARN_MS = (maxDuration - 30) * 1000;
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (res, status, data) => { res.writeHead(status, { ...headers, ...(data.retryAfterSec ? { 'Retry-After': String(data.retryAfterSec) } : {}) }); res.end(JSON.stringify(data)); };

// Dependencies may be supplied only by server tests, never through a request body.
export function createPlanMealOptionsHandler(overrides = {}) {
  return async function handler(req, res) {
    let currentStep = 'request', currentStepStart = Date.now();
    async function withStep(label, fn) {
      const previousStep = currentStep, previousStart = currentStepStart;
      currentStep = label; currentStepStart = Date.now();
      console.log(`[plan-meal-options] step=${label} ENTER`);
      try { return await fn(); }
      finally {
        console.log(`[plan-meal-options] step=${label} END ${Date.now() - currentStepStart}ms`);
        currentStep = previousStep; currentStepStart = previousStart;
      }
    }
    const hangWarnTimer = setTimeout(() => {
      const elapsedMs = Date.now() - currentStepStart;
      throttledTelegramAlert({ key: 'plan-meal-options-hang', channel: 'admin', severity: 'high',
        message: `plan-meal-options step=${currentStep} elapsedMs=${elapsedMs}` }).catch(() => {});
    }, HANG_WARN_MS);
    hangWarnTimer.unref?.();
    try {
    if (req.method !== 'POST') return reply(res, 405, { ok: false, status: 'method_not_allowed' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      if (typeof body.planId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(body.planId)
          || !['load', 'preview', 'commit', 'edit', 'validate_draft', 'snapshot'].includes(body.action)) return reply(res, 400, { ok: false, status: 'invalid_request' });
      const db = overrides.db || initAdminDb();
      if (!db) return reply(res, 503, { ok: false, status: 'storage_unavailable' });
      const policy = overrides.executionPolicy || readMealExecutionPolicy().policy;
      const guard = overrides.checkRateLimit || checkMealExecutionRate;
      const readRate = await withStep('read-rate-limit', () => guard({ req, db, phase: 'read', policy }));
      if (!readRate.ok) return reply(res, readRate.status, { ok: false, status: readRate.reason, retryAfterSec: readRate.retryAfterSec });
      const ref = db.collection('plans').doc(body.planId);
      const snap = await withStep('load-plan', () => ref.get());
      if (!snap.exists) return reply(res, 404, { ok: false, status: 'not_found' });
      const plan = snap.data();
      const auth = await withStep('authenticate', () => (overrides.authenticate || verifyMealActor)(req));
      const owner = (auth.ok && !!plan.uid && plan.uid === auth.uid)
        || (typeof body.token === 'string' && !!plan.accessToken && body.token === plan.accessToken);
      if (!owner && !(body.action === 'load' && plan.isPublic === true)) return reply(res, 403, { ok: false, status: 'forbidden' });
      if (plan.itinerary?.meal_options_version !== 1) return reply(res, 409, { ok: false, status: 'legacy_plan' });
      if (!owner && body.action === 'load') {
        return reply(res, 200, { ok: true, revision: mealPlanRevision(plan), meals: (plan.itinerary.meal_options || []).map((meal) => ({
          mealId: meal.mealId, day: meal.day, status: meal.status, baselineId: meal.baselineId || null, selectedId: meal.selectedId || null,
          options: (meal.options || []).slice(0, 3).map((option) => ({ id: option.id, name: option.name,
            verificationStatus: option.verificationStatus, startMin: option.startMin, endMin: option.endMin, inboundMin: option.inboundMin, outboundMin: option.outboundMin, sourceUrl: option.sourceUrl || null, checkedAt: option.checkedAt || null,
            repeatReason: option.repeatReason || null })),
        })) });
      }
      if (body.action === 'snapshot') return reply(res, 200, { ok: true, plan: { ...plan, planId: body.planId } });
      const expensiveRate = await withStep('expensive-rate-limit', () => guard({ req, db, phase: 'expensive', actorKey: auth.ok ? `uid:${auth.uid}` : `plan:${body.planId}`, policy }));
      if (!expensiveRate.ok) return reply(res, expensiveRate.status, { ok: false, status: expensiveRate.reason, retryAfterSec: expensiveRate.retryAfterSec });
      const routeBudget = createMealRouteBudget(policy?.routeQueryLimit || 64);
      let savedPlan = null;
      const rows = await withStep('load-rows', () => (overrides.loadRows || loadMealFoodRows)());
      const dbVersion = mealDatabaseVersion(rows);
      const repository = {
        async load() {
          const current = await ref.get();
          if (!current.exists) return null;
          const value = current.data();
          const allowed = (auth.ok && !!value.uid && value.uid === auth.uid) || (typeof body.token === 'string' && !!value.accessToken && body.token === value.accessToken);
          if (!allowed) throw Object.assign(new Error('ownership_changed'), { code: 'ownership_changed' });
          return { ...value, planId: body.planId };
        },
        async compareAndSave(expected, proposal) {
          return db.runTransaction(async (tx) => {
            const current = await tx.get(ref);
            if (!current.exists || expected.planId !== body.planId || expected.dbVersion !== dbVersion
                || mealPlanRevision(current.data()) !== expected.revision) return false;
            const currentPlan = current.data();
            const stillOwner = (auth.ok && !!currentPlan.uid && currentPlan.uid === auth.uid)
              || (typeof body.token === 'string' && !!currentPlan.accessToken && currentPlan.accessToken === body.token);
            if (!stillOwner) return false;
            const revision = randomUUID();
            const saved = { ...proposal.itinerary, meal_options_version: 1 };
            if (proposal.mealId) saved.meal_options = (saved.meal_options || []).map((meal) => meal.mealId === proposal.mealId
              ? { ...meal, selectedId: proposal.selectedId } : meal);
            const update = { itinerary: JSON.parse(JSON.stringify(saved)), mealOptionsRevision: revision, mealOptionsDbVersion: dbVersion, edited: true, lastEditedAt: Date.now() };
            tx.update(ref, update);
            savedPlan = { ...currentPlan, ...update, planId: body.planId };
            return true;
          });
        },
      };
      const route = createMealRouteProvider(overrides.route, routeBudget);
      const service = createMealPlanService({ repository, rows, route, ...(overrides.opening ? { opening: overrides.opening } : {}) });
      if (body.action === 'load') return reply(res, 200, await withStep('service-load', () => service.load()));
      if (body.action === 'validate_draft') return reply(res, 200, { ok: true, ...await withStep('validate-draft', () => service.validateDraft()) });
      if (body.action === 'edit') {
        if (!Array.isArray(body.days)) return reply(res, 400, { ok: false, status: 'invalid_days' });
        const result = await withStep('edit', () => service.validateEdit(body.days, body.baseRevision));
        return reply(res, result.status === 'saved' ? 200 : 422, { ok: true, ...result, ...(result.status === 'saved' && savedPlan ? { plan: savedPlan } : {}) });
      }
      const result = await withStep('select', () => service.select({ action: body.action, mealId: body.mealId,
        candidateId: body.candidateId, baseRevision: body.baseRevision, proposalId: body.proposalId,
        confirmedProposalId: body.confirmedProposalId }));
      return reply(res, 200, { ...result, ...(result.status === 'saved' && savedPlan ? { plan: savedPlan } : {}) });
    } catch (error) {
      console.error('[plan-meal-options]', error?.code || error?.name || 'error');
      return reply(res, 500, { ok: false, status: 'verification_failed' });
    } finally { clearTimeout(hangWarnTimer); }
  };
}
export default createPlanMealOptionsHandler();
