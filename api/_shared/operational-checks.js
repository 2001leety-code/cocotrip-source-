const OWNER = '2001leety-code';
const REPOSITORY = 'cocotrip-source-';
const API_URL = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/actions/runs?event=schedule&branch=main&per_page=100`;
const CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10000;
const WORKFLOW_LIMITS = Object.freeze({
  'daily-health.yml': 4 * 24 * 60 * 60 * 1000,
  'scenario-matrix.yml': 9 * 24 * 60 * 60 * 1000,
  'weekly-design-ops-audit.yml': 9 * 24 * 60 * 60 * 1000,
  'weekly-i18n-audit.yml': 9 * 24 * 60 * 60 * 1000,
  'security-audit.yml': 9 * 24 * 60 * 60 * 1000,
  'vercel-cost-audit.yml': 9 * 24 * 60 * 60 * 1000,
});
export const OPERATIONAL_WORKFLOWS = Object.freeze(Object.keys(WORKFLOW_LIMITS));
let cache = null;
let inFlight = null;
let rateLimitedUntilMs = 0;

function validMs(ms) { return Number.isSafeInteger(ms) && ms > 0; }
function err(reason, code) { return Object.assign(new Error(reason), code ? { code } : {}); }
function runHealth(run, now, maxAgeMs) {
  if (!run) return 'unknown';
  if (run.status !== 'completed') return now - run.updatedAtMs > maxAgeMs ? 'overdue' : 'running';
  if (run.conclusion !== 'success') return 'failed';
  return now - run.updatedAtMs > maxAgeMs ? 'overdue' : 'ok';
}
function parseRun(raw, now) {
  if (!raw || !Number.isSafeInteger(raw.id) || raw.id <= 0 || typeof raw.status !== 'string') throw err('실행 자료 형식 오류');
  if (!['queued', 'in_progress', 'completed'].includes(raw.status)) throw err('실행 상태 형식 오류');
  const conclusions = [null, 'success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral'];
  if (!conclusions.includes(raw.conclusion)) throw err('실행 결과 형식 오류');
  if ((raw.status === 'completed') !== (raw.conclusion !== null)) throw err('실행 상태 결과 불일치');
  const createdAtMs = Date.parse(raw.created_at);
  const updatedAtMs = Date.parse(raw.updated_at);
  if (!validMs(createdAtMs) || !validMs(updatedAtMs) || updatedAtMs < createdAtMs) throw err('실행 시각 형식 오류');
  if (createdAtMs > now + 60000 || updatedAtMs > now + 60000) throw err('미래 실행 시각');
  const workflow = raw.path?.split('/').pop();
  if (!workflow || !OPERATIONAL_WORKFLOWS.includes(workflow) || raw.path !== `.github/workflows/${workflow}`) throw err('실행 경로 형식 오류');
  const expectedUrl = `https://github.com/${OWNER}/${REPOSITORY}/actions/runs/${raw.id}`;
  if (raw.html_url !== expectedUrl) throw err('실행 주소 형식 오류');
  return { id: raw.id, status: raw.status, conclusion: raw.conclusion, createdAtMs, updatedAtMs, url: raw.html_url, workflow };
}
async function cancelReader(reader) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve(reader.cancel()).catch(() => undefined),
      new Promise(resolve => { timer = setTimeout(resolve, 100); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function readBody(response, signal, deadline) {
  const length = response.headers?.get?.('content-length') || response.headers?.get?.('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw err('응답 크기 제한 초과');
  if (!response.body?.getReader) throw err('응답 본문 형식 오류');
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw err('GitHub 조회 시간 초과', 'TIMEOUT');
      const part = await Promise.race([reader.read(), deadline]); if (part.done) break;
      total += part.value.byteLength; if (total > MAX_BODY_BYTES) throw err('응답 크기 제한 초과', 'BODY_TOO_LARGE'); chunks.push(part.value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { await cancelReader(reader); }
}
async function fetchRuns(fetchImpl, timeoutMs, now) {
  const controller = new AbortController(); let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(); reject(err('GitHub 조회 시간 초과', 'TIMEOUT'));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([fetchImpl(API_URL, { method: 'GET', headers: { Accept: 'application/vnd.github+json' }, redirect: 'error', signal: controller.signal }), deadline]);
    const remaining = response.headers?.get?.('x-ratelimit-remaining') || response.headers?.get?.('X-RateLimit-Remaining');
    if (response.status === 429 || (response.status === 403 && remaining === '0')) throw err('GitHub 요청 제한', 'RATE_LIMIT');
    if (!Number.isInteger(response.status) || response.status < 200 || response.status >= 300) throw err(`GitHub 응답 오류(${response.status || 'unknown'})`);
    const body = await readBody(response, controller.signal, deadline);
    if (!body || !Array.isArray(body.workflow_runs)) throw err('실행 목록 형식 오류');
    if (body.workflow_runs.length > 100) throw err('실행 목록 개수 제한 초과');
    const allowed = body.workflow_runs.filter((run) => run?.event === 'schedule' && run?.head_branch === 'main' && typeof run?.path === 'string' && OPERATIONAL_WORKFLOWS.includes(run.path.split('/').pop()) && run.path === `.github/workflows/${run.path.split('/').pop()}`);
    return allowed.map((run) => parseRun(run, now));
  } catch (error) {
    if (error?.name === 'AbortError') throw err('GitHub 조회 시간 초과', 'TIMEOUT');
    throw error;
  } finally { clearTimeout(timer); }
}
function emptyChecks(reason) { return OPERATIONAL_WORKFLOWS.map((workflow) => ({ key: workflow.replace(/\.yml$/, ''), workflow, latestRun: null, freshness: 'unknown', checkedAtMs: null, runHealth: 'unknown', maxAgeMs: WORKFLOW_LIMITS[workflow], lastSuccessfulRun: null, reason })); }
function buildChecks(runs, now) { return OPERATIONAL_WORKFLOWS.map((workflow) => {
  const matching = runs.filter((run) => run.workflow === workflow).sort((a, b) => b.createdAtMs - a.createdAtMs);
  const latestRun = matching[0] || null; const lastSuccessfulRun = matching.find((run) => run.conclusion === 'success') || null;
  const publicRun = (run) => run ? { id: run.id, status: run.status, conclusion: run.conclusion, createdAtMs: run.createdAtMs, updatedAtMs: run.updatedAtMs, url: run.url } : null;
  return { key: workflow.replace(/\.yml$/, ''), workflow, latestRun: publicRun(latestRun), freshness: 'fresh', checkedAtMs: now, runHealth: runHealth(latestRun, now, WORKFLOW_LIMITS[workflow]), maxAgeMs: WORKFLOW_LIMITS[workflow], lastSuccessfulRun: publicRun(lastSuccessfulRun), reason: null };
}); }
export function clearOperationalChecksCache() { cache = null; inFlight = null; rateLimitedUntilMs = 0; }
function withCurrentHealth(check, now, freshness, reason) {
  return { ...check, freshness, reason, runHealth: runHealth(check.latestRun, now, check.maxAgeMs) };
}
function reasonCode(error) {
  if (error?.code === 'RATE_LIMIT') return 'GITHUB_RATE_LIMIT';
  if (error?.code === 'TIMEOUT') return 'GITHUB_TIMEOUT';
  if (error?.code === 'BODY_TOO_LARGE') return 'GITHUB_RESPONSE_TOO_LARGE';
  if (String(error?.message || '').startsWith('GitHub 응답 오류')) return 'GITHUB_HTTP_ERROR';
  return 'GITHUB_RESPONSE_INVALID';
}
export async function getOperationalChecks({ fetchImpl = globalThis.fetch, now = Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!validMs(now) || now > Date.now() + 60000) throw err('기준 시각 형식 오류');
  // A backward clock or corrupt module state must never make future evidence
  // look current or extend a rate-limit lock indefinitely.
  if (cache && (!validMs(cache.fetchedAtMs) || cache.fetchedAtMs > now)) cache = null;
  if (!validMs(rateLimitedUntilMs) || rateLimitedUntilMs <= now || rateLimitedUntilMs > now + RATE_LIMIT_COOLDOWN_MS) rateLimitedUntilMs = 0;
  if (cache && now >= cache.fetchedAtMs && now - cache.fetchedAtMs < CACHE_TTL_MS) return { ...cache.data, generatedAtMs: now, checks: cache.data.checks.map((check) => withCurrentHealth({ ...check, checkedAtMs: cache.fetchedAtMs }, now, 'fresh', null)) };
  if (inFlight) return inFlight;
  if (now < rateLimitedUntilMs) return { generatedAtMs: now, checks: cache ? cache.data.checks.map((check) => withCurrentHealth(check, now, 'stale', 'GITHUB_RATE_LIMIT')) : emptyChecks('GITHUB_RATE_LIMIT'), source: 'github-actions', historyScope: 'latest-100-scheduled-main-runs', readOnly: true };
  inFlight = (async () => {
    try { const data = { generatedAtMs: now, checks: buildChecks(await fetchRuns(fetchImpl, timeoutMs, now), now), source: 'github-actions', historyScope: 'latest-100-scheduled-main-runs', readOnly: true }; cache = { fetchedAtMs: now, data }; return data; }
    catch (error) { const reason = reasonCode(error); if (error?.code === 'RATE_LIMIT') rateLimitedUntilMs = now + RATE_LIMIT_COOLDOWN_MS; return { generatedAtMs: now, checks: cache ? cache.data.checks.map((check) => withCurrentHealth(check, now, 'stale', reason)) : emptyChecks(reason), source: 'github-actions', historyScope: 'latest-100-scheduled-main-runs', readOnly: true }; }
    finally { inFlight = null; }
  })();
  return inFlight;
}
export { API_URL, CACHE_TTL_MS, MAX_BODY_BYTES };
