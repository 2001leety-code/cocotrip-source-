/** @vitest-environment jsdom */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MealOptionsCard } from '../../src/components/MealOptionsCard';
import { mealOptionMessages, type MealOptionLanguage } from '../../src/lib/mealOptionMessages';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/mealDraftIdentity', () => ({ mealDraftGuestHeaders: async () => ({}) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: request }));
import { PrepaymentMealDraftGate } from '../../src/pages/PlannerPage/components/PrepaymentMealDraftGate';

const reference = { id: 'r1', name: 'Reference restaurant', verificationStatus: 'halal_certified', openingStatus: 'unknown' as const, startMin: 720, inboundMin: 15, sourceUrl: 'https://example.com' };
afterEach(() => { cleanup(); request.mockReset(); });

describe('opening-hours reference candidates', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as MealOptionLanguage[])('renders reference only in %s without selection or unsupported evidence labels', (lang) => {
    const html = renderToStaticMarkup(<MealOptionsCard options={[]} referenceOptions={[reference]} baselineId={null} selectedId={null} busy={false} onSelect={vi.fn()} status="information_unknown" lang={lang} />);
    expect(html).toContain(mealOptionMessages[lang].referenceOpening);
    expect(html).toContain('Reference restaurant');
    expect(html).toContain('12:00');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain(mealOptionMessages[lang].source);
    expect(html).not.toContain(mealOptionMessages[lang].outbound + ':');
  });
  it('shows the short unknown-hours status for selectable paid-plan options', () => {
    const html = renderToStaticMarkup(<MealOptionsCard options={[reference]} baselineId={null} selectedId={null} busy={false} onSelect={vi.fn()} status="feasible" lang="en" />);
    expect(html).toContain(mealOptionMessages.en.referenceOpening);
    expect(html).toContain('<button');
  });
  it('does not label a confirmed restaurant as unknown because another meal needs confirmation', () => {
    const html = renderToStaticMarkup(<MealOptionsCard options={[]} referenceOptions={[{ ...reference, openingStatus: 'verified_open' }]} baselineId={null} selectedId={null} busy={false} onSelect={vi.fn()} status="information_unknown" lang="en" />);
    expect(html).toContain(mealOptionMessages.en.referenceSchedule);
    expect(html).not.toContain(mealOptionMessages.en.referenceOpening);
    expect(html).not.toContain('<button');
  });
  it('shows the disclosure and passes its version with an opening-unconfirmed draft', async () => {
    request.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, status: 'opening_unconfirmed', draftId: 'd1', revision: 3, fingerprint: 'f1', referenceMeals: [{ mealId: 'm1', day: 1, referenceOptions: [reference] }] }) });
    render(<PrepaymentMealDraftGate input={{ region: 'seoul' }} language="en" userId="u1">{(draft) => <button>{`Pay ${draft.openingNoticeVersion}`}</button>}</PrepaymentMealDraftGate>);
    expect(await screen.findByRole('button', { name: 'Pay meal-opening-unconfirmed-v1' })).toBeTruthy();
    expect(screen.getByText(/Opening hours for some restaurants are unconfirmed/)).toBeTruthy();
    expect(screen.getByText('Reference restaurant')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });
  it('shows unknown draft references while keeping payment locked', async () => {
    request.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, status: 'unknown', referenceMeals: [{ mealId: 'm1', day: 1, referenceOptions: [reference] }] }) });
    render(<PrepaymentMealDraftGate input={{ region: 'seoul' }} language="en" userId="u1">{() => <button>Pay</button>}</PrepaymentMealDraftGate>);
    expect(await screen.findByText('Reference restaurant')).toBeTruthy();
    expect(screen.getByText(mealOptionMessages.en.referenceOpening)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });
});
