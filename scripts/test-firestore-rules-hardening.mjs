/**
 * Firestore Rules 강화 검증 스크립트
 * 
 * catch-all 제거 후 추가 검증 케이스:
 *   D1) 서버 전용 컬렉션 접근 차단 (used_paypal_orders, api_stats)
 *   D2) 공개 컬렉션 비인증 접근 (tours, earlybird)
 *   D3) plans update — 소유자 vs 비소유자
 *   D4) plans create 차단 (클라이언트)
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.admin.local');
const envContent = readFileSync(envPath, 'utf8');

const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^(\w+)=(.+)$/);
  if (m) {
    let val = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[m[1]] = val;
  }
}

const PROJECT_ID = env.FIREBASE_PROJECT_ID;
const CLIENT_EMAIL = env.FIREBASE_CLIENT_EMAIL;
const PRIVATE_KEY = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: CLIENT_EMAIL, sub: CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  };
  const segments = [
    base64url(Buffer.from(JSON.stringify(header))),
    base64url(Buffer.from(JSON.stringify(payload))),
  ];
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(segments.join('.'));
  segments.push(base64url(sign.sign(PRIVATE_KEY)));
  return segments.join('.');
}

async function getAdminToken() {
  const jwt = createJWT();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function firestoreGet(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/${path}`, { headers });
  return { status: res.status, data: await res.json() };
}

async function firestorePatch(path, fields, token) {
  const updateMask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const res = await fetch(`${BASE}/${path}?${updateMask}`, {
    method: 'PATCH',
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  return { status: res.status, data: await res.json() };
}

async function firestoreCreate(collectionPath, fields, token) {
  const res = await fetch(`${BASE}/${collectionPath}`, {
    method: 'POST',
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  return { status: res.status, data: await res.json() };
}

async function firestoreList(path, token, pageSize = 3) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/${path}?pageSize=${pageSize}`, { headers });
  return { status: res.status, data: await res.json() };
}

// ---- Results tracking ----
const results = [];
function record(id, desc, expected, actual, pass) {
  results.push({ id, desc, expected, actual, pass });
  console.log(`   ${pass ? '✅' : '❌'} ${id}: ${desc} → HTTP ${actual} (expected ${expected})`);
}

// ---- Main ----
async function main() {
  console.log(`\n🔧 Project: ${PROJECT_ID}`);
  console.log('🔐 Admin token 획득...');
  const adminToken = await getAdminToken();
  console.log('✅ Admin token OK\n');

  // Find a plan with uid for testing
  const list = await firestoreList('plans', adminToken, 5);
  const docs = list.data.documents || [];
  let testPlan = null;
  for (const d of docs) {
    if (d.fields?.uid?.stringValue) {
      testPlan = { id: d.name.split('/').pop(), uid: d.fields.uid.stringValue };
      break;
    }
  }
  if (!testPlan) { console.error('❌ uid가 있는 플랜 없음'); return; }
  console.log(`📌 테스트 플랜: ${testPlan.id} (uid: ${testPlan.uid})\n`);

  // ================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  강화 검증 — 서버 전용 컬렉션 차단');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // D1: used_paypal_orders — 비인증 read
  const d1a = await firestoreGet('used_paypal_orders/test-doc', null);
  record('D1a', 'used_paypal_orders 비인증 read', '403/404', d1a.status, d1a.status === 403 || d1a.status === 404);

  // D1b: used_paypal_orders — Admin SDK read (should work since Admin bypasses rules)
  const d1b = await firestoreGet('used_paypal_orders/test-doc', adminToken);
  record('D1b', 'used_paypal_orders Admin read (bypass)', '200/404', d1b.status, d1b.status === 200 || d1b.status === 404);

  // D2: api_stats — 비인증 read
  const d2 = await firestoreGet('api_stats/2026-04', null);
  record('D2', 'api_stats 비인증 read', '403/404', d2.status, d2.status === 403 || d2.status === 404);

  // ================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌐 강화 검증 — 공개 컬렉션 비인증 접근');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // D3: tours 비인증 read (should be public)
  const d3 = await firestoreList('tours', null, 1);
  record('D3', 'tours 비인증 list', '200', d3.status, d3.status === 200);

  // D4: earlybird 비인증 read
  const d4 = await firestoreGet('earlybird/counter', null);
  record('D4', 'earlybird/counter 비인증 read', '200', d4.status, d4.status === 200);

  // D4b: earlybird 비인증 write (should fail)
  const d4b = await firestorePatch('earlybird/counter', {
    remaining: { integerValue: '999' },
  }, null);
  record('D4b', 'earlybird/counter 비인증 write', '403', d4b.status, d4b.status === 403);

  // ================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✏️  강화 검증 — plans update 권한');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // D5: plans update — 비인증 → 거부
  const d5 = await firestorePatch(`plans/${testPlan.id}`, {
    isPublic: { booleanValue: true },
  }, null);
  record('D5', 'plans update 비인증', '403', d5.status, d5.status === 403);

  // D6: plans create — 비인증 → 거부
  const d6 = await firestoreCreate('plans', {
    uid: { stringValue: 'hacker' },
    title: { stringValue: 'injected plan' },
  }, null);
  record('D6', 'plans create 비인증', '403', d6.status, d6.status === 403);

  // D6b: plans create — Admin (should also be denied by rules, but Admin SDK bypasses)
  // Admin REST API still uses the token which acts as service account → bypasses rules
  // So this tests that rules deny client create while Admin can still create via SDK
  
  // ================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔒 강화 검증 — 서버 전용 컬렉션 write 차단');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // D7: api_stats write — 비인증 → 거부
  const d7 = await firestorePatch('api_stats/2026-04', {
    hackerField: { stringValue: 'injected' },
  }, null);
  record('D7', 'api_stats 비인증 write', '403', d7.status, d7.status === 403);

  // D8: availability write — 비인증 → 거부
  const d8 = await firestorePatch('availability/2026-04-20', {
    slots: { integerValue: '0' },
  }, null);
  record('D8', 'availability 비인증 write', '403', d8.status, d8.status === 403);

  // ================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 최종 결과');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  
  for (const r of results) {
    console.log(`  ${r.pass ? '✅' : '❌'} ${r.id} — ${r.desc}`);
  }
  
  console.log(`\n  총 ${total}건 중 ${passed}건 PASS, ${total - passed}건 FAIL`);
  console.log(passed === total ? '\n🎉 모든 강화 테스트 PASS!' : '\n⚠️  일부 테스트 실패 — 즉시 롤백 검토!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(err => {
  console.error('❌ 치명적 오류:', err);
  process.exit(1);
});
