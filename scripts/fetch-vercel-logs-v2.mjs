/**
 * Vercel logs REST API 직접 호출 (CLI 가 일부 logs 누락 가능)
 */
import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local']) {
  try {
    const t = readFileSync(file, 'utf8');
    for (const m of t.matchAll(/^([A-Z0-9_]+)\s*=\s*(.*)$/gm)) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1).replace(/\\n/g,'\n');
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {}
}
const TOKEN = process.env.VERCEL_TOKEN.trim();
const PROJECT = process.env.VERCEL_PROJECT_ID.trim();
const TEAM = process.env.VERCEL_TEAM_ID.trim();
const deployment = process.argv[2] || 'dpl_2RyaXYK9ta2ZDM9eunp3QnrJqW3n';
const since = process.argv[3] || '2026-05-28T16:49:00Z';
const until = process.argv[4] || '2026-05-28T16:49:30Z';

console.log(`deployment: ${deployment}`);
console.log(`range: ${since} ~ ${until}`);

// Stream API — read until end or 30s timeout
const url = `https://api.vercel.com/v1/projects/${PROJECT}/deployments/${deployment}/runtime-logs?teamId=${TEAM}`;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 30000);
const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` }, signal: controller.signal });

if (!res.ok) {
  console.error(res.status, await res.text());
  process.exit(1);
}

const sinceMs = new Date(since).getTime();
const untilMs = new Date(until).getTime();
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let count = 0;
const matches = [];

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        count++;
        if (j.timestampInMs >= sinceMs && j.timestampInMs <= untilMs) {
          matches.push(j);
        }
      } catch {}
    }
  }
} catch (e) {
  if (e.name !== 'AbortError') throw e;
} finally {
  clearTimeout(timer);
}

console.log(`\ntotal parsed: ${count}, in range: ${matches.length}\n`);

for (const j of matches.sort((a,b) => a.timestampInMs - b.timestampInMs)) {
  const ts = new Date(j.timestampInMs).toISOString().slice(11,23);
  const lvl = (j.level || '?').padEnd(7);
  const path = (j.requestPath || '').padEnd(25).slice(0,25);
  console.log(`${ts} ${lvl} ${path} ${(j.message || '').slice(0, 250)}`);
}
