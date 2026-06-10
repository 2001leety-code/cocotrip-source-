/** 플랜 동선 실데이터 덤프 — Firestore plan 문서에서 day별 stop 좌표/거리/카테고리 추출.
 *  사용: node scripts/qa-plan-route-dump.mjs <planId>
 *  목적: 동선 최적성(backtrack) + 다양성(generic 여부) 분석용 ground-truth. 비용 0(LLM 없음). */
import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local', '.env.test.local']) {
  try {
    const t = readFileSync(file, 'utf8'); const p = /^([A-Z0-9_]+)\s*=\s*(.*)$/gm; let m;
    while ((m = p.exec(t)) !== null) { const k = m[1]; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\n/g, '\n'); if (!process.env[k]) process.env[k] = v; }
  } catch {}
}
const planId = process.argv[2];
if (!planId) { console.log('usage: node scripts/qa-plan-route-dump.mjs <planId>'); process.exit(1); }

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
const pem = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
let pk = rawKey;
if (pem) { const b64 = pem[1].replace(/\s+/g, ''); pk = '-----BEGIN PRIVATE KEY-----\n' + (b64.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n'; }
initializeApp({ credential: cert({ projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(), clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(), privateKey: pk }) });

const snap = await getFirestore().collection('plans').doc(planId).get();
if (!snap.exists) { console.log('plan 없음'); process.exit(1); }
const d = snap.data();
const it = d.itinerary || {};
const days = it.days || [];

const hav = (a, b) => {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return (R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
};

const out = { planId, styles: d.styles || it.styles, days: [] };
for (const day of days) {
  const stops = (day.stops || []).map((s) => ({
    time: s.time, name: s.display_name || s.name || s.name_en || '',
    name_ko: s.name || s.name_ko || '',
    cat: s.category || '',
    lat: s.lat != null ? s.lat : (s.latitude != null ? s.latitude : null),
    lng: s.lng != null ? s.lng : (s.longitude != null ? s.longitude : null),
    transit: s.transit_from_prev ? `${s.transit_from_prev.method || ''} ${s.transit_from_prev.minutes || '?'}min ${s.transit_from_prev.distance_km || '?'}km` : '',
  }));
  // 좌표 있는 stop 만으로 backtrack 지표: 연속 거리 합 vs 첫-끝 직선거리
  const coordStops = stops.filter((s) => s.lat != null);
  let pathKm = 0;
  const legs = [];
  for (let i = 1; i < coordStops.length; i++) {
    const km = hav(coordStops[i - 1], coordStops[i]);
    if (km != null) { pathKm += km; legs.push({ from: coordStops[i - 1].name, to: coordStops[i].name, km: +km.toFixed(2) }); }
  }
  out.days.push({
    day: day.day, city: day.city || day.region, theme: day.theme,
    stopCount: stops.length, coordCount: coordStops.length,
    pathKm: +pathKm.toFixed(1),
    longestLegs: legs.sort((a, b) => b.km - a.km).slice(0, 3),
    stops: stops.map((s) => `${s.time} ${s.name}${s.name_ko && s.name_ko !== s.name ? ' [' + s.name_ko + ']' : ''} (${s.cat}) ${s.lat ? s.lat.toFixed(4) + ',' + s.lng.toFixed(4) : 'NOGEO'} ${s.transit}`),
  });
}
console.log(JSON.stringify(out, null, 1));
