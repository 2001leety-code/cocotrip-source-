// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanDocument } from '../../src/pages/PlanDetailPage/types';

void React;

vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: 'en' }),
}));

const authFetchMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/authFetch', () => ({ authFetch: authFetchMock }));

const { CharterInquireModal } = await import(
  '../../src/pages/PlanDetailPage/components/ads/CharterInquireModal'
);

const plan: PlanDocument = {
  input: { startDate: '2026-09-10', pax: 2 },
  itinerary: { days: [{ day: 1, stops: [{ name_en: 'Gyeongbokgung Palace' }] }] },
};

beforeEach(() => {
  authFetchMock.mockReset();
});

afterEach(() => {
  cleanup();
});

function modal(onClose = vi.fn()) {
  return (
    <CharterInquireModal
      open
      onClose={onClose}
      plan={plan}
      days={plan.itinerary?.days || []}
      recommendedTour="Seoul City Tour"
      quotedKRW={330000}
      hours={8}
      tourKey="seoul-city"
      planId="plan-1"
    />
  );
}

describe('CharterInquireModal portal and keyboard access', () => {
  it('escapes transformed carousel coordinates by portaling under document.body', () => {
    const { container } = render(
      <div style={{ transform: 'translateX(-2000px)' }}>{modal()}</div>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Charter Quote Request' });
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(dialog.textContent).toContain('₩330,000 / 8 hrs');
  });

  it('focuses email first, closes with Escape, and restores the trigger focus', async () => {
    const onClose = vi.fn();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const view = render(modal(onClose));
    await waitFor(() => expect(screen.getByLabelText('Email *')).toBe(document.activeElement));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(
      <CharterInquireModal
        open={false}
        onClose={onClose}
        plan={plan}
        days={plan.itinerary?.days || []}
        recommendedTour="Seoul City Tour"
        quotedKRW={330000}
        hours={8}
        tourKey="seoul-city"
        planId="plan-1"
      />,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('wraps Tab at both ends instead of moving focus to the background', () => {
    render(modal());
    const close = screen.getByRole('button', { name: 'Close' });
    const submit = screen.getByRole('button', { name: 'Submit request' });

    submit.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(submit);

    const background = document.createElement('button');
    document.body.appendChild(background);
    background.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    background.remove();
  });

  it('announces success and moves focus when the submit button disappears', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    render(modal());
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'guest@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Request received');
    expect(document.activeElement).toBe(status.querySelector('button'));
  });
});
