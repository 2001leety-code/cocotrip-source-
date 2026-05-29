/**
 * fetch-vercel-debug.mjs — Vercel API 접근 진단
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
console.log('TOKEN length:', TOKEN.length);
console.log('PROJECT_ID:', PROJECT_ID);

const headers = { Authorization: `Bearer ${TOKEN}` };

async function tryEndpoint(name, path) {
  try {
    const res = await fetch(`https://api.vercel.com${path}`, { headers });
    const text = await res.text();
    console.log(`\n[${name}] ${res.status} ${res.statusText}`);
    console.log(`  ${text.slice(0, 500)}`);
    if (res.ok) {
      try {
        const j = JSON.parse(text);
        return j;
      } catch {}
    }
  } catch (e) {
    console.log(`\n[${name}] ERROR: ${e.message}`);
  }
  return null;
}

// 1. user 확인
const user = await tryEndpoint('GET /v2/user', '/v2/user');

// 2. team list
const teams = await tryEndpoint('GET /v2/teams', '/v2/teams');

// 3. 전체 projects (team 무관)
await tryEndpoint('GET /v9/projects (no team)', '/v9/projects?limit=10');

// 4. teams 있으면 team-scoped projects
if (teams?.teams) {
  for (const t of teams.teams) {
    await tryEndpoint(`GET /v9/projects (teamId=${t.id})`, `/v9/projects?teamId=${t.id}&limit=10`);
  }
}

// 5. project 직접 by ID
await tryEndpoint(`GET /v9/projects/${PROJECT_ID}`, `/v9/projects/${PROJECT_ID}`);
