/** @vitest-environment jsdom */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/mealDraftIdentity', () => ({ mealDraftGuestHeaders: async () => ({}) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: request }));
import { PrepaymentMealDraftGate } from '../../src/pages/PlannerPage/components/PrepaymentMealDraftGate';
const reply = (data: object, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const verified = { ok: true, status: 'verified', draftId: 'd1', revision: 3, fingerprint: 'f1' };
const gate = (input: Record<string, unknown>, userId = 'u1') => <PrepaymentMealDraftGate input={input} language="en" userId={userId}>{(draft) => <button>{`Pay ${draft.id}`}</button>}</PrepaymentMealDraftGate>;
afterEach(() => { cleanup(); request.mockReset(); });

describe('prepayment meal draft gate', () => {
  it('renders payment only for a complete verified response and sends unchanged input', async () => {
    request.mockResolvedValueOnce(reply(verified));
    render(gate({ regions: ['seoul'] }));
    expect(await screen.findByRole('button', { name: 'Pay d1' })).toBeTruthy();
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ input: { regions: ['seoul'] }, language: 'en' });
  });
  it.each(['unknown', 'no_feasible', 'route_failed'])('%s blocks payment and offers retry', async (status) => {
    request.mockResolvedValueOnce(reply({ ok: true, status }));
    render(gate({ regions: ['seoul'] }));
    expect(await screen.findByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay d1' })).toBeNull();
  });
  it('rejects incomplete verified data and shows sign-in on 401', async () => {
    request.mockResolvedValueOnce(reply({ ok: true, status: 'verified', draftId: 'd1' })).mockResolvedValueOnce(reply({}, 401));
    render(gate({ regions: ['seoul'] }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('Please sign in to check the meal plan.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay d1' })).toBeNull();
  });
  it('immediately discards verification on input or user change', async () => {
    request.mockResolvedValueOnce(reply(verified)).mockImplementation(() => new Promise(() => {}));
    const view = render(gate({ region: 'seoul' }));
    await screen.findByRole('button', { name: 'Pay d1' });
    view.rerender(gate({ region: 'busan' }));
    expect(screen.queryByRole('button', { name: 'Pay d1' })).toBeNull();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    view.rerender(gate({ region: 'busan' }, 'u2'));
    expect(screen.queryByRole('button', { name: 'Pay d1' })).toBeNull();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  });
});
