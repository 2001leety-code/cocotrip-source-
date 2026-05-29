/**
 * fetch-vercel-project-id.mjs — 실제 project ID 추출.
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
const headers = { Authorization: `Bearer ${TOKEN}` };

const TEAM_ID = 'team_BJBSYgMLiGERQaryblHyvMfW';
const res = await fetch(`https://api.vercel.com/v9/projects?teamId=${TEAM_ID}&limit=20`, { headers });
const data = await res.json();
console.log('=== Projects ===');
for (const p of (data.projects || [])) {
  console.log(`  id=${p.id}  name=${p.name}  framework=${p.framework}`);
}
