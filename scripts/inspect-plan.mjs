import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local', '.env.test.local']) {
  try {
    const envText = readFileSync(file, 'utf8');
    const pattern = /^([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1).replace(/\\n/g, '\n');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
let privateKey = rawKey;
if (pemMatch) {
  const b64 = pemMatch[1].replace(/\s+/g, '');
  const lines = b64.match(/.{1,64}/g) || [];
  privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
}
initializeApp({ credential: cert({ projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(), clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(), privateKey }) });
const db = getFirestore();

const planId = process.argv[2] || '85c28f8f-6fb1-480b-aaa8-e4135e9e6b7a';
const snap = await db.collection('plans').doc(planId).get();
const plan = snap.data();

for (const day of (plan?.itinerary?.days || [])) {
  console.log(`\n=== Day ${day.day} (${day.date}) ===`);
  for (const stop of (day.stops || [])) {
    const t = stop.transit_from_prev;
    if (!t) continue;
    console.log(`  → ${stop.display_name || stop.name}: method=${t.method}, source=${t.source}, steps_detail=${(t.steps_detail || []).length}`);
    for (const s of (t.steps_detail || [])) {
      console.log(`      [${s.mode}]`, s.mode === 'subway' ? `${s.lineEn || s.line} ${s.from} exit${s.fromExit} → ${s.to} exit${s.toExit} | timetable=${s.fromTimetable ? 'yes' : 'no'}` : s.mode === 'bus' ? `${s.busNo} ${s.from} → ${s.to}` : `walk ${s.duration}min`);
      if (s.fromTimetable) {
        const tt = s.fromTimetable;
        console.log(`         timetable up: ${tt.up?.first} / ${tt.up?.last} (to ${tt.up?.lastDest})`);
        console.log(`         timetable down: ${tt.down?.first} / ${tt.down?.last} (to ${tt.down?.lastDest})`);
      }
    }
  }
}
process.exit(0);
