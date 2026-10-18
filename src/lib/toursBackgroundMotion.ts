import { useEffect, useState, useSyncExternalStore } from 'react';

export type Language = 'ko' | 'en' | 'ja' | 'zh';

export const TOURS_BACKGROUND_STORAGE_KEY = 'cocotrip.tours.cloud-background.v1';
export const TOURS_BACKGROUND_EVENT = 'cocotrip:tours-cloud-background';

export interface ToursBackgroundCopy {
  title: string;
  label: string;
  item: string;
  stopped: string;
}

export const TOURS_BACKGROUND_COPY: Record<Language, ToursBackgroundCopy> = {
  ko: { title: '언어 및 배경 설정', label: '배경', item: '구름 움직임', stopped: '기기 설정으로 정지됨' },
  en: { title: 'Language and background settings', label: 'Background', item: 'Moving clouds', stopped: 'Stopped by device settings' },
  ja: { title: '言語と背景の設定', label: '背景', item: '雲の動き', stopped: '端末の設定により停止中' },
  zh: { title: '语言和背景设置', label: '背景', item: '云朵动态', stopped: '已按设备设置停止' },
};

/** Exact /tours only. */
export function isToursPath(pathname: string): boolean {
  return pathname === '/tours';
}

/* ── Preference store (single owner) ─────────────────────────────── */

let memoryValue = true;
let sticky = false;

export function getToursBackgroundSnapshot(): boolean {
  if (typeof window === 'undefined') return true;
  if (sticky) return memoryValue;
  try {
    memoryValue = window.localStorage.getItem(TOURS_BACKGROUND_STORAGE_KEY) !== '0';
  } catch {
    // read failure: keep last known value
  }
  return memoryValue;
}

export function setToursBackgroundEnabled(next: boolean): void {
  memoryValue = next;
  try {
    window.localStorage.setItem(TOURS_BACKGROUND_STORAGE_KEY, next ? '1' : '0');
    sticky = false;
  } catch {
    // write failed: this tab keeps the in-memory choice and never rereads old storage
    sticky = true;
  }
  window.dispatchEvent(new Event(TOURS_BACKGROUND_EVENT));
}

export function resetToursBackgroundPreference(): void {
  memoryValue = true;
  sticky = false;
  try {
    window.localStorage.removeItem(TOURS_BACKGROUND_STORAGE_KEY);
  } catch {
    sticky = true;
  }
  window.dispatchEvent(new Event(TOURS_BACKGROUND_EVENT));
}

export function subscribeToursBackground(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
    if (event.key === null || event.key === TOURS_BACKGROUND_STORAGE_KEY) {
      sticky = false;
      onChange();
    }
  };
  window.addEventListener(TOURS_BACKGROUND_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(TOURS_BACKGROUND_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function resetToursBackgroundStoreForTests(): void {
  memoryValue = true;
  sticky = false;
}

const noopSubscribe = () => () => {};
const alwaysOn = () => true;

/** `active=false` performs no storage reads and no subscriptions. */
export function useToursBackgroundPreference(active: boolean) {
  const enabled = useSyncExternalStore(
    active ? subscribeToursBackground : noopSubscribe,
    active ? getToursBackgroundSnapshot : alwaysOn,
    alwaysOn,
  );
  return { enabled, setEnabled: setToursBackgroundEnabled };
}

/* ── Device guards ───────────────────────────────────────────────── */

export interface DeviceMotionState {
  reduceMotion: boolean;
  saveData: boolean;
  visible: boolean;
}

type ConnectionLike = {
  saveData?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';
const INACTIVE_STATE: DeviceMotionState = { reduceMotion: false, saveData: false, visible: true };

function getConnection(): ConnectionLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { connection?: ConnectionLike }).connection;
}

export function readDeviceMotionState(): DeviceMotionState {
  const reduceMotion = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCE_QUERY).matches;
  const connection = getConnection();
  return {
    reduceMotion,
    saveData: !!(connection && connection.saveData),
    visible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
  };
}

export function useDeviceMotionState(active: boolean): DeviceMotionState {
  const [state, setState] = useState<DeviceMotionState>(() => (active ? readDeviceMotionState() : INACTIVE_STATE));

  useEffect(() => {
    if (!active) return undefined;
    const update = () => {
      const next = readDeviceMotionState();
      setState((prev) => (
        prev.reduceMotion === next.reduceMotion && prev.saveData === next.saveData && prev.visible === next.visible
          ? prev
          : next
      ));
    };
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCE_QUERY) : undefined;
    if (mql) {
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', update);
      else if (typeof mql.addListener === 'function') mql.addListener(update);
    }
    const connection = getConnection();
    if (connection && typeof connection.addEventListener === 'function') connection.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      if (mql) {
        if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', update);
        else if (typeof mql.removeListener === 'function') mql.removeListener(update);
      }
      if (connection && typeof connection.removeEventListener === 'function') connection.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [active]);

  return state;
}

export function computeShouldAnimate(input: {
  preference: boolean;
  reduceMotion: boolean;
  saveData: boolean;
  visible: boolean;
  intersecting: boolean;
}): boolean {
  return input.preference && !input.reduceMotion && !input.saveData && input.visible && input.intersecting;
}

/** Cloud motion for the masthead. Starts paused; no IntersectionObserver => static. */
export function useToursCloudMotion(ref: { current: Element | null }, active: boolean) {
  const { enabled } = useToursBackgroundPreference(active);
  const device = useDeviceMotionState(active);
  const [intersecting, setIntersecting] = useState(false);

  useEffect(() => {
    if (!active || typeof IntersectionObserver === 'undefined') return undefined;
    const element = ref.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setIntersecting(last.isIntersecting);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      setIntersecting(false);
    };
  }, [active, ref]);

  return {
    preference: enabled,
    deviceStopped: device.reduceMotion || device.saveData,
    running: active && computeShouldAnimate({
      preference: enabled,
      reduceMotion: device.reduceMotion,
      saveData: device.saveData,
      visible: device.visible,
      intersecting,
    }),
  };
}
