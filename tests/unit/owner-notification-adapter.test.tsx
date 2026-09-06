// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwnerNotificationSetup } from '@/components/OwnerNotificationSetup';

const fake = vi.hoisted(() => ({
  user: { uid: 'owner-adapter-test' } as { uid: string } | null,
  loading: false,
  enable: vi.fn(),
  isEnabled: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fake.user, loading: fake.loading }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'ko' }) }));
vi.mock('@/hooks/usePushSubscription', () => ({ usePushSubscription: () => ({
  enable: fake.enable, isEnabled: fake.isEnabled, state: 'granted', busy: false,
}) }));

beforeEach(() => {
  fake.user = { uid: 'owner-adapter-test' };
  fake.loading = false;
  fake.enable.mockReset().mockResolvedValue(true);
  fake.isEnabled.mockReset().mockResolvedValue(false);
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'public-test-config');
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({}) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('운영 알림 어댑터', () => {
  it('브라우저 권한만 신뢰하지 않고 기존 hook에 서버 등록 확인을 요청한다', async () => {
    render(<OwnerNotificationSetup />);
    await screen.findByText('기기 미등록');
    expect(fake.isEnabled).toHaveBeenCalledWith({ serverOnly: true });
    expect(fake.enable).not.toHaveBeenCalled();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    fake.isEnabled.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: '이 기기 등록' }));
    await screen.findByText('기기 등록됨');
    expect(fake.enable).toHaveBeenCalledTimes(1);
  });

  it('기존 공개 키 설정이 없으면 등록 액션을 열지 않는다', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    render(<OwnerNotificationSetup />);
    await screen.findByText('알림 연결 설정 필요');
    expect(fake.isEnabled).not.toHaveBeenCalled();
    expect(fake.enable).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '이 기기 등록' })).not.toBeInTheDocument();
  });

  it('권한 차단·로그아웃에서는 서버 구독 자료를 읽지 않는다', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
    const view = render(<OwnerNotificationSetup />);
    await screen.findByText('알림 권한 차단됨');
    expect(fake.isEnabled).not.toHaveBeenCalled();
    fake.user = null;
    view.rerender(<OwnerNotificationSetup />);
    await screen.findByText('로그인 필요');
    expect(fake.isEnabled).not.toHaveBeenCalled();
  });

  it('등록 확인 실패는 서버 등록 완료로 표시하지 않는다', async () => {
    fake.isEnabled.mockRejectedValue(new Error('server unavailable'));
    render(<OwnerNotificationSetup />);
    await screen.findByText('등록 상태 확인 실패');
    expect(screen.queryByText('기기 등록됨')).not.toBeInTheDocument();
    expect(fake.enable).not.toHaveBeenCalled();
  });

  it('계정 로딩이 끝나면 새 계정으로 다시 검사한다', async () => {
    fake.loading = true;
    const view = render(<OwnerNotificationSetup />);
    await screen.findByText('로그인 확인 중');
    expect(fake.isEnabled).not.toHaveBeenCalled();
    fake.loading = false;
    view.rerender(<OwnerNotificationSetup />);
    await screen.findByText('기기 미등록');
    await waitFor(() => expect(fake.isEnabled).toHaveBeenCalledTimes(1));
  });
});
