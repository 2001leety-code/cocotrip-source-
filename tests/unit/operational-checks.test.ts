import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOperationalChecksCache, getOperationalChecks, OPERATIONAL_WORKFLOWS } from '../../api/_shared/operational-checks.js';

const run = (id: number, workflow = 'daily-health.yml', conclusion: string | null = 'success') => ({
  id, status: 'completed', conclusion,
  event: 'schedule', head_branch: 'main',
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:01:00Z',
  html_url: `https://github.com/2001leety-code/cocotrip-source-/actions/runs/${id}`,
  path: `.github/workflows/${workflow}`,
});
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

beforeEach(() => clearOperationalChecksCache());

describe('operational checks', () => {
  it('reads exactly six workflows and separates latest from last success', async () => {
    const now = Date.now();
    const fetchImpl = vi.fn(async () => response({ workflow_runs: [run(1, 'daily-health.yml', 'failure'), run(2)] }));
    const data = await getOperationalChecks({ fetchImpl, now });
    expect(OPERATIONAL_WORKFLOWS).toHaveLength(6);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(data.readOnly).toBe(true);
    expect(data.checks.every((check) => check.freshness === 'fresh')).toBe(true);
    expect(data.checks[0].lastSuccessfulRun?.id).toBe(2);
  });

  it('uses fresh cache without another fetch', async () => {
    const fetchImpl = vi.fn(async () => response({ workflow_runs: [run(3)] }));
    const now = Date.now();
    await getOperationalChecks({ fetchImpl, now });
    const second = await getOperationalChecks({ fetchImpl, now: now + 1000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.checks[0].freshness).toBe('fresh');
  });

  it('ignores non-scheduled, non-main, and non-allowlisted runs', async () => {
    const ignored = { ...run(99), event: 'workflow_dispatch', path: '.github/workflows/other.yml' };
    const fetchImpl = vi.fn(async () => response({ workflow_runs: [ignored, run(7, 'weekly-i18n-audit.yml')] }));
    const data = await getOperationalChecks({ fetchImpl, now: Date.now() });
    expect(data.checks.find((check) => check.workflow === 'weekly-i18n-audit.yml')?.latestRun?.id).toBe(7);
    expect(data.checks.find((check) => check.workflow === 'daily-health.yml')?.latestRun).toBeNull();
  });

  it('keeps stale evidence after upstream failure and marks first failure unknown', async () => {
    let fail = false;
    const fetchImpl = vi.fn(async () => {
      if (fail) throw new Error('network');
      return response({ workflow_runs: [run(4)] });
    });
    const now = Date.now() - 301000;
    await getOperationalChecks({ fetchImpl, now });
    fail = true;
    const stale = await getOperationalChecks({ fetchImpl, now: Date.now() });
    expect(stale.checks[0].freshness).toBe('stale');
    expect(stale.checks[0].latestRun?.id).toBe(4);
    clearOperationalChecksCache();
    const unknown = await getOperationalChecks({ fetchImpl, now: Date.now() });
    expect(unknown.checks[0].freshness).toBe('unknown');
    expect(unknown.checks[0].latestRun).toBeNull();
  });

  it.each([
    ['rate limit', response({}, 429)],
    ['bad shape', response({ workflow_runs: {} })],
    ['bad url', response({ workflow_runs: [{ ...run(5), html_url: 'https://example.com/run/5' }] })],
    ['bad time', response({ workflow_runs: [{ ...run(6), created_at: 'not-a-date' }] })],
  ])('rejects %s safely', async (_label, result) => {
    const data = await getOperationalChecks({ fetchImpl: vi.fn(async () => result), now: Date.now() });
    expect(data.checks.every((check) => check.freshness === 'unknown')).toBe(true);
    expect(data.checks.every((check) => check.reason)).toBe(true);
  });

  it('rejects a GitHub response that exceeds the documented latest-100 scope', async () => {
    const data = await getOperationalChecks({ fetchImpl: vi.fn(async () => response({ workflow_runs: Array.from({ length: 101 }, () => run(10)) })), now: Date.now() });
    expect(data.checks.every((check) => check.freshness === 'unknown' && check.reason === 'GITHUB_RESPONSE_INVALID')).toBe(true);
  });

  it('treats GitHub 403 with exhausted remaining quota as a rate limit and keeps the cooldown contract', async () => {
    const fetchImpl = vi.fn(async () => response({}, 403, { 'x-ratelimit-remaining': '0' }));
    const now = Date.now();
    const limited = await getOperationalChecks({ fetchImpl, now });
    expect(limited.checks.every((check) => check.reason === 'GITHUB_RATE_LIMIT')).toBe(true);
    const cooldown = await getOperationalChecks({ fetchImpl, now: now + 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cooldown).toMatchObject({ historyScope: 'latest-100-scheduled-main-runs' });
    expect(cooldown.checks.every((check) => check.reason === 'GITHUB_RATE_LIMIT')).toBe(true);
  });

  it('uses one deadline for fetch and a stalled real Response stream, then cancels without waiting forever', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const stream = new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => { cancelled = true; } });
    const fetchImpl = vi.fn(async () => new Response(stream));
    const pending = getOperationalChecks({ fetchImpl, now: Date.now(), timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(21);
    const data = await pending;
    expect(data.checks.every((check) => check.reason === 'GITHUB_TIMEOUT')).toBe(true);
    expect(cancelled).toBe(true);
    vi.useRealTimers();
  });

  it('drops cache evidence whose timestamp is ahead of the request clock', async () => {
    const fetchImpl = vi.fn(async () => response({ workflow_runs: [run(11)] }));
    const now = Date.now();
    await getOperationalChecks({ fetchImpl, now });
    await getOperationalChecks({ fetchImpl, now: now - 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('marks aborted fetch as unknown without credentials', async () => {
    const fetchImpl = vi.fn(async (_url: string, options: { signal: AbortSignal }) => {
      options.signal.addEventListener('abort', () => undefined);
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    const data = await getOperationalChecks({ fetchImpl, timeoutMs: 1 });
    expect(data.checks[0].reason).toBe('GITHUB_TIMEOUT');
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('headers.Authorization');
  });
});
