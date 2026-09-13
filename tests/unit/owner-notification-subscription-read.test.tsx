// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePushSubscription } from '@/hooks/usePushSubscription';

const fake = vi.hoisted(() => ({
  getDoc: vi.fn(), getDocFromServer: vi.fn(), doc: vi.fn((...args: unknown[]) => args),
  getSubscription: vi.fn(), getRegistration: vi.fn(),
  setDoc: vi.fn(), deleteDoc: vi.fn(),
}));
const keyMock = vi.hoisted(() => ({
  configured: vi.fn(),
  extract: vi.fn(),
  equal: vi.fn(),
  toArrayBuffer: vi.fn(),
}));

const keyA = new Uint8Array([1, 2, 3]);
const keyB = new Uint8Array([9, 8, 7]);
const PUBLIC_KEY = 'synthetic-public-key';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'test-owner' } }) }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: fake.doc, getDoc: fake.getDoc, getDocFromServer: fake.getDocFromServer,
  setDoc: fake.setDoc, deleteDoc: fake.deleteDoc, serverTimestamp: vi.fn(),
}));
vi.mock('@/lib/pushSubscriptionKey', () => ({
  getConfiguredVapidPublicKey: keyMock.configured,
  getPushSubscriptionApplicationServerKeyBytes: keyMock.extract,
  isSameVapidPublicKey: keyMock.equal,
  toArrayBuffer: keyMock.toArrayBuffer,
}));

beforeEach(() => {
  vi.clearAllMocks();
  fake.getDoc.mockResolvedValue({ exists: () => true });
  fake.getDocFromServer.mockResolvedValue({ exists: () => false });
  fake.setDoc.mockResolvedValue(undefined);
  fake.deleteDoc.mockResolvedValue(undefined);
  keyMock.configured.mockReturnValue({ value: PUBLIC_KEY, bytes: keyA });
  keyMock.toArrayBuffer.mockImplementation((bytes: Uint8Array) => {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  });
  keyMock.extract.mockReturnValue(keyA);
  keyMock.equal.mockReturnValue(true);
  fake.getSubscription.mockResolvedValue({
    options: { applicationServerKey: keyA },
    toJSON: () => ({ endpoint: 'https://push.example.invalid/device-test' }),
    unsubscribe: vi.fn(),
  });
  const registration = { pushManager: { getSubscription: fake.getSubscription } };
  fake.getRegistration.mockResolvedValue(registration);
  vi.stubGlobal('Notification', {
    permission: 'granted',
    requestPermission: vi.fn().mockResolvedValue('granted'),
  });
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

  it('동일 키면 기존 구독을 재사용한다', async () => {
    const subscribeMock = vi.fn();
    const registration = { pushManager: { getSubscription: fake.getSubscription, subscribe: subscribeMock } };
    fake.getRegistration.mockResolvedValue(registration);
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration), getRegistration: fake.getRegistration } });

    const { result } = renderHook(() => usePushSubscription());
    let ok = false;
    await act(async () => {
      ok = await result.current.enable();
    });

    expect(ok).toBe(true);
    expect(fake.getSubscription).toHaveBeenCalledTimes(1);
    expect(keyMock.extract).toHaveBeenCalled();
    expect(keyMock.equal).toHaveBeenCalledWith(keyA, keyA);
    expect(fake.setDoc).toHaveBeenCalledTimes(1);
    expect(fake.setDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ vapidPublicKey: PUBLIC_KEY }));
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(fake.deleteDoc).not.toHaveBeenCalled();
  });

  it('키 불일치 시 기존 구독을 해제하고 새 키로 구독한다', async () => {
    const unsubscribeMock = vi.fn().mockResolvedValue(true);
    const subscribeMock = vi.fn().mockResolvedValue({
      options: { applicationServerKey: keyA },
      toJSON: () => ({ endpoint: 'https://push.example.invalid/device-new' }),
    });
    const existing = {
      options: { applicationServerKey: keyB },
      toJSON: () => ({ endpoint: 'https://push.example.invalid/device-old' }),
      unsubscribe: unsubscribeMock,
    };
    fake.getSubscription.mockResolvedValue(existing);
    keyMock.extract.mockReturnValue(keyB);
    keyMock.equal.mockReturnValue(false);
    const registration = { pushManager: { getSubscription: fake.getSubscription, subscribe: subscribeMock } };
    fake.getRegistration.mockResolvedValue(registration);
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration), getRegistration: fake.getRegistration } });

    const { result } = renderHook(() => usePushSubscription());
    let ok = false;
    await act(async () => {
      ok = await result.current.enable();
    });

    expect(ok).toBe(true);
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(ArrayBuffer),
    });
    expect(fake.setDoc).toHaveBeenCalledTimes(1);
    expect(fake.setDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ vapidPublicKey: PUBLIC_KEY }));
  });

  it('기존 키를 검사할 수 없으면 변경하지 않고 실패한다', async () => {
    const unsubscribeMock = vi.fn().mockResolvedValue(true);
    const existing = {
      options: {},
      toJSON: () => ({ endpoint: 'https://push.example.invalid/device-old' }),
      unsubscribe: unsubscribeMock,
    };
    fake.getSubscription.mockResolvedValue(existing);
    keyMock.extract.mockReturnValue(null as unknown as Uint8Array);

    const subscribeMock = vi.fn();
    const registration = { pushManager: { getSubscription: fake.getSubscription, subscribe: subscribeMock } };
    fake.getRegistration.mockResolvedValue(registration);
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration), getRegistration: fake.getRegistration } });

    const { result } = renderHook(() => usePushSubscription());
    let ok = true;
    await act(async () => {
      ok = await result.current.enable();
    });

    expect(ok).toBe(false);
    expect(unsubscribeMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(fake.setDoc).not.toHaveBeenCalled();
  });

  it('키 회전 실패(구독 해제 false)는 실패하고 재구독하지 않는다', async () => {
    const unsubscribeMock = vi.fn().mockResolvedValue(false);
    const existing = {
      options: { applicationServerKey: keyB },
      toJSON: () => ({ endpoint: 'https://push.example.invalid/device-old' }),
      unsubscribe: unsubscribeMock,
    };
    fake.getSubscription.mockResolvedValue(existing);
    keyMock.extract.mockReturnValue(keyB);
    keyMock.equal.mockReturnValue(false);

    const subscribeMock = vi.fn();
    const registration = { pushManager: { getSubscription: fake.getSubscription, subscribe: subscribeMock } };
    fake.getRegistration.mockResolvedValue(registration);
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration), getRegistration: fake.getRegistration } });

    const { result } = renderHook(() => usePushSubscription());
    let ok = true;
    await act(async () => {
      ok = await result.current.enable();
    });

    expect(ok).toBe(false);
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(fake.setDoc).not.toHaveBeenCalled();
  });

  it('키 회전 중 구독 해제가 예외면 기존 문서와 구독을 더 바꾸지 않는다', async () => {
    const unsubscribeMock = vi.fn().mockRejectedValue(new Error('unsubscribe-failed'));
    const existing = {
      options: { applicationServerKey: keyB },
      toJSON: () => ({ endpoint: 'https://push.example.invalid/device-old' }),
      unsubscribe: unsubscribeMock,
    };
    fake.getSubscription.mockResolvedValue(existing);
    keyMock.extract.mockReturnValue(keyB);
    keyMock.equal.mockReturnValue(false);
    const subscribeMock = vi.fn();
    const registration = { pushManager: { getSubscription: fake.getSubscription, subscribe: subscribeMock } };
    fake.getRegistration.mockResolvedValue(registration);
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(registration), getRegistration: fake.getRegistration } });

    const { result } = renderHook(() => usePushSubscription());
    await expect(result.current.enable()).resolves.toBe(false);

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(fake.setDoc).not.toHaveBeenCalled();
    expect(fake.deleteDoc).not.toHaveBeenCalled();
  });

  it('VAPID 키가 유효하지 않으면 어떤 변경도 하지 않는다', async () => {
    keyMock.configured.mockReturnValue(null);

    const { result } = renderHook(() => usePushSubscription());
    let ok = true;
    await act(async () => {
      ok = await result.current.enable();
    });

    expect(ok).toBe(false);
    expect(fake.getSubscription).not.toHaveBeenCalled();
    expect(fake.setDoc).not.toHaveBeenCalled();
    expect(fake.deleteDoc).not.toHaveBeenCalled();
  });

  it('isEnabled는 키 불일치면 미등록으로 반환하고 Firestore 조회를 수행하지 않는다', async () => {
    keyMock.extract.mockReturnValue(keyB);
    keyMock.equal.mockReturnValue(false);

    const { result } = renderHook(() => usePushSubscription());
    let enabled = true;
    await act(async () => {
      enabled = await result.current.isEnabled();
    });

    expect(enabled).toBe(false);
    expect(fake.getDoc).not.toHaveBeenCalled();
    expect(fake.getDocFromServer).not.toHaveBeenCalled();
    expect(fake.setDoc).not.toHaveBeenCalled();
    expect(fake.deleteDoc).not.toHaveBeenCalled();
  });

  it('isEnabled는 설정 키가 없으면 구독과 Firestore를 읽지 않는다', async () => {
    keyMock.configured.mockReturnValue(null);
    const { result } = renderHook(() => usePushSubscription());

    await expect(result.current.isEnabled()).resolves.toBe(false);

    expect(fake.getSubscription).not.toHaveBeenCalled();
    expect(fake.getDoc).not.toHaveBeenCalled();
    expect(fake.getDocFromServer).not.toHaveBeenCalled();
  });

  it('isEnabled는 키 비교 가능한 경우 기존 조회 동작을 수행한다', async () => {
    keyMock.extract.mockReturnValue(keyA);
    keyMock.equal.mockReturnValue(true);
    const { result } = renderHook(() => usePushSubscription());
    let enabled = false;
    await act(async () => { enabled = await result.current.isEnabled(); });
    expect(enabled).toBe(true);
    expect(fake.getDoc).toHaveBeenCalledTimes(1);
    expect(fake.getDocFromServer).not.toHaveBeenCalled();
  });
});
