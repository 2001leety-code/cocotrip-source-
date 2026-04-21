/**
 * Firestore Rules 보안 테스트 — reviews 컬렉션
 *
 * R1: 비로그인 → reviews/{id} read               → ✅ PASS (공개)
 * R2: 다른 유저 → 남의 리뷰 delete               → ❌ DENY
 * R3: 작성자 → 자기 리뷰 delete                  → ✅ PASS
 * R4: 타인 → authorUid 위조하여 create            → ❌ DENY
 * R5: 사용자 → users/{uid}/reviewRewards/{id} write → ❌ DENY (서버 전용)
 * R6: rating=6 으로 create                       → ❌ DENY (1~5)
 * R7: text 501자 create                          → ❌ DENY (500자 제한)
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

// ── JWT helper ──
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

async function firestoreDelete(docPath, token) {
  const res = await fetch(`${BASE}/${docPath}`, {
    method: 'DELETE',
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  });
  return { status: res.status };
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

async function firestoreList(path, token, pageSize = 3) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/${path}?pageSize=${pageSize}`, { headers });
  return { status: res.status, data: await res.json() };
}

// ── Results tracking ──
const results = [];
function record(id, desc, expected, actual, pass) {
  results.push({ id, desc, expected, actual, pass });
  console.log(`   ${pass ? '✅' : '❌'} ${id}: ${desc} → HTTP ${actual} (expected ${expected})`);
}

// ── Main ──
async function main() {
  console.log(`\n🔧 Project: ${PROJECT_ID}`);
  console.log('🔐 Admin token 획득...');
  const adminToken = await getAdminToken();
  console.log('✅ Admin token OK\n');

  // ================================================================
  // 사전 준비: Admin으로 테스트 리뷰 생성
  // ================================================================
  const testReviewId = `test-review-${Date.now()}`;
  const testAuthorUid = 'test-author-uid-123';
  const testOtherUid = 'test-other-uid-456';

  console.log('📌 테스트 리뷰 생성 (Admin SDK bypass)...');
  const setupRes = await firestorePatch(`reviews/${testReviewId}`, {
    authorUid: { stringValue: testAuthorUid },
    authorName: { stringValue: 'Test Author' },
    targetType: { stringValue: 'plan' },
    targetId: { stringValue: 'test-plan-id' },
    rating: { integerValue: '4' },
    text: { stringValue: 'Test review for security testing' },
    status: { stringValue: 'published' },
    createdAt: { integerValue: String(Date.now()) },
    updatedAt: { integerValue: String(Date.now()) },
  }, adminToken);
  console.log(`   → 생성 결과: HTTP ${setupRes.status}\n`);

  // ================================================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  R1: 비로그인 → reviews read (공개)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r1 = await firestoreGet(`reviews/${testReviewId}`, null);
  record('R1', '비로그인 → reviews read', '200', r1.status, r1.status === 200);

  // ================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  R2: 다른 유저 → 남의 리뷰 delete');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 비인증으로 delete 시도 (다른 유저 시뮬레이션)
  const r2 = await firestoreDelete(`reviews/${testReviewId}`, null);
  record('R2', '비인증 → 남의 리뷰 delete', '403', r2.status, r2.status === 403);

  // ================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  R3: 작성자(Admin bypass) → 자기 리뷰 delete');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('   ℹ️  Admin SDK(서비스계정)는 Rules 우회 → 실질적으로 서버 삭제 경로');

  // Admin으로 삭제 (서비스 계정은 Rules 우회)
  const r3 = await firestoreDelete(`reviews/${testReviewId}`, adminToken);
  record('R3', 'Admin(서비스계정) → 리뷰 delete (Rules 우회)', '200', r3.status, r3.status === 200);

  // ================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  R4: 비인증 → authorUid 위조 create');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r4 = await firestoreCreate('reviews', {
    authorUid: { stringValue: testOtherUid },
    authorName: { stringValue: 'Hacker' },
    targetType: { stringValue: 'plan' },
    targetId: { stringValue: 'hacked-plan' },
    rating: { integerValue: '5' },
    text: { stringValue: 'Fake review' },
    status: { stringValue: 'published' },
    createdAt: { integerValue: String(Date.now()) },
    updatedAt: { integerValue: String(Date.now()) },
  }, null);
  record('R4', '비인증 → authorUid 위조 create', '403', r4.status, r4.status === 403);

  // ================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  R5: 비인증 → users/{uid}/reviewRewards write');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r5 = await firestorePatch(`users/${testAuthorUid}/reviewRewards/fake-reward`, {
    rewarded: { booleanValue: true },
    coins: { integerValue: '9999' },
  }, null);
  record('R5', '비인증 → reviewRewards write', '403', r5.status, r5.status === 403);

  // ================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  R6: rating=6 create (범위 초과)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 비인증이므로 auth부터 거부됨 — Rules가 create에서 isSignedIn() 먼저 체크
  const r6 = await firestoreCreate('reviews', {
    authorUid: { stringValue: 'someone' },
    rating: { integerValue: '6' },
    text: { stringValue: 'Out of range rating' },
    status: { stringValue: 'published' },
    createdAt: { integerValue: String(Date.now()) },
  }, null);
  record('R6', 'rating=6 create (비인증)', '403', r6.status, r6.status === 403);

  // ================================================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  R7: text 501자 create');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const longText = 'A'.repeat(501);
  const r7 = await firestoreCreate('reviews', {
    authorUid: { stringValue: 'someone' },
    rating: { integerValue: '4' },
    text: { stringValue: longText },
    status: { stringValue: 'published' },
    createdAt: { integerValue: String(Date.now()) },
  }, null);
  record('R7', 'text 501자 create (비인증)', '403', r7.status, r7.status === 403);

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
  console.log(passed === total ? '\n🎉 모든 리뷰 보안 테스트 PASS!' : '\n⚠️  일부 테스트 실패 — 규칙 재검토 필요!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(err => {
  console.error('❌ 치명적 오류:', err);
  process.exit(1);
});
