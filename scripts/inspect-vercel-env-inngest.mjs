/**
 * inspect-vercel-env-inngest.mjs — READ-ONLY. Show PLANNER_INNGEST_ENABLED +
 * INNGEST_* env vars per environment (production vs preview) to determine whether
 * prod dispatches to Inngest (needs synced worker) or runs inline (delivers plan).
 */
import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local']) {
  try {
    const envText = readFileSync(file, 'utf8');
    const pattern = /^([A-Z0-9_]+)\s*=\s*(.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1]; let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1).replace(/\\n/g, '\n');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
const TOKEN = (process.env.VERCEL_TOKEN || '').trim();
const PROJECT_ID = (process.env.VERCEL_PROJECT_ID || '').trim();
const TEAM_ID = (process.env.VERCEL_TEAM_ID || '').trim();
const TEAM_QS = TEAM_ID ? `&teamId=${TEAM_ID}` : '';
const res = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env?decrypt=true${TEAM_QS}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
const data = await res.json();
const envs = data.envs || data.env || [];
console.log(`total env vars: ${envs.length}\n`);
const KEYS = /INNGEST|PLANNER_INNGEST|PLANNER_MODE|PLANNER_SKELETON|STREAM/i;
for (const e of envs) {
  if (!KEYS.test(e.key)) continue;
  const target = Array.isArray(e.target) ? e.target.join(',') : e.target;
  let val = e.value;
  if (val && e.key.includes('SIGNING') || e.key.includes('KEY') || e.key.includes('SECRET')) val = val ? `<set:${String(val).length}chars>` : '(empty)';
  console.log(`${e.key.padEnd(32)} target=[${target}]${e.gitBranch ? ' branch=' + e.gitBranch : ''}  value=${val}`);
}
console.log('\nDONE (read-only).');
process.exit(0);
