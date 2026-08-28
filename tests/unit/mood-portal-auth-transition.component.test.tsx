// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authFetchMock = vi.fn();
let currentUser: { uid: string; email: string } | null = null;

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: currentUser, loading: false }),
}));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'ko' }) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => authFetchMock(...args) }));
vi.mock('@/lib/firebase', () => ({ signInWithGoogle: vi.fn() }));
vi.mock('@/lib/appReady', () => ({ signalAppReady: vi.fn() }));
vi.mock('@/components/MoodRouteMap', () => ({ MoodRouteMap: () => null }));
vi.mock('@/components/PwaInstallButton', () => ({ PwaInstallButton: () => null }));
vi.mock('@/components/charter/AddressAutocomplete', () => ({ AddressAutocomplete: () => null }));
vi.mock('@/components/mood/MoodAiBooking', () => ({ MoodAiBooking: () => null }));
vi.mock('@/components/mood/MoodReceiptModal', () => ({ MoodReceiptModal: () => null }));
vi.mock('@/components/mood/MoodGuideModal', () => ({ MoodGuideModal: () => null }));
vi.mock('@/components/mood/MoodBookingChangeModal', () => ({ MoodBookingChangeModal: () => null }));
vi.mock('@/components/mood/MoodSettlementEditor', () => ({
  MoodSettlementApprovalPanel: () => null,
  MoodSettlementEditor: () => null,
}));
vi.mock('@/components/mood/MoodBookingShareCard', () => ({
  MoodBookingShareCard: () => null,
  MoodBookingCopyButton: () => null,
}));
vi.mock('@/components/mood/MoodCourseShareEditor', () => ({ MoodCourseShareEditor: () => null }));
vi.mock('@/components/mood/MoodBookingBlockManager', () => ({ MoodBookingBlockManager: () => null }));
vi.mock('@/components/mood/MoodQuoteBuilder', () => ({
  MoodQuoteBuilder: () => (
    <section aria-label="관리자 견적 작성기">
      <label>
        견적 고객 일정
        <textarea aria-label="견적 고객 일정" />
      </label>
    </section>
  ),
}));

import MoodPortal from '../../src/pages/MoodPortal';

const AVAILABILITY = { schemaVersion: 1, revision: 1, rules: [] };

function moodData(isAdmin: boolean, clientName: string) {
  return {
    ok: true,
    data: {
      clientId: clientName.toLowerCase(),
      client: { name: clientName, balanceKRW: 1_000_000 },
      bookings: [],
      isAdmin,
      canApproveSettlement: false,
      bookingAvailability: AVAILABILITY,
    },
  };
}

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  currentUser = { uid: 'admin-uid', email: '2001leety@gmail.com' };
  authFetchMock.mockReset();
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => { callback(0); return 1; },
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn(),
  });
});

describe('MoodPortal 계정 전환 관리자 상태 격리', () => {
  it('같은 uid의 인증 객체만 갱신되면 관리자 화면과 작성 중 일정을 유지한다', async () => {
    let moodDataCall = 0;
    authFetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/mood-data')) {
        moodDataCall += 1;
        return response(moodData(true, 'MOOD ADMIN'));
      }
      return response({ ok: true, notes: {} });
    });

    const view = render(<MoodPortal />);
    fireEvent.click(await screen.findByRole('button', { name: '견적' }));
    fireEvent.change(screen.getByLabelText('견적 고객 일정'), { target: { value: '작성 중인 일정' } });

    currentUser = { uid: 'admin-uid', email: '2001leety@gmail.com' };
    view.rerender(<MoodPortal />);

    expect(screen.getByRole('button', { name: '견적' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByDisplayValue('작성 중인 일정')).toBeInTheDocument();
    expect(moodDataCall).toBe(1);
  });

  it('다른 uid로 바뀌는 즉시 이전 견적 탭과 작성 중 일정을 내린다', async () => {
    const staffData = deferred<ReturnType<typeof response>>();
    let moodDataCall = 0;
    authFetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/mood-data')) {
        moodDataCall += 1;
        return moodDataCall === 1
          ? Promise.resolve(response(moodData(true, 'MOOD ADMIN')))
          : staffData.promise;
      }
      return Promise.resolve(response({ ok: true, notes: {} }));
    });

    const view = render(<MoodPortal />);
    fireEvent.click(await screen.findByRole('button', { name: '견적' }));
    fireEvent.change(screen.getByLabelText('견적 고객 일정'), { target: { value: '고객 A 비공개 일정' } });
    expect(screen.getByDisplayValue('고객 A 비공개 일정')).toBeInTheDocument();

    currentUser = { uid: 'staff-uid', email: 'staff@mood.test' };
    view.rerender(<MoodPortal />);

    expect(screen.queryByRole('button', { name: '견적' })).toBeNull();
    expect(screen.queryByLabelText('관리자 견적 작성기')).toBeNull();
    expect(screen.queryByDisplayValue('고객 A 비공개 일정')).toBeNull();
    await waitFor(() => expect(moodDataCall).toBe(2));

    staffData.resolve(response(moodData(false, 'MOOD STAFF')));
    await screen.findByText('MOOD STAFF');
    expect(screen.queryByRole('button', { name: '견적' })).toBeNull();
    expect(screen.queryByDisplayValue('고객 A 비공개 일정')).toBeNull();
  });

  it('새 계정 mood-data 요청이 실패해도 이전 관리자 UI와 일정이 다시 나타나지 않는다', async () => {
    let moodDataCall = 0;
    authFetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/mood-data')) {
        moodDataCall += 1;
        return moodDataCall === 1
          ? response(moodData(true, 'MOOD ADMIN'))
          : response({ ok: false, error: '새 계정 조회 실패' }, 500);
      }
      return response({ ok: true, notes: {} });
    });

    const view = render(<MoodPortal />);
    fireEvent.click(await screen.findByRole('button', { name: '견적' }));
    fireEvent.change(screen.getByLabelText('견적 고객 일정'), { target: { value: '실패 뒤에도 숨길 일정' } });

    currentUser = { uid: 'failed-staff-uid', email: 'failed@mood.test' };
    view.rerender(<MoodPortal />);

    expect(await screen.findByText('새 계정 조회 실패')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '견적' })).toBeNull();
    expect(screen.queryByLabelText('관리자 견적 작성기')).toBeNull();
    expect(screen.queryByDisplayValue('실패 뒤에도 숨길 일정')).toBeNull();
  });

  it('로그아웃한 뒤 같은 uid로 다시 로그인해도 이전 관리자 응답을 재사용하지 않는다', async () => {
    const reloginData = deferred<ReturnType<typeof response>>();
    let moodDataCall = 0;
    authFetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/mood-data')) {
        moodDataCall += 1;
        return moodDataCall === 1
          ? Promise.resolve(response(moodData(true, 'MOOD ADMIN')))
          : reloginData.promise;
      }
      return Promise.resolve(response({ ok: true, notes: {} }));
    });

    const view = render(<MoodPortal />);
    fireEvent.click(await screen.findByRole('button', { name: '견적' }));
    fireEvent.change(screen.getByLabelText('견적 고객 일정'), { target: { value: '로그아웃 전 일정' } });

    currentUser = null;
    view.rerender(<MoodPortal />);
    expect(screen.getByRole('button', { name: '구글로 로그인' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('로그아웃 전 일정')).toBeNull();

    currentUser = { uid: 'admin-uid', email: '2001leety@gmail.com' };
    view.rerender(<MoodPortal />);
    await waitFor(() => expect(moodDataCall).toBe(2));
    expect(screen.queryByRole('button', { name: '견적' })).toBeNull();
    expect(screen.queryByDisplayValue('로그아웃 전 일정')).toBeNull();

    reloginData.resolve(response({ ok: false, error: '재로그인 조회 실패' }, 500));
    expect(await screen.findByText('재로그인 조회 실패')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '견적' })).toBeNull();
  });
});
