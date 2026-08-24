/**
 * 2026-08-24 (planner-trust-course): computeWizardGate's `canStep3` used to
 * accept dates purely by lexicographic string comparison
 * (`!!startDate && !!endDate && endDate >= startDate`) — a shape-valid but
 * nonexistent date like "2026-02-31" passed straight through with no real
 * calendar validation. Locks that computeWizardGate now round-trips both
 * dates through a real calendar (dateOnly.ts) before comparing them, and that
 * the KST "must start tomorrow or later" rule is exercised at real
 * day-boundary/non-UTC-timezone instants (not just an arbitrary fixed date).
 */
import { describe, it, expect } from 'vitest';
import { computeWizardGate, kstTodayISO } from '../../src/components/WizardForm/wizardGate';

const BASE = {
  reservationStatus: 'nothing' as const,
  arrivalAirport: 'ICN_T1',
  arrivalTime: '',
  mainCity: 'Seoul',
  selectedActivities: ['Food'],
  pax: 2,
};

describe('computeWizardGate — real canonical-date validation, not lexicographic-only', () => {
  it('rejects a shape-valid but nonexistent start date (Feb 31)', () => {
    const r = computeWizardGate({ ...BASE, startDate: '2026-02-31', endDate: '2026-03-02', nowKstDate: '2026-01-01' });
    expect(r.canStep3).toBe(false);
  });

  it('rejects a shape-valid but nonexistent end date', () => {
    const r = computeWizardGate({ ...BASE, startDate: '2026-03-02', endDate: '2026-04-31', nowKstDate: '2026-01-01' });
    expect(r.canStep3).toBe(false);
  });

  it('rejects garbage date strings', () => {
    const r = computeWizardGate({ ...BASE, startDate: 'banana', endDate: '2026-03-02', nowKstDate: '2026-01-01' });
    expect(r.canStep3).toBe(false);
  });

  it('a lexicographically-later-looking but noncanonical end date no longer sneaks past a real endDate<startDate check', () => {
    // "2026-3-2" sorts after "2026-02-31" lexicographically but is not
    // canonical shape — must fail as malformed, not "pass because it compares
    // greater as a string".
    const r = computeWizardGate({ ...BASE, startDate: '2026-02-31', endDate: '2026-3-2', nowKstDate: '2026-01-01' });
    expect(r.canStep3).toBe(false);
  });

  it('still accepts real, well-formed, ascending dates', () => {
    const r = computeWizardGate({ ...BASE, startDate: '2026-03-02', endDate: '2026-03-05', nowKstDate: '2026-01-01' });
    expect(r.canStep3).toBe(true);
  });
});

describe('computeWizardGate — KST day-boundary and non-UTC host timezone', () => {
  it('a start date equal to KST "today" is blocked (must be strictly after)', () => {
    const r = computeWizardGate({ ...BASE, startDate: '2026-08-25', endDate: '2026-08-27', nowKstDate: '2026-08-25' });
    expect(r.canStep3).toBe(false);
  });

  it('a start date of KST tomorrow is allowed', () => {
    const r = computeWizardGate({ ...BASE, startDate: '2026-08-26', endDate: '2026-08-28', nowKstDate: '2026-08-25' });
    expect(r.canStep3).toBe(true);
  });

  it('isRevision bypasses the "must start in the future" rule but not real-date validation', () => {
    const pastButReal = computeWizardGate({
      ...BASE, startDate: '2026-08-20', endDate: '2026-08-22', nowKstDate: '2026-08-25', isRevision: true,
    });
    expect(pastButReal.canStep3).toBe(true);

    const pastAndFake = computeWizardGate({
      ...BASE, startDate: '2026-02-31', endDate: '2026-08-22', nowKstDate: '2026-08-25', isRevision: true,
    });
    expect(pastAndFake.canStep3).toBe(false);
  });

  it('kstTodayISO gives the same calendar day for a UTC instant already past the KST midnight boundary, regardless of what the host machine believes "today" is', () => {
    // 2026-08-24T15:30:00Z is already 2026-08-25 00:30 in KST.
    const now = new Date('2026-08-24T15:30:00Z');
    expect(kstTodayISO(now)).toBe('2026-08-25');
    // A traveler whose real-clock "now" is this instant must be blocked from
    // picking 2026-08-25 as a start date (that's KST-today, not KST-tomorrow).
    const r = computeWizardGate({
      ...BASE, startDate: '2026-08-25', endDate: '2026-08-27', nowKstDate: kstTodayISO(now),
    });
    expect(r.canStep3).toBe(false);
  });
});
