// @vitest-environment jsdom
//
// 2026-08-24 (planner-trust-course): the step-rail tick buttons let a user
// jump straight to step 5 (Review + free preview) with zero answers filled
// in anywhere — clicking a future tick only ever called `setStep(i)`.
// Locks the fix: a tick is only reachable if `i <= step` (always — back/edit)
// or `i <= unlockedStep` (forward, but only once its prerequisites validate).
// A blocked click must not fire `wizard_step_advanced` either (it only fires
// when `step` actually changes).
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

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
const trackSpy = vi.fn();
vi.mock('@/lib/posthog', () => ({ track: (...args: unknown[]) => trackSpy(...args) }));
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

// Interactive stubs: only expose what's needed to drive each step's
// prerequisites so unlockedStep can be tested without the real step UIs.
vi.mock('../../src/components/WizardForm/WizardStep0Reservation', () => ({
  WizardStep0Reservation: ({ setStatus, onNext }: { setStatus: (v: string) => void; onNext: () => void }) => (
    <div>
      <p>예약 화면</p>
      <button type="button" onClick={() => setStatus('nothing')}>set-status-nothing</button>
      <button type="button" onClick={onNext}>예약 다음</button>
    </div>
  ),
}));
vi.mock('../../src/components/WizardForm/WizardStep0Destination', () => ({
  WizardStep0Destination: (
    { setMainCity, setMainCityKey, toggleActivity, onNext }:
    { setMainCity: (v: string) => void; setMainCityKey: (v: string) => void; toggleActivity: (v: string) => void; onNext: () => void },
  ) => (
    <div>
      <p>도시 화면</p>
      <button type="button" onClick={() => { setMainCity('Seoul'); setMainCityKey('seoul'); }}>set-city</button>
      <button type="button" onClick={() => { setMainCity('Busan'); setMainCityKey('busan'); }}>set-city-busan</button>
      <button type="button" onClick={() => toggleActivity('Food')}>toggle-activity</button>
      <button type="button" onClick={onNext}>도시 다음</button>
    </div>
  ),
}));
vi.mock('../../src/components/WizardForm/WizardStep1Food', () => ({
  WizardStep1Food: ({ onNext }: { onNext: () => void }) => (
    <div>
      <p>음식 화면</p>
      <button type="button" onClick={onNext}>음식 다음</button>
    </div>
  ),
}));
vi.mock('../../src/components/WizardForm/WizardStep2Details', () => ({
  WizardStep2Details: (
    { setDateRange, setPaxInput, setArrivalTerminal, onNext }:
    { setDateRange: (v: unknown) => void; setPaxInput: (v: string) => void; setArrivalTerminal: (v: string) => void; onNext: () => void },
  ) => (
    <div>
      <p>상세 화면</p>
      <button type="button" onClick={() => setDateRange({ from: new Date('2026-09-01T12:00:00'), to: new Date('2026-09-03T12:00:00') })}>set-dates</button>
      <button type="button" onClick={() => setPaxInput('2')}>set-pax</button>
      <button type="button" onClick={() => setArrivalTerminal('ICN_T1')}>set-airport</button>
      <button type="button" onClick={onNext}>상세 다음</button>
    </div>
  ),
}));
vi.mock('../../src/components/WizardForm/WizardStep3Review', () => ({
  WizardStep3Review: ({ onGenerate }: { onGenerate: () => void }) => (
    <div>
      <p>검토 화면</p>
      <button type="button" onClick={onGenerate}>generate</button>
    </div>
  ),
}));

const { WizardForm } = await import('../../src/components/WizardForm');

void React;

async function flushLazy() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); trackSpy.mockClear(); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

function renderWizard() {
  return render(<WizardForm onSubmit={async () => ({ ok: true })} isLoading={false} />);
}

/** The step-rail tick buttons, in step order. */
function ticks(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('ol > li > button'));
}

describe('wizard step-rail future-tick gating', () => {
  it('with zero answers, only step 0 is reachable — steps 1-4 are disabled', async () => {
    const { container } = renderWizard();
    await flushLazy();
    const t = ticks(container);
    expect(t).toHaveLength(5);
    expect(t[0].disabled).toBe(false);
    for (const btn of t.slice(1)) expect(btn.disabled).toBe(true);
  });

  it('clicking a disabled future tick does not change the visible step', async () => {
    const { container } = renderWizard();
    await flushLazy();
    fireEvent.click(ticks(container)[4]); // Review tick, step 0 -> should stay on step 0
    expect(container.textContent).toContain('예약 화면');
    expect(container.textContent).not.toContain('검토 화면');
  });

  it('clicking a disabled future tick never fires wizard_step_advanced', async () => {
    const { container } = renderWizard();
    await flushLazy();
    trackSpy.mockClear();
    fireEvent.click(ticks(container)[4]);
    expect(trackSpy).not.toHaveBeenCalledWith('wizard_step_advanced', expect.anything());
  });

  it('unlocks the next step only once its own step validates, and stays locked further out', async () => {
    const { container } = renderWizard();
    await flushLazy();

    // Step 0: pick a status -> unlocks step 1, but not step 2/3/4 yet.
    fireEvent.click(screen.getByText('set-status-nothing'));
    let t = ticks(container);
    expect(t[1].disabled).toBe(false); // Destination now reachable
    expect(t[2].disabled).toBe(true);  // Food still locked
    expect(t[4].disabled).toBe(true);  // Review still locked

    // Jump to step 1 (now unlocked) and fill it in.
    fireEvent.click(t[1]);
    await flushLazy();
    expect(container.textContent).toContain('도시 화면');
    fireEvent.click(screen.getByText('set-city'));
    fireEvent.click(screen.getByText('toggle-activity'));

    // Food (2) and Details (3) unlock together — Food has no required fields
    // of its own — but Review (4) stays locked until Details validates.
    t = ticks(container);
    expect(t[2].disabled).toBe(false);
    expect(t[3].disabled).toBe(false);
    expect(t[4].disabled).toBe(true);

    // Jump to Details (3) and fill in dates/pax/airport.
    fireEvent.click(t[3]);
    await flushLazy();
    expect(container.textContent).toContain('상세 화면');
    fireEvent.click(screen.getByText('set-dates'));
    fireEvent.click(screen.getByText('set-pax'));
    fireEvent.click(screen.getByText('set-airport'));

    t = ticks(container);
    expect(t[4].disabled).toBe(false); // Review finally reachable
  });

  it('back navigation to an earlier step is always allowed regardless of validation', async () => {
    const { container } = renderWizard();
    await flushLazy();
    fireEvent.click(screen.getByText('set-status-nothing'));
    fireEvent.click(ticks(container)[1]);
    await flushLazy();
    // Now on step 1 with nothing filled in on it. Step 0 must still be reachable.
    const t = ticks(container);
    expect(t[0].disabled).toBe(false);
    fireEvent.click(t[0]);
    expect(container.textContent).toContain('예약 화면');
  });
});

describe('handleGenerate sends only real answers, never a fabricated default', () => {
  it('submits the requested city (Busan) — not a "Seoul" fallback — and the real dates picked', async () => {
    const onSubmit = vi.fn(async () => ({ ok: true }));
    const { container } = render(<WizardForm onSubmit={onSubmit} isLoading={false} />);
    await flushLazy();

    fireEvent.click(screen.getByText('set-status-nothing'));
    fireEvent.click(ticks(container)[1]);
    await flushLazy();
    fireEvent.click(screen.getByText('set-city-busan'));
    fireEvent.click(screen.getByText('toggle-activity'));

    fireEvent.click(ticks(container)[3]);
    await flushLazy();
    fireEvent.click(screen.getByText('set-dates'));
    fireEvent.click(screen.getByText('set-pax'));
    fireEvent.click(screen.getByText('set-airport'));

    fireEvent.click(ticks(container)[4]);
    await flushLazy();
    await act(async () => { fireEvent.click(screen.getByText('generate')); });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sent = onSubmit.mock.calls[0][0];
    expect(sent.regions).toEqual(['Busan']);
    expect(sent.startDate).toBe('2026-09-01');
    expect(sent.endDate).toBe('2026-09-03');
  });
});
