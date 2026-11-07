// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { TriviaLoadingAnimation } from '../../src/pages/PlannerPage/components/TriviaLoadingAnimation';
import { PLANNER_COPY } from '../../src/pages/PlannerPage/plannerCopy';
import type { PlannerDict } from '../../src/pages/PlannerPage/types';

const locales = ['ko', 'en', 'ja', 'zh'] as const;
const savingLabels = {
  ko: '일정 저장',
  en: 'Save itinerary',
  ja: '日程の保存',
  zh: '保存行程',
};
const planner = (lang: string) => JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}.json`), 'utf8')).planner as PlannerDict;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function expectPendingPhases() {
  const list = screen.getByRole('list');
  expect(within(list).getAllByRole('listitem')).toHaveLength(4);
  expect(list.querySelector('[aria-current]')).toBeNull();
  expect(list.querySelector('.lucide-check')).toBeNull();
  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  return list.innerHTML;
}

describe('phase descriptions are not completion events', () => {
  it.each(locales)('%s describes saving without promising completion is near', (lang) => {
    expect(planner(lang).loading_step4).toBe(savingLabels[lang]);
  });

  it('does not turn twelve seconds of waiting into three completed phases', () => {
    render(<TriviaLoadingAnimation p={planner('en')} />);
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.getByRole('list').querySelectorAll('.lucide-check')).toHaveLength(0);
  });

  it.each(locales)('%s does not mark a phase current or done on the wall clock', (lang) => {
    const p = planner(lang);
    render(<TriviaLoadingAnimation p={p} lang={lang} />);
    const initial = expectPendingPhases();
    for (const label of [p.loading_step1, p.loading_step2, p.loading_step3, p.loading_step4]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    act(() => vi.advanceTimersByTime(12_000));
    expect(expectPendingPhases()).toBe(initial);
    act(() => vi.advanceTimersByTime(64_000));
    expect(expectPendingPhases()).toBe(initial);
    expect(screen.getByText(PLANNER_COPY[lang].loading.slowNote)).toBeInTheDocument();
  });

  it('does not infer phase completion from agent steps, even the final step', () => {
    const p = planner('en');
    const { rerender } = render(<TriviaLoadingAnimation p={p} streamStep={1} />);
    const initial = expectPendingPhases();
    act(() => vi.advanceTimersByTime(12_000));
    rerender(<TriviaLoadingAnimation p={p} streamStep={6} />);
    expect(expectPendingPhases()).toBe(initial);
    expect(screen.getByText(String(p.streamStepStatus).replace('{step}', '6'))).toBeInTheDocument();
  });

  it('keeps phases pending without tips and still rotates tips when supplied', () => {
    const p = planner('en');
    const { rerender } = render(<TriviaLoadingAnimation p={{ ...p, loading_tips: [] }} />);
    const initial = expectPendingPhases();
    act(() => vi.advanceTimersByTime(12_000));
    expect(expectPendingPhases()).toBe(initial);
    rerender(<TriviaLoadingAnimation p={{ ...p, loading_tips: ['First travel tip', 'Second travel tip'] }} />);
    expect(screen.getByText('First travel tip')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_800));
    expect(screen.getByText('Second travel tip')).toBeInTheDocument();
    expect(expectPendingPhases()).toBe(initial);
  });

  it('does not add paid phase descriptions to the free preview', () => {
    render(<TriviaLoadingAnimation p={planner('en')} preview />);
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});
