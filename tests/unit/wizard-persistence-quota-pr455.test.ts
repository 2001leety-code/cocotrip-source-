/**
 * PR #455 — Audit W-H15 regression slot.
 *
 * Pre-fix: src/hooks/useWizardPersistence.ts wrapped localStorage.setItem
 * in try { ... } catch { /silent fail/ } — quota/private mode swallowed.
 * When the user filled wizard fields and quota was exhausted, the autosave
 * silently stopped working. Next session → snapshot missing → user
 * starts over (the exact UX the hook was added to prevent).
 *
 * Post-fix: a small helper layer (isQuotaError + sweepStaleWizardSnapshots
 * + safeWizardSetItem) detects QuotaExceededError across browser flavors,
 * sweeps stale `cocotrip:wizard:*` snapshots, retries once. On second
 * failure structured console.warn surfaces to Sentry instead of silent
 * loss.
 *
 * This file exercises the helper layer directly via the `__testing` export.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { __testing } from '../../src/hooks/useWizardPersistence.ts';

const { isQuotaError, sweepStaleWizardSnapshots, safeWizardSetItem, STORAGE_PREFIX } = __testing;

const src = readFileSync(
  resolve(process.cwd(), 'src/hooks/useWizardPersistence.ts'),
  'utf8',
);

// Polyfill a small in-memory localStorage so we can simulate quota
// behavior deterministically. We replace the global, then restore on
// afterEach.
function makeInMemoryStorage(quotaBytes?: number): Storage {
  const map = new Map<string, string>();
  let size = 0;
  return {
    get length() { return map.size; },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      const prev = map.get(k);
      const delta = (v.length) - (prev?.length ?? 0);
      if (quotaBytes !== undefined && size + delta > quotaBytes) {
        const err: Error & { name: string } = new Error('Quota exceeded') as any;
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, v);
      size += delta;
    },
    removeItem: (k: string) => {
      const prev = map.get(k);
      if (prev !== undefined) {
        size -= prev.length;
        map.delete(k);
      }
    },
    clear: () => { map.clear(); size = 0; },
  } as Storage;
}

describe('PR #455 W-H15 — isQuotaError detects browser flavors', () => {
  it('matches modern QuotaExceededError name', () => {
    const e: any = new Error('x'); e.name = 'QuotaExceededError';
    expect(isQuotaError(e)).toBe(true);
  });

  it('matches Safari legacy code 22', () => {
    const e: any = { code: 22 };
    expect(isQuotaError(e)).toBe(true);
  });

  it('matches Firefox NS_ERROR_DOM_QUOTA_REACHED + code 1014', () => {
    const e: any = new Error('x'); e.name = 'NS_ERROR_DOM_QUOTA_REACHED';
    expect(isQuotaError(e)).toBe(true);
    const e2: any = { code: 1014 };
    expect(isQuotaError(e2)).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isQuotaError(new TypeError('boom'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
    expect(isQuotaError('quota')).toBe(false);
  });
});

describe('PR #455 W-H15 — sweepStaleWizardSnapshots removes other-type stale entries', () => {
  let originalLs: Storage | undefined;
  beforeEach(() => {
    originalLs = (globalThis as any).localStorage;
    (globalThis as any).localStorage = makeInMemoryStorage();
  });
  afterEach(() => {
    if (originalLs) (globalThis as any).localStorage = originalLs;
  });

  it('removes stale (>24h) cocotrip:wizard:* keys, keeps fresh ones', () => {
    const now = Date.now();
    const stale = now - 25 * 60 * 60 * 1000;
    const fresh = now - 60 * 1000;
    localStorage.setItem(STORAGE_PREFIX + 'charter', JSON.stringify({ ts: stale, values: { a: 1 }, step: 0 }));
    localStorage.setItem(STORAGE_PREFIX + 'tour', JSON.stringify({ ts: fresh, values: { b: 1 }, step: 0 }));
    localStorage.setItem(STORAGE_PREFIX + 'planner', JSON.stringify({ ts: stale, values: { c: 1 }, step: 0 }));
    localStorage.setItem('unrelated:key', 'noise');

    const removed = sweepStaleWizardSnapshots('charter');
    // charter is the keep type, but it's stale — must NOT be touched even though stale.
    expect(localStorage.getItem(STORAGE_PREFIX + 'charter')).not.toBeNull();
    // tour is fresh — keep.
    expect(localStorage.getItem(STORAGE_PREFIX + 'tour')).not.toBeNull();
    // planner is stale + not keepType → removed.
    expect(localStorage.getItem(STORAGE_PREFIX + 'planner')).toBeNull();
    expect(removed).toBe(1);
    // Unrelated keys must not be touched.
    expect(localStorage.getItem('unrelated:key')).toBe('noise');
  });

  it('removes corrupted entries', () => {
    localStorage.setItem(STORAGE_PREFIX + 'charter', 'not-json');
    const removed = sweepStaleWizardSnapshots('tour');
    expect(localStorage.getItem(STORAGE_PREFIX + 'charter')).toBeNull();
    expect(removed).toBe(1);
  });
});

describe('PR #455 W-H15 — safeWizardSetItem retry-on-quota', () => {
  let originalLs: Storage | undefined;
  beforeEach(() => {
    originalLs = (globalThis as any).localStorage;
  });
  afterEach(() => {
    if (originalLs) (globalThis as any).localStorage = originalLs;
    vi.restoreAllMocks();
  });

  it('first call succeeds → ok:true (happy path)', () => {
    (globalThis as any).localStorage = makeInMemoryStorage();
    const r = safeWizardSetItem('charter', '{"a":1}');
    expect(r.ok).toBe(true);
    expect(localStorage.getItem(STORAGE_PREFIX + 'charter')).toBe('{"a":1}');
  });

  it('on quota: sweeps stale OTHER snapshots and retries successfully', () => {
    // Cap large enough for one snapshot but not two simultaneously.
    const ls = makeInMemoryStorage(280);
    (globalThis as any).localStorage = ls;
    // Pre-fill with stale 'planner' that fills most of the cap.
    const stale = Date.now() - 25 * 60 * 60 * 1000;
    const stalePayload = JSON.stringify({ ts: stale, values: { large: 'x'.repeat(200) }, step: 0 });
    ls.setItem(STORAGE_PREFIX + 'planner', stalePayload);
    // Now there's ~50 bytes free. New charter snapshot is ~55 bytes →
    // first attempt should throw QuotaExceededError, sweep removes
    // planner, retry succeeds.
    const r = safeWizardSetItem('charter', JSON.stringify({ ts: Date.now(), values: { a: 1 }, step: 0 }));
    expect(r.ok).toBe(true);
    // 'planner' got swept.
    expect(ls.getItem(STORAGE_PREFIX + 'planner')).toBeNull();
    expect(ls.getItem(STORAGE_PREFIX + 'charter')).not.toBeNull();
  });

  it('on quota with nothing sweepable: returns ok:false + reason:quota + console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ls = makeInMemoryStorage(10); // very tight cap, can't fit even 100 bytes
    (globalThis as any).localStorage = ls;
    const r = safeWizardSetItem('charter', '{"a":' + 'x'.repeat(200) + '}');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('quota');
    expect(warn).toHaveBeenCalledWith(
      '[wizard-persistence] localStorage quota exceeded, snapshot dropped',
      expect.objectContaining({ type: 'charter', sweptStaleSnapshots: 0 }),
    );
  });

  it('non-quota error: returns ok:false + reason:unavailable (silent — private mode)', () => {
    const ls = makeInMemoryStorage();
    (ls as any).setItem = () => { throw new TypeError('SecurityError'); };
    (globalThis as any).localStorage = ls;
    const r = safeWizardSetItem('charter', '{"a":1}');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unavailable');
  });
});

describe('PR #455 W-H15 — source-level invariants', () => {
  it('isQuotaError recognises all three flavor markers in the source', () => {
    expect(src).toMatch(/QuotaExceededError/);
    expect(src).toMatch(/NS_ERROR_DOM_QUOTA_REACHED/);
    expect(src).toMatch(/code\s*===\s*22/);
    expect(src).toMatch(/code\s*===\s*1014/);
  });

  it('useWizardPersistence still has the debounced setTimeout wrapper', () => {
    expect(src).toMatch(/DEBOUNCE_MS\s*=\s*500/);
    expect(src).toMatch(/window\.setTimeout/);
    expect(src).toMatch(/window\.clearTimeout/);
  });

  it('safeWizardSetItem is invoked from the hook (not raw localStorage.setItem)', () => {
    // The original line `localStorage.setItem(STORAGE_PREFIX + type, JSON.stringify(snap))`
    // must be replaced.
    expect(src).toMatch(/safeWizardSetItem\(\s*type\s*,/);
    expect(src).not.toMatch(/localStorage\.setItem\(\s*STORAGE_PREFIX\s*\+/);
  });

  it('structured warn log includes a payload-size telemetry field', () => {
    expect(src).toMatch(/payloadSize:\s*payload\.length/);
    expect(src).toMatch(/sweptStaleSnapshots:\s*swept/);
  });
});
