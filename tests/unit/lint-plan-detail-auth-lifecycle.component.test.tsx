// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

void React;

let authLoading = true;
let authUser: { uid: string } | null = null;
const fetchMock = vi.fn();
const { snapshotRequest } = vi.hoisted(() => ({ snapshotRequest: vi.fn() }));
vi.mock('@/lib/authFetch', () => ({ authFetch: snapshotRequest }));
vi.mock('@/lib/mealDraftIdentity', () => ({ mealDraftGuestHeaders: async () => ({}) }));
vi.mock('../../src/pages/PlanDetailPage/components/DayTimeline', () => ({ DayTimeline: ({ onPlanSaved }: { onPlanSaved?: () => Promise<void> }) => React.createElement('button', { onClick: () => { void onPlanSaved?.(); } }, 'Refresh saved plan') }));

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser, loading: authLoading }),
}));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('../../src/lib/firebase-auth.js', () => ({ auth: { currentUser: null } }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn(),
}));

const { default: PlanDetailPage } = await import('../../src/pages/PlanDetailPage/index');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function response(status: number) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}) };
}

beforeEach(() => {
  authLoading = true;
  authUser = null;
  snapshotRequest.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
});

describe('PlanDetailPage auth and route request lifecycle', () => {
  it('auth 완료 뒤 동일 게스트 경로를 읽고, 바뀐 plan/token의 늦은 이전 HTTP 응답은 무시한다', async () => {
    const first = deferred<ReturnType<typeof response>>();
    const second = deferred<ReturnType<typeof response>>();
    fetchMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    vi.stubGlobal('fetch', fetchMock);

    const router = createMemoryRouter([
      { path: '/my-plans/:planId', element: <PlanDetailPage /> },
    ], { initialEntries: ['/my-plans/first?token=first-token'] });
    render(<RouterProvider router={router} />);
    expect(screen.getByTestId('plan-detail-loading')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    authLoading = false;
    // 같은 plan/token/게스트에서 인증 상태만 완료된 경로 전환이다. hash는 reader
    // identity에 포함되지 않으므로 effect가 authLoading 변경으로 다시 실행되어야 한다.
    await act(async () => { await router.navigate('/my-plans/first?token=first-token#auth-ready'); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toContain('planId=first');
    expect(fetchMock.mock.calls[0][0]).toContain('token=first-token');

    await act(async () => { await router.navigate('/my-plans/second?token=second-token'); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('plan-detail-loading')).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toContain('planId=second');
    expect(fetchMock.mock.calls[1][0]).toContain('token=second-token');

    first.resolve(response(403));
    await Promise.resolve();
    expect(screen.getByTestId('plan-detail-loading')).toBeInTheDocument();

    second.resolve(response(404));
    expect(await screen.findByTestId('plan-detail-not-found')).toBeInTheDocument();
  });

  it("handler catch 가 error 로 마감한 문서(status 'error' + _streaming_error_code) → 기존 풀페이지 ErrorState", async () => {
    authLoading = false;
    fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('/api/get-plan')
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            plan: {
              planId: 'closed-plan', uid: null, accessToken: 'guest-token', status: 'error',
              _streaming_in_progress: false, _streaming_error: 'handler_catch',
              _streaming_error_code: 'DUPLICATE_STOP_VIOLATION', _streaming_failed_stage: 'finalGate',
              input: { area: 'seoul', language: 'en' },
            },
          }),
        }
      : response(500)));
    vi.stubGlobal('fetch', fetchMock);

    const router = createMemoryRouter([
      { path: '/my-plans/:planId', element: <PlanDetailPage /> },
    ], { initialEntries: ['/my-plans/closed-plan?token=guest-token'] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByTestId('plan-error-state')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-detail-loading')).not.toBeInTheDocument();
  });
  it('discards a late private snapshot after the token is removed on the same plan', async () => {
    authLoading = false;
    const late = deferred<{ ok: boolean; json: () => Promise<object> }>();
    snapshotRequest.mockImplementation((_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      return body.action === 'snapshot' ? late.promise : Promise.resolve(response(500));
    });
    const safe = { planId: 'same', uid: 'owner', isPublic: true, status: 'ready', itinerary: { tour_title: 'Public itinerary', days: [{ day: 1, city: 'seoul', stops: [] }] } };
    fetchMock.mockImplementation(async (url: string) => String(url).startsWith('/local-plans/')
      ? { ok: true, json: async () => ({ ...safe, accessToken: 'private-token' }) }
      : { ok: true, status: 200, json: async () => ({ ok: true, plan: safe }) });
    vi.stubGlobal('fetch', fetchMock);
    const router = createMemoryRouter([{ path: '/my-plans/:planId', element: <PlanDetailPage /> }],
      { initialEntries: ['/my-plans/same?token=private-token&localPlan=scope-check'] });
    render(<RouterProvider router={router} />);
    const day = await screen.findByRole('tab', { name: 'Day 1' });
    await act(async () => { day.click(); });
    await act(async () => { screen.getByRole('button', { name: 'Refresh saved plan' }).click(); });
    await waitFor(() => expect(snapshotRequest.mock.calls.some((call) => typeof call[1]?.body === 'string' && JSON.parse(call[1].body).action === 'snapshot')).toBe(true));
    await act(async () => { await router.navigate('/my-plans/same'); });
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).startsWith('/api/get-plan'))).toBe(true));
    await act(async () => { late.resolve({ ok: true, json: async () => ({ ok: true, plan: { ...safe, itinerary: { ...safe.itinerary, tour_title: 'LATE PRIVATE VALUE' } } }) }); await Promise.resolve(); });
    expect(screen.queryByText('LATE PRIVATE VALUE')).toBeNull();
    expect(document.title).not.toContain('LATE PRIVATE VALUE');
  });

});
