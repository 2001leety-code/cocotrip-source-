import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ serve: vi.fn(), send: vi.fn(), alert: vi.fn() }));
vi.mock('inngest/node', () => ({ serve: () => effects.serve }));
vi.mock('../../api/_inngest/client.js', () => ({ inngest: { send: effects.send }, isInngestConfigured: () => true, INNGEST_EVENTS: { PLAN_AI_COMPLETE: 'plan/ai.complete' } }));
vi.mock('../../api/_inngest/functions/processPlanAfterAI.js', () => ({ processPlanAfterAI: {} }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: effects.alert }));
import handler from '../../api/inngest.js';
import { publishPlanAiComplete, shouldDispatchToInngest } from '../../api/_ai_core/inngestDispatch.js';
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'true'); });
afterEach(() => vi.unstubAllEnvs());
describe('isolated Preview worker boundaries', () => {
  it.each(['GET', 'POST', 'PUT'])('denies %s before SDK invocation, timers or alerts', async method => {
    const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    await handler({ method }, res);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ ok: false, code: 'PREVIEW_WORKER_DISABLED' });
    expect(effects.serve).not.toHaveBeenCalled(); expect(effects.alert).not.toHaveBeenCalled();
  });
  it('prevents direct publication and keeps normal Preview planning inline', async () => {
    expect(shouldDispatchToInngest()).toBe(false);
    await expect(publishPlanAiComplete({ planId: 'fixture' })).rejects.toMatchObject({ code: 'PREVIEW_WORKER_DISABLED' });
    expect(effects.send).not.toHaveBeenCalled(); expect(effects.alert).not.toHaveBeenCalled();
  });
  it('preserves production worker serving and publishing using mocks only', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    await handler({ method: 'POST' }, {});
    await publishPlanAiComplete({ planId: 'fixture' });
    expect(effects.serve).toHaveBeenCalledTimes(1); expect(effects.send).toHaveBeenCalledTimes(1);
  });
});
