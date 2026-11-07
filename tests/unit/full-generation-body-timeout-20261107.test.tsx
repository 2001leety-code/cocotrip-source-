// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PlannerFormValues } from '../../src/components/PlannerForm';

const mocks = vi.hoisted(() => ({
  token: vi.fn(), navigate: vi.fn(), analytics: vi.fn(),
}));
vi.mock('../../src/lib/firebase-auth.js', () => ({ auth: { currentUser: { getIdToken: mocks.token } } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../../src/lib/guestReader', () => ({ isGuestAnonEnabled: () => false, shouldAttachGuestAnonToken: () => false }));
vi.mock('../../src/lib/analytics', () => ({ markPlannerPendingComplete: mocks.analytics }));
vi.mock('../../src/lib/posthog', () => ({ track: vi.fn() }));

import { usePlannerHandlers } from '../../src/pages/PlannerPage/hooks/usePlannerHandlers';

const values = { regions: ['Busan'], cityKeys: ['busan'], durationDays: 3, pax: 2, reservation_status: 'nothing' } as PlannerFormValues;
const paid = 'OFFLINE-PAID-ORDER';
const admin = 'ADMIN-BYPASS-offline';
const resultBody = (data: Record<string, unknown> = { planId: 'offline-plan', firestoreSaved: false }) => ({ ok: true, data });
function response(status = 200, json: () => Promise<unknown> = async () => resultBody()) {
  return { ok: status >= 200 && status < 300, status, json,
    text: vi.fn(async () => { throw new TypeError('Body already consumed'); }),
  } as unknown as Response;
}
function abortable(signal?: AbortSignal | null, error?: () => unknown) {
  return new Promise<never>((_resolve, reject) => {
    const abort = () => reject(error ? error() : signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}
async function setup() {
  const hook = renderHook(() => usePlannerHandlers({ language: 'en', userEmail: '', setUserEmail: vi.fn() }));
  await act(async () => { await hook.result.current.handleRevisionSubmit(values); });
  return hook;
}
type Hook = Awaited<ReturnType<typeof setup>>;
async function start(hook: Hook, orderId = paid) {
  let pending!: Promise<void>;
  await act(async () => { pending = hook.result.current.handlePaymentSuccess(orderId); });
  return { pending };
}
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.token.mockResolvedValue('synthetic-token');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('main full generation deadline includes response body', () => {
  it.each([paid, admin].flatMap(order => [200, 503].map(status => ({ order, status }))))(
    '$order HTTP $status body aborts at the existing deadline without retry', async ({ order, status }) => {
      let signal: AbortSignal | null | undefined;
      const body = response(status, () => abortable(signal));
      const fetchMock = vi.fn(async (_url, init) => { signal = init?.signal; return body; });
      vi.stubGlobal('fetch', fetchMock);
      const hook = await setup();
      const { pending } = await start(hook, order);
      await advance(299_999);
      expect(signal?.aborted).toBe(false);
      expect(hook.result.current.isGeneratingPlan).toBe(true);
      await advance(1);
      expect(signal?.aborted).toBe(true);
      expect(hook.result.current.planErrorCode).toBe('ABORT_TIMEOUT');
      expect(hook.result.current.isGeneratingPlan).toBe(false);
      expect(hook.result.current.lastValues.current).toBe(values);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(body.text).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      await pending;
    },
  );

  it('accepts a body just before the deadline and clears its timer', async () => {
    let signal: AbortSignal | null | undefined;
    let finishBody!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signal = init?.signal;
      return response(200, () => new Promise(resolve => { finishBody = resolve; }));
    }));
    const hook = await setup();
    const { pending } = await start(hook);
    await advance(299_999);
    await act(async () => { finishBody(resultBody()); await pending; });
    expect(mocks.navigate).toHaveBeenCalledWith('/my-plans/offline-plan');
    expect(hook.result.current.planErrorCode).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await advance(1);
    expect(signal?.aborted).toBe(false);
  });

  it('maps native AbortError numeric code 20 to timeout when headers never arrive', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => abortable(init?.signal)));
    const hook = await setup();
    const { pending } = await start(hook);
    await advance(300_000);
    expect(hook.result.current.planErrorCode).toBe('ABORT_TIMEOUT');
    expect(hook.result.current.isGeneratingPlan).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await pending;
  });

  it.each([false, true])('keeps timeout identity for a body rejection (non-native=%s)', async (nonNative) => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => response(200, () => abortable(init?.signal,
      nonNative ? () => new TypeError('Stream interrupted') : undefined))));
    const hook = await setup();
    const { pending } = await start(hook);
    await advance(300_000);
    expect(hook.result.current.planErrorCode).toBe('ABORT_TIMEOUT');
    expect(vi.getTimerCount()).toBe(0);
    await pending;
  });

  it('does not overwrite a real string code when abort and body failure race', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => response(200, () => abortable(init?.signal,
      () => Object.assign(new Error('Existing order'), { name: 'AbortError', code: 'DUPLICATE_ORDER' })))));
    const hook = await setup();
    const { pending } = await start(hook);
    await advance(300_000);
    expect(hook.result.current.planErrorCode).toBe('DUPLICATE_ORDER');
    await pending;
  });

  it.each(['network', 'malformed', 'auth'] as const)('%s failure settles with no timer or automatic retry', async (kind) => {
    const fetchMock = vi.fn(async () => {
      if (kind === 'network') throw new TypeError('Offline');
      return response(200, async () => { throw new SyntaxError('Invalid JSON'); });
    });
    if (kind === 'auth') mocks.token.mockRejectedValue(new Error('Synthetic auth failure'));
    vi.stubGlobal('fetch', fetchMock);
    const hook = await setup();
    await act(async () => { await hook.result.current.handlePaymentSuccess(kind === 'auth' ? admin : paid); });
    expect(hook.result.current.planErrorCode).toBe(kind === 'network' ? 'NETWORK_ERROR' : kind === 'auth' ? 'AUTH_REQUIRED' : 'INVALID_RESPONSE');
    expect(hook.result.current.isGeneratingPlan).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(kind === 'auth' ? 0 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves existing server error details without introducing order recovery', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(409, async () => ({ code: 'PLAN_GENERATION_IN_PROGRESS', details: 'Existing generation pending' }))));
    const hook = await setup();
    await act(async () => { await hook.result.current.handlePaymentSuccess(paid); });
    expect(hook.result.current.planErrorCode).toBe('PLAN_GENERATION_IN_PROGRESS');
    expect(hook.result.current.planError).toBe('Existing generation pending');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves string server-code priority even when a rejected fetch is named AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('Existing order'), { name: 'AbortError', code: 'DUPLICATE_ORDER' }); }));
    const hook = await setup();
    await act(async () => { await hook.result.current.handlePaymentSuccess(paid); });
    expect(hook.result.current.planErrorCode).toBe('DUPLICATE_ORDER');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the missing-form guard ahead of timers and requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const hook = renderHook(() => usePlannerHandlers({ language: 'en', userEmail: '', setUserEmail: vi.fn() }));
    await act(async () => { await hook.result.current.handlePaymentSuccess(paid); });
    expect(hook.result.current.planErrorCode).toBe('MISSING_FORM');
    expect(hook.result.current.isGeneratingPlan).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])('keeps existing saved-plan navigation and analytics (saved=%s)', async (firestoreSaved) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, async () => resultBody({ planId: 'offline-plan', firestoreSaved }))));
    const hook = await setup();
    await act(async () => { await hook.result.current.handlePaymentSuccess(paid); });
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/my-plans/offline-plan');
    expect(mocks.analytics).toHaveBeenCalledExactlyOnceWith('offline-plan', { durationDays: 3, freeCoupon: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps existing missing-plan-address error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, async () => resultBody({ firestoreSaved: true }))));
    const hook = await setup();
    await act(async () => { await hook.result.current.handlePaymentSuccess(paid); });
    expect(hook.result.current.planErrorCode).toBe('NO_PLAN_URL');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows a paid guest without changing the existing auth gate', async () => {
    mocks.token.mockRejectedValue(new Error('Synthetic token failure'));
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetchMock);
    const hook = await setup();
    await act(async () => { await hook.result.current.handlePaymentSuccess(paid); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.planErrorCode).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses a fresh controller on manual retry without creating an automatic retry', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(async (_url, init) => {
      signals.push(init.signal);
      return signals.length === 1 ? response(200, () => abortable(init.signal)) : response();
    });
    vi.stubGlobal('fetch', fetchMock);
    const hook = await setup();
    const { pending } = await start(hook);
    await advance(300_000);
    expect(hook.result.current.planErrorCode).toBe('ABORT_TIMEOUT');
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { await hook.result.current.handlePaymentSuccess(paid); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[1].aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps timers independent without adding a new concurrency guard', async () => {
    const signals: AbortSignal[] = [];
    let finishSecond!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      signals.push(init.signal);
      return signals.length === 1 ? response(200, () => abortable(init.signal))
        : response(200, () => new Promise(resolve => { finishSecond = resolve; }));
    }));
    const hook = await setup();
    const first = await start(hook);
    await advance(150_000);
    const second = await start(hook);
    await advance(150_000);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await first.pending;
    await act(async () => { finishSecond(resultBody()); await second.pending; });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('documents that an auth promise ignoring abort is not preempted by a body-timeout fix', async () => {
    let finishAuth!: (value: string) => void;
    mocks.token.mockImplementation(() => new Promise(resolve => { finishAuth = resolve; }));
    const fetchMock = vi.fn((_url, init) => abortable(init?.signal));
    vi.stubGlobal('fetch', fetchMock);
    const hook = await setup();
    const { pending } = await start(hook, admin);
    await advance(300_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hook.result.current.isGeneratingPlan).toBe(true);
    await act(async () => { finishAuth('synthetic-token'); await pending; });
    expect(hook.result.current.planErrorCode).toBe('ABORT_TIMEOUT');
    expect(vi.getTimerCount()).toBe(0);
  });
});

// The production branch intentionally keeps its existing request and auth contracts.
describe('main integration boundaries', () => {
  it('keeps the payment identifiers and legacy request payload without new order recovery state', async () => {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal('fetch', fetchMock);
    const hook = await setup();
    await act(async () => { await hook.result.current.handlePaymentSuccess(paid, 'OFFLINE-COUPON'); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(url).toBe('/api/ai-planner-full');
    expect(body.paypalOrderId).toBe(paid);
    expect(body.aiCouponCode).toBe('OFFLINE-COUPON');
    expect(body.durationDays).toBe(3);
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-token' });
    expect(hook.result.current).not.toHaveProperty('paidOrderIssue');
    expect(hook.result.current).not.toHaveProperty('handleGenerateWithPaidInput');
  });
});
