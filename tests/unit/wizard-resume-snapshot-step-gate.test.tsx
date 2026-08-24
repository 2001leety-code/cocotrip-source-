// @vitest-environment jsdom
//
// 2026-08-24 (planner-trust-course, F2/F4): applyResumeSnapshot used to trust
// the saved snapshot's `step` verbatim. A legacy snapshot saved before Step 0
// (reservation status) existed — or one edited/replayed by hand — can carry
// `step: 4` (Review) with no `reservationStatus` at all. Restoring it must not
// drop the traveller straight onto the free-preview Review screen, bypassing
// a required gate that a fresh run through the wizard would have enforced.
// Locks: Continue clamps to the highest step the restored *values* actually
// unlock, never the stored step number verbatim.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.hoisted(() => {
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {};
});

const dict = new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? k : '') });
vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { planner: dict }, language: 'en' }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/notify', () => ({ requestNotifyPermission: vi.fn() }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../src/components/WizardForm/WizardStepHint', () => ({ WizardStepHint: () => null }));

// A legacy snapshot: fully filled through Step 3 (Details) but missing
// `reservationStatus` entirely (saved before Step 0 existed, or hand-edited
// localStorage) — and stored with `step: 4` (Review), which a real run
// through the wizard could never reach without a reservation status.
const LEGACY_SNAPSHOT_VALUES = {
  mainCity: 'Seoul',
  mainCityKey: 'seoul',
  extraCities: [],
  selectedActivities: ['Food'],
  freeText: '',
  dietPrefs: [],
  dietaryRestrictions: [],
  priceRange: 'Any',
  spiceLevel: 'medium',
  bucketDishes: [],
  dateRangeFrom: '2026-09-01',
  dateRangeTo: '2026-09-03',
  paxInput: '2',
  arrivalTerminal: 'ICN_T1',
  departureTerminal: '',
  hotelAddress: '',
  arrivalTime: '10:00',
  departureTime: '',
  tourStartTime: '09:00',
  tourEndTime: '21:00',
  luggageSmall: 0, luggageMedium: 0, luggageLarge: 0,
  wantAccom: false, accomBudget: 'moderate',
  recommendedZones: {},
  tourPace: 'full',
  companions: '',
  // reservationStatus intentionally absent — legacy shape.
};

vi.mock('@/hooks/useWizardPersistence', () => ({
  useWizardPersistence: () => ({ clear: vi.fn() }),
  loadFreshestWizardSnapshot: () => ({
    snapshot: { values: LEGACY_SNAPSHOT_VALUES, step: 4 },
    staleSource: null,
  }),
  clearWizardSnapshot: vi.fn(),
  clearPlannerWizardSnapshot: vi.fn(),
  markWizardDirtyExit: vi.fn(),
  PLANNER_WIZARD_NS: 'planner',
  PLANNER_WIZARD_PAUSED_NS: 'planner_paused',
}));

function stub(name: string) {
  return () => <p>{name} 화면</p>;
}
vi.mock('../../src/components/WizardForm/WizardStep0Reservation', () => ({ WizardStep0Reservation: stub('예약') }));
vi.mock('../../src/components/WizardForm/WizardStep0Destination', () => ({ WizardStep0Destination: stub('도시') }));
vi.mock('../../src/components/WizardForm/WizardStep1Food', () => ({ WizardStep1Food: stub('음식') }));
vi.mock('../../src/components/WizardForm/WizardStep2Details', () => ({ WizardStep2Details: stub('상세') }));
vi.mock('../../src/components/WizardForm/WizardStep3Review', () => ({ WizardStep3Review: stub('검토') }));

const { WizardForm } = await import('../../src/components/WizardForm');

void React;

async function flushLazy() {
  await new Promise((r) => setTimeout(r, 0));
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('resume snapshot cannot bypass Step 0', () => {
  it('Continue clamps to the highest step the restored values actually unlock, not the stored step', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true }));
    render(<WizardForm onSubmit={onSubmit} isLoading={false} />);
    await flushLazy();

    // Resume modal shows (legacy snapshot has plenty of meaningful signals).
    expect(screen.getByText('Continue where you left off?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await flushLazy();

    // reservationStatus was never in the snapshot -> Step 0 never validates,
    // so restoring must land back on Step 0 (Reservation), never jump to the
    // stored step: 4 (Review) where a free preview could be generated.
    expect(screen.getByText('예약 화면')).toBeTruthy();
    expect(screen.queryByText('검토 화면')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
