/**
 * PR #443 — Audit Z-H12 regression slot.
 *
 * Pre-fix: throttledTelegramAlert fell open in three places:
 *   (a) missing/invalid `key` → direct notify
 *   (b) Firestore admin SDK unavailable (initAdminDb returned null) →
 *       direct notify
 *   (c) Firestore transaction threw (e.g., network blip) → direct notify
 *
 * Combined with a high-rate underlying error (Gemini quota exceeded
 * firing 100+ times/min), each of these paths would FLOOD the
 * operator Telegram channel — exactly the spam the dedup logic was
 * designed to prevent.
 *
 * Post-fix: an in-memory Map (keyed by dedup key, per serverless
 * instance) provides a 5-minute throttle as a safety net. When the
 * Firestore-backed throttle is unreachable, we still cap the flood
 * to one alert per key per 5 minutes per container.
 *
 * Trade-off: per-instance state means N concurrent containers can
 * each send 1 alert per window = N alerts/window. Acceptable —
 * Firestore outages are rare AND short, and per-instance throttling
 * still gives operators digestible signal instead of unbounded spam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const NOTIFY_MOCK = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock('../../api/_shared/notify.js', () => ({ notify: NOTIFY_MOCK }));

// Force initAdminDb to return null so the !adminDb branch executes.
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: vi.fn(() => null),
}));

// Reset between cases so cross-test pollution doesn't hide regressions.
beforeEach(async () => {
  NOTIFY_MOCK.mockClear();
  const mod = await import('../../api/_shared/telegram-throttle.js');
  mod.__resetInMemoryThrottleForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PR #443 Z-H12 — !adminDb branch is in-memory throttled (not fail-open)', () => {
  it('first call sends notify (no Firestore = first chance)', async () => {
    const { throttledTelegramAlert } = await import('../../api/_shared/telegram-throttle.js');
    const r = await throttledTelegramAlert({
      key: 'unit-test-no-db',
      message: 'first hit',
      channel: 'error',
    });
    expect(r.alerted).toBe(true);
    expect(r.fallback).toBe(true);
    expect(NOTIFY_MOCK).toHaveBeenCalledTimes(1);
  });

  it('100 rapid calls with same key → notify fires exactly ONCE (in-memory throttle)', async () => {
    const { throttledTelegramAlert } = await import('../../api/_shared/telegram-throttle.js');
    const calls = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        throttledTelegramAlert({
          key: 'gemini-quota-exceeded',
          message: `attempt ${i}`,
          channel: 'error',
        }),
      ),
    );
    const alerted = calls.filter((r) => r.alerted).length;
    const throttled = calls.filter((r) => r.throttled).length;
    expect(alerted).toBe(1);
    expect(throttled).toBe(99);
    expect(NOTIFY_MOCK).toHaveBeenCalledTimes(1);
  });

  it('different keys each get their own 1-per-window slot', async () => {
    const { throttledTelegramAlert } = await import('../../api/_shared/telegram-throttle.js');
    const r1 = await throttledTelegramAlert({ key: 'err-a', message: 'a', channel: 'error' });
    const r2 = await throttledTelegramAlert({ key: 'err-b', message: 'b', channel: 'error' });
    const r3 = await throttledTelegramAlert({ key: 'err-c', message: 'c', channel: 'error' });
    expect(r1.alerted).toBe(true);
    expect(r2.alerted).toBe(true);
    expect(r3.alerted).toBe(true);
    expect(NOTIFY_MOCK).toHaveBeenCalledTimes(3);
  });
});

describe('PR #443 Z-H12 — missing key path also bounded (no unbounded flood)', () => {
  it('repeated calls with NO key + same message → notify fires once per message hash window', async () => {
    const { throttledTelegramAlert } = await import('../../api/_shared/telegram-throttle.js');
    const calls = await Promise.all(
      Array.from({ length: 50 }, () =>
        throttledTelegramAlert({
          // No key on purpose — should still get a per-message in-memory throttle.
          message: 'same message body',
          channel: 'error',
        } as any),
      ),
    );
    const alerted = calls.filter((r) => r.alerted).length;
    expect(alerted).toBe(1);
    expect(NOTIFY_MOCK).toHaveBeenCalledTimes(1);
  });

  it('different no-key messages each get their own bucket (real distinct alerts not suppressed)', async () => {
    const { throttledTelegramAlert } = await import('../../api/_shared/telegram-throttle.js');
    const r1 = await throttledTelegramAlert({ message: 'message A', channel: 'error' } as any);
    const r2 = await throttledTelegramAlert({ message: 'message B', channel: 'error' } as any);
    expect(r1.alerted).toBe(true);
    expect(r2.alerted).toBe(true);
    expect(NOTIFY_MOCK).toHaveBeenCalledTimes(2);
  });
});

describe('PR #443 Z-H12 — return-shape signaling', () => {
  it('throttled call returns throttled:true + fallback:true (so callers can observe)', async () => {
    const { throttledTelegramAlert } = await import('../../api/_shared/telegram-throttle.js');
    await throttledTelegramAlert({ key: 'shape-key', message: 'first', channel: 'error' });
    const r = await throttledTelegramAlert({ key: 'shape-key', message: 'second', channel: 'error' });
    expect(r.alerted).toBe(false);
    expect(r.throttled).toBe(true);
    expect(r.fallback).toBe(true);
  });
});

describe('PR #443 Z-H12 — in-memory map is bounded (no leak)', () => {
  it('exceeding 500 distinct keys evicts oldest (rough LRU semantics)', async () => {
    const { throttledTelegramAlert, __resetInMemoryThrottleForTests } = await import(
      '../../api/_shared/telegram-throttle.js'
    );
    __resetInMemoryThrottleForTests();
    // Send 600 distinct keys; first ones should get evicted but no crash.
    for (let i = 0; i < 600; i++) {
      const r = await throttledTelegramAlert({
        key: `bound-key-${i}`,
        message: `m-${i}`,
        channel: 'error',
      });
      expect(r.ok).toBe(true);
    }
    // The most recent key should still alert if called again (was just inserted).
    NOTIFY_MOCK.mockClear();
    const r2 = await throttledTelegramAlert({
      key: 'bound-key-599',
      message: 'just inserted',
      channel: 'error',
    });
    // Just-inserted key is still in-window → should be throttled.
    expect(r2.alerted).toBe(false);
    // An evicted key (0) gets a fresh slot — alerts.
    const r3 = await throttledTelegramAlert({
      key: 'bound-key-0',
      message: 'evicted earlier',
      channel: 'error',
    });
    expect(r3.alerted).toBe(true);
  });
});
