/**
 * monitor-newest-plan.mjs — READ-ONLY. Poll the operator's newest plan (uid
 * PYOcsoVY / dlxodbs147) until it reaches status=ready (P318 inline delivered)
 * or error/sweep (still failing). Confirms whether P318 fix delivers.
 */
import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local', '.env.test.local']) {
  try {
    const t = readFileSync(file, 'utf8'); const re = /^([A-Z0-9_]+)\s*=\s*(.*)$/gm; let m;
    while ((m = re.exec(t)) !== null) { const k = m[1]; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\n/g, '\n'); if (!process.env[k]) process.env[k] = v; }
  } catch {}
}
const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
const pem = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
let pk = rawKey;
if (pem) { const b64 = pem[1].replace(/\s+/g, ''); pk = '-----BEGIN PRIVATE KEY-----\n' + (b64.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n'; }
initializeApp({ credential: cert({ projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(), clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(), privateKey: pk }) });
const db = getFirestore();
const UID = 'rLpDpgI8HffwFe7x3LVD9VfARCd2'; // also check guest uid
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newest() {
  const out = [];
  for (const q of [db.collection('plans').where('uid', '==', 'PYOcsoVY5ug5sO6OmxYV0YAoN5v1'), db.collection('plans').where('guestEmail', '==', 'dlxodbs147@gmail.com')]) {
    try { (await q.get()).forEach((p) => out.push({ id: p.id, d: p.data() })); } catch {}
  }
  out.sort((a, b) => (b.d._streaming_started_at || 0) - (a.d._streaming_started_at || 0));
  return out[0];
}

let n = 0;
while (n < 18) {
  n++;
  const p = await newest();
  if (!p) { console.log(`[${n}] no plan found`); await sleep(20000); continue; }
  const d = p.d; const days = (d.itinerary?.days || d.days); const dayN = Array.isArray(days) ? days.length : 0;
  const ago = d._streaming_last_update ? Math.round((Date.now() - d._streaming_last_update) / 1000) : '?';
  console.log(`[${n}] ${p.id.slice(0, 8)} status=${d.status} days=${dayN} progress=${d._streaming_progress} last_update=${ago}s ago err=${d._streaming_error || '-'}`);
  if (d.status === 'ready') { console.log(`\n✅ READY — P318 inline DELIVERED. days=${dayN} planId=${p.id}`); process.exit(0); }
  if (d.status === 'error' || d._streaming_error) { console.log(`\n❌ ERROR — still failing. err=${d._streaming_error} planId=${p.id}`); process.exit(0); }
  await sleep(20000);
}
console.log('\n⏱️ monitor timed out (still streaming after ~6min — likely stuck).');
process.exit(0);
