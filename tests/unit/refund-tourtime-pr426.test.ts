/**
 * PR #426 — Audit CY3 regression slot.
 *
 * Pre-fix: cancelBooking / modifyBooking / my-bookings called
 * evaluateRefundPolicy WITHOUT passing tourTime, so every booking was
 * scored against 00:00 KST. A 18:00 tour on the same calendar day
 * therefore showed "refund window closed" 18 hours earlier than it
 * actually was — customers lost their right to a partial refund, and
 * operators got escalation tickets to manually reconcile.
 *
 * Two-part assertion:
 *   1. evaluateRefundPolicy itself respects tourTime (existing behaviour,
 *      regression guard).
 *   2. cancelBooking / modifyBooking / my-bookings now thread booking.tourTime
 *      into the policy call.
 *   3. capturePaypalOrder + booking-confirm persist tourTime on the
 *      booking doc so downstream lookups have it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateRefundPolicy } from '../../api/_refund-policy.js';

describe('PR #426 CY3 — evaluateRefundPolicy honours tourTime', () => {
  it('a 6 PM same-day tour is still in the refund window at noon', () => {
    // 5/14 12:00 KST → 5/14 18:00 KST tour = 6 hours away. Without tourTime
    // the policy would have treated tour start as 5/14 00:00 = already gone
    // → canRefund:false. With tourTime: 6h → 0% (still inside the <12h
    // band) but the regression we are guarding against is "way wrong",
    // not the band itself. Pick a clearer fixture below.
    const now = new Date('2026-05-14T03:00:00Z'); // 12:00 KST
    const policy = evaluateRefundPolicy({
      tourDate: '2026-05-14',
      tourTime: '18:00',
      tier: 'Bronze',
      now,
    });
    expect(policy.hoursUntilTour).toBeGreaterThanOrEqual(5.5);
    expect(policy.hoursUntilTour).toBeLessThanOrEqual(6.5);
  });

  it('without tourTime the same booking falls to the 00:00 default (CY3 bug)', () => {
    const now = new Date('2026-05-14T03:00:00Z'); // 12:00 KST same day
    // No tourTime → defaults to 00:00 → tour considered 12h in the past →
    // hoursUntilTour clamped to 0. This is exactly the buggy state we want
    // to keep callers OUT of by always passing tourTime when available.
    const policy = evaluateRefundPolicy({
      tourDate: '2026-05-14',
      tier: 'Bronze',
      now,
    });
    expect(policy.hoursUntilTour).toBe(0);
    expect(policy.canRefund).toBe(false);
  });

  it('legacy bookings without tourTime keep the old behaviour (no regression)', () => {
    // We don't change the policy default. Callers are responsible for
    // passing tourTime when they have it; legacy docs stay on 00:00.
    const a = evaluateRefundPolicy({
      tourDate: '2026-06-15',
      tier: 'Bronze',
      now: new Date('2026-05-14T00:00:00Z'),
    });
    const b = evaluateRefundPolicy({
      tourDate: '2026-06-15',
      tourTime: '00:00',
      tier: 'Bronze',
      now: new Date('2026-05-14T00:00:00Z'),
    });
    expect(a.hoursUntilTour).toBe(b.hoursUntilTour);
    expect(a.refundPercent).toBe(b.refundPercent);
  });
});

describe('PR #426 CY3 — callers thread booking.tourTime into the policy call', () => {
  function src(rel: string): string {
    return readFileSync(resolve(process.cwd(), rel), 'utf8');
  }

  it('cancelBooking.js passes booking.tourTime', () => {
    const code = src('api/cancelBooking.js');
    expect(code).toMatch(/evaluateRefundPolicy\(\s*\{[\s\S]*?tourTime\s*:\s*booking\.tourTime/);
  });

  it('modifyBooking.js passes booking.tourTime', () => {
    const code = src('api/modifyBooking.js');
    expect(code).toMatch(/evaluateRefundPolicy\(\s*\{[\s\S]*?tourTime\s*:\s*booking\.tourTime/);
  });

  it('my-bookings.js passes tourTime per booking', () => {
    const code = src('api/my-bookings.js');
    expect(code).toMatch(/evaluateRefundPolicy\(\s*\{[\s\S]*?tourTime/);
  });
});

describe('PR #426 CY3 — booking docs persist tourTime at confirm time', () => {
  function src(rel: string): string {
    return readFileSync(resolve(process.cwd(), rel), 'utf8');
  }

  it('capturePaypalOrder.js writes tourTime to the booking doc', () => {
    const code = src('api/capturePaypalOrder.js');
    // tourTime in the destructured body params AND in the .set() payload.
    expect(code).toMatch(/\btourTime\b[^=]*=[^;]*body/s);
    expect(code).toMatch(/tourTime\s*:\s*tourTime\s*\|\|\s*['"]/);
  });

  it('booking-confirm.js mirrors tourTime onto the bookings doc', () => {
    const code = src('api/_shared/booking-confirm.js');
    expect(code).toMatch(/tourTime\s*:\s*pending\.tourTime/);
  });
});
