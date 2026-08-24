// @vitest-environment jsdom
/**
 * P125 (2026-05-21) + planner-intent-v1 (2026-08-24) parity check —
 * arrival_city/departure_city must reach /api/ai-planner-full for BOTH the
 * NEW paid-generation path (handlePaymentSuccess) and the REVISION path
 * (handleRevisionRegenerate), not just the client-side PlannerIntent object.
 * P125's guard only greps usePlannerHandlers.ts for the literal
 * `values.arrival_city`/`values.departure_city` text; this proves the actual
 * fetch body (what the server sees) carries both fields on both paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PlannerFormValues } from '../../src/components/PlannerForm';

vi.mock('../../src/lib/firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'test-id-token' } },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../src/lib/guestReader', () => ({
  isGuestAnonEnabled: () => false,
  shouldAttachGuestAnonToken: () => false,
}));
vi.mock('../../src/lib/analytics', () => ({ markPlannerPendingComplete: () => {} }));
vi.mock('../../src/lib/posthog', () => ({ track: async () => {} }));

const { usePlannerHandlers } = await import('../../src/pages/PlannerPage/hooks/usePlannerHandlers');

const VALUES: Partial<PlannerFormValues> = {
  regions: ['Seoul', 'Busan'],
  cityKeys: ['seoul', 'busan'],
  durationDays: 3,
  pax: 2,
  reservation_status: 'nothing',
  arrival_city: 'seoul',
  departure_city: 'busan',
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('usePlannerHandlers — arrival_city/departure_city reach the backend body', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handlePaymentSuccess (NEW) forwards arrival_city/departure_city', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { planId: 'plan-new' } }));
    global.fetch = fetchMock;
    const { result } = renderHook(() => usePlannerHandlers({ language: 'en', userEmail: '', setUserEmail: () => {} }));

    await act(async () => {
      await result.current.handleSubmit(VALUES as PlannerFormValues); // sets lastValues
    });
    await act(async () => {
      await result.current.handlePaymentSuccess('PAYPAL-ORDER-1');
    });

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/ai-planner-full');
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.arrival_city).toBe('seoul');
    expect(body.departure_city).toBe('busan');
  });

  it('handleRevisionRegenerate (REVISION) forwards the same arrival_city/departure_city', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { planId: 'plan-rev' } }));
    global.fetch = fetchMock;
    const { result } = renderHook(() => usePlannerHandlers({ language: 'en', userEmail: '', setUserEmail: () => {} }));

    await act(async () => {
      await result.current.handleRevisionRegenerate(VALUES as PlannerFormValues, 'plan-old', 'rev-token');
    });

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/ai-planner-full');
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.arrival_city).toBe('seoul');
    expect(body.departure_city).toBe('busan');
  });

  it('PlannerIntent (flat) stays the SSOT — an explicit compat forward never overrides it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, data: { planId: 'plan-conflict' } }));
    global.fetch = fetchMock;
    const { result } = renderHook(() => usePlannerHandlers({ language: 'en', userEmail: '', setUserEmail: () => {} }));

    await act(async () => {
      // entry_city is a lower-priority fallback inside plannerIntent.ts's
      // arrivalCityKey derivation — arrival_city must still win.
      await result.current.handleRevisionRegenerate(
        { ...VALUES, arrival_city: 'seoul', entry_city: 'busan' } as PlannerFormValues,
        'plan-old',
        'rev-token',
      );
    });

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/ai-planner-full');
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.arrival_city).toBe('seoul');
    expect(body[Object.keys(body).find((k) => k === 'planner_intent_v1') as string].arrivalCityKey).toBe('seoul');
  });
});
