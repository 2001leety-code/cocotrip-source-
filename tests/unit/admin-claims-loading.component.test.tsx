// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

void React;

type SnapshotDoc = { id: string; data: () => Record<string, unknown> };
type Snapshot = { docs: SnapshotDoc[] };
type Listener = {
  collectionName: string;
  next: (snapshot: Snapshot) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
};

const testState = vi.hoisted(() => ({
  listeners: [] as Listener[],
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { email: 'admin@test.invalid', getIdToken: vi.fn(async () => 'test-token') },
    loading: false,
    error: null,
  }),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

vi.mock('@/components/admin/InquiryResponsePanel', () => ({
  default: () => <div data-testid="inquiry-response-panel" />,
}));

vi.mock('@/components/admin/RuntimeFlagsPanel', () => ({
  RuntimeFlagsPanel: () => <div data-testid="inquiry-runtime-flags" />,
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, collectionName: string) => ({ collectionName }),
  query: (source: { collectionName: string }) => source,
  orderBy: () => ({ field: 'createdAt' }),
  onSnapshot: (
    source: { collectionName: string },
    next: (snapshot: Snapshot) => void,
    fail: (error: Error) => void,
  ) => {
    const unsubscribe = vi.fn();
    testState.listeners.push({ collectionName: source.collectionName, next, fail, unsubscribe });
    return unsubscribe;
  },
  doc: vi.fn(),
  updateDoc: vi.fn(),
  serverTimestamp: vi.fn(),
}));

import AdminClaims from '../../src/pages/AdminClaims';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/claims']}>
      <AdminClaims />
    </MemoryRouter>,
  );
}

function listenersFor(collectionName: string): Listener[] {
  return testState.listeners.filter(listener => listener.collectionName === collectionName);
}

function latestListener(collectionName: string): Listener {
  const listeners = listenersFor(collectionName);
  const listener = listeners[listeners.length - 1];
  if (!listener) throw new Error(`${collectionName} listener missing`);
  return listener;
}

async function emitSuccess(collectionName: string, docs: SnapshotDoc[] = []) {
  await act(async () => latestListener(collectionName).next({ docs }));
}

async function emitFailure(collectionName: string) {
  await act(async () => latestListener(collectionName).fail(new Error('permission-denied')));
}

function openInquiriesTab() {
  fireEvent.click(screen.getByRole('button', { name: /문의 \(차터·맞춤투어·버스\)/ }));
}

beforeEach(() => {
  cleanup();
  testState.listeners = [];
  vi.stubEnv('VITE_ADMIN_EMAIL', 'admin@test.invalid');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('AdminClaims 조회 상태', () => {
  it('무료 신청 조회 완료가 아직 진행 중인 문의 조회를 완료 처리하지 않는다', async () => {
    renderPage();
    await waitFor(() => expect(testState.listeners).toHaveLength(2));

    await emitSuccess('pending_free_claims');
    expect(screen.getByText('대기 상태의 무료 신청 항목이 없습니다.')).toBeInTheDocument();

    openInquiriesTab();
    expect(screen.getByRole('status')).toHaveTextContent('문의 목록을 불러오는 중…');
    expect(screen.queryByText(/문의 .*항목이 없습니다/)).toBeNull();
  });

  it('문의 조회 오류를 빈 목록으로 숨기지 않고 재시도 후에만 빈 상태를 보여준다', async () => {
    renderPage();
    await waitFor(() => expect(testState.listeners).toHaveLength(2));
    await emitSuccess('pending_free_claims');
    await emitFailure('charter_inquiries');

    openInquiriesTab();
    expect(screen.getByTestId('inquiries-load-error')).toHaveTextContent('문의 목록을 불러오지 못했습니다.');
    expect(screen.queryByText(/항목이 없습니다/)).toBeNull();
    expect(screen.getByRole('button', { name: /문의 \(차터·맞춤투어·버스\)/ })).toHaveTextContent('확인 실패');

    const failedSubscription = latestListener('charter_inquiries');
    const retryButton = screen.getByRole('button', { name: '문의 목록 다시 불러오기' });
    expect(retryButton).toHaveClass('min-h-[44px]', 'focus-visible:ring-2');
    fireEvent.click(retryButton);

    await waitFor(() => expect(listenersFor('charter_inquiries')).toHaveLength(2));
    expect(failedSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('문의 목록을 불러오는 중…');

    await emitSuccess('charter_inquiries');
    expect(screen.queryByTestId('inquiries-load-error')).toBeNull();
    expect(screen.getByText('대기 상태의 문의 (차터·맞춤투어·버스) 항목이 없습니다.')).toBeInTheDocument();
  });

  it('무료 신청 오류가 정상 조회된 문의 화면으로 새지 않는다', async () => {
    renderPage();
    await waitFor(() => expect(testState.listeners).toHaveLength(2));
    await emitFailure('pending_free_claims');
    await emitSuccess('charter_inquiries');

    expect(screen.getByTestId('claims-load-error')).toHaveTextContent('무료 신청 목록을 불러오지 못했습니다.');
    openInquiriesTab();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('대기 상태의 문의 (차터·맞춤투어·버스) 항목이 없습니다.')).toBeInTheDocument();
  });

  it('문의는 과거 무료 신청 승인 버튼으로 상태를 바꾸지 않고 응답 패널에서만 승인한다', async () => {
    renderPage();
    await waitFor(() => expect(testState.listeners).toHaveLength(2));
    await emitSuccess('pending_free_claims');
    await emitSuccess('charter_inquiries', [{
      id: 'inquiry-1',
      data: () => ({
        status: 'NEW',
        vehicle: 'bus',
        email: 'guest@example.com',
        details: 'Airport transfer question',
      }),
    }]);

    openInquiriesTab();
    expect(screen.getByTestId('inquiry-runtime-flags')).toBeInTheDocument();
    expect(screen.getByTestId('inquiry-response-panel')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '승인' })).toHaveLength(1); // 상태 필터만 남음
    expect(screen.getAllByRole('button', { name: '거절' })).toHaveLength(2); // 상태 필터 + 문의 종료 액션
  });
});
