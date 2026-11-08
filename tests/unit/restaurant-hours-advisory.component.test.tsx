// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ko from '../../src/i18n/locales/ko.json';
import en from '../../src/i18n/locales/en.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';
import type { PlanStop } from '../../src/pages/PlanDetailPage/types';

const language = vi.hoisted(() => ({ value: 'en', ui: {} as Record<string, string> }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: language.value, t: { planDetail: { ui: language.ui } } }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
import { StopCard } from '../../src/pages/PlanDetailPage/components/StopCard';

const locales = { ko, en, ja, zh };
function mountStop(fields: Partial<PlanStop> = {}) {
  const stop = { order: 1, name: 'Synthetic venue', start_time: '10:00', stay_min: 60, category: 'food', ...fields };
  return render(<MemoryRouter><StopCard stop={stop} /></MemoryRouter>);
}
beforeEach(() => { language.value = 'en'; language.ui = en.planDetail.ui; localStorage.clear(); });
afterEach(cleanup);

describe('read-only restaurant hours advisory', () => {
  it.each(['food', 'cafe', 'restaurant', 'dessert', 'FOOD', 'Cafe'])('shows once for %s', category => {
    mountStop({ category });
    expect(screen.getAllByTestId('restaurant-hours-advisory')).toHaveLength(1);
  });
  it.each(['landmark', 'lodging', 'museum', '', undefined])('is absent for nonfood %s', category => {
    mountStop({ category });
    expect(screen.queryByTestId('restaurant-hours-advisory')).toBeNull();
  });
  it.each([true, false, undefined])('does not infer hours from verified=%s', verified => {
    mountStop({ verified });
    expect(screen.getByTestId('restaurant-hours-advisory')).toHaveTextContent(en.planDetail.ui.restaurantHoursAdvisory);
    expect(screen.queryByText(en.planDetail.ui.unverifiedBadge) !== null).toBe(verified === false);
  });
  it('stays in the collapsed header exactly once after expand and collapse', () => {
    mountStop();
    const card = screen.getByRole('button', { name: /Synthetic venue/ });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('restaurant-hours-advisory')).toBeVisible();
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByTestId('restaurant-hours-advisory')).toHaveLength(1);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByTestId('restaurant-hours-advisory')).toHaveLength(1);
  });
  it.each(['ko', 'en', 'ja', 'zh'] as const)('uses actual %s locale', lng => {
    language.value = lng; language.ui = locales[lng].planDetail.ui;
    mountStop();
    expect(screen.getByTestId('restaurant-hours-advisory')).toHaveTextContent(locales[lng].planDetail.ui.restaurantHoursAdvisory);
  });
  it('has an English fallback without altering the stop', () => {
    language.ui = {};
    const stop = Object.freeze({ order: 1, name: 'Synthetic venue', category: 'food', verified: true });
    render(<MemoryRouter><StopCard stop={stop} /></MemoryRouter>);
    expect(screen.getByTestId('restaurant-hours-advisory')).toHaveTextContent(en.planDetail.ui.restaurantHoursAdvisory);
    expect(stop).toEqual({ order: 1, name: 'Synthetic venue', category: 'food', verified: true });
  });
});
