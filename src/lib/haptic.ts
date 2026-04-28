/**
 * Haptic feedback wrapper around `navigator.vibrate`.
 *
 * iOS Safari ignores vibrate (no-op, never throws). Android Chrome works.
 * Desktop browsers no-op silently. Users can disable via localStorage flag
 * if vibration becomes annoying — settings UI is a follow-up; for now the
 * default is on.
 *
 * Three intensity presets keep usage consistent:
 *   - tap     light, single 8ms — button presses, step nav
 *   - select  medium, single 15ms — chip/zone selection, picker tap
 *   - success patterned — plan ready, payment confirmed
 *
 * Wrapped in try/catch because some browsers throw on patterns when not
 * triggered by a user gesture (rare but documented).
 */

const SUPPORTED = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let prefCache: boolean | null = null;

function loadPref(): boolean {
  if (prefCache !== null) return prefCache;
  try {
    const s = localStorage.getItem('cocotrip_haptic');
    prefCache = s === null ? true : s !== 'off';
  } catch {
    prefCache = true;
  }
  return prefCache;
}

export type HapticIntensity = 'tap' | 'select' | 'success';

export function haptic(intensity: HapticIntensity = 'tap'): void {
  if (!SUPPORTED) return;
  if (!loadPref()) return;
  try {
    switch (intensity) {
      case 'tap':
        navigator.vibrate(8);
        break;
      case 'select':
        navigator.vibrate(15);
        break;
      case 'success':
        navigator.vibrate([10, 30, 10]);
        break;
    }
  } catch {
    /* ignore — non-critical */
  }
}

export function setHapticEnabled(on: boolean): void {
  prefCache = on;
  try {
    localStorage.setItem('cocotrip_haptic', on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

export function isHapticEnabled(): boolean {
  return loadPref();
}
