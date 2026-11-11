import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triggerAiPlanner } from '../../api/_shared/ai-planner-trigger.js';

const origin = 'https://cocotrip-isolated-test.vercel.app';
const request = (siteUrl = origin) => triggerAiPlanner({ db: null, siteUrl, bookingRef: 'sandbox-test-order', payload: { test: true } });
const completed = () => new Response(JSON.stringify({ outcome: 'completed' }), { status: 200 });
beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('VERCEL_URL', 'cocotrip-isolated-test.vercel.app');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('AI planner preview network isolation', () => {
  it.each(['https://cocotripkr.com', 'https://other-preview.vercel.app', origin + '/other', origin + '@cocotripkr.com', 'http://cocotrip-isolated-test.vercel.app'])('blocks a foreign or malformed siteUrl %s before network', async siteUrl => {
    const fetch = vi.fn<typeof globalThis.fetch>(); vi.stubGlobal('fetch', fetch);
    const result = await request(siteUrl);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('PREVIEW_INTERNAL_ORIGIN_MISMATCH');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks unresolved VERCEL_URL before network', async () => {
    vi.stubEnv('VERCEL_URL', ''); const fetch = vi.fn<typeof globalThis.fetch>(); vi.stubGlobal('fetch', fetch);
    expect((await request()).reason).toContain('PREVIEW_INTERNAL_ORIGIN_UNAVAILABLE');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses redirect:error for exact preview origin', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => completed()); vi.stubGlobal('fetch', fetch);
    await request();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual([origin + '/api/ai-planner-full', expect.objectContaining({ redirect: 'error', method: 'POST' })]);
  });
  it('does not retry a redirect failure in the same invocation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => {
      expect(options?.redirect).toBe('error');
      throw new TypeError('redirect encountered');
    }); vi.stubGlobal('fetch', fetch);
    expect((await request()).ok).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(['production', 'development'])('preserves prior redirect behavior outside preview: %s', async env => {
    vi.stubEnv('VERCEL_ENV', env);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => completed()); vi.stubGlobal('fetch', fetch);
    await request('https://cocotripkr.com');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]).not.toHaveProperty('redirect');
  });
});
