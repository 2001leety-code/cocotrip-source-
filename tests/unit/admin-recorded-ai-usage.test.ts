import { describe, expect, it, vi } from 'vitest';
import { loadRecordedAiUsage, recordedUsageWindow, summarizeRecordedAiUsage, RECORDED_AI_USAGE_TIMEOUT_MS } from '../../api/_shared/adminRecordedAiUsage.js';

const NOW = Date.parse('2026-09-08T11:00:00+09:00');
const row = (cost = 0.1, ms = NOW - 1000) => ({ service: 'gemini', cost_usd: cost, ms });

describe('stored AI usage is not an invoice', () => {
  it('sums existing stored estimates precisely and never recalculates provider prices', () => {
    const result = summarizeRecordedAiUsage([row(0.1), row(0.2), row(0)], { nowMs: NOW });
    expect(result).toMatchObject({ status: 'ok', recordedCostUsd: 0.3, todayRecordedCostUsd: 0.3, recordCount: 3, todayRecordCount: 3, currency: 'USD', basis: 'stored-estimate', coverage: 'best-effort-records-only', actualBillConnected: false });
  });
  it('uses Korea date boundaries including year rollover', () => {
    const nowMs = Date.parse('2027-01-01T00:00:00+09:00');
    expect(recordedUsageWindow(nowMs)).toEqual({ monthStartMs: nowMs, todayStartMs: nowMs, throughMs: nowMs });
    expect(summarizeRecordedAiUsage([row(1, nowMs), row(9, nowMs - 1)], { nowMs })).toMatchObject({ status: 'partial', recordedCostUsd: 1, excludedCount: 1 });
  });
  it('separates today from earlier current-month records', () => {
    expect(summarizeRecordedAiUsage([row(0.5), row(1, Date.parse('2026-09-07T23:59:59+09:00'))], { nowMs: NOW })).toMatchObject({ recordedCostUsd: 1.5, todayRecordedCostUsd: 0.5, recordCount: 2, todayRecordCount: 1 });
  });
  it('does not represent missing rows or failed reads as free usage', () => {
    expect(summarizeRecordedAiUsage([], { nowMs: NOW })).toMatchObject({ status: 'empty', recordedCostUsd: null, todayRecordedCostUsd: null, recordCount: 0, latestRecordAt: null });
    expect(summarizeRecordedAiUsage(null, { nowMs: NOW, readOk: false })).toMatchObject({ status: 'unknown', recordedCostUsd: null, recordCount: null });
    expect(summarizeRecordedAiUsage([row(0)], { nowMs: NOW })).toMatchObject({ status: 'ok', recordedCostUsd: 0, recordCount: 1 });
  });
  it.each([null, undefined, '', '0.1', -1, NaN, Infinity, 1e20, 1e-10])('rejects an invalid or unrepresentable stored cost (%s)', cost => {
    const result = summarizeRecordedAiUsage([{ ...row(), cost_usd: cost }], { nowMs: NOW });
    expect(result).toMatchObject({ status: 'partial', excludedCount: 1, recordedCostUsd: null });
  });
  it('rejects other providers, missing timestamps and future or old records', () => {
    const result = summarizeRecordedAiUsage([{ ...row(), service: 'openai' }, { ...row(), ms: null }, row(1, NOW + 1), row(1, Date.parse('2026-08-31T23:59:59+09:00'))], { nowMs: NOW });
    expect(result).toMatchObject({ status: 'partial', excludedCount: 4, recordedCostUsd: null });
  });
  it('uses the extra record only to detect an incomplete window', () => {
    expect(summarizeRecordedAiUsage([row(1), row(2), row(90)], { nowMs: NOW, limit: 2 })).toMatchObject({ status: 'partial', recordedCostUsd: 3, recordCount: 2, limitReached: true });
    expect(summarizeRecordedAiUsage([row(1), row(2)], { nowMs: NOW, limit: 2 })).toMatchObject({ status: 'ok', limitReached: false });
  });
  it('exposes only aggregate fields, not arbitrary customer or provider fields', () => {
    const result = summarizeRecordedAiUsage([{ ...row(), email: 'synthetic@example.test', prompt: 'PRIVATE SENTINEL', apiKey: 'NOT_A_REAL_KEY' }], { nowMs: NOW });
    expect(JSON.stringify(result)).not.toMatch(/synthetic|SENTINEL|NOT_A_REAL_KEY/);
  });
  it('queries a bounded month with a field projection and no writes', async () => {
    const query = { where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), select: vi.fn(), get: vi.fn(async () => ({ docs: [{ data: () => row() }] })) };
    for (const method of ['where', 'orderBy', 'limit', 'select'] as const) query[method].mockReturnValue(query);
    const db = { collection: vi.fn(() => query) };
    expect(await loadRecordedAiUsage(db, NOW)).toMatchObject({ status: 'ok', recordCount: 1 });
    expect(db.collection).toHaveBeenCalledExactlyOnceWith('api_usage');
    expect(query.where.mock.calls).toEqual([['ms', '>=', Date.parse('2026-09-01T00:00:00+09:00')], ['ms', '<=', NOW]]);
    expect(query.orderBy).toHaveBeenCalledExactlyOnceWith('ms', 'desc');
    expect(query.limit).toHaveBeenCalledExactlyOnceWith(501);
    expect(query.select).toHaveBeenCalledExactlyOnceWith('service', 'ms', 'cost_usd');
  });
  it('keeps source errors isolated and does not expose raw secrets', async () => {
    const db = { collection: () => { throw new Error('PRIVATE PROVIDER ERROR'); } };
    const result = await loadRecordedAiUsage(db, NOW);
    expect(result).toMatchObject({ status: 'unknown', recordedCostUsd: null });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('bounds a stalled source and ignores its late failure without retrying', async () => {
    vi.useFakeTimers();
    try {
      let rejectRead: (error: Error) => void = () => {};
      const get = vi.fn(() => new Promise((_resolve, reject) => { rejectRead = reject; }));
      const query = { where: () => query, orderBy: () => query, limit: () => query, select: () => query, get };
      const result = loadRecordedAiUsage({ collection: () => query }, NOW);
      await vi.advanceTimersByTimeAsync(RECORDED_AI_USAGE_TIMEOUT_MS);
      expect(await result).toMatchObject({ status: 'unknown', recordedCostUsd: null });
      rejectRead(new Error('LATE PRIVATE ERROR'));
      await Promise.resolve();
      expect(get).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
