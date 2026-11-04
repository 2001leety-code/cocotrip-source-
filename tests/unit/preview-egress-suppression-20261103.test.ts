import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPreviewPushSuppressed, isPreviewSheetsSuppressed } from '../../api/_shared/preview-egress-policy.js';

const effects = vi.hoisted(() => ({ push: vi.fn(), configure: vi.fn(), sheets: vi.fn() }));
vi.mock('web-push', () => ({ default: { sendNotification: effects.push, setVapidDetails: effects.configure } }));
vi.mock('googleapis', () => ({ google: { sheets: effects.sheets, auth: { JWT: effects.sheets } } }));
const { appendBooking, updateBookingStatus } = await import('../../api/_google-sheets.js');
const { recordLeadToSheets } = await import('../../api/_ai_core/emailNotifier.js');
const { sendPush, sendPushToUser } = await import('../../api/_send-push.js');
const { sendSingleOwnerPush, deliverOwnerEvent } = await import('../../api/_shared/owner-notification-delivery.js');
const { ownerNotificationTestTask } = await import('../../api/_shared/owner-notification-test.js');
const { ownerNotificationSweepTask } = await import('../../api/_crons/owner-notification-sweep.js');
const network = vi.fn(() => { throw new Error('Unmocked network forbidden'); });
const collection = vi.fn(() => { throw new Error('Subscription/ledger access forbidden'); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('PREVIEW_SHEETS_SUPPRESS', 'true'); vi.stubEnv('PREVIEW_PUSH_SUPPRESS', 'true');
  vi.stubGlobal('fetch', network);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Preview-only Sheets and push isolation', () => {
  it.each([
    ['preview', 'true', true], ['preview', undefined, false], ['preview', 'false', false],
    ['preview', 'TRUE', false], ['preview', ' true ', false], ['production', 'true', false],
    ['development', 'true', false], [undefined, 'true', false],
  ])('requires exact server env and flag (%s/%s)', (deployment, flag, expected) => {
    const env = { VERCEL_ENV: deployment, PREVIEW_SHEETS_SUPPRESS: flag, PREVIEW_PUSH_SUPPRESS: flag };
    expect(isPreviewSheetsSuppressed(env)).toBe(expected); expect(isPreviewPushSuppressed(env)).toBe(expected);
  });
  it('blocks both booking mutations and the independent lead path before credentials/token/read/write', async () => {
    for (const result of [await appendBooking({ transactionId: 'offline' }), await updateBookingStatus('offline', 'confirmed'),
      await recordLeadToSheets({ email: 'fixture@example.invalid' })]) {
      expect(result).toMatchObject({ status: 'suppressed', write: 'not_attempted', appended: false, updated: false, retryable: false });
      expect(result).not.toHaveProperty('appendedRow');
    }
    expect(network).not.toHaveBeenCalled(); expect(effects.sheets).not.toHaveBeenCalled();
  });
  it('blocks customer and owner push before configuration, subscription lookup, cleanup and event claims', async () => {
    const db = { collection, runTransaction: collection };
    const results = [await sendPush({}, {}), await sendPushToUser(db, 'offline', {}),
      await sendSingleOwnerPush({}, {}, {}), await deliverOwnerEvent({ db }, {}, {}, 'offline'),
      await ownerNotificationTestTask({ db, auth: {}, config: {}, input: { action: 'send' } }),
      await ownerNotificationSweepTask({ loadServices: collection })];
    for (const result of results) expect(result).toMatchObject({ status: 'suppressed', delivery: 'not_attempted', sent: 0, retryable: false });
    expect(collection).not.toHaveBeenCalled(); expect(effects.push).not.toHaveBeenCalled();
    expect(effects.configure).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
  });
});
