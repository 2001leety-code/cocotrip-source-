// 2026-08-24 (planner-trust-course): the client (src/pages/PlannerPage/lib/
// quickPreviewIntent.ts) and server (api/_shared/quickPreviewIntent.js) each
// carry their own copy of "what fields does a quick-preview request forward",
// because api/ and src/ don't cross-import. This test is the guard promised in
// both files' comments — it feeds the client builder's output straight into
// the server normalizer and checks every field round-trips.
import { describe, it, expect } from 'vitest';
import { buildQuickPreviewPayload } from '../../src/pages/PlannerPage/lib/quickPreviewIntent';
import type { PlannerFormValues } from '../../src/components/PlannerForm';
import {
  normalizeQuickPreviewIntent,
  normalizeReservationStatus,
  buildReflectedConditions,
} from '../../api/_shared/quickPreviewIntent.js';

function baseValues(overrides: Partial<PlannerFormValues> = {}): PlannerFormValues {
  return {
    categories: ['K-food'],
    regions: ['Seoul'],
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    cityKey: 'seoul',
    durationDays: 3,
    pax: 2,
    ...overrides,
  };
}

describe('quick-preview intent parity (client -> server)', () => {
  it('round-trips destination/cityKey/dates/duration/pax', () => {
    const values = baseValues();
    const payload = JSON.parse(JSON.stringify(buildQuickPreviewPayload(values, 'en')));
    const { intent } = normalizeQuickPreviewIntent(payload);
    expect(intent.destination).toBe('Seoul');
    expect(intent.cityKey).toBe('seoul');
    expect(intent.startDate).toBe('2026-09-01');
    expect(intent.endDate).toBe('2026-09-03');
    expect(intent.durationDays).toBe(3);
    expect(intent.pax).toBe(2);
  });

  it('never fabricates durationDays=3 or pax=2 for missing/zero values', () => {
    const values = baseValues({ durationDays: undefined, pax: 0 });
    const payload = JSON.parse(JSON.stringify(buildQuickPreviewPayload(values, 'en')));
    expect(payload.durationDays).toBeUndefined();
    expect(payload.pax).toBe(0);
    const { intent } = normalizeQuickPreviewIntent(payload);
    expect(Number.isNaN(intent.durationDays)).toBe(true);
    expect(intent.pax).toBe(0);
  });

  it('reservation_status: forwarded when present, omitted (not defaulted) when absent', () => {
    const withStatus = JSON.parse(JSON.stringify(
      buildQuickPreviewPayload(baseValues({ reservation_status: 'flight' }), 'en'),
    ));
    expect(normalizeReservationStatus(withStatus)).toEqual({ status: 'flight', provided: true, invalid: false });

    const without = JSON.parse(JSON.stringify(buildQuickPreviewPayload(baseValues(), 'en')));
    expect(Object.prototype.hasOwnProperty.call(without, 'reservation_status')).toBe(false);
    expect(normalizeReservationStatus(without)).toEqual({ status: null, provided: false, invalid: false });
  });

  it('an unrecognized reservation_status is invalid, not silently "nothing"', () => {
    const payload = JSON.parse(JSON.stringify(buildQuickPreviewPayload(baseValues(), 'en')));
    payload.reservation_status = 'garbage';
    expect(normalizeReservationStatus(payload)).toEqual({ status: null, provided: true, invalid: true });
  });

  it('arrival_city is preserved separately from and preferred over entry_city', () => {
    const values = baseValues({ arrival_city: 'busan', entry_city: 'seoul' });
    const payload = JSON.parse(JSON.stringify(buildQuickPreviewPayload(values, 'en')));
    expect(payload.arrival_city).toBe('busan');
    expect(payload.entry_city).toBe('seoul');
    const { intent } = normalizeQuickPreviewIntent(payload);
    expect(intent.arrivalCity).toBe('busan');
    expect(intent.entryCity).toBe('seoul');
  });

  it('departure_time round-trips', () => {
    const values = baseValues({ departure_time: '18:30' });
    const payload = JSON.parse(JSON.stringify(buildQuickPreviewPayload(values, 'en')));
    const { intent } = normalizeQuickPreviewIntent(payload);
    expect(intent.departureTime).toBe('18:30');
  });

  it('canonical empty dietaryRestrictions beats a stale legacy allergies array', () => {
    const values = baseValues({ dietaryRestrictions: [] });
    const payload = JSON.parse(JSON.stringify(buildQuickPreviewPayload(values, 'en')));
    // simulate a stale legacy field a caller might still attach
    (payload as Record<string, unknown>).allergies = ['Halal'];
    const { intent } = normalizeQuickPreviewIntent(payload);
    expect(intent.dietaryRestrictions).toEqual([]);
  });

  it('mobility "ok" (the WizardForm baseline) never counts as covered', () => {
    const values = baseValues({ mobility: 'ok' });
    const payload = JSON.parse(JSON.stringify(buildQuickPreviewPayload(values, 'en')));
    const { intent, coverage } = normalizeQuickPreviewIntent(payload);
    expect(intent.mobility).toBe('ok');
    expect(coverage.mobility).toBe(false);
    expect(buildReflectedConditions(coverage, 'en')).not.toContain('Your mobility needs');
  });

  it('empty/false brief -> every coverage flag reads false, no visible condition labels', () => {
    const values = baseValues({
      dietPrefs: [], dietaryRestrictions: [], hotel_address: '', recommended_zone: '',
      tourPace: '', luggage: undefined, companions: '', freeText: '',
      arrival_city: '', entry_city: '', departure_city: '', priceRange: 'Any',
    });
    const payload = JSON.parse(JSON.stringify(buildQuickPreviewPayload(values, 'en')));
    const { coverage } = normalizeQuickPreviewIntent(payload);
    // destination/dates come from baseValues() itself (always-required, not
    // optional "condition" signals) — every optional coverage flag must read false.
    const optionalFlags = ['airport', 'hotel', 'zone', 'mobility', 'pace', 'luggage', 'companions', 'foodStyle', 'dietary', 'priceRange', 'specialRequest', 'entryExitCities'];
    for (const key of optionalFlags) expect(coverage[key]).toBe(false);
    // only the always-required dates signal (from baseValues itself) shows up —
    // no optional-condition label leaks through for an otherwise-empty brief.
    expect(buildReflectedConditions(coverage, 'en')).toEqual(['Your travel dates']);
  });
});
