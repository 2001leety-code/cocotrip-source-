import { beforeEach, describe, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ processor: vi.fn(), ai: vi.fn(), email: vi.fn(), notify: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'OFFLINE_TIMESTAMP' } }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: effects.notify }));
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({ buildManualPaymentEmail: () => ({ subject: 'fixture', html: '', text: '' }) }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: effects.processor }));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: effects.email }));
vi.mock('../../api/_shared/customer-email-trigger.js', () => ({ sendCustomerEmailWithAlert: effects.email }));
vi.mock('../../api/_shared/ai-planner-trigger.js', () => ({ triggerAiPlanner: effects.ai }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => {}) }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://offline.invalid' }));

import { confirmBookingAsPaid } from '../../api/_shared/booking-confirm.js';

type Row = Record<string, unknown>;
type Ref = { path: string };
type SetOptions = { merge?: boolean };
type Snapshot = { exists: boolean; data: () => Row };
type DocRef = Ref & {
  id: string;
  get: () => Promise<Snapshot>;
  set: (value: Row, options?: SetOptions) => Promise<void>;
  update: (value: Row) => Promise<void>;
};
type Tx = {
  get: (ref: Ref) => Promise<Snapshot>;
  set: (ref: Ref, value: Row, options?: SetOptions) => void;
  update: (ref: Ref, value: Row) => void;
};
type Write = { ref: Ref; value: Row; merge: boolean };
// Adapted from the preserved 2026-10-09 implementation-payment-regression fixture.
function memoryStore(initialStatus = 'PENDING', failPath = '') {
  const rows = new Map<string, Row>([['pending_bookings/OFFLINE-ONLY', {
    status: initialStatus, priceKRW: 10000, priceUSD: '9.90',
    customerEmail: 'fixture@example.invalid', productType: 'fixture',
    ...(initialStatus === 'CONFIRMED' ? { paypalTransactionId: 'OFFLINE-CAPTURE' } : {}),
  }]]);
  const versions = new Map<string, number>();
  let shouldFail = !!failPath;
  const snapshot = (ref: Ref) => ({ exists: rows.has(ref.path), data: () => ({ ...rows.get(ref.path) }) });
  const checkWrite = (ref: Ref) => {
    if (ref.path.startsWith(failPath) && shouldFail) {
      shouldFail = false;
      throw new Error('OFFLINE_INJECTED_WRITE_FAILURE');
    }
  };
  const apply = (ref: Ref, value: Row, merge: boolean) => {
    rows.set(ref.path, merge ? { ...rows.get(ref.path), ...value } : { ...value });
    versions.set(ref.path, (versions.get(ref.path) || 0) + 1);
  };
  const db = {
    collection: (name: string) => ({ doc: (id: string) => {
      const ref: DocRef = {
        path: `${name}/${id}`, id,
        get: async () => snapshot(ref),
        set: async (value: Row, options?: SetOptions) => { checkWrite(ref); apply(ref, value, !!options?.merge); },
        update: async (value: Row) => { checkWrite(ref); apply(ref, value, true); },
      };
      return ref;
    } }),
    runTransaction: async <T>(callback: (tx: Tx) => Promise<T>): Promise<T> => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const reads = new Map<string, number>();
        const writes: Write[] = [];
        const tx: Tx = {
          get: async (ref) => { expect(writes).toHaveLength(0); reads.set(ref.path, versions.get(ref.path) || 0); return snapshot(ref); },
          set: (ref, value, options) => writes.push({ ref, value, merge: !!options?.merge }),
          update: (ref, value) => writes.push({ ref, value, merge: true }),
        };
        const result = await callback(tx);
        if ([...reads].some(([path, version]) => (versions.get(path) || 0) !== version)) continue;
        for (const { ref } of writes) checkWrite(ref);
        for (const { ref, value, merge } of writes) apply(ref, value, merge);
        return result;
      }
      throw new Error('OFFLINE_TRANSACTION_CONFLICT');
    },
  };
  return { db, rows };
}

const args = { bookingRef: 'OFFLINE-ONLY', paypalTransactionId: 'OFFLINE-CAPTURE', source: 'webhook' };
beforeEach(() => {
  vi.clearAllMocks();
  effects.processor.mockResolvedValue({ ok: true, outcome: 'completed' });
  effects.ai.mockResolvedValue({ ok: true });
  effects.email.mockResolvedValue({ ok: true });
  effects.notify.mockResolvedValue(undefined);
});

describe('manual confirmation durable recovery', () => {
  it.each(['bookings/', 'pending_processor_retries/'])('commits no state or effects when %s fails, then recovers once', async (path) => {
    const { db, rows } = memoryStore('PENDING', path);
    await expect(confirmBookingAsPaid({ db, ...args })).rejects.toThrow('OFFLINE_INJECTED_WRITE_FAILURE');
    expect(rows.get('pending_bookings/OFFLINE-ONLY')?.status).toBe('PENDING');
    expect(rows.has('bookings/OFFLINE-CAPTURE')).toBe(false);
    expect(effects.processor).not.toHaveBeenCalled();
    expect(effects.email).not.toHaveBeenCalled();
    expect((await confirmBookingAsPaid({ db, ...args })).ok).toBe(true);
    expect(rows.has('bookings/OFFLINE-CAPTURE')).toBe(true);
    expect(rows.get('pending_processor_retries/OFFLINE-CAPTURE')?.status).toBe('done');
    await confirmBookingAsPaid({ db, ...args });
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(effects.email).toHaveBeenCalledTimes(1);
  });

  it('repairs legacy CONFIRMED using its original id while quarantining unknown email history', async () => {
    const { db, rows } = memoryStore('CONFIRMED');
    const result = await confirmBookingAsPaid({ db, ...args, paypalTransactionId: 'NEW-UNTRUSTED-ID' });
    expect(result).toMatchObject({ ok: true, bookingId: 'OFFLINE-CAPTURE', alreadyConfirmed: true });
    expect(rows.get('bookings/OFFLINE-CAPTURE')).toMatchObject({ amountUSD: '9.90', voucherSentAtState: 'outcome_unknown' });
    expect(rows.has('bookings/NEW-UNTRUSTED-ID')).toBe(false);
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(effects.email).not.toHaveBeenCalled();
    await confirmBookingAsPaid({ db, ...args });
    expect(effects.processor).toHaveBeenCalledTimes(1);
  });

  it.each(['done', 'manual-intervention', 'permanent-failure'])('preserves %s intents, snapshots and existing booking markers', async (status) => {
    const { db, rows } = memoryStore('CONFIRMED');
    const booking = { captureID: 'OFFLINE-CAPTURE', bookingRef: 'OFFLINE-ONLY', amountUSD: '7.50', voucherSentAtState: 'outcome_unknown', createdAt: 'OLD' };
    const queue = { status, attempts: 4, payload: { orderID: 'OFFLINE-CAPTURE', amount: '7.50' }, stepStatus: { email: 'outcome_unknown' } };
    rows.set('bookings/OFFLINE-CAPTURE', booking);
    rows.set('pending_processor_retries/OFFLINE-CAPTURE', queue);
    await confirmBookingAsPaid({ db, ...args });
    expect(rows.get('bookings/OFFLINE-CAPTURE')).toEqual(booking);
    expect(rows.get('pending_processor_retries/OFFLINE-CAPTURE')).toEqual(queue);
    expect(effects.processor).not.toHaveBeenCalled();
    expect(effects.email).not.toHaveBeenCalled();
  });

  it('restores a missing booking from the saved snapshot without adopting later pending edits', async () => {
    const { db, rows } = memoryStore();
    await confirmBookingAsPaid({ db, ...args });
    rows.delete('bookings/OFFLINE-CAPTURE');
    Object.assign(rows.get('pending_bookings/OFFLINE-ONLY')!, { priceUSD: '99.00', customerEmail: 'changed@example.invalid' });
    await confirmBookingAsPaid({ db, ...args });
    expect(rows.get('bookings/OFFLINE-CAPTURE')).toMatchObject({ amountUSD: '9.90', userEmail: 'fixture@example.invalid' });
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(effects.email).toHaveBeenCalledTimes(1);
  });

  it('does not mistake an existing mirror for completed downstream work', async () => {
    const { db, rows } = memoryStore('CONFIRMED');
    rows.set('bookings/OFFLINE-CAPTURE', { captureID: 'OFFLINE-CAPTURE', bookingRef: 'OFFLINE-ONLY', amountUSD: '8.00', userEmail: 'original@example.invalid', voucherSentAt: 'OLD' });
    await confirmBookingAsPaid({ db, ...args });
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(effects.processor.mock.calls[0][0].payload).toMatchObject({ amount: '8.00', payerEmail: 'original@example.invalid' });
    expect(rows.get('bookings/OFFLINE-CAPTURE')?.voucherSentAt).toBe('OLD');
  });

  it('quarantines ambiguous new confirmation email failures without automatic resend', async () => {
    const { db, rows } = memoryStore();
    effects.email.mockRejectedValueOnce(new Error('SMTP response lost'));
    await confirmBookingAsPaid({ db, ...args });
    await confirmBookingAsPaid({ db, ...args });
    expect(effects.email).toHaveBeenCalledTimes(1);
    expect(rows.get('pending_bookings/OFFLINE-ONLY')?.confirmationEmailState).toBe('outcome_unknown');
    expect([...rows.keys()].some(k => k.startsWith('pending_email_retries/'))).toBe(false);
  });

  it('claims simultaneous confirmation once and leaves semantic failures durable', async () => {
    const { db, rows } = memoryStore();
    effects.processor.mockResolvedValue({ ok: false, outcome: 'manual_intervention', docStatus: 'manual-intervention', stepStatus: { email: 'outcome_unknown' } });
    await Promise.all([confirmBookingAsPaid({ db, ...args }), confirmBookingAsPaid({ db, ...args, source: 'admin' })]);
    expect(effects.processor).toHaveBeenCalledTimes(1);
    expect(effects.email).toHaveBeenCalledTimes(1);
    expect(rows.get('pending_processor_retries/OFFLINE-CAPTURE')).toMatchObject({ status: 'manual-intervention', stepStatus: { email: 'outcome_unknown' } });
    await confirmBookingAsPaid({ db, ...args });
    expect(effects.processor).toHaveBeenCalledTimes(1);
  });

  it.each(['CANCELLED', 'REFUNDED', 'REFUND_PENDING'])('does not turn %s bookings back into confirmed bookings or dispatch them', async (status) => {
    const { db, rows } = memoryStore('CONFIRMED');
    rows.set('bookings/OFFLINE-CAPTURE', { status, bookingRef: 'OFFLINE-ONLY', memo: 'KEEP' });
    expect((await confirmBookingAsPaid({ db, ...args })).ok).toBe(false);
    expect(effects.processor).not.toHaveBeenCalled();
    expect(effects.email).not.toHaveBeenCalled();
    expect(rows.get('bookings/OFFLINE-CAPTURE')).toEqual({ status, bookingRef: 'OFFLINE-ONLY', memo: 'KEEP' });
    expect(rows.has('pending_processor_retries/OFFLINE-CAPTURE')).toBe(false);
  });
});
