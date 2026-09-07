// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePushSubscription } from '@/hooks/usePushSubscription';

const fake = vi.hoisted(() => ({
  getDoc: vi.fn(), getDocFromServer: vi.fn(), doc: vi.fn((...args: unknown[]) => args),
  getSubscription: vi.fn(), getRegistration: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'test-owner' } }) }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: fake.doc, getDoc: fake.getDoc, getDocFromServer: fake.getDocFromServer,
  setDoc: vi.fn(), deleteDoc: vi.fn(), serverTimestamp: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fake.getDoc.mockResolvedValue({ exists: () => true });
  fake.getDocFromServer.mockResolvedValue({ exists: () => false });
  fake.getSubscription.mockResolvedValue({ toJSON: () => ({ endpoint: 'https://push.example.invalid/device-test' }) });
  const registration = { pushManager: { getSubscription: fake.getSubscription } };
  fake.getRegistration.mockResolvedValue(registration);
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration), getRegistration: fake.getRegistration } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('기존 구독 계약의 서버 확인 옵션', () => {
  it('오너 검사에서는 캐시가 등록됨이어도 서버 미등록 결과를 따른다', async () => {
    const { result } = renderHook(() => usePushSubscription());
    let enabled = true;
    await act(async () => { enabled = await result.current.isEnabled({ serverOnly: true }); });
    expect(enabled).toBe(false);
    expect(fake.getDocFromServer).toHaveBeenCalledTimes(1);
    expect(fake.getDoc).not.toHaveBeenCalled();
    expect(fake.doc.mock.calls[0][1]).toBe('push_subscriptions');
    expect(fake.doc.mock.calls[0][2]).toMatch(/^test-owner_/);
  });

  it('기존 일반 PWA 호출 방식은 기존 조회를 유지한다', async () => {
    const { result } = renderHook(() => usePushSubscription());
    let enabled = false;
    await act(async () => { enabled = await result.current.isEnabled(); });
    expect(enabled).toBe(true);
    expect(fake.getDoc).toHaveBeenCalledTimes(1);
    expect(fake.getDocFromServer).not.toHaveBeenCalled();
  });

  it('서버 조회 실패를 캐시 등록됨으로 대체하지 않는다', async () => {
    fake.getDocFromServer.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => usePushSubscription());
    await expect(result.current.isEnabled({ serverOnly: true })).rejects.toThrow('offline');
    expect(fake.getDoc).not.toHaveBeenCalled();
  });

  it('브라우저 구독이 없으면 서버 자료를 읽지 않고 미등록으로 반환한다', async () => {
    fake.getSubscription.mockResolvedValue(null);
    const { result } = renderHook(() => usePushSubscription());
    await expect(result.current.isEnabled({ serverOnly: true })).resolves.toBe(false);
    expect(fake.getDocFromServer).not.toHaveBeenCalled();
  });
});
