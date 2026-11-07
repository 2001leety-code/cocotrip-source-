// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PlannerFormValues } from '../../src/components/PlannerForm';

vi.mock('../../src/lib/firebase-auth.js', () => ({ auth: { currentUser: null } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../src/lib/guestReader', () => ({ isGuestAnonEnabled: () => false, shouldAttachGuestAnonToken: () => false }));
vi.mock('../../src/lib/analytics', () => ({ markPlannerPendingComplete: vi.fn() }));
vi.mock('../../src/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('../../src/pages/PlannerPage/lib/quickPreviewContract', () => ({ parseQuickPreviewResponse: () => true }));

import { usePlannerHandlers } from '../../src/pages/PlannerPage/hooks/usePlannerHandlers';
import { resolveErrorMessage } from '../../src/pages/PlannerPage/hooks/errorMessages';

const values = { regions: ['Busan'], categories: ['Food'], durationDays: 3, pax: 2, reservation_status: 'nothing' } as PlannerFormValues;
const success = () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { synthetic: true } }) }) as Response;
const abortable = (signal?: AbortSignal | null) => new Promise<never>((_resolve, reject) => {
  const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
  if (signal?.aborted) rejectAbort();
  else signal?.addEventListener('abort', rejectAbort, { once: true });
});
const hook = () => renderHook(() => usePlannerHandlers({ language: 'en', userEmail: '', setUserEmail: vi.fn() }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('free preview request deadline', () => {
  it.each(['ko', 'en', 'ja', 'zh'])('has its own localized timeout message in %s without paid-order claims', (lang) => {
    const errors = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}.json`), 'utf8')).planner.errors;
    const message = resolveErrorMessage('PREVIEW_TIMEOUT', 'Fallback', errors);
    expect(message.length).toBeGreaterThan(15);
    expect(message).toBe(errors.PREVIEW_TIMEOUT);
    expect(message).not.toBe(errors.ABORT_TIMEOUT);
    expect(message).not.toMatch(/payment|WhatsApp|결제|支払い|支付/i);
  });

  it('ends a stalled fetch, keeps inputs and permits a manual retry', async () => {
    const fetchMock = vi.fn<typeof fetch>((_url, init) => abortable(init?.signal));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = hook();
    let pending: Promise<void | undefined>;
    act(() => { pending = result.current.handleSubmit(values); });
    await act(async () => { await vi.advanceTimersByTimeAsync(74_999); });
    expect(result.current.status).toBe('loadingQuick');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('PREVIEW_TIMEOUT');
    expect(result.current.lastValues.current).toBe(values);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await pending!;
    fetchMock.mockImplementationOnce(async () => success());
    await act(async () => { await result.current.handleSubmit(values); });
    expect(result.current.status).toBe('quickSuccess');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('classifies a stalled response body as timeout (HTTP ok=%s)', async (ok) => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => ({ ok, status: ok ? 200 : 503, json: () => abortable(init?.signal) })));
    const { result } = hook();
    act(() => { void result.current.handleSubmit(values); });
    await act(async () => { await vi.advanceTimersByTimeAsync(75_000); });
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('PREVIEW_TIMEOUT');
  });

  it('uses one deadline across the permitted network retry', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Network unavailable'))
      .mockImplementationOnce((_url, init) => abortable(init?.signal));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = hook();
    act(() => { void result.current.handleSubmit(values); });
    await act(async () => { await vi.advanceTimersByTimeAsync(75_000); });
    expect(result.current.errorCode).toBe('PREVIEW_TIMEOUT');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('clears its deadline after a prompt response (HTTP ok=%s)', async (ok) => {
    vi.stubGlobal('fetch', vi.fn(async () => ok ? success() : ({ ok: false, status: 422, json: async () => ({ code: 'INVALID_DURATION', details: 'Invalid duration' }) })));
    const { result } = hook();
    await act(async () => { await result.current.handleSubmit(values); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.status).toBe(ok ? 'quickSuccess' : 'error');
    expect(result.current.errorCode).toBe(ok ? null : 'INVALID_DURATION');
  });
});
