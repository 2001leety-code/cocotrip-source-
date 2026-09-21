// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

void React;

type FakeUser = { uid: string; email: string; displayName?: string | null } | null;

let currentUser: FakeUser = null;
let authLoading = false;
const getDocMock = vi.fn();
const authFetchMock = vi.fn();

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: currentUser, loading: authLoading }),
}));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => ({ args }),
  getDoc: (...args: unknown[]) => getDocMock(...args),
}));
vi.mock('../../src/lib/authFetch', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
  authDownload: vi.fn(),
}));

const { invalidateProfileCache, useUserProfile } = await import('../../src/hooks/useUserProfile');
const { MyBookingsTab } = await import('../../src/components/MyBookingsTab');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function profileSnapshot(data: Record<string, unknown>) {
  return { exists: () => true, data: () => data };
}

function bookingResponse(bookingRef: string) {
  return {
    json: async () => ({
      ok: true,
      data: {
        bookings: [{
          id: bookingRef,
          bookingRef,
          status: 'CONFIRMED',
          productType: 'ai-planner',
          tourDate: '2030-01-01',
          pickupLocation: '',
          dropoffLocation: '',
          paxCount: 1,
          vehicleType: 'van',
          amountKRW: 0,
          amountUSD: '0',
          createdAt: null,
          canceledAt: null,
          refundedAmount: 0,
          canRefund: false,
          canModify: false,
          refundPercent: 0,
          hoursUntilTour: 24,
        }],
      },
    }),
  };
}

beforeEach(() => {
  currentUser = null;
  authLoading = false;
  getDocMock.mockReset();
  authFetchMock.mockReset();
});
afterEach(() => cleanup());

describe('lint identity lifecycle — profile and bookings', () => {
  it('A의 늦은 프로필 응답은 B 로그인 전환 뒤에 보이지 않고 B 응답만 채운다', async () => {
    const a = deferred<ReturnType<typeof profileSnapshot>>();
    const b = deferred<ReturnType<typeof profileSnapshot>>();
    getDocMock.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);
    currentUser = { uid: 'profile-a', email: 'a@test.invalid' };

    const view = renderHook(() => useUserProfile());
    expect(view.result.current).toEqual({ profile: null, loading: true });

    currentUser = { uid: 'profile-b', email: 'b@test.invalid' };
    view.rerender();
    expect(view.result.current).toEqual({ profile: null, loading: true });

    a.resolve(profileSnapshot({ name: 'A 비공개 이름' }));
    await new Promise((done) => setTimeout(done, 0));
    expect(view.result.current.profile).toBeNull();

    b.resolve(profileSnapshot({ name: 'B 이름' }));
    await waitFor(() => expect(view.result.current).toEqual({
      profile: expect.objectContaining({ name: 'B 이름', email: 'b@test.invalid' }),
      loading: false,
    }));
  });

  it('같은 uid에서 캐시 무효화 뒤 Auth 이메일이 갱신되면 새 프로필 요청을 로딩으로 시작한다', async () => {
    getDocMock.mockResolvedValueOnce(profileSnapshot({ name: '기존 이름' }));
    currentUser = { uid: 'profile-refresh', email: 'before@test.invalid' };
    const view = renderHook(() => useUserProfile());
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    const fresh = deferred<ReturnType<typeof profileSnapshot>>();
    getDocMock.mockImplementationOnce(() => fresh.promise);
    invalidateProfileCache('profile-refresh');
    currentUser = { uid: 'profile-refresh', email: 'after@test.invalid' };
    view.rerender();
    expect(view.result.current.loading).toBe(true);

    fresh.resolve(profileSnapshot({ name: '새 이름' }));
    await waitFor(() => expect(view.result.current).toEqual({
      profile: expect.objectContaining({ name: '새 이름', email: 'after@test.invalid' }),
      loading: false,
    }));
  });

  it('로그아웃 뒤 재로그인해도 늦은 A 목록을 버리고 B 목록만 표시한다', async () => {
    const a = deferred<ReturnType<typeof bookingResponse>>();
    const b = deferred<ReturnType<typeof bookingResponse>>();
    authFetchMock.mockImplementationOnce(() => a.promise).mockImplementationOnce(() => b.promise);

    const view = render(<MemoryRouter><MyBookingsTab userEmail="a@test.invalid" /></MemoryRouter>);
    view.rerender(<MemoryRouter><MyBookingsTab userEmail="" /></MemoryRouter>);
    a.resolve(bookingResponse('A-PRIVATE'));
    await new Promise((done) => setTimeout(done, 0));
    expect(screen.queryByText('A-PRIVATE')).toBeNull();

    view.rerender(<MemoryRouter><MyBookingsTab userEmail="b@test.invalid" /></MemoryRouter>);
    b.resolve(bookingResponse('B-ONLY'));
    expect(await screen.findByText('B-ONLY')).toBeInTheDocument();
    expect(screen.queryByText('A-PRIVATE')).toBeNull();
    expect(screen.getByText('B-ONLY')).toBeInTheDocument();
  });
});
