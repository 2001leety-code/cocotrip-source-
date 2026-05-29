/**
 * Vercel project ENV check (no value, only key + target)
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

const res = await fetch(`https://api.vercel.com/v9/projects/${PROJECT}/env?teamId=${TEAM}`, {
  headers: { Authorization: `Bearer ${TOKEN}` }
});
const data = await res.json();
console.log('Total ENVs:', data.envs?.length || 0);
const planner = (data.envs || []).filter(e => /PLANNER|GEMINI_MAIN|GEMINI_ADMIN|CRON/i.test(e.key));
console.log('\nPLANNER_* / GEMINI_*_MODEL envs:');
for (const e of planner.sort((a,b)=>a.key.localeCompare(b.key))) {
  console.log(`  ${e.key.padEnd(40)} targets=${e.target.join(',')} value=${e.value || '(encrypted)'}`);
}
