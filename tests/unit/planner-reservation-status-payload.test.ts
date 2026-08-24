/**
 * Reservation status payload test (2026-08-24 planner-trust-course issue #4)
 * Ensures both quick preview and full planner request bodies include reservation_status when provided
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlannerFormValues } from '../../src/components/PlannerForm';

vi.mock('../../src/lib/firebase', () => ({
  auth: { currentUser: null },
}));

describe('Reservation status payload — quick preview', () => {
  it('buildQuickPreviewPayload includes reservation_status when present', async () => {
    const { buildQuickPreviewPayload } = await import('../../src/pages/PlannerPage/lib/quickPreviewIntent');

    const values: Partial<PlannerFormValues> = {
      regions: ['Busan'],
      categories: ['Food'],
      durationDays: 3,
      pax: 2,
      reservation_status: 'flight',
      arrivalAirport: 'ICN_T1',
      arrival_time: '14:00',
    };

    const payload = buildQuickPreviewPayload(values as PlannerFormValues, 'en');
    expect(payload.reservation_status).toBe('flight');
  });

  // 2026-08-24 (planner-trust-course, D: reservation payload parity) — this
  // used to assert the key was OMITTED when absent. That silent-omission
  // behavior is exactly what task D flags as unsafe: a caller regression that
  // leaves `values.reservation_status` undefined must still reach the server
  // as an explicit (undefined) value, not vanish from the payload, so the
  // server's MISSING_RESERVATION_STATUS check is the one place this gets
  // caught — not masked by the client conditionally dropping the key.
  it('buildQuickPreviewPayload always serializes reservation_status, even when absent (undefined)', async () => {
    const { buildQuickPreviewPayload } = await import('../../src/pages/PlannerPage/lib/quickPreviewIntent');

    const values: Partial<PlannerFormValues> = {
      regions: ['Busan'],
      categories: ['Food'],
      durationDays: 3,
      pax: 2,
    };

    const payload = buildQuickPreviewPayload(values as PlannerFormValues, 'en');
    expect(payload).toHaveProperty('reservation_status');
    expect(payload.reservation_status).toBeUndefined();
  });

  it('buildQuickPreviewPayload includes all four valid reservation_status values', async () => {
    const { buildQuickPreviewPayload } = await import('../../src/pages/PlannerPage/lib/quickPreviewIntent');

    for (const status of ['nothing', 'flight', 'flight_hotel', 'all_done']) {
      const values: Partial<PlannerFormValues> = {
        regions: ['Busan'],
        durationDays: 3,
        pax: 2,
        reservation_status: status as any,
      };

      const payload = buildQuickPreviewPayload(values as PlannerFormValues, 'en');
      expect(payload.reservation_status).toBe(status);
    }
  });
});

describe('Reservation status payload — normalizer & validator', () => {
  it('normalizeReservationStatus detects when field was never sent (legacy client)', async () => {
    const { normalizeReservationStatus } = await import('../../api/_shared/quickPreviewIntent.js');

    const result = normalizeReservationStatus({
      regions: ['Busan'],
      durationDays: 3,
    });

    expect(result.provided).toBe(false);
    expect(result.invalid).toBe(false);
    expect(result.status).toBeNull();
  });

  it('normalizeReservationStatus detects invalid value (live client sending garbage)', async () => {
    const { normalizeReservationStatus } = await import('../../api/_shared/quickPreviewIntent.js');

    const result = normalizeReservationStatus({
      reservation_status: 'invalid_status',
    });

    expect(result.provided).toBe(true);
    expect(result.invalid).toBe(true);
    expect(result.status).toBeNull();
  });

  it('normalizeReservationStatus accepts all valid values', async () => {
    const { normalizeReservationStatus } = await import('../../api/_shared/quickPreviewIntent.js');

    for (const status of ['nothing', 'flight', 'flight_hotel', 'all_done']) {
      const result = normalizeReservationStatus({
        reservation_status: status,
      });

      expect(result.provided).toBe(true);
      expect(result.invalid).toBe(false);
      expect(result.status).toBe(status);
    }
  });
});

describe('Reservation status validation — validateRequiredIntent', () => {
  it('validateRequiredIntent fails with INVALID_RESERVATION_STATUS when provided but invalid', async () => {
    const { normalizeQuickPreviewIntent, normalizeReservationStatus, validateRequiredIntent } =
      await import('../../api/_shared/quickPreviewIntent.js');

    const rawBody = {
      regions: ['Busan'],
      durationDays: 3,
      pax: 2,
      destination: 'Busan',
      reservation_status: 'garbage',
    };

    const { intent } = normalizeQuickPreviewIntent(rawBody);
    const reservation = normalizeReservationStatus(rawBody);
    const error = validateRequiredIntent(intent, reservation);

    expect(error?.code).toBe('INVALID_RESERVATION_STATUS');
  });

  it('validateRequiredIntent fails with MISSING_AIRPORT when flight booked but no airport', async () => {
    const { normalizeQuickPreviewIntent, normalizeReservationStatus, validateRequiredIntent } =
      await import('../../api/_shared/quickPreviewIntent.js');

    const rawBody = {
      regions: ['Busan'],
      durationDays: 3,
      pax: 2,
      destination: 'Busan',
      reservation_status: 'flight',
      // missing arrival_airport
    };

    const { intent } = normalizeQuickPreviewIntent(rawBody);
    const reservation = normalizeReservationStatus(rawBody);
    const error = validateRequiredIntent(intent, reservation);

    expect(error?.code).toBe('MISSING_AIRPORT');
  });

  it('validateRequiredIntent fails with MISSING_ARRIVAL_TIME when flight booked but no time', async () => {
    const { normalizeQuickPreviewIntent, normalizeReservationStatus, validateRequiredIntent } =
      await import('../../api/_shared/quickPreviewIntent.js');

    const rawBody = {
      regions: ['Busan'],
      durationDays: 3,
      pax: 2,
      destination: 'Busan',
      reservation_status: 'flight',
      arrival_airport: 'ICN_T1',
      // missing arrival_time
    };

    const { intent } = normalizeQuickPreviewIntent(rawBody);
    const reservation = normalizeReservationStatus(rawBody);
    const error = validateRequiredIntent(intent, reservation);

    expect(error?.code).toBe('MISSING_ARRIVAL_TIME');
  });

  it('validateRequiredIntent passes when flight booked with both airport and time', async () => {
    const { normalizeQuickPreviewIntent, normalizeReservationStatus, validateRequiredIntent } =
      await import('../../api/_shared/quickPreviewIntent.js');

    const rawBody = {
      regions: ['Busan'],
      durationDays: 3,
      pax: 2,
      destination: 'Busan',
      reservation_status: 'flight',
      arrival_airport: 'ICN_T1',
      arrival_time: '14:00',
    };

    const { intent } = normalizeQuickPreviewIntent(rawBody);
    const reservation = normalizeReservationStatus(rawBody);
    const error = validateRequiredIntent(intent, reservation);

    expect(error).toBeNull();
  });

  it('validateRequiredIntent requires reservation_status even from legacy clients (no absent-key leniency)', async () => {
    // 2026-08-24 (planner-trust-course hardening): the old absent-key leniency
    // let a client silently skip reservation_status entirely — removed per
    // explicit instruction. A client that never sends the key now fails
    // exactly like one that sends it blank.
    const { normalizeQuickPreviewIntent, normalizeReservationStatus, validateRequiredIntent } =
      await import('../../api/_shared/quickPreviewIntent.js');

    const rawBody = {
      regions: ['Busan'],
      durationDays: 3,
      pax: 2,
      destination: 'Busan',
      // no reservation_status at all — must now fail closed, not pass leniently
    };

    const { intent } = normalizeQuickPreviewIntent(rawBody);
    const reservation = normalizeReservationStatus(rawBody);
    const error = validateRequiredIntent(intent, reservation);

    expect(error?.code).toBe('MISSING_RESERVATION_STATUS');
  });
});

describe('Reservation status payload — shared canonical field builder (2026-08-24, D)', () => {
  // buildReservationStatusField is the ONE place quick preview, normal full
  // submit, and revision submit all pull reservation_status from — this locks
  // its raw-pass-through behavior for all 4 wizard values plus the absent
  // case, without grepping usePlannerHandlers.ts's three call sites by hand.
  it('always returns a reservation_status key, raw pass-through, for all 4 values and absent', async () => {
    const { buildReservationStatusField } = await import('../../src/pages/PlannerPage/lib/reservationStatusField');

    for (const status of ['nothing', 'flight', 'flight_hotel', 'all_done'] as const) {
      expect(buildReservationStatusField({ reservation_status: status })).toEqual({ reservation_status: status });
    }
    const absent = buildReservationStatusField({ reservation_status: undefined });
    expect(absent).toHaveProperty('reservation_status');
    expect(absent.reservation_status).toBeUndefined();
  });

  it('never defaults — an empty-string caller regression passes through unchanged, not coerced to "nothing"', async () => {
    const { buildReservationStatusField } = await import('../../src/pages/PlannerPage/lib/reservationStatusField');
    // Cast: PlannerFormValues' type only allows the 4 enum values, but a
    // caller regression (e.g. a stale form reset) could still hand this
    // helper an empty string at runtime — it must not silently upgrade that
    // to a valid-looking default.
    const result = buildReservationStatusField({ reservation_status: '' as unknown as PlannerFormValues['reservation_status'] });
    expect(result.reservation_status).toBe('');
  });
});
