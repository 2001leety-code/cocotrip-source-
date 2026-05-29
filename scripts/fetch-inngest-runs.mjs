/**
 * fetch-inngest-runs.mjs — Inngest REST API 로 worker function runs 자동 fetch.
 *
 * 사용:
 *   node scripts/fetch-inngest-runs.mjs                                  # 최근 plan/ai.complete events + runs
 *   node scripts/fetch-inngest-runs.mjs --event=<eventId>                # specific event 의 runs
 *   node scripts/fetch-inngest-runs.mjs --since=2026-05-28T15:38:00Z     # 시각 range
 *   node scripts/fetch-inngest-runs.mjs --name=plan/ai.complete          # event name filter
 *
 * ENV 필요 (.env.admin.local):
 *   - INNGEST_API_KEY (sk-inn-api... — Inngest Cloud → Settings → API keys)
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

const KEY = (process.env.INNGEST_API_KEY || '').trim();
if (!KEY) { console.error('INNGEST_API_KEY missing'); process.exit(1); }

const args = process.argv.slice(2);
const eventArg = args.find(a => a.startsWith('--event='))?.slice(8);
const sinceArg = args.find(a => a.startsWith('--since='))?.slice(8);
const nameArg = args.find(a => a.startsWith('--name='))?.slice(7) || 'plan/ai.complete';
const limit = args.find(a => a.startsWith('--limit='))?.slice(8) || '50';

const headers = { Authorization: `Bearer ${KEY}` };
async function api(path) {
  const res = await fetch(`https://api.inngest.com${path}`, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

if (eventArg) {
  console.log(`=== runs of event ${eventArg} ===`);
  const data = await api(`/v1/events/${eventArg}/runs`);
  for (const r of (data.data || [])) {
    console.log(`\nrun_id: ${r.run_id}`);
    console.log(`  status: ${r.status}`);
    console.log(`  function_id: ${r.function_id}`);
    console.log(`  started: ${r.run_started_at} | ended: ${r.ended_at || '(running)'}`);
    if (r.output) console.log(`  output: ${JSON.stringify(r.output).slice(0, 600)}`);
  }
  process.exit(0);
}

// list events + filter by name + time range
const sinceMs = sinceArg ? new Date(sinceArg).getTime() : Date.now() - 60 * 60 * 1000;  // default: last 1 hour
console.log(`=== Events (name=${nameArg}, since=${new Date(sinceMs).toISOString()}) ===\n`);

const data = await api(`/v1/events?limit=${limit}`);
const events = (data.data || []).filter(e => {
  if (e.name !== nameArg) return false;
  const ts = new Date(e.received_at).getTime();
  return ts >= sinceMs;
});

console.log(`matched ${events.length} / ${(data.data || []).length} events\n`);

for (const e of events) {
  console.log(`event ${e.id}  received ${e.received_at}`);
  const dataStr = JSON.stringify(e.data).slice(0, 200);
  console.log(`  data: ${dataStr}...`);

  // fetch runs for this event
  try {
    const r = await api(`/v1/events/${e.id}/runs`);
    for (const run of (r.data || [])) {
      const dur = run.ended_at && run.run_started_at
        ? Math.round((new Date(run.ended_at) - new Date(run.run_started_at)) / 1000)
        : null;
      console.log(`  └─ run ${run.run_id} status=${run.status} fn=${run.function_id} dur=${dur || '?'}s`);
      if (run.output && run.status !== 'Completed') {
        const out = JSON.stringify(run.output).slice(0, 500);
        console.log(`     output: ${out}`);
      }
    }
  } catch (err) {
    console.log(`  └─ runs fetch failed: ${err.message}`);
  }
  console.log('');
}
