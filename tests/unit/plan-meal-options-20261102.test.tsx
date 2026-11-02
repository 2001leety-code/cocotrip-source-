/** @vitest-environment jsdom */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/mealDraftIdentity', () => ({ mealDraftGuestHeaders: async () => ({}) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: request }));

vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ t: {}, language: 'en' }) }));
vi.mock('../../src/pages/PlanDetailPage/components/TransitArrow', () => ({ TransitArrow: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/TransitFallback', () => ({ TransitFallback: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/SortableStopCard', () => ({ SortableStopCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/StopCard', () => ({ StopCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/CharterCTA', () => ({ CharterCTA: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/RouteInsightCard', () => ({ RouteInsightCard: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/OptimizePanel', () => ({ OptimizePanel: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/LodgingBookend', () => ({ LodgingBookend: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/ActivityMetaChips', () => ({ ActivityMetaChips: () => null }));
vi.mock('../../src/pages/PlanDetailPage/components/DayRouteMap', () => ({ DayRouteMap: () => null }));

import { PlanMealOptions } from '../../src/pages/PlanDetailPage/components/PlanMealOptions';
import { DayTimeline } from '../../src/pages/PlanDetailPage/components/DayTimeline';

const load = { ok: true, revision: 7, meals: [{ mealId: 'lunch', day: 1, status: 'feasible', baselineId: 'a', selectedId: null, options: [{ id: 'a', name: 'Restaurant A', verificationStatus: 'verified' }] }] };
const fresh = { ok: true, revision: 8, meals: [{ ...load.meals[0], baselineId: 'b', selectedId: 'b', options: [{ id: 'b', name: 'Restaurant B', verificationStatus: 'verified' }] }, { mealId: 'dinner', day: 1, status: 'information_unknown', baselineId: null, selectedId: null, options: [] }] };
const reply = (body: object) => ({ ok: true, json: async () => body });
afterEach(() => { cleanup(); request.mockReset(); });

describe('plan meal options', () => {
  it('does not show a selection until the server confirms save', async () => {
    const onPlanSaved = vi.fn();
    const canonical = { planId: 'p', mealOptionsRevision: 8, itinerary: { days: [{ day: 1, stops: [{ name: 'Restaurant B' }] }] } };
    let complete: (value: ReturnType<typeof reply>) => void = () => {};
    request.mockResolvedValueOnce(reply(load)).mockResolvedValueOnce(reply({ ok: true, status: 'ready', proposalId: 'p1' }))
      .mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; })).mockResolvedValueOnce(reply(fresh));
    render(<PlanMealOptions planId="p" day={1} language="en" isOwner onPlanSaved={onPlanSaved} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(screen.getByText('No restaurant selected yet.')).toBeTruthy();
    complete(reply({ ok: true, status: 'saved', revision: 8, plan: canonical }));
    await waitFor(() => expect(onPlanSaved).toHaveBeenCalledWith(canonical));
    await screen.findByRole('button', { name: 'Selected' });
    expect(screen.getByText('Restaurant B')).toBeTruthy();
    expect(screen.getByText('Restaurant information has not been confirmed.')).toBeTruthy();
    expect(JSON.parse(request.mock.calls[3][1].body)).toMatchObject({ action: 'load' });
    expect(JSON.parse(request.mock.calls[2][1].body)).toMatchObject({ action: 'commit', proposalId: 'p1', baseRevision: 7 });
  });

  it('requires explicit confirmation before committing a changed plan', async () => {
    request.mockResolvedValueOnce(reply(load)).mockResolvedValueOnce(reply({ ok: true, status: 'confirmation_required', proposalId: 'p2', changes: ['Museum moves later'] }))
      .mockResolvedValueOnce(reply({ ok: true, status: 'saved', revision: 8 })).mockResolvedValueOnce(reply(fresh));
    render(<PlanMealOptions planId="p" day={1} language="en" isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    expect(await screen.findByText('Museum moves later')).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and apply' }));
    await screen.findByRole('button', { name: 'Selected' });
    expect(JSON.parse(request.mock.calls[2][1].body)).toMatchObject({ confirmedProposalId: 'p2' });
  });

  it('allows a shared viewer to read but not select', async () => {
    request.mockResolvedValueOnce(reply(load));
    render(<PlanMealOptions planId="p" accessToken="guest" day={1} language="en" isOwner={false} />);
    const button = await screen.findByRole('button', { name: 'Select' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('reports a saved selection separately when refresh fails and reload does not repeat commit', async () => {
    request.mockResolvedValueOnce(reply(load)).mockResolvedValueOnce(reply({ ok: true, status: 'ready', proposalId: 'p3' }))
      .mockResolvedValueOnce(reply({ ok: true, status: 'saved', revision: 8 })).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(reply(fresh));
    render(<PlanMealOptions planId="p" day={1} language="en" isOwner />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select' }));
    expect(await screen.findByText('Your selection was saved, but the latest itinerary could not be loaded. Please reload.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByText('Restaurant B')).toBeTruthy();
    const actions = request.mock.calls.map((call) => JSON.parse(call[1].body).action);
    expect(actions).toEqual(['load', 'preview', 'commit', 'load', 'load']);
  });

  it('reloads the other day when the saved plan revision changes', async () => {
    request.mockResolvedValue(reply(load));
    const day = { day: 2, city: 'seoul', stops: [{ name: 'B', category: 'food', start_time: '12:00' }] };
    const plan = { mealOptionsRevision: 7, itinerary: { meal_options_version: 1, days: [day] } };
    const view = render(<DayTimeline day={day} dayIndex={1} planId="p" plan={plan} isOwner editMode={false} onDeleteStop={() => {}} onAddStop={() => {}} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    view.rerender(<DayTimeline day={day} dayIndex={1} planId="p" plan={{ ...plan, mealOptionsRevision: 8 }} isOwner editMode={false} onDeleteStop={() => {}} onAddStop={() => {}} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls.map((call) => JSON.parse(call[1].body).action)).toEqual(['load', 'load']);
  });

});
