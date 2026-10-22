/**
 * 2026-10-10 — booking-confirm lost its operator alerts in the recovery rewrite (notify no longer passed to the
 * trigger helpers; missing AI input and unvalidated dispatch results were quarantined silently). This locks the
 * restored behaviour. Offline: fake Firestore, mocked triggers/alerts, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  aiCalls: [] as Record<string, unknown>[],
  processorCalls: [] as Record<string, unknown>[],
  alerts: [] as Record<string, unknown>[],
  aiResult: { ok: true } as unknown,
  processorResult: { ok: true } as unknown,
}));
vi.mock('firebase-admin/firestore', async () => {
  const { FieldValue } = await import('../../tests/helpers/fake-firestore.js');
  return { FieldValue };
});
vi.mock('../../api/_shared/ai-planner-trigger.js', () => ({
  triggerAiPlanner: async (args: Record<string, unknown>) => { state.aiCalls.push(args); return state.aiResult; },
}));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({
  triggerBookingProcessor: async (args: Record<string, unknown>) => { state.processorCalls.push(args); return state.processorResult; },
}));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: async (args: Record<string, unknown>) => { state.alerts.push(args); return { ok: true, alerted: true }; },
}));
vi.mock('../../api/_shared/notify.js', () => ({ notify: async () => {} }));
vi.mock('../../api/_shared/customer-email-trigger.js', () => ({ sendCustomerEmailWithAlert: async () => ({ ok: true }) }));
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({ buildManualPaymentEmail: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('../../api/_shared/internal-base-url.js', () => ({ internalApiBase: () => 'https://internal.invalid' }));

import { createFakeFirestore } from '../../tests/helpers/fake-firestore.js';
import { confirmBookingAsPaid } from '../../api/_shared/booking-confirm.js';

const pending = (extra: Record<string, unknown>) => ({
  status: 'AWAITING_VERIFICATION', customerEmail: 'guest@example.invalid', priceKRW: 99000, priceUSD: '70.00',
  productType: 'charter_seoul_city', dateStart: '2030-01-05', passengers: 2, ...extra,
});

beforeEach(() => { state.aiCalls = []; state.processorCalls = []; state.alerts = []; state.aiResult = { ok: true }; state.processorResult = { ok: true }; });
afterEach(() => vi.restoreAllMocks());

describe('booking-confirm operator alerts (restored)', () => {
  it('passes notify to both trigger helpers so their own failure alerts can fire', async () => {
    const db = createFakeFirestore({ 'pending_bookings/REF-P': pending({}) });
    const r = await confirmBookingAsPaid({ db, bookingRef: 'REF-P', paypalTransactionId: 'TX-1', source: 'webhook' });
    expect(r.ok).toBe(true);
    expect(state.processorCalls).toHaveLength(1);
    expect(typeof state.processorCalls[0].notify).toBe('function');

    const db2 = createFakeFirestore({ 'pending_bookings/REF-AI': pending({ productType: 'ai-planner-basic', itineraryData: { regions: ['seoul'], days: 2 } }) });
    const r2 = await confirmBookingAsPaid({ db: db2, bookingRef: 'REF-AI', paypalTransactionId: 'TX-2', source: 'webhook' });
    expect(r2.ok).toBe(true);
    expect(state.aiCalls).toHaveLength(1);
    expect(typeof state.aiCalls[0].notify).toBe('function');
    expect(state.alerts).toEqual([]);
  });

  it('alerts critical when a paid AI planner booking has no wizard input (queued manual-intervention)', async () => {
    const db = createFakeFirestore({ 'pending_bookings/REF-MISSING': pending({ productType: 'ai-planner-basic' }) });
    const r = await confirmBookingAsPaid({ db, bookingRef: 'REF-MISSING', paypalTransactionId: 'TX-3', source: 'admin', adminUid: 'u1' });
    expect(r.ok).toBe(true);
    expect(state.aiCalls).toEqual([]);
    expect(db.__get('pending_ai_planner_retries/REF-MISSING')).toMatchObject({ status: 'manual-intervention' });
    const alert = state.alerts.find((a) => a.key === 'ai-planner-itinerary-missing');
    expect(alert).toMatchObject({ severity: 'critical', channel: 'booking' });
    expect(String(alert?.message)).toContain('REF-MISSING');
    // Re-confirming the same booking does not re-create the queue and so does not alert again here (throttle key dedupes anyway).
    state.alerts = [];
    await confirmBookingAsPaid({ db, bookingRef: 'REF-MISSING', paypalTransactionId: 'TX-3', source: 'admin', adminUid: 'u1' });
    expect(state.alerts.find((a) => a.key === 'ai-planner-itinerary-missing')).toBeUndefined();
  });

  it('alerts critical when the dispatch result is not a validated helper result (quarantine)', async () => {
    state.processorResult = undefined; // unproven side effect
    const db = createFakeFirestore({ 'pending_bookings/REF-Q': pending({}) });
    const r = await confirmBookingAsPaid({ db, bookingRef: 'REF-Q', paypalTransactionId: 'TX-4', source: 'webhook' });
    expect(r.ok).toBe(true);
    expect(db.__get('pending_processor_retries/TX-4')).toMatchObject({ status: 'manual-intervention', outcome: 'outcome_unknown' });
    const alert = state.alerts.find((a) => a.key === 'booking-confirm-dispatch-unknown');
    expect(alert).toMatchObject({ severity: 'critical', channel: 'admin' });
    expect(String(alert?.message)).toContain('TX-4');
  });

  it('alerts critical when a trigger helper throws (intent stays retryable)', async () => {
    state.processorResult = Promise.reject(new Error('synthetic-throw'));
    const db = createFakeFirestore({ 'pending_bookings/REF-T': pending({}) });
    const r = await confirmBookingAsPaid({ db, bookingRef: 'REF-T', paypalTransactionId: 'TX-5', source: 'webhook' });
    expect(r.ok).toBe(true);
    expect(db.__get('pending_processor_retries/TX-5')).toMatchObject({ status: 'pending', outcome: 'retryable' });
    const alert = state.alerts.find((a) => a.key === 'booking-confirm-downstream-throw');
    expect(alert).toMatchObject({ severity: 'critical', channel: 'admin' });
    expect(String(alert?.message)).toContain('synthetic-throw');
  });
});
