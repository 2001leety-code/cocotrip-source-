// Read-only display of existing records, never a price calculator or billing API.
// The recorder is best-effort: a complete query still does not prove a complete bill.
export const RECORDED_AI_USAGE_LIMIT = 500;
export const RECORDED_AI_USAGE_TIMEOUT_MS = 3000;
const USD_SCALE = 1_000_000_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function recordedUsageWindow(nowMs) {
  const shifted = new Date(nowMs + KST_OFFSET_MS);
  return {
    monthStartMs: Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - KST_OFFSET_MS,
    todayStartMs: Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - KST_OFFSET_MS,
    throughMs: nowMs,
  };
}

export function summarizeRecordedAiUsage(rows, { nowMs, readOk = true, limit = RECORDED_AI_USAGE_LIMIT } = {}) {
  const window = recordedUsageWindow(nowMs);
  const base = {
    source: 'api_usage', service: 'gemini', currency: 'USD', basis: 'stored-estimate',
    coverage: 'best-effort-records-only', actualBillConnected: false,
    generatedAt: new Date(nowMs).toISOString(),
    monthStart: new Date(window.monthStartMs).toISOString(),
    todayStart: new Date(window.todayStartMs).toISOString(),
    queryLimit: limit,
  };
  if (!readOk || !Array.isArray(rows)) {
    return { ...base, status: 'unknown', recordedCostUsd: null, todayRecordedCostUsd: null, recordCount: null, todayRecordCount: null, excludedCount: null, limitReached: false, latestRecordAt: null };
  }
  const limitReached = rows.length > limit;
  let totalUnits = 0;
  let todayUnits = 0;
  let recordCount = 0;
  let todayRecordCount = 0;
  let excludedCount = 0;
  let latestMs = null;
  for (const row of rows.slice(0, limit)) {
    const value = row && typeof row === 'object' ? row : {};
    const ms = value.ms;
    const cost = value.cost_usd;
    const units = typeof cost === 'number' ? Math.round(cost * USD_SCALE) : NaN;
    if (value.service !== 'gemini' || !Number.isSafeInteger(ms)
      || ms < window.monthStartMs || ms > nowMs
      || typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0
      || (cost > 0 && units === 0)
      || !Number.isSafeInteger(units) || !Number.isSafeInteger(totalUnits + units)) {
      excludedCount += 1;
      continue;
    }
    totalUnits += units;
    recordCount += 1;
    if (ms >= window.todayStartMs) { todayUnits += units; todayRecordCount += 1; }
    if (latestMs === null || ms > latestMs) latestMs = ms;
  }
  return {
    ...base,
    status: limitReached || excludedCount > 0 ? 'partial' : recordCount > 0 ? 'ok' : 'empty',
    // No trustworthy rows is not the same as a zero-cost day/month.
    recordedCostUsd: recordCount > 0 ? totalUnits / USD_SCALE : null,
    todayRecordedCostUsd: todayRecordCount > 0 ? todayUnits / USD_SCALE : null,
    recordCount, todayRecordCount, excludedCount, limitReached,
    latestRecordAt: latestMs === null ? null : new Date(latestMs).toISOString(),
  };
}

export async function loadRecordedAiUsage(db, nowMs) {
  let timer;
  try {
    const window = recordedUsageWindow(nowMs);
    const read = db.collection('api_usage')
      .where('ms', '>=', window.monthStartMs)
      .where('ms', '<=', nowMs)
      .orderBy('ms', 'desc')
      .limit(RECORDED_AI_USAGE_LIMIT + 1)
      .select('service', 'ms', 'cost_usd')
      .get();
    const snapshot = await Promise.race([
      read,
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), RECORDED_AI_USAGE_TIMEOUT_MS); }),
    ]);
    if (!snapshot) return summarizeRecordedAiUsage(null, { nowMs, readOk: false });
    return summarizeRecordedAiUsage(snapshot.docs.map(doc => doc.data()), { nowMs });
  } catch {
    // Never return provider/raw data or error strings to the client or logs.
    return summarizeRecordedAiUsage(null, { nowMs, readOk: false });
  } finally {
    clearTimeout(timer);
  }
}
