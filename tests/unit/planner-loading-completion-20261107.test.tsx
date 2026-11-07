// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { TriviaLoadingAnimation } from '../../src/pages/PlannerPage/components/TriviaLoadingAnimation';
import { PLANNER_COPY } from '../../src/pages/PlannerPage/plannerCopy';
import type { PlannerDict } from '../../src/pages/PlannerPage/types';

const p = {
  loading_tips: ['Travel tip one', 'Travel tip two'],
  loading_step1: 'Planning',
  loading_step2: 'Matching',
  loading_step3: 'Routing',
  loading_step4: 'Saving',
  streamStepStatus: 'Agent step {step} / 6',
} as PlannerDict;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('pending itinerary completion display', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as const)('keeps %s pending after the phase clock reaches its end', (lang) => {
    const { container } = render(<TriviaLoadingAnimation p={p} lang={lang} />);
    act(() => vi.advanceTimersByTime(76_000));

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(PLANNER_COPY[lang].loading.heading)).toBeInTheDocument();
    expect(screen.getByText(PLANNER_COPY[lang].loading.slowNote)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d+%/);
    expect(container.querySelector('.ec-steprail')).toBeNull();
  });

  it('does not confuse the final agent step with a completed itinerary', () => {
    const { container } = render(<TriviaLoadingAnimation p={p} streamStep={6} />);
    expect(screen.getByText('Agent step 6 / 6')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(container.textContent).not.toMatch(/\d+%/);
    expect(container.querySelector('.ec-steprail')).toBeNull();
  });

  it('preserves the separate free-preview heading and slow notice', () => {
    const { container } = render(<TriviaLoadingAnimation p={p} streamStep={6} preview />);
    act(() => vi.advanceTimersByTime(76_000));
    expect(screen.getByText(PLANNER_COPY.en.loading.previewHeading)).toBeInTheDocument();
    expect(screen.getByText(PLANNER_COPY.en.loading.previewSlowNote)).toBeInTheDocument();
    expect(screen.queryByText('Agent step 6 / 6')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d+%/);
  });
});
