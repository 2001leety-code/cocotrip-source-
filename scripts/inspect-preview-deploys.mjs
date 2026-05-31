/**
 * inspect-preview-deploys.mjs — READ-ONLY. List recent deployments for the
 * feat/p314 branch with commit + state + created time, to determine whether the
 * P318 deployment (8e35c1fc) is live as the branch alias target.
 */
import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local']) {
  try { const t = readFileSync(file, 'utf8'); const re = /^([A-Z0-9_]+)\s*=\s*(.*)$/gm; let m; while ((m = re.exec(t)) !== null) { const k = m[1]; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!process.env[k]) process.env[k] = v; } } catch {}
}
const TOKEN = (process.env.VERCEL_TOKEN || '').trim();
const PROJECT_ID = (process.env.VERCEL_PROJECT_ID || '').trim();
const TEAM_ID = (process.env.VERCEL_TEAM_ID || '').trim();
const TEAM_QS = TEAM_ID ? `&teamId=${TEAM_ID}` : '';
const headers = { Authorization: `Bearer ${TOKEN}` };
const dep = await (await fetch(`https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&limit=15${TEAM_QS}`, { headers })).json();
console.log('recent deployments (newest first):');
for (const d of (dep.deployments || [])) {
  const br = d.meta?.githubCommitRef || '?';
  if (!/p314|p3/.test(br) && d.target !== 'production') continue;
  console.log(`  ${d.uid} ${d.state}/${d.readyState || ''} target=${d.target || 'preview'} branch=${br} commit=${(d.meta?.githubCommitSha || '?').slice(0, 8)} created=${new Date(d.created).toISOString()}`);
}
console.log('\nDONE.');
process.exit(0);
