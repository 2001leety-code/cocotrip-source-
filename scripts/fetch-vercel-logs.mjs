/**
 * fetch-vercel-logs.mjs — Vercel REST API 로 runtime logs 자동 fetch.
 *
 * 사용:
 *   node scripts/fetch-vercel-logs.mjs                         # 최근 production deployment 의 logs (최근 30분)
 *   node scripts/fetch-vercel-logs.mjs --plan=<planId>         # 특정 plan ID 가 포함된 log 만 grep
 *   node scripts/fetch-vercel-logs.mjs --since=<ISO timestamp> # 특정 시각 이후
 *   node scripts/fetch-vercel-logs.mjs --deployment=<id>       # 특정 deployment
 *
 * ENV 필요 (.env.admin.local 또는 .env):
 *   - VERCEL_TOKEN
 *   - VERCEL_PROJECT_ID
 */
import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local']) {
  try {
    const envText = readFileSync(file, 'utf8');
    const pattern = /^([A-Z0-9_]+)\s*=\s*(.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1]; let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1,-1).replace(/\\n/g,'\n');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

const TOKEN = (process.env.VERCEL_TOKEN || '').trim();
const PROJECT_ID = (process.env.VERCEL_PROJECT_ID || '').trim();
const TEAM_ID = (process.env.VERCEL_TEAM_ID || '').trim();
if (!TOKEN || !PROJECT_ID) {
  console.error('VERCEL_TOKEN or VERCEL_PROJECT_ID missing');
  process.exit(1);
}
const TEAM_QS = TEAM_ID ? `&teamId=${TEAM_ID}` : '';
const TEAM_QS_ONLY = TEAM_ID ? `?teamId=${TEAM_ID}` : '';

const args = process.argv.slice(2);
const planFilter = args.find(a => a.startsWith('--plan='))?.slice(7);
const sinceArg = args.find(a => a.startsWith('--since='))?.slice(8);
const deploymentArg = args.find(a => a.startsWith('--deployment='))?.slice(13);

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function api(path) {
  const url = `https://api.vercel.com${path}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

// 1. deployment 결정
let deploymentId = deploymentArg;
if (!deploymentId) {
  console.log('[1/3] fetching latest production deployment...');
  const deployments = await api(`/v6/deployments?projectId=${PROJECT_ID}&limit=5&target=production${TEAM_QS}`);
  const latest = deployments?.deployments?.find(d => d.state === 'READY');
  if (!latest) {
    console.error('no READY production deployment found');
    process.exit(2);
  }
  deploymentId = latest.uid || latest.id;
  console.log(`     deployment ${deploymentId} (commit ${(latest.meta?.githubCommitSha || '?').slice(0,8)}, created ${new Date(latest.created).toISOString()})`);
}

// 2. runtime-logs fetch
// P279 (2026-05-29): Vercel runtime-logs API 가 NDJSON (newline-delimited JSON) 응답 →
//   `res.json()` (api() 안) 가 SyntaxError. text() + split('\n') + per-line JSON.parse 패턴 적용.
//   fetch-vercel-logs-v2.mjs 의 streaming 패턴 (line 38-66) 와 동일 원리, 본 v1 은 simple non-streaming.
console.log(`[2/3] fetching runtime logs for deployment ${deploymentId}...`);
const logsUrl = `https://api.vercel.com/v1/projects/${PROJECT_ID}/deployments/${deploymentId}/runtime-logs${TEAM_QS_ONLY}`;
const logsRes = await fetch(logsUrl, { headers });
if (!logsRes.ok) {
  const text = await logsRes.text();
  throw new Error(`${logsRes.status} ${logsRes.statusText}: ${text.slice(0, 500)}`);
}
const logsText = await logsRes.text();
const logs = logsText
  .split('\n')
  .filter(line => line.trim())
  .map(line => {
    try { return JSON.parse(line); } catch { return null; }
  })
  .filter(l => l !== null);
console.log(`     fetched ${logs.length} log entries (NDJSON)`);

// 3. 필터 + 출력
console.log(`[3/3] filtering + printing...\n`);
const sinceMs = sinceArg ? new Date(sinceArg).getTime() : 0;

const filtered = logs.filter(l => {
  if (sinceMs && l.timestampInMs < sinceMs) return false;
  if (planFilter && !((l.message || '').includes(planFilter))) return false;
  return true;
});

console.log(`=== ${filtered.length} entries match filter ===\n`);
for (const l of filtered) {
  const ts = l.timestampInMs ? new Date(l.timestampInMs).toISOString() : '?';
  const lvl = (l.level || '?').padEnd(7);
  const src = (l.source || '?').padEnd(12);
  const path = l.requestPath || '';
  const status = l.responseStatusCode || '';
  const msg = (l.message || '').slice(0, 600);
  console.log(`[${ts}] ${lvl} ${src} ${status} ${path}`);
  console.log(`  ${msg}`);
}

process.exit(0);
