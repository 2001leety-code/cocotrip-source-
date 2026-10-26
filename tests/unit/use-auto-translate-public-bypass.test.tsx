// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translationSourceFingerprint, useAutoTranslate, type AutoTranslateAccess } from '../../src/pages/PlanDetailPage/useAutoTranslate';
import type { PlanDocument } from '../../src/pages/PlanDetailPage/types';

const cache = vi.hoisted(() => ({ getDoc: vi.fn(), setDoc: vi.fn(), doc: vi.fn() }));
vi.mock('firebase/firestore', () => cache);
vi.mock('../../src/lib/firebase', () => ({ db: {} }));

function fixture(id: string, title = id): PlanDocument {
  return { id, isPublic: true, input: { language: 'en' }, itinerary: {
    tour_title: title,
    days: [{ day: 1, stops: [{ category: 'culture', name: 'Palace', lat: 37.58, lng: 126.98 }] }],
  } };
}
function access(id: string, kind: 'public' | 'owner' | 'token' = 'public'): AutoTranslateAccess {
  return { planId: id, publicView: kind === 'public', allowCache: kind === 'owner', accessKey: `${id}:${kind}` };
}
async function bound(source: PlanDocument) {
  const fingerprint = await translationSourceFingerprint(source.input?.language || 'en', source.itinerary);
  if (!fingerprint) throw new Error('Web Crypto SHA-256 is required for owner-cache fixtures');
  return fingerprint;
}
function response(translated: unknown) {
  return { ok: true, json: async () => ({ data: { translated, translatorVersion: 3 } }) } as Response;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Standard Web Crypto, independent of whether jsdom exposes crypto.subtle.
  vi.stubGlobal('crypto', webcrypto);
  cache.doc.mockReturnValue({});
  cache.getDoc.mockResolvedValue({ exists: () => false });
  cache.setDoc.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('translation access and request boundaries', () => {
  it('replaces the original after edits within one plan and ignores the old in-flight translation', async () => {
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    vi.stubGlobal('fetch', fetchMock);
    let plan = fixture('same', 'Before edit');
    const setPlan = (update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; };
    const { result, rerender } = renderHook(({ language }) => useAutoTranslate(plan, setPlan, language, access('same')),
      { initialProps: { language: 'ja' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    plan = fixture('same', 'After edit');
    rerender({ language: 'ja' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).plan.tour_title).toBe('After edit');
    await act(async () => { old.resolve(response({ tour_title: 'Stale', days: [] })); });
    expect(plan.itinerary?.tour_title).toBe('After edit');
    expect(result.current.isTranslating).toBe(true);
    await act(async () => { fresh.resolve(response({ tour_title: 'Edited Japanese', days: [] })); });
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    rerender({ language: 'en' });
    await waitFor(() => expect(plan.itinerary?.tour_title).toBe('After edit'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('forces public cache bypass even with contradictory allowCache=true and reprojects the response', async () => {
    let plan = fixture('public');
    const fetchMock = vi.fn().mockResolvedValue(response({
      tour_title: 'Translated', accommodation: { name: 'PRIVATE-HOTEL' },
      days: [{ day: 1, private_note: 'PRIVATE', stops: [
        { category: 'lodging', name: 'PRIVATE-HOTEL', address: 'PRIVATE-ADDRESS', lat: 1, lng: 2 },
        { category: 'culture', name: 'Palace', lat: 37.58, lng: 126.98, personalization_reasoning: 'PRIVATE',
          transit_from_prev: { method: 'walk', est_min: 5, steps_detail: [{ from: 'PRIVATE-HOTEL', path: [1, 2, 3, 4] }] } },
      ] }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const setPlan = vi.fn((update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; });
    const { result, rerender } = renderHook(({ language }) => useAutoTranslate(plan, setPlan, language, { ...access('public'), allowCache: true }),
      { initialProps: { language: 'ja' } });
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    expect(cache.getDoc).not.toHaveBeenCalled();
    expect(cache.setDoc).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(plan)).not.toContain('PRIVATE');
    expect(plan.itinerary?.days?.[0].stops?.[0].name).toBe('宿泊先');
    expect(plan.itinerary?.days?.[0].stops?.[1].lat).toBe(37.58);
    rerender({ language: 'en' });
    await waitFor(() => expect(plan.itinerary?.tour_title).toBe('public'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves full owner-cache data and full token translation while token viewers bypass cache', async () => {
    const full = { tour_title: 'Owner', accommodation: { name: 'PRIVATE-HOTEL' }, days: [] };
    const ownerFingerprint = await bound(fixture('owner'));
    cache.getDoc.mockResolvedValue({ exists: () => true, data: () => ({
      itinerary: full, translatorVersion: 3, sourceFingerprint: ownerFingerprint,
    }) });
    let plan = fixture('owner');
    const fetchMock = vi.fn().mockResolvedValue(response(full));
    vi.stubGlobal('fetch', fetchMock);
    const setPlan = (update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; };
    const { result, rerender } = renderHook(({ viewer }) => useAutoTranslate(plan, setPlan, 'ja', viewer),
      { initialProps: { viewer: access('owner', 'owner') } });
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    expect(plan.itinerary?.accommodation).toEqual({ name: 'PRIVATE-HOTEL' });
    expect(fetchMock).not.toHaveBeenCalled();
    plan = fixture('token');
    rerender({ viewer: access('token', 'token') });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    expect(plan.itinerary?.accommodation).toEqual({ name: 'PRIVATE-HOTEL' });
    expect(cache.getDoc).toHaveBeenCalledTimes(1);
    expect(cache.setDoc).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('discards an old request %s after a plan/access switch', async (completion) => {
    const old = deferred<Response>();
    const fresh = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    vi.stubGlobal('fetch', fetchMock);
    let plan = fixture('first');
    const setPlan = vi.fn((update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; });
    const { result, rerender } = renderHook(({ viewer }) => useAutoTranslate(plan, setPlan, 'ja', viewer),
      { initialProps: { viewer: access('first', 'token') } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    plan = fixture('second');
    rerender({ viewer: access('second', 'public') });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => {
      if (completion === 'resolve') old.resolve(response({ tour_title: 'OLD-PRIVATE', days: [] }));
      else old.reject(new Error('OLD-PRIVATE'));
    });
    expect(plan.itinerary?.tour_title).toBe('second');
    expect(result.current.isTranslating).toBe(true);
    expect(result.current.translationError).toBeNull();
    await act(async () => { fresh.resolve(response({ tour_title: 'New translation', days: [] })); });
    await waitFor(() => expect(plan.itinerary?.tour_title).toBe('New translation'));
    expect(JSON.stringify(plan)).not.toContain('OLD-PRIVATE');
    expect(cache.setDoc).not.toHaveBeenCalled();
  });

  it('misses an owner cache translated from an older source even when its cachedAt is later', async () => {
    // Another tab finished translating the pre-edit source after this edit was saved.
    const olderSource = await bound(fixture('owner-edit', 'Before edit'));
    const editedSource = await bound(fixture('owner-edit', 'After edit'));
    expect(olderSource).not.toBe(editedSource);
    cache.getDoc.mockResolvedValue({ exists: () => true, data: () => ({
      itinerary: { tour_title: 'Older source Japanese', days: [] }, cachedAt: '2999-01-01T00:00:00.000Z',
      translatorVersion: 3, sourceFingerprint: olderSource,
    }) });
    let plan: PlanDocument = { ...fixture('owner-edit', 'After edit'), lastEditedAt: Date.parse('2026-10-01T00:00:00.000Z') };
    const fetchMock = vi.fn().mockResolvedValue(response({ tour_title: 'Edited Japanese', days: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const setPlan = (update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; };
    const { result } = renderHook(() => useAutoTranslate(plan, setPlan, 'ja', access('owner-edit', 'owner')));
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).plan.tour_title).toBe('After edit');
    expect(plan.itinerary?.tour_title).toBe('Edited Japanese');
    expect(cache.setDoc).toHaveBeenCalledTimes(1);
    expect(cache.setDoc.mock.calls[0][1].sourceFingerprint).toBe(editedSource);
  });

  it('reuses an owner cache bound to the same source', async () => {
    const sameSource = await bound(fixture('owner-fresh'));
    expect(sameSource).toMatch(/^sha256:[0-9a-f]{64}$/);
    cache.getDoc.mockResolvedValue({ exists: () => true, data: () => ({
      itinerary: { tour_title: 'Bound Japanese', days: [] }, cachedAt: '2026-10-01T00:00:00.000Z',
      translatorVersion: 3, sourceFingerprint: sameSource,
    }) });
    let plan = fixture('owner-fresh');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const setPlan = (update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; };
    const { result } = renderHook(() => useAutoTranslate(plan, setPlan, 'ja', access('owner-fresh', 'owner')));
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    expect(plan.itinerary?.tour_title).toBe('Bound Japanese');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.setDoc).not.toHaveBeenCalled();
  });

  it('2026-10-26: an owner cache from translator v2 (fixed notes translated in) is re-translated even with the same source', async () => {
    const sameSource = await bound(fixture('owner-v2'));
    cache.getDoc.mockResolvedValue({ exists: () => true, data: () => ({
      itinerary: { tour_title: 'v2 Japanese', days: [] }, cachedAt: '2999-01-01T00:00:00.000Z',
      translatorVersion: 2, sourceFingerprint: sameSource,
    }) });
    let plan = fixture('owner-v2');
    const fetchMock = vi.fn().mockResolvedValue(response({ tour_title: 'v3 Japanese', days: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const setPlan = (update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; };
    const { result } = renderHook(() => useAutoTranslate(plan, setPlan, 'ja', access('owner-v2', 'owner')));
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan.itinerary?.tour_title).toBe('v3 Japanese');
    expect(cache.setDoc.mock.calls[0][1].translatorVersion).toBe(3);
  });

  it('misses a legacy unbound owner cache, rewrites it bound, then reuses the rewrite', async () => {
    cache.getDoc.mockResolvedValue({ exists: () => true, data: () => ({
      itinerary: { tour_title: 'Legacy Japanese', days: [] }, cachedAt: '2999-01-01T00:00:00.000Z', translatorVersion: 3,
    }) });
    let plan = fixture('owner-legacy', 'Original');
    const fetchMock = vi.fn().mockResolvedValue(response({ tour_title: 'Fresh Japanese', days: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const setPlan = (update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; };
    const first = renderHook(() => useAutoTranslate(plan, setPlan, 'ja', access('owner-legacy', 'owner')));
    await waitFor(() => expect(first.result.current.isTranslating).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(plan.itinerary?.tour_title).toBe('Fresh Japanese');
    expect(cache.setDoc).toHaveBeenCalledTimes(1);
    const written = cache.setDoc.mock.calls[0][1];
    expect(written).toEqual(expect.objectContaining({
      itinerary: { tour_title: 'Fresh Japanese', days: [] },
      sourceLang: 'en',
      sourceFingerprint: await bound(fixture('owner-legacy', 'Original')),
    }));
    first.unmount();

    // A later visit to the same source reads the rewritten entry instead of translating again.
    cache.getDoc.mockResolvedValue({ exists: () => true, data: () => written });
    plan = fixture('owner-legacy', 'Original');
    const second = renderHook(() => useAutoTranslate(plan, setPlan, 'ja', access('owner-legacy', 'owner')));
    await waitFor(() => expect(second.result.current.isTranslating).toBe(false));
    expect(plan.itinerary?.tour_title).toBe('Fresh Japanese');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.setDoc).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: 'unavailable', platformCrypto: {} },
    { state: 'rejecting', platformCrypto: { subtle: { digest: () => Promise.reject(new Error('digest blocked')) } } },
  ])('bypasses owner cache reads and writes when Web Crypto is $state, but still translates', async ({ platformCrypto }) => {
    vi.stubGlobal('crypto', platformCrypto);
    let plan = fixture('owner-nocrypto', 'Original');
    const fetchMock = vi.fn().mockResolvedValue(response({ tour_title: 'Uncached Japanese', days: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const setPlan = (update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; };
    const { result } = renderHook(() => useAutoTranslate(plan, setPlan, 'ja', access('owner-nocrypto', 'owner')));
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    expect(plan.itinerary?.tour_title).toBe('Uncached Japanese');
    expect(result.current.translationError).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cache.getDoc).not.toHaveBeenCalled();
    expect(cache.setDoc).not.toHaveBeenCalled();
  });

  it('does not cover an in-session owner edit with the older cached translation', async () => {
    const beforeEdit = await bound(fixture('owner-live', 'Before edit'));
    cache.getDoc.mockResolvedValue({ exists: () => true, data: () => ({
      itinerary: { tour_title: 'Cached Japanese', days: [] }, cachedAt: new Date(Date.now() - 60_000).toISOString(),
      translatorVersion: 3, sourceFingerprint: beforeEdit,
    }) });
    let plan = fixture('owner-live', 'Before edit');
    const fetchMock = vi.fn().mockResolvedValue(response({ tour_title: 'Edited Japanese', days: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const setPlan = (update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; };
    const { result, rerender } = renderHook(() => useAutoTranslate(plan, setPlan, 'ja', access('owner-live', 'owner')));
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    expect(plan.itinerary?.tour_title).toBe('Cached Japanese');
    expect(fetchMock).not.toHaveBeenCalled();
    // The edited itinerary no longer matches the cache's source binding.
    plan ={ ...fixture('owner-live', 'After edit'), lastEditedAt: Date.now() };
    rerender();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).plan.tour_title).toBe('After edit');
    await waitFor(() => expect(plan.itinerary?.tour_title).toBe('Edited Japanese'));
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
  });

  it('does not restore an owner original after the same plan becomes public', async () => {
    let plan = fixture('same');
    plan.itinerary!.accommodation = { name: 'OWNER-PRIVATE' };
    const fetchMock = vi.fn().mockResolvedValue(response({ tour_title: 'Translation', days: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const setPlan = (update: (previous: PlanDocument | null) => PlanDocument | null) => { plan = update(plan)!; };
    const { result, rerender } = renderHook(({ viewer, language }) => useAutoTranslate(plan, setPlan, language, viewer),
      { initialProps: { viewer: access('same', 'owner'), language: 'ja' } });
    await waitFor(() => expect(result.current.isTranslating).toBe(false));
    plan = fixture('same', 'Public original');
    rerender({ viewer: access('same', 'public'), language: 'en' });
    await waitFor(() => expect(plan.itinerary?.tour_title).toBe('Public original'));
    expect(JSON.stringify(plan)).not.toContain('OWNER-PRIVATE');
  });
});
