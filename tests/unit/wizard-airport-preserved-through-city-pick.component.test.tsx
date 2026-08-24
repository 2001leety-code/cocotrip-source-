// @vitest-environment jsdom
//
// 2026-08-24 (planner-trust-course): integration lock for the airport-before-
// city scenarios — picking an airport from Step 0's global list (no city
// chosen yet), then picking a city on Step 1, must not silently erase a
// still-valid airport just because the picked city's own AIRPORT_OPTIONS
// shortlist doesn't happen to repeat it. Uses the REAL WizardStep0Reservation
// and WizardStep0Destination components (both light enough for jsdom) so the
// actual `mainCityKey` wiring + erase-on-change effect are exercised, not a
// stand-in.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup, within, waitFor } from '@testing-library/react';

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
vi.mock('@/hooks/useWizardPersistence', () => ({
  useWizardPersistence: () => ({ clear: vi.fn() }),
  loadFreshestWizardSnapshot: () => null,
  clearWizardSnapshot: vi.fn(),
  clearPlannerWizardSnapshot: vi.fn(),
  markWizardDirtyExit: vi.fn(),
  PLANNER_WIZARD_NS: 'planner',
  PLANNER_WIZARD_PAUSED_NS: 'planner_paused',
}));
vi.mock('@/components/ResumeWizardModal', () => ({ ResumeWizardModal: () => null }));
vi.mock('../../src/components/WizardForm/WizardStepHint', () => ({ WizardStepHint: () => null }));

// Step0Reservation and Step0Destination are the REAL components — not mocked.
vi.mock('../../src/components/WizardForm/WizardStep1Food', () => ({
  WizardStep1Food: ({ onNext }: { onNext: () => void }) => (
    <div><p>food-screen</p><button type="button" onClick={onNext}>food-next</button></div>
  ),
}));
vi.mock('../../src/components/WizardForm/WizardStep2Details', () => ({
  WizardStep2Details: () => <div><p>details-screen</p></div>,
}));
vi.mock('../../src/components/WizardForm/WizardStep3Review', () => ({
  WizardStep3Review: () => <div><p>review-screen</p></div>,
}));

const { WizardForm } = await import('../../src/components/WizardForm');

void React;

async function flushLazy(container: HTMLElement) {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  await waitFor(() => {
    if (container.querySelector('.animate-spin')) throw new Error('still on Suspense fallback');
  }, { timeout: 3000, interval: 20 });
}

afterEach(() => { cleanup(); });

function renderWizard() {
  return render(<WizardForm onSubmit={async () => ({ ok: true })} isLoading={false} />);
}

/** Step 0: pick "flight" status (reveals the airport dropdown), fill airport
 *  + arrival time (both required for this step to validate and unlock Step 1). */
function pickAirportOnStep0(container: HTMLElement, code: string) {
  const flightBtn = Array.from(container.querySelectorAll('button'))
    .find((b) => b.textContent?.includes('resFlightTitle'));
  fireEvent.click(flightBtn!);
  const select = container.querySelector('select') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: code } });
  const timeInput = container.querySelector('input[type="time"]') as HTMLInputElement;
  fireEvent.change(timeInput, { target: { value: '14:30' } });
}

function airportSelectValue(container: HTMLElement): string {
  const select = container.querySelector('select') as HTMLSelectElement;
  return select.value;
}

/** Step 1 (Destination, tick index 1): click the city chip for `cityKey`. */
function pickCity(container: HTMLElement, cityKey: string) {
  const label = within(container).getByText(`city_${cityKey}`);
  const btn = label.closest('button');
  fireEvent.click(btn!);
}

function ticks(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('ol > li > button'));
}

describe('an airport picked before any city is chosen survives a later city pick', () => {
  it('PUS (Busan\'s airport) survives picking Busan as the city', async () => {
    const { container } = renderWizard();
    await flushLazy(container);
    pickAirportOnStep0(container, 'PUS');
    expect(airportSelectValue(container)).toBe('PUS');

    fireEvent.click(ticks(container)[1]); // -> Destination step
    await flushLazy(container);
    pickCity(container, 'busan');

    fireEvent.click(ticks(container)[0]); // back to Reservation
    await flushLazy(container);
    expect(airportSelectValue(container)).toBe('PUS');
  });

  it('ICN survives picking Busan, and still survives switching to Seoul', async () => {
    const { container } = renderWizard();
    await flushLazy(container);
    pickAirportOnStep0(container, 'ICN_T1');
    expect(airportSelectValue(container)).toBe('ICN_T1');

    fireEvent.click(ticks(container)[1]);
    await flushLazy(container);
    pickCity(container, 'busan');
    fireEvent.click(ticks(container)[0]);
    await flushLazy(container);
    expect(airportSelectValue(container)).toBe('ICN_T1');

    // Switch city: Busan -> Seoul (toggle Busan off, then pick Seoul).
    fireEvent.click(ticks(container)[1]);
    await flushLazy(container);
    pickCity(container, 'busan'); // deselect
    pickCity(container, 'seoul');
    fireEvent.click(ticks(container)[0]);
    await flushLazy(container);
    expect(airportSelectValue(container)).toBe('ICN_T1');
  });

  it('CJU (Jeju\'s airport) survives picking Jeju as the city', async () => {
    const { container } = renderWizard();
    await flushLazy(container);
    pickAirportOnStep0(container, 'CJU');
    expect(airportSelectValue(container)).toBe('CJU');

    fireEvent.click(ticks(container)[1]);
    await flushLazy(container);
    pickCity(container, 'jeju');

    fireEvent.click(ticks(container)[0]);
    await flushLazy(container);
    expect(airportSelectValue(container)).toBe('CJU');
  });
});
