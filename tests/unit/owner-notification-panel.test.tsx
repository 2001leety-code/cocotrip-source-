// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OwnerNotificationPanel } from '@/components/OwnerNotificationPanel';
import { ownerNotificationCopy } from '@/components/ownerNotificationCopy';
import { OWNER_NOTIFICATION_READ_TIMEOUT_MS, type OwnerNotificationAdapter, type OwnerNotificationSnapshot } from '@/lib/ownerNotificationSetup';
import type { Language } from '@/i18n';

let sequence = 0;
function fixture(overrides: Partial<OwnerNotificationSnapshot> = {}) {
  const snapshot: OwnerNotificationSnapshot = {
    permission: 'default', account: 'signed_in', configured: true, registered: false, ...overrides,
  };
  const adapter: OwnerNotificationAdapter = {
    key: `test-owner-${++sequence}`,
    read: vi.fn(async () => ({ ...snapshot })),
    enroll: vi.fn(async () => {
      snapshot.permission = 'granted';
      snapshot.registered = true;
      return true;
    }),
  };
  return { adapter, snapshot };
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('오너 알림 등록과 상태', () => {
  it('진입으로 권한 요청을 만들지 않고, 클릭 후 서버 확인을 거쳐 기기만 등록됨으로 표시한다', async () => {
    const { adapter } = fixture();
    render(<StrictMode><OwnerNotificationPanel adapter={adapter} /></StrictMode>);
    await screen.findByText('기기 미등록');
    expect(adapter.enroll).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: '이 기기 등록' });
    expect(button).toHaveClass('min-h-[44px]');
    fireEvent.click(button);
    await screen.findByText('기기 등록됨');
    expect(adapter.enroll).toHaveBeenCalledTimes(1);
    expect(screen.getByText(ownerNotificationCopy.ko.dispatch)).toBeInTheDocument();
    expect(screen.getByText(/실제 알림 수신은 별도 확인/)).toBeInTheDocument();
  });

  it('권한이 granted여도 서버 등록이 없으면 등록됐다고 표시하지 않는다', async () => {
    const { adapter } = fixture({ permission: 'granted' });
    adapter.enroll = vi.fn(async () => true);
    render(<OwnerNotificationPanel adapter={adapter} />);
    await screen.findByText('기기 미등록');
    expect(screen.queryByText('기기 등록됨')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '이 기기 등록' }));
    await waitFor(() => expect(adapter.read).toHaveBeenCalledTimes(2));
    await screen.findByText('기기 미등록');
    expect(screen.queryByText('기기 등록됨')).not.toBeInTheDocument();
  });

  it.each([
    [{ permission: 'unsupported' }, '지원되지 않는 환경'],
    [{ permission: 'denied' }, '알림 권한 차단됨'],
    [{ account: 'signed_out' }, '로그인 필요'],
    [{ configured: false }, '알림 연결 설정 필요'],
  ] as [Partial<OwnerNotificationSnapshot>, string][])('준비 조건 %j에서는 등록을 요청하지 않는다', async (state, expected) => {
    const { adapter } = fixture(state);
    render(<OwnerNotificationPanel adapter={adapter} />);
    await screen.findByText(expected);
    expect(screen.queryByRole('button', { name: '이 기기 등록' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }));
    await waitFor(() => expect(adapter.read).toHaveBeenCalledTimes(2));
    expect(adapter.enroll).not.toHaveBeenCalled();
  });

  it('조회 실패를 등록 완료로 바꾸지 않고 읽기 재시도를 제공한다', async () => {
    const { adapter } = fixture({ permission: 'granted', registered: true });
    adapter.read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      permission: 'granted', account: 'signed_in', configured: true, registered: true,
    });
    render(<OwnerNotificationPanel adapter={adapter} />);
    await screen.findByText('등록 상태 확인 실패');
    expect(screen.queryByText('기기 등록됨')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }));
    await screen.findByText('기기 등록됨');
    expect(adapter.enroll).not.toHaveBeenCalled();
  });

  it('시간이 지난 조회의 늦은 응답은 새 조회 결과를 덮지 못한다', async () => {
    vi.useFakeTimers();
    const { adapter, snapshot } = fixture();
    let finishOld: (value: OwnerNotificationSnapshot) => void = () => {};
    adapter.read = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValue({ ...snapshot });
    render(<OwnerNotificationPanel adapter={adapter} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(OWNER_NOTIFICATION_READ_TIMEOUT_MS + 1); });
    expect(screen.getByText('등록 상태 확인 실패')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '다시 확인' })); });
    expect(screen.getByText('기기 미등록')).toBeInTheDocument();
    await act(async () => { finishOld({ ...snapshot, permission: 'granted', registered: true }); });
    expect(screen.queryByText('기기 등록됨')).not.toBeInTheDocument();
    expect(screen.getByText('기기 미등록')).toBeInTheDocument();
  });

  it('실패한 등록은 다시 시도할 수 있고 브라우저 권한 거부는 차단으로 안내한다', async () => {
    const { adapter, snapshot } = fixture();
    adapter.enroll = vi.fn().mockRejectedValueOnce(new Error('write failed')).mockImplementationOnce(async () => {
      snapshot.permission = 'denied'; return false;
    });
    render(<OwnerNotificationPanel adapter={adapter} />);
    fireEvent.click(await screen.findByRole('button', { name: '이 기기 등록' }));
    await screen.findByText('기기 등록 실패');
    fireEvent.click(screen.getByRole('button', { name: '등록 재시도' }));
    await screen.findByText('알림 권한 차단됨');
    expect(adapter.enroll).toHaveBeenCalledTimes(2);
  });

  it('긴 등록과 재마운트에서도 진행 중 요청 하나를 유지하고 늦게 끝난 등록을 확인한다', async () => {
    const { adapter, snapshot } = fixture();
    let finish: (value: boolean) => void = () => {};
    adapter.enroll = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const first = render(<OwnerNotificationPanel adapter={adapter} />);
    const register = await screen.findByRole('button', { name: '이 기기 등록' });
    vi.useFakeTimers();
    fireEvent.click(register);
    fireEvent.click(register);
    await act(async () => { await vi.advanceTimersByTimeAsync(12_001); });
    expect(screen.getByRole('button', { name: '기기 등록 중' })).toBeDisabled();
    expect(adapter.enroll).toHaveBeenCalledTimes(1);
    first.unmount();
    render(<OwnerNotificationPanel adapter={adapter} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: '기기 등록 중' })).toBeDisabled();
    await act(async () => {
      snapshot.permission = 'granted'; snapshot.registered = true; finish(true);
    });
    expect(screen.getByText('기기 등록됨')).toBeInTheDocument();
    expect(adapter.enroll).toHaveBeenCalledTimes(1);
  });

  it('계정이 바뀐 뒤 이전 계정 조회가 완료되어도 새 계정에 등록됨을 표시하지 않는다', async () => {
    const old = fixture();
    const next = fixture({ account: 'signed_out' });
    let finish: (value: OwnerNotificationSnapshot) => void = () => {};
    old.adapter.read = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<OwnerNotificationPanel adapter={old.adapter} />);
    await waitFor(() => expect(old.adapter.read).toHaveBeenCalledTimes(1));
    view.rerender(<OwnerNotificationPanel adapter={next.adapter} />);
    await screen.findByText('로그인 필요');
    await act(async () => { finish({ ...old.snapshot, registered: true, permission: 'granted' }); });
    expect(screen.getByText('로그인 필요')).toBeInTheDocument();
    expect(screen.queryByText('기기 등록됨')).not.toBeInTheDocument();
  });

  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s에서도 기기 상태와 미연결 범위를 함께 안내한다', async (language) => {
    const { adapter } = fixture({ permission: 'granted', registered: true });
    render(<OwnerNotificationPanel adapter={adapter} language={language} />);
    await screen.findByText(ownerNotificationCopy[language].registered);
    expect(screen.getByText(ownerNotificationCopy[language].dispatch)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ownerNotificationCopy[language].check })).toHaveClass('min-h-[44px]');
  });
});
