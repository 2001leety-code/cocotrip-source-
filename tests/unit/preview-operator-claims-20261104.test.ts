import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const effects = vi.hoisted(() => ({ db: vi.fn(() => { throw new Error('Unexpected database initialization'); }) }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: effects.db }));
import { sendDispatchToDriver, broadcastDispatchToDrivers } from '../../api/_shared/dispatch-helpers.js';
import { sweepExpiredDispatches } from '../../api/_shared/dispatch-sweep.js';
import { throttledTelegramAlert } from '../../api/_shared/telegram-throttle.js';
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('PREVIEW_OPERATOR_NOTIFICATIONS_SUPPRESS', 'true'); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('suppresses dispatch, broadcast, expiry sweep and alert before database or delivery bookkeeping', async () => {
  const network = vi.fn(() => { throw new Error('Unexpected outbound attempt'); });
  vi.stubGlobal('fetch', network);
  const receipts = [await sendDispatchToDriver({}), await broadcastDispatchToDrivers({}),
    await sweepExpiredDispatches({}), await throttledTelegramAlert({ key: 'fixture', message: 'fixture' })];
  for (const receipt of receipts) expect(receipt).toMatchObject({ ok: false, status: 'suppressed', alerted: false, delivery: 'not_attempted' });
  expect(effects.db).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
});
