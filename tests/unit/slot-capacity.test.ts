/**
 * Coverage for api/_shared/slot-capacity.js — Phase 2 (2026-05-20) TourSlot
 * per-slot capacity pre-lock + confirm + sweep helpers.
 *
 * Approach: Firestore-free unit test. We synthesize a runTransaction-compatible
 * mock that captures `tx.get(ref)` / `tx.set(ref, data, opts)` against an
 * in-memory document store. This isolates the capacity-arithmetic + race-safety
 * branch logic from Firestore connectivity (which is integration concern).
 *
 * Verifies:
 *   1. acquireSlotLock — capacity gate, status guards, pending stacking,
 *      expired-lock overwrite.
 *   2. confirmSlotLock — same-orderId fast path, lost-lock re-validation,
 *      pending residual handling.
 *   3. sweepExpiredPending — removes only expired entries, idempotent.
 *   4. summarizeSlot / isPendingExpired — pure helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  acquireSlotLock,
  confirmSlotLock,
  sweepExpiredPending,
  summarizeSlot,
  isPendingExpired,
  SLOT_CAPACITY_INTERNAL,
} from '../../api/_shared/slot-capacity.js';

interface MockSnap {
  exists: boolean;
  data: () => Record<string, unknown>;
}

function makeMockDb(initialDocs: Record<string, Record<string, unknown> | undefined> = {}) {
  const store = new Map<string, Record<string, unknown>>();
  for (const [path, data] of Object.entries(initialDocs)) {
    if (data !== undefined) store.set(path, structuredClone(data));
  }

  function doc(path: string) {
    return { path };
  }

  async function runTransaction(fn: (tx: any) => Promise<unknown>) {
    const tx = {
      get(ref: { path: string }): Promise<MockSnap> {
        const cur = store.get(ref.path);
        return Promise.resolve({
          exists: cur !== undefined,
          data: () => structuredClone(cur ?? {}),
        });
      },
      set(ref: { path: string }, data: Record<string, unknown>, opts: { merge?: boolean } = {}) {
        if (opts.merge && store.has(ref.path)) {
          const cur = store.get(ref.path)!;
          store.set(ref.path, { ...cur, ...data });
        } else {
          store.set(ref.path, structuredClone(data));
        }
      },
    };
    return fn(tx);
  }

  return {
    doc,
    runTransaction,
    _peek: (path: string) => store.get(path),
  };
}

const PATH = 'tour_availability/test-tour/dates/2026-06-01';

describe('isPendingExpired — pure', () => {
  const now = 1_700_000_000_000;
  it('returns true for undefined entry', () => {
    expect(isPendingExpired(undefined, now)).toBe(true);
  });
  it('returns true for missing expiresAt', () => {
    expect(isPendingExpired({ count: 2 } as any, now)).toBe(true);
  });
  it('returns true for malformed expiresAt', () => {
    expect(isPendingExpired({ count: 2, expiresAt: 'not-a-date' } as any, now)).toBe(true);
  });
  it('returns false when expiresAt > now', () => {
    expect(isPendingExpired({ count: 2, expiresAt: new Date(now + 1000).toISOString() } as any, now)).toBe(false);
  });
  it('returns true when expiresAt == now (boundary)', () => {
    expect(isPendingExpired({ count: 2, expiresAt: new Date(now).toISOString() } as any, now)).toBe(true);
  });
});

describe('summarizeSlot — confirmed + valid pending', () => {
  const now = 1_700_000_000_000;
  it('zero pending when slot empty', () => {
    expect(summarizeSlot({}, 'slot-a', now)).toEqual({ confirmed: 0, pending: 0, total: 0 });
  });
  it('confirmed only when no pending', () => {
    expect(summarizeSlot({ slot_bookings: { 'slot-a': 3 } }, 'slot-a', now))
      .toEqual({ confirmed: 3, pending: 0, total: 3 });
  });
  it('confirmed + active pending sum', () => {
    expect(summarizeSlot({
      slot_bookings: { 'slot-a': 3 },
      slot_pending: { 'slot-a': { count: 2, expiresAt: new Date(now + 1000).toISOString() } },
    }, 'slot-a', now)).toEqual({ confirmed: 3, pending: 2, total: 5 });
  });
  it('expired pending excluded from total', () => {
    expect(summarizeSlot({
      slot_bookings: { 'slot-a': 3 },
      slot_pending: { 'slot-a': { count: 2, expiresAt: new Date(now - 1000).toISOString() } },
    }, 'slot-a', now)).toEqual({ confirmed: 3, pending: 0, total: 3 });
  });
});

describe('acquireSlotLock — capacity gate + pending increment', () => {
  it('first acquisition succeeds and stores pending entry', async () => {
    const db = makeMockDb();
    const r = await acquireSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: 2,
      capacity: 7,
      orderId: 'ORD-1',
    });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(5);
    const doc = db._peek(PATH)!;
    expect((doc.slot_pending as any)['slot-a'].count).toBe(2);
    expect((doc.slot_pending as any)['slot-a'].orderId).toBe('ORD-1');
  });

  it('rejects when confirmed + pending + pax exceeds capacity', async () => {
    const db = makeMockDb({
      [PATH]: {
        status: 'available',
        slot_bookings: { 'slot-a': 5 },
        slot_pending: { 'slot-a': { count: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() } },
      },
    });
    await expect(acquireSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: 2,
      capacity: 7,
      orderId: 'ORD-NEW',
    })).rejects.toThrow(/Slot full/);
  });

  it('overwrites expired pending (does not stack with stale lock)', async () => {
    const oldExp = new Date(Date.now() - 60_000).toISOString();
    const db = makeMockDb({
      [PATH]: {
        status: 'available',
        slot_pending: { 'slot-a': { count: 99, expiresAt: oldExp, orderId: 'OLD' } },
      },
    });
    const r = await acquireSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: 3,
      capacity: 7,
      orderId: 'NEW',
    });
    expect(r.ok).toBe(true);
    const doc = db._peek(PATH)!;
    // stale 99 gone, only our 3 remains.
    expect((doc.slot_pending as any)['slot-a'].count).toBe(3);
    expect((doc.slot_pending as any)['slot-a'].orderId).toBe('NEW');
  });

  it('stacks pending with active lock from different orderId', async () => {
    const futureExp = new Date(Date.now() + 60_000).toISOString();
    const db = makeMockDb({
      [PATH]: {
        status: 'available',
        slot_pending: { 'slot-a': { count: 2, expiresAt: futureExp, orderId: 'ORD-1' } },
      },
    });
    const r = await acquireSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: 2,
      capacity: 7,
      orderId: 'ORD-2',
    });
    expect(r.ok).toBe(true);
    const doc = db._peek(PATH)!;
    expect((doc.slot_pending as any)['slot-a'].count).toBe(4); // 2 + 2
  });

  it('rejects when status=fully_booked regardless of slot capacity', async () => {
    const db = makeMockDb({
      [PATH]: { status: 'fully_booked' },
    });
    await expect(acquireSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: 1,
      capacity: 100,
      orderId: 'X',
    })).rejects.toThrow(/fully_booked/);
  });

  it('rejects invalid pax', async () => {
    const db = makeMockDb();
    await expect(acquireSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: 0,
      capacity: 10,
      orderId: 'X',
    })).rejects.toThrow(/Invalid pax/);
    await expect(acquireSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: -1 as any,
      capacity: 10,
      orderId: 'X',
    })).rejects.toThrow(/Invalid pax/);
  });
});

describe('confirmSlotLock — pending → confirmed transition', () => {
  it('happy path: same orderId, confirms pax + clears pending', async () => {
    const futureExp = new Date(Date.now() + 60_000).toISOString();
    const db = makeMockDb({
      [PATH]: {
        status: 'available',
        slot_pending: { 'slot-a': { count: 2, expiresAt: futureExp, orderId: 'ORD-1' } },
      },
    });
    const r = await confirmSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: 2,
      capacity: 7,
      orderId: 'ORD-1',
    });
    expect(r.confirmed).toBe(2);
    const doc = db._peek(PATH)!;
    expect((doc.slot_bookings as any)['slot-a']).toBe(2);
    expect((doc.slot_pending as any)['slot-a']).toBeUndefined();
  });

  it('lost-lock path: pending expired, but capacity allows confirm', async () => {
    const pastExp = new Date(Date.now() - 60_000).toISOString();
    const db = makeMockDb({
      [PATH]: {
        status: 'available',
        slot_bookings: { 'slot-a': 3 },
        slot_pending: { 'slot-a': { count: 2, expiresAt: pastExp, orderId: 'ORD-1' } },
      },
    });
    const r = await confirmSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: 2,
      capacity: 7,
      orderId: 'ORD-1',
    });
    expect(r.confirmed).toBe(5);
  });

  it('lost-lock path: pending expired AND capacity exhausted → SLOT_FULL_AT_CAPTURE', async () => {
    const pastExp = new Date(Date.now() - 60_000).toISOString();
    const db = makeMockDb({
      [PATH]: {
        status: 'available',
        slot_bookings: { 'slot-a': 6 }, // someone else filled it while pending expired
        slot_pending: { 'slot-a': { count: 2, expiresAt: pastExp, orderId: 'ORD-1' } },
      },
    });
    await expect(confirmSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: 2,
      capacity: 7,
      orderId: 'ORD-1',
    })).rejects.toThrow(/Slot full at capture/);
  });

  it('partial pending residual preserved (rare — re-issued capture with smaller pax)', async () => {
    const futureExp = new Date(Date.now() + 60_000).toISOString();
    const db = makeMockDb({
      [PATH]: {
        status: 'available',
        slot_pending: { 'slot-a': { count: 5, expiresAt: futureExp, orderId: 'ORD-1' } },
      },
    });
    const r = await confirmSlotLock({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
      slotId: 'slot-a',
      pax: 2,
      capacity: 10,
      orderId: 'ORD-1',
    });
    expect(r.confirmed).toBe(2);
    const doc = db._peek(PATH)!;
    expect((doc.slot_pending as any)['slot-a'].count).toBe(3); // 5 - 2
  });
});

describe('sweepExpiredPending — cron logic', () => {
  it('removes only expired entries (idempotent)', async () => {
    const now = Date.now();
    const db = makeMockDb({
      [PATH]: {
        slot_pending: {
          'slot-a': { count: 2, expiresAt: new Date(now - 1000).toISOString() }, // expired
          'slot-b': { count: 1, expiresAt: new Date(now + 60_000).toISOString() }, // active
          'slot-c': { count: 3 } as any, // malformed → expired
        },
      },
    });
    const r = await sweepExpiredPending({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
    });
    expect(r.swept).toBe(2);
    const doc = db._peek(PATH)!;
    const pending = doc.slot_pending as any;
    expect(pending['slot-a']).toBeUndefined();
    expect(pending['slot-c']).toBeUndefined();
    expect(pending['slot-b'].count).toBe(1);

    // 2nd sweep: idempotent (no expired left).
    const r2 = await sweepExpiredPending({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
    });
    expect(r2.swept).toBe(0);
  });

  it('handles missing doc gracefully', async () => {
    const db = makeMockDb({});
    const r = await sweepExpiredPending({
      adminDb: db as any,
      tourId: 'test-tour',
      date: '2026-06-01',
    });
    expect(r.swept).toBe(0);
  });
});

describe('SLOT_CAPACITY_INTERNAL — exposed constants', () => {
  it('PENDING_TTL_MS = 10 minutes', () => {
    expect(SLOT_CAPACITY_INTERNAL.PENDING_TTL_MS).toBe(10 * 60 * 1000);
  });
});
