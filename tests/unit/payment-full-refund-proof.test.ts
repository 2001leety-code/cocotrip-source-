/**
 * 2026-10-21 (PR #1441 review item C) — strict full-refund proof.
 * Only a path that verified a FULL refund of THIS capture may write bookings/{orderID}.fullRefundProof, and the
 * finalized replay accepts it only when it describes exactly lock.captureVerified. Fully offline (memory Firestore).
 */
import { describe, expect, it } from 'vitest';
import { memoryDb } from './helpers/payment-recovery-fixture';
import {
  buildFullRefundProof, mergeFullRefundProof, fullRefundProofMatchesCapture, readFullRefundProof, markRefundCompleted,
} from '../../api/_shared/payment-fulfillment-recovery.js';
import { applyRefundEvent, ensureFullRefundProof } from '../../api/_shared/refund-ledger.js';

const base = { captureID: 'CAP-1', currency: 'USD', amountMinor: 10000, refundIDs: ['REF-1'], source: 'test', environment: 'live', nowMs: 1 };
const lock = { environment: 'live', captureVerified: { captureID: 'CAP-1', currency: 'USD', amountMinor: 10000 } };

describe('buildFullRefundProof', () => {
  it('builds a normalised proof (trimmed, de-duplicated ids, upper-case currency, lower-case env)', () => {
    expect(buildFullRefundProof({ ...base, currency: 'usd', environment: 'LIVE', refundIDs: [' REF-1 ', 'REF-1', 'REF-2'] })).toEqual({
      captureID: 'CAP-1', currency: 'USD', amountMinor: 10000, refundIDs: ['REF-1', 'REF-2'], source: 'test', environment: 'live', provenAtMs: 1,
    });
  });
  it('rejects no ids, empty-string ids, a bad environment, a zero/non-integer amount, a missing capture or currency', () => {
    expect(buildFullRefundProof({ ...base, refundIDs: [] })).toBeNull();
    expect(buildFullRefundProof({ ...base, refundIDs: ['', '  ', null as unknown as string] })).toBeNull();
    expect(buildFullRefundProof({ ...base, environment: 'staging' })).toBeNull();
    expect(buildFullRefundProof({ ...base, environment: '' })).toBeNull();
    expect(buildFullRefundProof({ ...base, amountMinor: 0 })).toBeNull();
    expect(buildFullRefundProof({ ...base, amountMinor: 100.5 })).toBeNull();
    expect(buildFullRefundProof({ ...base, amountMinor: null as unknown as number })).toBeNull();
    expect(buildFullRefundProof({ ...base, captureID: '' })).toBeNull();
    expect(buildFullRefundProof({ ...base, currency: '' })).toBeNull();
  });
});

describe('mergeFullRefundProof', () => {
  it('keeps the existing proof and unions refundIDs; a missing incoming proof leaves the existing one', () => {
    const existing = { ...buildFullRefundProof(base)!, source: 'capture-auto' };
    const incoming = buildFullRefundProof({ ...base, refundIDs: ['REF-1', 'REF-2'], source: 'webhook-authoritative', nowMs: 99 })!;
    expect(mergeFullRefundProof(existing, incoming)).toEqual({ ...existing, refundIDs: ['REF-1', 'REF-2'] });
    expect(mergeFullRefundProof(existing, null)).toBe(existing);
    expect(mergeFullRefundProof(undefined, incoming)).toBe(incoming);
    expect(mergeFullRefundProof(undefined, null)).toBeNull();
  });
});

describe('fullRefundProofMatchesCapture', () => {
  const proof = buildFullRefundProof(base)!;
  it('accepts the exact match', () => {
    expect(fullRefundProofMatchesCapture(proof, lock)).toBe(true);
  });
  it('rejects captureID / currency / amountMinor / environment mismatch, empty ids and a lock without captureVerified', () => {
    expect(fullRefundProofMatchesCapture({ ...proof, captureID: 'CAP-2' }, lock)).toBe(false);
    expect(fullRefundProofMatchesCapture({ ...proof, currency: 'EUR' }, lock)).toBe(false);
    expect(fullRefundProofMatchesCapture({ ...proof, amountMinor: 9999 }, lock)).toBe(false);
    expect(fullRefundProofMatchesCapture({ ...proof, environment: 'sandbox' }, lock)).toBe(false);
    expect(fullRefundProofMatchesCapture({ ...proof, environment: 'staging' }, { captureVerified: lock.captureVerified })).toBe(false);
    expect(fullRefundProofMatchesCapture({ ...proof, refundIDs: [] }, lock)).toBe(false);
    expect(fullRefundProofMatchesCapture({ ...proof, refundIDs: [''] }, lock)).toBe(false);
    expect(fullRefundProofMatchesCapture(proof, { environment: 'live' })).toBe(false);
    expect(fullRefundProofMatchesCapture(null, lock)).toBe(false);
  });
  it('a proof with an environment never matches a lock without one (strict, review round 2)', () => {
    expect(fullRefundProofMatchesCapture(proof, { captureVerified: lock.captureVerified })).toBe(false);
    expect(fullRefundProofMatchesCapture(proof, { environment: '', captureVerified: lock.captureVerified })).toBe(false);
  });
});

describe('readFullRefundProof', () => {
  it('returns the stored proof, or null for a missing doc / missing field / throwing db', async () => {
    const db = memoryDb();
    expect(await readFullRefundProof({ db: db.db, orderID: 'ORD-1' })).toBeNull();
    db.rows.set('bookings/ORD-1', { status: 'REFUNDED' });
    expect(await readFullRefundProof({ db: db.db, orderID: 'ORD-1' })).toBeNull();
    const proof = buildFullRefundProof(base);
    db.rows.set('bookings/ORD-1', { status: 'REFUNDED', fullRefundProof: proof });
    expect(await readFullRefundProof({ db: db.db, orderID: 'ORD-1' })).toEqual(proof);
    const throwing = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('offline'); } }) }) };
    expect(await readFullRefundProof({ db: throwing, orderID: 'ORD-1' })).toBeNull();
  });
});

describe('markRefundCompleted with proof', () => {
  it('REFUND_PENDING ⇒ REFUNDED + proof stored; already REFUNDED ⇒ false and the helper writes no proof', async () => {
    const db = memoryDb();
    const proof = buildFullRefundProof({ ...base, source: 'capture-auto' });
    db.rows.set('bookings/RP', { status: 'REFUND_PENDING' });
    expect(await markRefundCompleted({ db: db.db, orderID: 'RP', timestamp: 'TS', refundID: 'REF-1', proof })).toBe(true);
    expect(db.rows.get('bookings/RP')).toMatchObject({ status: 'REFUNDED', refundID: 'REF-1', fullRefundProof: proof });
    db.rows.set('bookings/DONE', { status: 'REFUNDED', refundReason: 'operator' });
    expect(await markRefundCompleted({ db: db.db, orderID: 'DONE', timestamp: 'TS', refundID: 'REF-2', proof })).toBe(false);
    expect(db.rows.get('bookings/DONE')).toEqual({ status: 'REFUNDED', refundReason: 'operator' });
  });
  it('without a proof the transition is unchanged (no fullRefundProof field)', async () => {
    const db = memoryDb();
    db.rows.set('bookings/RP', { status: 'REFUND_PENDING' });
    expect(await markRefundCompleted({ db: db.db, orderID: 'RP', timestamp: 'TS', refundID: 'REF-1' })).toBe(true);
    expect(db.rows.get('bookings/RP')).not.toHaveProperty('fullRefundProof');
  });
});

describe('refund ledger — webhook proof only on PayPal-authoritative REFUNDED for this capture', () => {
  const FieldValue = { serverTimestamp: () => 'TS' };
  const booking = (over: Record<string, unknown> = {}) => ({
    status: 'CONFIRMED', captureID: 'CAP-1', amountUSD: '100.00', amountKRW: 135000, paypalEnvironment: 'live', ...over,
  });
  const event = (db: ReturnType<typeof memoryDb>, over: Record<string, unknown> = {}) => applyRefundEvent({
    db: db.db, FieldValue, eventId: 'EV-1', eventType: 'PAYMENT.CAPTURE.REFUNDED', refundId: 'R1', captureId: 'CAP-1',
    refundedUSD: 100, refundedKRW: 135000, usdToKrw: 1350, bookingsDocId: 'ORD-1', bookingRef: null,
    authoritativeCaptureStatus: 'REFUNDED', webhookEnvironment: 'live', refundCurrency: 'USD', nowMs: 1, ...over,
  } as never);

  it('authoritative REFUNDED + matching captureId + USD ⇒ proof, refund ids unioned across two events', async () => {
    const db = memoryDb();
    db.rows.set('bookings/ORD-1', booking());
    expect((await event(db, { eventId: 'EV-1', refundId: 'R1', refundedUSD: 40, authoritativeCaptureStatus: 'PARTIALLY_REFUNDED' })).applied).toBe(true);
    expect(db.rows.get('bookings/ORD-1')).not.toHaveProperty('fullRefundProof');
    expect((await event(db, { eventId: 'EV-2', refundId: 'R2', refundedUSD: 60 })).applied).toBe(true);
    expect(db.rows.get('bookings/ORD-1')).toMatchObject({
      status: 'REFUNDED',
      fullRefundProof: { captureID: 'CAP-1', currency: 'USD', amountMinor: 10000, refundIDs: ['R1', 'R2'], source: 'webhook-authoritative', environment: 'live' },
    });
  });

  it('a cart child (parentOrderID) gets no proof', async () => {
    const db = memoryDb();
    db.rows.set('bookings/ORD-1', booking({ parentOrderID: 'CART-1' }));
    expect((await event(db)).applied).toBe(true);
    expect(db.rows.get('bookings/ORD-1')).not.toHaveProperty('fullRefundProof');
  });

  it('cumulative ≥99% without PayPal-authoritative REFUNDED ⇒ REFUNDED status but no proof (FULL_REFUND_RATIO never proves)', async () => {
    const db = memoryDb();
    db.rows.set('bookings/ORD-1', booking());
    expect((await event(db, { refundedUSD: 99.5, authoritativeCaptureStatus: null })).status).toBe('REFUNDED');
    expect(db.rows.get('bookings/ORD-1')).not.toHaveProperty('fullRefundProof');
  });

  it('a non-USD refund currency ⇒ no proof', async () => {
    const db = memoryDb();
    db.rows.set('bookings/ORD-1', booking());
    await event(db, { refundCurrency: 'EUR' });
    expect(db.rows.get('bookings/ORD-1')).not.toHaveProperty('fullRefundProof');
  });

  it('ensureFullRefundProof: shouldSkip() true inside the transaction ⇒ response_already_sent, no write; false ⇒ normal write', async () => {
    const db = memoryDb();
    db.rows.set('bookings/ORD-1', booking({ status: 'REFUNDED', refundEvents: { R1: { usd: 100 } } }));
    const args = { db: db.db, bookingsDocId: 'ORD-1', captureId: 'CAP-1', authoritativeCaptureStatus: 'REFUNDED', refundId: 'R1', refundCurrency: 'USD', webhookEnvironment: 'live' };
    const before = JSON.stringify(db.rows.get('bookings/ORD-1'));
    expect(await ensureFullRefundProof({ ...args, shouldSkip: () => true } as never)).toEqual({ written: false, reason: 'response_already_sent' });
    expect(JSON.stringify(db.rows.get('bookings/ORD-1'))).toBe(before);
    expect(await ensureFullRefundProof({ ...args, shouldSkip: () => false } as never)).toEqual({ written: true });
    expect(db.rows.get('bookings/ORD-1')).toMatchObject({ fullRefundProof: { refundIDs: ['R1'] } });
  });

  it('a missing refund currency is never defaulted to USD ⇒ no proof (applyRefundEvent and ensureFullRefundProof)', async () => {
    const db = memoryDb();
    db.rows.set('bookings/ORD-1', booking());
    expect((await event(db, { refundCurrency: undefined })).applied).toBe(true);
    expect(db.rows.get('bookings/ORD-1')).not.toHaveProperty('fullRefundProof');
    expect(await ensureFullRefundProof({
      db: db.db, bookingsDocId: 'ORD-1', captureId: 'CAP-1', authoritativeCaptureStatus: 'REFUNDED', refundId: 'R1', refundCurrency: null, webhookEnvironment: 'live',
    } as never)).toEqual({ written: false, reason: 'not_eligible' });
    expect(db.rows.get('bookings/ORD-1')).not.toHaveProperty('fullRefundProof');
  });

  it('a captureId other than the booking capture ⇒ no proof', async () => {
    const db = memoryDb();
    db.rows.set('bookings/ORD-1', booking({ captureID: 'CAP-OTHER' }));
    await event(db);
    expect(db.rows.get('bookings/ORD-1')).not.toHaveProperty('fullRefundProof');
  });

  it('a pending_bookings-only match never receives a proof', async () => {
    const db = memoryDb();
    db.rows.set('pending_bookings/PB-1', { status: 'CONFIRMED', amountUSD: '100.00', paypalTransactionId: 'CAP-1', captureID: 'CAP-1', paypalEnvironment: 'live' });
    expect((await event(db, { bookingsDocId: null, bookingRef: 'PB-1' })).applied).toBe(true);
    expect(db.rows.get('pending_bookings/PB-1')).toMatchObject({ status: 'REFUNDED' });
    expect(db.rows.get('pending_bookings/PB-1')).not.toHaveProperty('fullRefundProof');
  });

  it('bookings + pending_bookings: the proof goes to bookings only', async () => {
    const db = memoryDb();
    db.rows.set('bookings/ORD-1', booking());
    db.rows.set('pending_bookings/PB-1', { status: 'CONFIRMED', amountUSD: '100.00', paypalEnvironment: 'live' });
    await event(db, { bookingRef: 'PB-1' });
    expect(db.rows.get('bookings/ORD-1')).toHaveProperty('fullRefundProof');
    expect(db.rows.get('pending_bookings/PB-1')).not.toHaveProperty('fullRefundProof');
  });

  it('ensureFullRefundProof on a duplicate event writes the proof once (proof only) and is idempotent', async () => {
    const db = memoryDb();
    // An earlier run committed the refund (event processed) before proof existed.
    db.rows.set('bookings/ORD-1', booking({ status: 'REFUNDED', refundedUSDTotal: 100, refundEvents: { R1: { usd: 100 } } }));
    db.rows.set('paypal_webhook_log/EV-1', { status: 'processed' });
    expect(await event(db)).toEqual({ applied: false, reason: 'duplicate_event' });
    const args = { db: db.db, bookingsDocId: 'ORD-1', captureId: 'CAP-1', authoritativeCaptureStatus: 'REFUNDED', refundId: 'R1', refundCurrency: 'USD', webhookEnvironment: 'live' };
    expect(await ensureFullRefundProof(args as never)).toEqual({ written: true });
    const after = db.rows.get('bookings/ORD-1') as Record<string, unknown>;
    expect(after).toMatchObject({ status: 'REFUNDED', refundedUSDTotal: 100, fullRefundProof: { refundIDs: ['R1'], source: 'webhook-authoritative', amountMinor: 10000 } });
    const snapshot = JSON.stringify(after);
    expect(await ensureFullRefundProof(args as never)).toEqual({ written: false, reason: 'already_proven' });
    expect(JSON.stringify(db.rows.get('bookings/ORD-1'))).toBe(snapshot);
    // Not eligible (no authoritative REFUNDED) ⇒ nothing written.
    expect(await ensureFullRefundProof({ ...args, bookingsDocId: 'ORD-2' } as never)).toEqual({ written: false, reason: 'unmatched' });
    db.rows.set('bookings/ORD-3', booking());
    expect(await ensureFullRefundProof({ ...args, bookingsDocId: 'ORD-3', authoritativeCaptureStatus: 'PARTIALLY_REFUNDED' } as never)).toEqual({ written: false, reason: 'not_eligible' });
    expect(db.rows.get('bookings/ORD-3')).not.toHaveProperty('fullRefundProof');
  });
});
