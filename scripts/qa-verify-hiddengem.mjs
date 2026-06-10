/** 히든젬 블록 선택 실증 — 부산 Culture/Local/Photo plan 생성 후 blocksUsed 에 신규 히든젬
 *  블록(영도/전포/초량)이 selectBlocksWithGemini 로 선택되는지 확인. 비용: Gemini 1 dispatch. */
import { readFileSync } from 'fs';
for (const file of ['.env', '.env.admin.local', '.env.test.local']) {
  try {
    const t = readFileSync(file, 'utf8'); const p = /^([A-Z0-9_]+)\s*=\s*(.*)$/gm; let m;
    while ((m = p.exec(t)) !== null) { const k = m[1]; let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\n/g, '\n'); if (!process.env[k]) process.env[k] = v; }
  } catch {}
}
const { initializeApp, cert } = await import('firebase-admin/app');
const { getAuth } = await import('firebase-admin/auth');
const { getFirestore } = await import('firebase-admin/firestore');
const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
const pem = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
let pk = rawKey;
if (pem) { const b64 = pem[1].replace(/\s+/g, ''); pk = '-----BEGIN PRIVATE KEY-----\n' + (b64.match(/.{1,64}/g) || []).join('\n') + '\n-----END PRIVATE KEY-----\n'; }
initializeApp({ credential: cert({ projectId: (process.env.FIREBASE_PROJECT_ID || '').trim(), clientEmail: (process.env.FIREBASE_CLIENT_EMAIL || '').trim(), privateKey: pk }) });
const auth = getAuth(); const db = getFirestore();
const ADMIN_EMAIL = '2001leety@gmail.com';
const WEB_API_KEY = (process.env.VITE_FIREBASE_API_KEY || '').trim();
const uid = (await auth.getUserByEmail(ADMIN_EMAIL)).uid;
const customToken = await auth.createCustomToken(uid);
const si = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) });
const { idToken } = await si.json();
console.log('auth OK');

const ts = Date.now();
const body = {
  uid, email: ADMIN_EMAIL,
  paypalOrderId: `ADMIN-BYPASS-hgverify-${ts}`,
  area: 'busan', durationDays: 3, regions: ['부산'],
  arrival_city: 'busan', entry_city: 'busan', departure_city: 'busan',
  hotelByCity: { busan: '서면 롯데호텔' }, recommendedZones: { busan: '서면' }, recommended_zones: { busan: '서면' },
  pax: 2, adults: 2, children: 0,
  arrival_airport: 'PUS', departure_airport: 'PUS', arrivalTime: '13:00', startDate: '2026-07-10',
  language: 'ko', styles: ['Culture', 'Local', 'Photo'], vehicle: 'public',
  dietPrefs: [], allergies: [], guestName: 'HGVerify', specialRequest: '로컬 골목·숨은 동네 위주, 관광지 회피',
};
console.log('dispatch: 부산 3일 Culture/Local/Photo');
const r = await fetch('https://cocotripkr.com/api/ai-planner-full', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify(body) });
const txt = await r.text(); let dt; try { dt = JSON.parse(txt); } catch { dt = null; }
const planId = dt?.data?.planId || dt?.planId;
console.log(`HTTP ${r.status} planId=${planId || 'NONE'}`);
if (!planId) { console.log(txt.slice(0, 300)); process.exit(1); }

let data = null;
for (let i = 0; i < 96; i++) {
  await new Promise((res) => setTimeout(res, 5000));
  const snap = await db.collection('plans').doc(planId).get();
  if (!snap.exists) continue;
  const d = snap.data();
  if (d.status === 'ready') { data = d; break; }
  if (d.status === 'error') { console.log('ERROR', d._streaming_error); process.exit(1); }
}
if (!data) { console.log('timeout'); process.exit(1); }

const blocksUsed = data.blocksUsed || data.itinerary?.blocksUsed || [];
const HIDDEN = ['YEONGDO', 'JEONPO', 'CHORYANG', 'SEOCHON', 'YEONNAM'];
const hit = blocksUsed.filter((b) => HIDDEN.some((h) => String(b).includes(h)));
console.log('\n=== plannerMode:', data.plannerMode || data.mode || '?');
console.log('blocksUsed:', JSON.stringify(blocksUsed));
console.log('히든젬 블록 선택:', hit.length ? hit.join(', ') : '없음 (Gemini 가 유명 블록 선택)');
console.log('day themes:', (data.itinerary?.days || []).map((d) => `${d.day}:${(d.theme || '').slice(0, 20)}`).join(' | '));
console.log('url: https://cocotripkr.com/my-plans/' + planId);
process.exit(0);
