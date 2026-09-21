// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

void React;

let authLoading = true;
const fetchMock = vi.fn();

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, loading: authLoading }),
}));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
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
  fetchMock.mockReset();
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
});
