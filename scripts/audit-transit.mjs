import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// Minimal inline .env loader (avoids dotenv dependency). Handles multi-line PEM values.
for (const file of ['.env', '.env.admin.local', '.env.test.local']) {
  try {
    const envText = readFileSync(file, 'utf8');
    // Match KEY=value where value may be quoted and contain newlines
    const pattern = /^([A-Z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|.*)$/gm;
    let m;
    while ((m = pattern.exec(envText)) !== null) {
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
  .replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
let privateKey = rawKey;
if (pemMatch) {
  const base64Clean = pemMatch[1].replace(/\s+/g, '');
  const lines = base64Clean.match(/.{1,64}/g) || [];
  privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
}

initializeApp({
  credential: cert({
    projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(),
    clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(),
    privateKey,
  }),
});

const db = getFirestore();
const snap = await db.collection('plans').orderBy('createdAtMs', 'desc').limit(10).get();

const counts = {};
const methods = {};
const downgrades = [];
const samples = [];

snap.forEach(doc => {
  const data = doc.data();
  const days = data.itinerary?.days || [];
  const info = { planId: doc.id.slice(0, 8), area: data.input?.area, stops: [] };
  for (const day of days) {
    for (const stop of (day.stops || [])) {
      const t = stop.transit_from_prev;
      if (!t) { counts.nullOrMissing = (counts.nullOrMissing || 0) + 1; continue; }
      const src = t.source || 'other';
      counts[src] = (counts[src] || 0) + 1;
      const m = t.method || 'none';
      methods[m] = (methods[m] || 0) + 1;
      if (t._downgraded_from) downgrades.push({ from: t._downgraded_from, to: t.method });
      info.stops.push({ method: m, source: src, mins: t.est_min, steps: (t.step_by_step || []).length, dgFrom: t._downgraded_from });
    }
  }
  samples.push(info);
});

console.log('SOURCE counts:', counts);
console.log('METHOD counts:', methods);
console.log('DOWNGRADE count:', downgrades.length, downgrades.slice(0, 5));
console.log('SAMPLES (first 3 plans):');
console.log(JSON.stringify(samples.slice(0, 3), null, 2));
process.exit(0);
