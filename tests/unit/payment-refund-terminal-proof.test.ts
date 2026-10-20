/**
 * Refund terminal proof — real refundPaypalCapture (fetch + token mocked, fully offline) feeding the strict
 * provenFullRefundID gate, and the shared client classifier. The handler suites mock the helper; this file
 * pins the helper metadata the gate depends on (opt-in receipt header, HTTP status) without changing old results.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_shared/paypal.js', () => ({ getPaypalAccessToken: async () => ({ accessToken: 'offline-token', baseUrl: 'https://paypal.invalid' }) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: vi.fn() }));

import { refundPaypalCapture } from '../../api/_shared/paypal-refund.js';
import { provenFullRefundID } from '../../api/_shared/payment-fulfillment-recovery.js';
import { classifyCaptureResponse } from '../../src/lib/paymentRecovery';

const calls: { headers: Record<string, string> }[] = [];
function reply(status: number, body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (...args: unknown[]) => {
    calls.push({ headers: (args[1] as { headers: Record<string, string> }).headers });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }));
}
const COMPLETED = { id: 'REF-1', status: 'COMPLETED', amount: { value: '100.00', currency_code: 'USD' } };
const FULL = { amountMinor: 10000, currency: 'USD' };

beforeEach(() => { calls.length = 0; });

describe('refund helper metadata + strict proof gate', () => {
  it('receipt:true asks for the representation and the proof needs HTTP 2xx; old callers keep their headers and ok/final result', async () => {
    reply(201, COMPLETED);
    const proven = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'ORD:promo-limit', refundUSD: '100.00', currency: 'USD', receipt: true });
    expect(calls[0].headers).toMatchObject({ Prefer: 'return=representation', 'PayPal-Request-Id': 'refund:ORD:promo-limit' });
    expect(proven).toMatchObject({ ok: true, final: true, httpStatus: 201 });
    expect(provenFullRefundID(proven, FULL)).toBe('REF-1');

    reply(500, COMPLETED);
    const contradictory = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(calls[1].headers).not.toHaveProperty('Prefer');
    expect(contradictory).toMatchObject({ ok: true, final: true }); // existing contract unchanged
    expect(provenFullRefundID(contradictory, FULL)).toBeNull();
  });

  it('the gate rejects pending, partial, other-currency, missing id and invalid expectations', () => {
    const ok = { ok: true, final: true, httpStatus: 200, refund: COMPLETED };
    expect(provenFullRefundID({ ...ok, final: false, refund: { ...COMPLETED, status: 'PENDING' } }, FULL)).toBeNull();
    expect(provenFullRefundID({ ...ok, refund: { ...COMPLETED, amount: { value: '50.00', currency_code: 'USD' } } }, FULL)).toBeNull();
    expect(provenFullRefundID({ ...ok, refund: { ...COMPLETED, amount: { value: '100.00', currency_code: 'usd' } } }, FULL)).toBeNull();
    expect(provenFullRefundID({ ...ok, refund: { ...COMPLETED, id: '  ' } }, FULL)).toBeNull();
    expect(provenFullRefundID(ok, { amountMinor: Number.NaN, currency: 'USD' })).toBeNull();
    expect(provenFullRefundID(ok, FULL)).toBe('REF-1');
  });
});

describe('classifyCaptureResponse — refunded', () => {
  const proof = { ok: false, code: 'PROMO_LIMIT_EXCEEDED', error: 'refunded', orderID: 'ORD-1', finalized: true, paymentStatus: 'REFUNDED', refundID: 'REF-1' };
  it('accepts only the exact proof for the same order (replayed included); anything else is never a terminal refund', () => {
    expect(classifyCaptureResponse({ ...proof, replayed: true }, 'ORD-1')).toEqual({ kind: 'refunded', message: 'refunded', refundID: 'REF-1' });
    for (const bad of [{ orderID: 'ORD-2' }, { ok: true }, { finalized: false }, { paymentStatus: 'REFUND_PENDING' }, { refundID: '' }, { code: 'DUPLICATE_ORDER' }]) {
      expect(classifyCaptureResponse({ ...proof, ...bad }, 'ORD-1').kind).not.toBe('refunded');
    }
  });
});
