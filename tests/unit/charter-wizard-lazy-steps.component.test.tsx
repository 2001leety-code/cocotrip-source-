// @vitest-environment jsdom
import React, { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const fixture = vi.hoisted(() => {
  let releaseStep2 = () => {};
  const step2Promise = new Promise<void>((resolve) => { releaseStep2 = resolve; });
  return {
    snapshot: null as unknown,
    step2Pending: true,
    step2Promise,
    releaseStep2: () => releaseStep2(),
  };
});

vi.mock('@/hooks/useQuoteCalculator', () => ({
  useQuoteCalculator: () => ({
    quote: { subtotalKRW: 123000, needsCustomQuote: false },
    loading: false,
    geocodingFailed: false,
    distanceSource: null,
  }),
}));
vi.mock('@/lib/charterRouteKm', () => ({ useCharterRouteKm: () => ({ routeKm: null, routeCoords: null }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => ({ profile: null }) }));
vi.mock('@/hooks/useProfileContactSync', () => ({ useProfileContactSync: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/firebase-auth', () => ({ signInWithGoogle: vi.fn() }));
vi.mock('@/lib/profilePrefill', () => ({ mergeProfileDefaults: (state: unknown) => state, normalizeProfilePhone: (phone: string) => phone }));
vi.mock('../../src/components/charter/useCharterFunnelTracking', () => ({ useCharterFunnelTracking: vi.fn() }));
vi.mock('@/hooks/useWizardPersistence', () => ({
  loadWizardSnapshot: () => fixture.snapshot,
  useWizardPersistence: () => ({ clear: vi.fn() }),
  clearWizardSnapshot: vi.fn(),
}));
vi.mock('../../src/components/coco/CocoUI', () => ({ CocoStepper: () => null }));
vi.mock('../../src/components/ResumeWizardModal', () => ({
  ResumeWizardModal: ({ open, onContinue }: { open: boolean; onContinue: () => void }) => open
    ? <button type="button" onClick={onContinue}>Continue saved charter</button>
    : null,
}));
vi.mock('../../src/components/charter/Step1Origin', () => ({
  Step1Origin: ({ state, patch }: { state: { origin?: string }; patch: (value: { origin: string }) => void }) => (
    <div>
      <p>Step 1 origin</p>
      <button type="button" onClick={() => patch({ origin: 'ICN' })}>Set origin</button>
      <span>{state.origin}</span>
    </div>
  ),
}));
vi.mock('../../src/components/charter/Step2Service', () => ({
  Step2Service: ({ state }: { state: { origin?: string } }) => {
    if (fixture.step2Pending) throw fixture.step2Promise;
    return <p>Step 2 origin: {state.origin}</p>;
  },
}));
vi.mock('../../src/components/charter/Step3Destination', () => ({ Step3Destination: () => <p>Step 3</p> }));
vi.mock('../../src/components/charter/Step4PaxVehicle', () => ({ Step4PaxVehicle: () => <p>Step 4</p> }));
vi.mock('../../src/components/charter/Step5DateOptions', () => ({
  Step5DateOptions: ({ state, termsAgreed, onTermsChange }: {
    state: { customerName?: string };
    termsAgreed: boolean;
    onTermsChange: (agreed: boolean) => void;
  }) => (
    <div>
      <p>Step 5 guest: {state.customerName}</p>
      <button type="button" aria-pressed={termsAgreed} onClick={() => onTermsChange(true)}>Agree to terms</button>
    </div>
  ),
}));
vi.mock('../../src/components/charter/Step6Quote', () => ({ Step6Quote: () => <p>Step 6 quote</p> }));
vi.mock('../../src/components/charter/InquiryForm', () => ({ InquiryForm: () => <p>Inquiry form</p> }));

const { CharterWizard } = await import('../../src/components/charter/CharterWizard');

beforeEach(() => { fixture.snapshot = null; });
afterEach(cleanup);

function renderWizard(props: React.ComponentProps<typeof CharterWizard> = {}) {
  return render(
    <Suspense fallback={<div role="status">Loading step</div>}>
      <CharterWizard {...props} />
    </Suspense>,
  );
}

describe('CharterWizard deferred steps', () => {
  it('keeps the current step controls out while the next chunk loads and carries edited state forward', async () => {
    const { container } = renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'Set origin' }));
    const next = screen.getByRole('button', { name: 'Next' });

    fireEvent.click(next);
    expect(screen.getByRole('status').textContent).toBe('Loading step');
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    fireEvent.click(next);

    fixture.step2Pending = false;
    fixture.releaseStep2();
    expect(await screen.findByText('Step 2 origin: ICN')).toBeTruthy();
    expect(container.textContent).not.toContain('Step 1 origin');
    expect(screen.queryByText('Step 3')).toBeNull();
  });

  it('restores at step 5, keeps the consent gate, and passes consent into payment completion', async () => {
    fixture.snapshot = {
      values: {
        state: {
          origin: 'SEL_METRO', service: 'day_tour', destinationKey: 'seoul-central',
          startDate: '2099-09-01', pickupTime: '09:00', customerName: 'Fixture Guest',
          customerPhone: '+821012345678', paxCount: 2, vehicle: 'staria',
        },
        manualKm: null,
      },
      step: 5,
    };
    const onComplete = vi.fn();
    renderWizard({ onComplete });

    fireEvent.click(screen.getByRole('button', { name: 'Continue saved charter' }));
    expect(screen.getByRole('status').textContent).toBe('Loading step');
    expect(await screen.findByText('Step 5 guest: Fixture Guest')).toBeTruthy();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(next.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Agree to terms' }));
    expect(next.hasAttribute('disabled')).toBe(false);
    fireEvent.click(next);
    expect(await screen.findByText('Step 6 quote')).toBeTruthy();

    const pay = screen.getByRole('button', { name: 'Proceed to Pay' });
    expect(pay.hasAttribute('disabled')).toBe(false);
    fireEvent.click(pay);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ customerName: 'Fixture Guest', origin: 'SEL_METRO' }),
      { termsAgreed: true, marketingConsent: false },
    );
  });
});
