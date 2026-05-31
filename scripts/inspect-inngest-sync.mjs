/**
 * inspect-inngest-sync.mjs — READ-ONLY. Determine whether the prod Inngest worker
 * (processPlanAfterAI) is deployed + synced, to predict if real-payment streaming
 * plans will be finalized on prod.
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

async function getJson(url, opts = {}, label = '') {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 600); }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 'ERR', body: e.message };
  }
}

console.log('═══ 1) prod /api/inngest serve introspection (GET) ═══');
const introspect = await getJson('https://cocotripkr.com/api/inngest', { method: 'GET', headers: { 'User-Agent': 'cocotrip-diagnostic' } });
console.log(`   status=${introspect.status}`);
console.log(`   body=${typeof introspect.body === 'object' ? JSON.stringify(introspect.body, null, 2) : introspect.body}`);

console.log('\n═══ 2) Inngest Cloud apps (sync status) ═══');
const KEY = (process.env.INNGEST_API_KEY || '').trim();
if (!KEY) { console.log('   INNGEST_API_KEY missing — skip'); }
else {
  for (const path of ['/v1/apps', '/v1/envs', '/v1/functions']) {
    const r = await getJson(`https://api.inngest.com${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
    console.log(`   GET ${path} → status=${r.status}`);
    if (r.ok) console.log(`      ${typeof r.body === 'object' ? JSON.stringify(r.body).slice(0, 1200) : r.body}`);
    else console.log(`      ${typeof r.body === 'object' ? JSON.stringify(r.body).slice(0, 300) : r.body}`);
  }
}

console.log('\n═══ 3) recent processPlanAfterAI runs (any plan/ai.complete ever) ═══');
if (KEY) {
  const r = await getJson(`https://api.inngest.com/v1/events?name=plan/ai.complete&limit=5`, { headers: { Authorization: `Bearer ${KEY}` } });
  console.log(`   GET /v1/events?name=plan/ai.complete → status=${r.status}`);
  console.log(`   ${typeof r.body === 'object' ? JSON.stringify(r.body).slice(0, 800) : r.body}`);
}
console.log('\nDONE (read-only).');
process.exit(0);
