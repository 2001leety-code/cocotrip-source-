// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOURS_BACKGROUND_STORAGE_KEY as KEY,
  computeShouldAnimate,
  isToursPath,
  resetToursBackgroundPreference,
  resetToursBackgroundStoreForTests,
  setToursBackgroundEnabled,
  useToursBackgroundPreference,
  useToursCloudMotion,
} from '@/lib/toursBackgroundMotion';

beforeEach(() => {
  window.localStorage.clear();
  resetToursBackgroundStoreForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

describe('isToursPath', () => {
  it('matches only exact /tours', () => {
    expect(isToursPath('/tours')).toBe(true);
    expect(isToursPath('/tours/seoul')).toBe(false);
    expect(isToursPath('/')).toBe(false);
  });
});

describe('preference store', () => {
  it('defaults on, turns off, and resets to on', () => {
    const { result } = renderHook(() => useToursBackgroundPreference(true));
    expect(result.current.enabled).toBe(true);
    act(() => setToursBackgroundEnabled(false));
    expect(result.current.enabled).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe('0');
    act(() => resetToursBackgroundPreference());
    expect(result.current.enabled).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the choice in memory after a failed write and never reverts', () => {
    const { result } = renderHook(() => useToursBackgroundPreference(true));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    act(() => setToursBackgroundEnabled(false));
    expect(result.current.enabled).toBe(false);
    vi.restoreAllMocks();
    // storage is empty (would read as default on), yet the sticky value holds
    const again = renderHook(() => useToursBackgroundPreference(true));
    expect(again.result.current.enabled).toBe(false);
  });

  it('syncs from other tabs, including key removal and clear', () => {
    const { result } = renderHook(() => useToursBackgroundPreference(true));
    act(() => {
      window.localStorage.setItem(KEY, '0');
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '0', storageArea: window.localStorage }));
    });
    expect(result.current.enabled).toBe(false);
    act(() => {
      window.localStorage.removeItem(KEY);
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: null, storageArea: window.localStorage }));
    });
    expect(result.current.enabled).toBe(true);
    act(() => {
      window.localStorage.setItem(KEY, '0');
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '0', storageArea: window.localStorage }));
    });
    expect(result.current.enabled).toBe(false);
    act(() => {
      window.localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: window.localStorage }));
    });
    expect(result.current.enabled).toBe(true);
  });

  it('inactive hook never touches storage', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const { result } = renderHook(() => useToursBackgroundPreference(false));
    expect(result.current.enabled).toBe(true);
    expect(getItem).not.toHaveBeenCalled();
  });

  it('ignores sessionStorage events after a failed preference write', () => {
    const { result } = renderHook(() => useToursBackgroundPreference(true));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => setToursBackgroundEnabled(false));
    vi.restoreAllMocks();
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: window.sessionStorage }));
    });
    expect(result.current.enabled).toBe(false);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: window.localStorage }));
    });
    expect(result.current.enabled).toBe(true);
  });
});

describe('computeShouldAnimate', () => {
  const ok = { preference: true, reduceMotion: false, saveData: false, visible: true, intersecting: true };
  it('runs only when every guard passes', () => {
    expect(computeShouldAnimate(ok)).toBe(true);
    expect(computeShouldAnimate({ ...ok, preference: false })).toBe(false);
    expect(computeShouldAnimate({ ...ok, reduceMotion: true })).toBe(false);
    expect(computeShouldAnimate({ ...ok, saveData: true })).toBe(false);
    expect(computeShouldAnimate({ ...ok, visible: false })).toBe(false);
    expect(computeShouldAnimate({ ...ok, intersecting: false })).toBe(false);
  });
});

describe('useToursCloudMotion', () => {
  type Listener = () => void;
  let reduce = false;
  let listeners: Set<Listener>;
  let observers: MockObserver[];

  class MockObserver {
    cb: IntersectionObserverCallback;
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
      observers.push(this);
    }
    emit(isIntersecting: boolean) {
      this.cb([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }

  beforeEach(() => {
    reduce = false;
    listeners = new Set();
    observers = [];
    window.matchMedia = ((query: string) => ({
      matches: reduce,
      media: query,
      addEventListener: (_type: string, l: Listener) => listeners.add(l),
      removeEventListener: (_type: string, l: Listener) => listeners.delete(l),
    })) as unknown as typeof window.matchMedia;
    vi.stubGlobal('IntersectionObserver', MockObserver);
  });

  const mount = (active = true) => {
    const ref = { current: document.createElement('header') as Element | null };
    return renderHook(() => useToursCloudMotion(ref, active));
  };

  it('starts paused and runs once the masthead intersects', () => {
    const { result } = mount();
    expect(result.current.running).toBe(false);
    act(() => observers[0].emit(true));
    expect(result.current.running).toBe(true);
    act(() => observers[0].emit(false));
    expect(result.current.running).toBe(false);
  });

  it('stops on reduced-motion media change and reports device stop', () => {
    const { result } = mount();
    act(() => observers[0].emit(true));
    expect(result.current.running).toBe(true);
    act(() => {
      reduce = true;
      listeners.forEach((l) => l());
    });
    expect(result.current.running).toBe(false);
    expect(result.current.deviceStopped).toBe(true);
    expect(result.current.preference).toBe(true);
  });

  it('pauses when the document is hidden', () => {
    const { result } = mount();
    act(() => observers[0].emit(true));
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.running).toBe(false);
  });

  it('stays paused when the preference is off', () => {
    const { result } = mount();
    act(() => observers[0].emit(true));
    act(() => setToursBackgroundEnabled(false));
    expect(result.current.running).toBe(false);
    expect(result.current.deviceStopped).toBe(false);
  });

  it('is static without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { result } = mount();
    expect(result.current.running).toBe(false);
  });

  it('cleans up observer and listeners on unmount', () => {
    const { unmount } = mount();
    expect(listeners.size).toBe(1);
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('pauses and resumes for Save-Data changes and removes its connection listener', () => {
    const connectionListeners = new Set<Listener>();
    const connection = {
      saveData: false,
      addEventListener: (_type: string, listener: Listener) => connectionListeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => connectionListeners.delete(listener),
    };
    Object.defineProperty(navigator, 'connection', { value: connection, configurable: true });
    try {
      const { result, unmount } = mount();
      act(() => observers[0].emit(true));
      expect(result.current.running).toBe(true);
      act(() => { connection.saveData = true; connectionListeners.forEach((listener) => listener()); });
      expect(result.current.running).toBe(false);
      expect(result.current.deviceStopped).toBe(true);
      expect(result.current.preference).toBe(true);
      act(() => { connection.saveData = false; connectionListeners.forEach((listener) => listener()); });
      expect(result.current.running).toBe(true);
      unmount();
      expect(connectionListeners.size).toBe(0);
    } finally {
      delete (navigator as Navigator & { connection?: unknown }).connection;
    }
  });

  it('does nothing when inactive', () => {
    const { result } = mount(false);
    expect(observers.length).toBe(0);
    expect(listeners.size).toBe(0);
    expect(result.current.running).toBe(false);
  });
});
