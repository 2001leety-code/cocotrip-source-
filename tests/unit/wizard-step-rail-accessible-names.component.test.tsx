// @vitest-environment jsdom
//
// Step rail accessibility (2026-08-24, planner-trust-course). Each of the 5
// step tick buttons must carry a stable, explicit accessible name in every
// state (locked/current/done) at every width — the visible label span is
// `hidden sm:inline` on non-current steps, so it can't be the only name a
// screen reader on a 390px viewport hears. `aria-label="Step N: Label"`
// covers that; the visible text stays `aria-hidden` so it isn't announced
// twice.
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';

vi.hoisted(() => {
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {};
});

// Empty dict — every `p.key || fallback` label falls through to its own
// English fallback string, which is what we assert on.
vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: { planner: {} }, language: 'en' }),
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
}));
vi.mock('@/components/ResumeWizardModal', () => ({ ResumeWizardModal: () => null }));
vi.mock('../../src/components/WizardForm/WizardStepHint', () => ({ WizardStepHint: () => null }));

vi.mock('../../src/components/WizardForm/WizardStep0Reservation', () => ({
  WizardStep0Reservation: ({ setStatus, onNext }: { setStatus: (v: string) => void; onNext?: () => void }) => (
    <div>
      <button type="button" onClick={() => setStatus('nothing')}>set-status-nothing</button>
      {onNext && <button type="button" onClick={onNext}>next0</button>}
    </div>
  ),
}));
function stub(name: string) {
  return ({ onNext, onPrev }: { onNext?: () => void; onPrev?: () => void }) => (
    <div>
      <p>{name}</p>
      {onNext && <button type="button" onClick={onNext}>next</button>}
      {onPrev && <button type="button" onClick={onPrev}>prev</button>}
    </div>
  );
}
vi.mock('../../src/components/WizardForm/WizardStep0Destination', () => ({ WizardStep0Destination: stub('dest') }));
vi.mock('../../src/components/WizardForm/WizardStep1Food', () => ({ WizardStep1Food: stub('food') }));
vi.mock('../../src/components/WizardForm/WizardStep2Details', () => ({ WizardStep2Details: stub('details') }));
vi.mock('../../src/components/WizardForm/WizardStep3Review', () => ({ WizardStep3Review: stub('review') }));

const { WizardForm } = await import('../../src/components/WizardForm');

void React;

afterEach(cleanup);

async function flushLazy() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function railButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('ol .ec-steptick'));
}

const EXPECTED_NAMES = [
  'Step 1: Reservation',
  'Step 2: Destinations',
  'Step 3: Food',
  'Step 4: Details',
];

describe('step rail — accessible names in every state', () => {
  it('at mount: step 0 is current, steps 1-4 are locked — all 5 have a stable name', async () => {
    const { container } = render(<WizardForm onSubmit={async () => ({ ok: true })} isLoading={false} />);
    await flushLazy();
    const buttons = railButtons(container);
    expect(buttons).toHaveLength(5);

    // current
    expect(buttons[0].getAttribute('aria-label')).toBe(EXPECTED_NAMES[0]);
    expect(buttons[0].getAttribute('aria-current')).toBe('step');
    expect(buttons[0].hasAttribute('disabled')).toBe(false);

    // locked
    for (let i = 1; i <= 3; i++) {
      expect(buttons[i].getAttribute('aria-label')).toBe(EXPECTED_NAMES[i]);
      expect(buttons[i].getAttribute('aria-current')).toBeNull();
      expect(buttons[i].hasAttribute('disabled')).toBe(true);
    }
    // step 5 (review) has its own label built from plannerCopy, just assert it's non-empty and locked
    expect(buttons[4].getAttribute('aria-label')).toMatch(/^Step 5: .+/);
    expect(buttons[4].hasAttribute('disabled')).toBe(true);

    // the visible label span must not be the ONLY name source — it's aria-hidden,
    // so the button's accessible name comes from aria-label alone at any width.
    expect(buttons[0].querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('after advancing: step 0 is done, step 1 is current, steps 2-4 stay locked', async () => {
    const { container } = render(<WizardForm onSubmit={async () => ({ ok: true })} isLoading={false} />);
    await flushLazy();
    const setStatusBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'set-status-nothing')!;
    fireEvent.click(setStatusBtn);
    const nextBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'next0')!;
    fireEvent.click(nextBtn);
    await flushLazy();

    const buttons = railButtons(container);
    // done
    expect(buttons[0].getAttribute('aria-label')).toBe(EXPECTED_NAMES[0]);
    expect(buttons[0].getAttribute('aria-current')).toBeNull();
    expect(buttons[0].hasAttribute('disabled')).toBe(false);

    // current
    expect(buttons[1].getAttribute('aria-label')).toBe(EXPECTED_NAMES[1]);
    expect(buttons[1].getAttribute('aria-current')).toBe('step');
    expect(buttons[1].hasAttribute('disabled')).toBe(false);

    // still locked
    for (let i = 2; i <= 3; i++) {
      expect(buttons[i].getAttribute('aria-label')).toBe(EXPECTED_NAMES[i]);
      expect(buttons[i].hasAttribute('disabled')).toBe(true);
    }
  });
});
