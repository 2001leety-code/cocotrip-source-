/** #2 5일 다도시 최종점검 — 서울+부산 5일 1건 admin-bypass dispatch + 종합 검증.
 *  검증: status / #1 paymentSource·isAdminBypass / 5일 / 다도시(부산day=부산숙소) /
 *        예산표≠0(B2) / 인터시티 KTX(B7) / 도착·출발 가이드 / 식당 중복·돼지(식이).
 *  비용: 단건 Gemini ≈ 수십원~$0.3. 모델 차등 없음(legacy/block_mode 자동). */
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
const PROD_URL = 'https://cocotripkr.com';
const uid = (await auth.getUserByEmail(ADMIN_EMAIL)).uid;
const customToken = await auth.createCustomToken(uid);
const si = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) });
const { idToken } = await si.json();
console.log('auth OK');

const ts = Date.now();
const body = {
  uid, email: ADMIN_EMAIL,
  paypalOrderId: `ADMIN-BYPASS-5day-${ts}`,
  // 5일 다도시: 서울(입국) → 부산(출국)
  area: 'seoul_city',
  durationDays: 5,
  regions: ['서울', '부산'],
  arrival_city: 'seoul', entry_city: 'seoul', departure_city: 'busan',
  hotelByCity: { seoul: '명동 신라스테이', busan: '해운대 파라다이스 호텔' },
  recommendedZones: { seoul: '명동', busan: '해운대' },
  recommended_zones: { seoul: '명동', busan: '해운대' },
  pax: 2, adults: 2, children: 0,
  arrival_airport: 'ICN T1', departure_airport: 'PUS',
  arrivalTime: '14:00', startDate: '2026-07-10',
  language: 'ko', styles: ['Food', 'Culture'], vehicle: 'public',
  dietPrefs: [], allergies: [],
  guestName: '5DayMultiQA', specialRequest: '#2 5일 다도시 최종점검',
};

console.log('dispatch:', body.paypalOrderId, '| 5일 서울+부산');
const r = await fetch(`${PROD_URL}/api/ai-planner-full`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify(body) });
const txt = await r.text(); let dt; try { dt = JSON.parse(txt); } catch { dt = null; }
const planId = dt?.data?.planId || dt?.planId;
console.log(`HTTP ${r.status} planId=${planId || 'NONE'}`);
if (!planId) { console.log('  응답:', txt.slice(0, 400)); process.exit(1); }

// polling (5일 다도시는 좀 걸림 — 최대 ~8분)
const start = Date.now(); let data = null;
for (let i = 0; i < 96; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const snap = await db.collection('plans').doc(planId).get();
  if (!snap.exists) continue;
  const d = snap.data();
  if (d.status === 'ready') { data = d; console.log(`READY ${Math.round((Date.now() - start) / 1000)}s`); break; }
  if (d.status === 'error') { console.log(`ERROR ${d._streaming_error}`); process.exit(1); }
}
if (!data) { console.log('timeout (still streaming)'); process.exit(1); }

// ===== 종합 검증 =====
console.log('\n===== 검증 =====');
// #1 결제 분리 필드
console.log(`[#1] paymentSource=${data.paymentSource} | isAdminBypass=${data.isAdminBypass}  (기대: admin-bypass / true)`);
const itin = data.itinerary || {};
const days = itin.days || [];
console.log(`[days] ${days.length}일 (기대 5)`);
// 다도시 — 각 day city/lodging
console.log('[다도시] day별 city / lodging:');
for (const d of days) {
  const lodging = (d.stops || []).find(s => s.category === 'lodging' || /숙소|호텔|stay/i.test(s.name || ''));
  console.log(`  Day${d.day || '?'}: city=${d.city || d.region || '?'} | theme=${(d.theme || '').slice(0, 20)} | lodging=${lodging?.name || '-'}`);
}
// B2 예산표
const bud = itin.daily_budget_summary || [];
const budNonZero = Array.isArray(bud) ? bud.filter(b => (b.total_krw || 0) > 0).length : 0;
console.log(`[B2 예산표] ${Array.isArray(bud) ? bud.length : 0}일 중 total_krw>0: ${budNonZero}일`);
// B7 인터시티 KTX
const inter = itin.intercity_transit || days.flatMap(d => d.intercity_transit ? [d.intercity_transit] : []);
const interArr = Array.isArray(inter) ? inter : (inter ? [inter] : []);
console.log(`[B7 인터시티] ${interArr.length}건: ${interArr.map(x => `${x.from_city || x.from || '?'}→${x.to_city || x.to || '?'} ${x.mode || x.method || ''} ${x.est_min || x.duration_min || '?'}분 ${x.est_fare_krw || x.cost_krw || '?'}원`).join(' / ') || '없음'}`);
// 도착/출발 가이드
console.log(`[가이드] arrival_guide=${itin.arrival_guide ? 'O' : 'X'} | departure_guide=${itin.departure_guide ? 'O' : 'X'}`);
// 식당 중복 + 돼지(식이 없지만 참고)
const food = days.flatMap(d => (d.stops || []).filter(s => s.category === 'food'));
const names = food.map(s => s.name);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
console.log(`[식당] ${food.length}개, 중복 ${[...new Set(dup)].length}종 ${dup.length ? '🔴' + [...new Set(dup)].join(',') : '(없음)'}`);
console.log(`\nurl: ${PROD_URL}/my-plans/${planId}`);
console.log('===== DONE =====');
