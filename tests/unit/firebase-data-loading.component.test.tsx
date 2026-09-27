// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCart } from '../../src/hooks/useCart';
import { useWishlist } from '../../src/hooks/useWishlist';
import { useLoyalty } from '../../src/hooks/useLoyalty';
import { useUserProfile } from '../../src/hooks/useUserProfile';
import { useProfileContactSync } from '../../src/hooks/useProfileContactSync';
import { useNextTrip } from '../../src/sections/home/useNextTrip';
import { useAuth } from '../../src/hooks/useAuth';
import { usePushSubscription } from '../../src/hooks/usePushSubscription';

const boundary = vi.hoisted(() => {
  let release!: () => void;
  return {
    ready: new Promise<void>(resolve => { release = resolve; }),
    release: () => release(),
    loads: 0,
    listeners: new Set<(user: unknown) => void>(),
    snapshot: vi.fn(() => vi.fn()),
    read: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined, forEach: () => {} }),
    write: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue('synthetic-token'),
  };
});

// Execute the real app/Auth/DB glue and hooks; only Firebase SDK boundaries are replaced.
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: () => ({ name: 'synthetic-app' }) }));
vi.mock('firebase/auth', () => {
  class Provider { addScope() {} setCustomParameters() {} }
  return {
    getAuth: () => ({}), GoogleAuthProvider: Provider, OAuthProvider: Provider,
    signInWithPopup: vi.fn(), signInWithRedirect: vi.fn(), getRedirectResult: vi.fn(),
    signInWithPhoneNumber: vi.fn(), signInAnonymously: vi.fn(), RecaptchaVerifier: vi.fn(),
    onAuthStateChanged: (_auth: unknown, next: (user: unknown) => void) => {
      boundary.listeners.add(next); next(null);
      return () => boundary.listeners.delete(next);
    },
  };
});
vi.mock('firebase/storage', () => ({ getStorage: () => ({}) }));
vi.mock('firebase/firestore', async () => {
  boundary.loads++;
  await boundary.ready;
  return {
    getFirestore: () => ({}),
    doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
    collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
    query: (ref: string) => ref, where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
    serverTimestamp: () => 'synthetic-time', onSnapshot: boundary.snapshot,
    getDoc: boundary.read, getDocs: boundary.read, setDoc: boundary.write, deleteDoc: boundary.remove,
  };
});

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('keeps guest operations local and cancels stale DB work while the SDK loads', async () => {
  const hook = renderHook(() => {
    useProfileContactSync('+12025550123');
    return {
      cart: useCart(), wishlist: useWishlist(), loyalty: useLoyalty(),
      profile: useUserProfile(), trip: useNextTrip(),
      push: usePushSubscription(),
    };
  });
  await act(async () => {
    await hook.result.current.wishlist.toggle({ id: 'guest-wish', productType: 'tour', name: 'Synthetic tour' });
  });
  expect(boundary.loads).toBe(0);
  expect(hook.result.current.wishlist.items).toHaveLength(1);
  const changeUser = (uid: string | null) => act(() => {
    for (const next of boundary.listeners) next(uid ? { uid, getIdToken: boundary.refresh } : null);
  });

  changeUser('cancelled-user');
  changeUser(null);
  await act(async () => { boundary.release(); await vi.dynamicImportSettled(); });
  expect(boundary.loads).toBeGreaterThan(0);
  expect(boundary.snapshot).not.toHaveBeenCalled();
  expect(boundary.read).not.toHaveBeenCalled();
  expect(boundary.write).not.toHaveBeenCalled();
  expect(hook.result.current.loyalty.loading).toBe(false);
  expect(hook.result.current.profile.profile).toBeNull();

  changeUser('current-user');
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(boundary.snapshot).toHaveBeenCalledTimes(5); // cart, wishlist, membership/coupons/history
  expect(boundary.read).toHaveBeenCalledTimes(2); // profile and next trip
  expect(boundary.write).toHaveBeenCalledWith('users/current-user', { phoneNumber: '+12025550123' }, { merge: true });
  await act(async () => { await hook.result.current.cart.remove('cart-item'); });
  expect(boundary.remove).toHaveBeenCalledWith('users/current-user/cart/cart-item');
  hook.unmount();
  for (const result of boundary.snapshot.mock.results) expect(result.value).toHaveBeenCalledOnce();
  expect(boundary.listeners.size).toBe(0);
});

it('keeps periodic and foreground token refresh, and removes both after sign-out', async () => {
  vi.useFakeTimers();
  boundary.refresh.mockClear();
  const hook = renderHook(() => useAuth());
  act(() => {
    for (const next of boundary.listeners) next({ uid: 'refresh-user', getIdToken: boundary.refresh });
  });
  await act(async () => { vi.advanceTimersByTime(50 * 60 * 1000); });
  expect(boundary.refresh).toHaveBeenCalledExactlyOnceWith(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(boundary.refresh).toHaveBeenCalledTimes(2);
  act(() => { for (const next of boundary.listeners) next(null); });
  await act(async () => {
    vi.advanceTimersByTime(100 * 60 * 1000);
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(boundary.refresh).toHaveBeenCalledTimes(2);
  expect(hook.result.current.user).toBeNull();
  hook.unmount();
  expect(boundary.listeners.size).toBe(0);
});
