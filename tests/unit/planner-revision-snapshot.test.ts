// @vitest-environment jsdom
// 2026-08-24 (planner-intent-v1 §3): plannerRevisionSnapshot.ts binds a
// revision brief to the specific plan it came from, storing nothing but the
// travel preferences a fresh wizard session needs. This guards: plan-binding
// (one plan's snapshot never populates another), version gating, malformed
// JSON falling back to null, and the PII/allergy exclusions the module's own
// header promises.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  writePlannerRevisionSnapshot,
  readPlannerRevisionSnapshot,
  clearPlannerRevisionSnapshot,
} from '../../src/pages/PlannerPage/lib/plannerRevisionSnapshot';
import type { PlannerFormValues } from '../../src/components/PlannerForm';

const STORAGE_KEY = 'cocotrip:planner-revision-intent-v1';

function fullValues(overrides: Partial<PlannerFormValues> = {}): PlannerFormValues {
  return {
    categories: ['K-food'],
    regions: ['Seoul'],
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    pax: 2,
    arrival_airport: 'ICN',
    hotel_address: '서울 강남구',
    recommended_zones: { seoul: 'gangnam' },
    reservation_status: 'flight_hotel',
    tourPace: 'full',
    dietPrefs: ['Seafood'],
    dietaryRestrictions: ['Vegan'],
    companions: 'family',
    wantAccom: true,
    accomBudget: 'moderate',
    freeText: 'Loved the market tour, want more shopping.',
    ...overrides,
  };
}

describe('planner revision snapshot (sessionStorage, versioned + plan-bound)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('round-trips a full brief for the same planId', () => {
    writePlannerRevisionSnapshot('plan-abc', fullValues());
    const snap = readPlannerRevisionSnapshot('plan-abc');
    expect(snap).not.toBeNull();
    expect(snap!.planId).toBe('plan-abc');
    expect(snap!.version).toBe(1);
    expect(snap!.values.endDate).toBe('2026-09-03');
    expect(snap!.values.recommended_zones).toEqual({ seoul: 'gangnam' });
    expect(snap!.values.reservation_status).toBe('flight_hotel');
    expect(snap!.values.dietaryRestrictions).toEqual(['Vegan']);
  });

  it('never lets one plan\'s snapshot populate a different plan', () => {
    writePlannerRevisionSnapshot('plan-abc', fullValues());
    expect(readPlannerRevisionSnapshot('plan-xyz')).toBeNull();
  });

  it('malformed JSON in storage falls back to null, not a throw', () => {
    sessionStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(readPlannerRevisionSnapshot('plan-abc')).toBeNull();
  });

  it('a wrong/older version falls back to null', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, planId: 'plan-abc', values: {} }));
    expect(readPlannerRevisionSnapshot('plan-abc')).toBeNull();
  });

  it('stores no email, uid, payment/order IDs, revision token, or share token', () => {
    writePlannerRevisionSnapshot('plan-abc', fullValues({ uid: 'user-123' }));
    const raw = sessionStorage.getItem(STORAGE_KEY) || '';
    expect(raw).not.toContain('user-123');
    expect(raw.toLowerCase()).not.toContain('email');
    expect(raw.toLowerCase()).not.toContain('token');
    expect(raw.toLowerCase()).not.toContain('paypal');
  });

  it('discards a legacy medical-allergen value, keeps only Halal/Vegan/Vegetarian', () => {
    writePlannerRevisionSnapshot('plan-abc', fullValues({
      dietaryRestrictions: ['Vegan', 'Nuts', 'Shellfish'] as unknown as string[],
    }));
    const snap = readPlannerRevisionSnapshot('plan-abc');
    expect(snap!.values.dietaryRestrictions).toEqual(['Vegan']);
  });

  it('bounds specialRequest/freeText length', () => {
    writePlannerRevisionSnapshot('plan-abc', fullValues({ freeText: 'x'.repeat(2000) }));
    const snap = readPlannerRevisionSnapshot('plan-abc');
    expect(snap!.values.freeText!.length).toBe(1000);
  });

  it('carries revision reasonCodes/note/avoidStopNames when supplied', () => {
    writePlannerRevisionSnapshot('plan-abc', fullValues(), {
      reasonCodes: ['wrong_pace'],
      note: 'too rushed',
      avoidStopNames: ['광장시장'],
    });
    const snap = readPlannerRevisionSnapshot('plan-abc');
    expect(snap!.revision).toEqual({ reasonCodes: ['wrong_pace'], note: 'too rushed', avoidStopNames: ['광장시장'] });
  });

  it('clearPlannerRevisionSnapshot removes it', () => {
    writePlannerRevisionSnapshot('plan-abc', fullValues());
    clearPlannerRevisionSnapshot();
    expect(readPlannerRevisionSnapshot('plan-abc')).toBeNull();
  });

  it('no planId never writes anything', () => {
    writePlannerRevisionSnapshot('', fullValues());
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
