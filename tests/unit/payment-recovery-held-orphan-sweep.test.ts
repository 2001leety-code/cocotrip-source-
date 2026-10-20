/**
 * 2026-10-20 (payments review, change 1): a retry intent left in HELD_RETRY_STATUS after the claim lease — the
 * capture handler died before releaseHeldIntents — must reach the operator. The sweep never dispatches it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const alerts = vi.hoisted(() => ({ throttled: vi.fn(async () => ({ ok: true, alerted: true })) }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: alerts.throttled }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => null }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid', vercelBypassHeaders: () => ({}) }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: vi.fn(), PENDING_PROCESSOR_RETRIES_COLLECTION: 'pending_processor_retries' }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

import { heldOrphanIds, reportHeldOrphans, HELD_ORPHAN_AGE_MS } from '../../api/_crons/processor-retry-sweep.js';
import { HELD_RETRY_STATUS, CLAIM_LEASE_MS } from '../../api/_shared/payment-fulfillment-recovery.js';

const NOW = 1_800_000_000_000;
type Doc = { id: string; data: () => Record<string, unknown> };
const doc = (id: string, data: Record<string, unknown>): Doc => ({ id, data: () => data });
const ts = (ms: number) => ({ toMillis: () => ms });

function fakeDb(rows: Doc[]) {
  const calls: Array<{ field: string; op: string; value: unknown }> = [];
  return {
    calls,
    collection: () => ({
      where: (field: string, op: string, value: unknown) => {
        calls.push({ field, op, value });
        const docs = rows.filter((row) => row.data().status === value);
        return { limit: () => ({ get: async () => ({ docs, empty: docs.length === 0 }) }) };
      },
    }),
  };
}

beforeEach(() => { alerts.throttled.mockClear(); });

describe('held retry intents left behind by a dead capture worker', () => {
  it('ages by the claim lease; a missing or unreadable updatedAt counts as orphaned', () => {
    expect(HELD_ORPHAN_AGE_MS).toBe(CLAIM_LEASE_MS);
    const rows = [
      doc('FRESH', { status: HELD_RETRY_STATUS, updatedAt: ts(NOW - CLAIM_LEASE_MS + 1) }),
      doc('OLD', { status: HELD_RETRY_STATUS, orderID: 'ORDER-OLD', updatedAt: ts(NOW - CLAIM_LEASE_MS - 1) }),
      doc('ISO', { status: HELD_RETRY_STATUS, updatedAt: new Date(NOW - 10 * CLAIM_LEASE_MS).toISOString() }),
      doc('NOSTAMP', { status: HELD_RETRY_STATUS }),
    ];
    expect(heldOrphanIds(rows, NOW)).toEqual(['ORDER-OLD', 'ISO', 'NOSTAMP']);
  });

  it('queries status == held only, alerts the operator per order through the throttled key, dispatches nothing', async () => {
    const db = fakeDb([
      doc('P1', { status: 'pending', updatedAt: ts(0) }),
      doc('H1', { status: HELD_RETRY_STATUS, orderID: 'ORDER-H1', updatedAt: ts(NOW - 2 * CLAIM_LEASE_MS) }),
      doc('H2', { status: HELD_RETRY_STATUS, updatedAt: ts(NOW) }),
    ]);
    const orphans = await reportHeldOrphans(db as never, NOW);
    expect(orphans).toEqual(['ORDER-H1']);
    expect(db.calls).toEqual([{ field: 'status', op: '==', value: HELD_RETRY_STATUS }]);
    expect(alerts.throttled).toHaveBeenCalledTimes(1);
    const alert = alerts.throttled.mock.calls[0][0] as { key: string; severity: string; channel: string; message: string };
    expect(alert).toMatchObject({ key: 'held-retry-orphan-ORDER-H1', severity: 'critical', channel: 'booking' });
    expect(alert.message).toContain('pending_processor_retries/ORDER-H1');
  });
});
