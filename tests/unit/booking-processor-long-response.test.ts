import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { triggerBookingProcessor } from '../../api/_shared/booking-processor-trigger.js';

let db: ReturnType<typeof createFakeFirestore>;
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));
vi.mock('../../api/_shared/cron-auth.js', () => ({ verifyCronRequest: async () => ({ ok: true }) }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));
import sweep from '../../api/_crons/processor-retry-sweep.js';

const ORDER = 'LONG-RESPONSE-ORDER';
const PRIVATE = 'private-buyer@example.invalid';
const path = `pending_processor_retries/${ORDER}`;
const steps = (loyalty: string) => ({ sheets: 'completed', email: 'completed', loyalty });
function responseBody(outcome: string, stepStatus = steps('completed')) {
  // The contract fields come after the old 1,200-character parsing cutoff.
  return JSON.stringify({ data: { memo: `${'x'.repeat(1600)}${PRIVATE}`, stepStatus }, outcome });
}
async function trigger(body: string, status = 200, notify = vi.fn(async () => {})) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status })));
  return triggerBookingProcessor({ db, siteUrl: 'https://offline.invalid', payload: { orderID: ORDER }, notify });
}
beforeEach(() => {
  db = createFakeFirestore({});
  vi.stubEnv('VERCEL_ENV', 'production');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('full response classification with bounded diagnostics', () => {
  it.each([
    ['completed', 'completed', undefined],
    ['completed', 'skipped_not_applicable', undefined],
    ['retryable', 'retryable', 'pending'],
    ['failed_permanent', 'failed_permanent', 'permanent-failure'],
    ['manual_intervention', 'outcome_unknown', 'manual-intervention'],
  ])('long %s / loyalty=%s keeps its semantic result', async (outcome, loyalty, status) => {
    const stepStatus = steps(loyalty);
    const result = await trigger(responseBody(outcome, stepStatus));
    expect(result.outcome).toBe(outcome);
    expect(result.ok).toBe(outcome === 'completed');
    if (status) {
      expect(db.__get(path)).toMatchObject({ status, outcome, stepStatus });
      expect(result.retryable).toBe(outcome === 'retryable');
    } else expect(db.__get(path)).toBeUndefined();
  });

  it('reads the full body without logging, alerting or storing its private fields; excerpt stays at 300 characters', async () => {
    const logs = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
    const notify = vi.fn(async () => {});
    const stepStatus = { ...steps('failed_permanent'), diagnostic: 'd'.repeat(500) };
    const result = await trigger(responseBody('failed_permanent', stepStatus), 200, notify);
    expect(result.bodyExcerpt).toBe(JSON.stringify(stepStatus).slice(0, 300));
    expect(JSON.stringify([result, db.__get(path), notify.mock.calls, logs.map((log) => log.mock.calls)])).not.toContain(PRIVATE);
    expect(notify.mock.calls[0][1]).toContain(result.bodyExcerpt);
  });

  it('non-2xx bodies still expose only the first 300 characters', async () => {
    const notify = vi.fn(async () => {});
    const result = await trigger(`${'e'.repeat(300)}${PRIVATE}`, 503, notify);
    expect(result).toMatchObject({ outcome: 'retryable', bodyExcerpt: 'e'.repeat(300) });
    expect(JSON.stringify([db.__get(path), notify.mock.calls])).not.toContain(PRIVATE);
  });

  it('malformed JSON still fails closed as retryable', async () => {
    expect(await trigger('{"outcome":"completed"')).toMatchObject({ ok: false, outcome: 'retryable' });
  });

  it.each([
    ['completed', 'done'],
    ['failed_permanent', 'permanent-failure'],
    ['manual_intervention', 'manual-intervention'],
  ])('the old pending queue becomes %s => %s and the next sweep does not dispatch it', async (outcome, status) => {
    db.__set(path, { orderID: ORDER, payload: { orderID: ORDER }, status: 'pending', attempts: 2 });
    const fetch = vi.fn(async () => new Response(responseBody(outcome, steps(outcome === 'manual_intervention' ? 'outcome_unknown' : outcome))));
    vi.stubGlobal('fetch', fetch);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await sweep({} as never, res as never);
    expect(db.__get(path)).toMatchObject({ status, outcome, attempts: 3 });
    await sweep({} as never, res as never);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.__get(path)).toMatchObject({ status, attempts: 3 });
  });
});
