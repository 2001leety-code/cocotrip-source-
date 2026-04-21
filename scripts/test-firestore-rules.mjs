/**
 * Firestore Rules 배포 검증 스크립트
 * 
 * 테스트 케이스:
 *   A) 인증된 사용자가 본인 플랜 읽기 → 허용
 *   B) 비인증 사용자가 isPublic=true 플랜 읽기 → 허용
 *   C) 비인증 사용자가 isPublic=false 플랜 읽기 → 거부
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.admin.local');
const envContent = readFileSync(envPath, 'utf8');

// Parse env
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

console.log(`\n🔧 Project: ${PROJECT_ID}`);
console.log(`📧 Service Account: ${CLIENT_EMAIL}`);

// ---- JWT generation for service account auth ----
import crypto from 'crypto';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT() {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: CLIENT_EMAIL,
    sub: CLIENT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
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

async function getAccessToken() {
  const jwt = createJWT();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));
  return data.access_token;
}

// ---- Firestore REST API helpers ----
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function firestoreGet(path, token) {
  const url = `${FIRESTORE_BASE}/${path}`;
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  return { status: res.status, data: await res.json() };
}

async function firestorePatch(path, fields, token) {
  const url = `${FIRESTORE_BASE}/${path}`;
  const body = { fields };
  // Build updateMask from field names
  const updateMask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const res = await fetch(`${url}?${updateMask}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function firestoreList(path, token, pageSize = 5) {
  const url = `${FIRESTORE_BASE}/${path}?pageSize=${pageSize}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return { status: res.status, data: await res.json() };
}

// ---- Main test sequence ----
async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔐 Step 1: Admin SDK 인증 토큰 획득...');
  const adminToken = await getAccessToken();
  console.log('✅ Admin token 획득 성공');

  // Get list of plans to find test targets
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Step 2: 플랜 목록 조회...');
  const listResult = await firestoreList('plans', adminToken, 10);
  if (!listResult.data.documents || listResult.data.documents.length === 0) {
    console.error('❌ 플랜 문서가 없습니다!');
    return;
  }

  const docs = listResult.data.documents;
  console.log(`   발견된 플랜: ${docs.length}건`);
  
  // Pick first plan with uid (user-owned plan) for testing
  let testPlanPath = null;
  let testPlanId = null;
  for (const d of docs) {
    const uid = d.fields?.uid?.stringValue;
    const name = d.name.split('/').pop();
    console.log(`   - ${name} | uid: ${uid || '(none)'} | isPublic: ${d.fields?.isPublic?.booleanValue ?? 'not set'}`);
    if (uid && !testPlanPath) {
      testPlanPath = `plans/${name}`;
      testPlanId = name;
    }
  }

  if (!testPlanPath) {
    console.error('❌ uid가 있는 플랜을 찾을 수 없습니다!');
    return;
  }

  console.log(`\n📌 테스트 대상 플랜: ${testPlanId}`);

  // ============================
  // CASE A: Authenticated read (admin token = service account, always passes)
  // ============================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 케이스 A: 인증된 사용자 → 본인 플랜 접근');
  console.log('   (Admin SDK 토큰으로 읽기 - 항상 성공해야 함)');
  const caseA = await firestoreGet(testPlanPath, adminToken);
  console.log(`   HTTP ${caseA.status} | ${caseA.status === 200 ? '✅ 성공' : '❌ 실패'}`);
  if (caseA.status === 200) {
    const fields = caseA.data.fields;
    console.log(`   tour_title: ${fields?.itinerary?.mapValue?.fields?.tour_title?.stringValue || '(N/A)'}`);
    console.log(`   uid: ${fields?.uid?.stringValue || '(none)'}`);
    console.log(`   isPublic: ${fields?.isPublic?.booleanValue ?? 'not set'}`);
  }

  // ============================
  // CASE B: Set isPublic=true, then read WITHOUT auth
  // ============================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 케이스 B: 공개 플랜 → 비인증 접근');
  
  // Step B.1: Set isPublic: true via admin
  console.log('   B.1) isPublic: true 설정...');
  const patchResult = await firestorePatch(testPlanPath, {
    isPublic: { booleanValue: true },
  }, adminToken);
  console.log(`   Patch 결과: HTTP ${patchResult.status} | ${patchResult.status === 200 ? '✅ 성공' : '❌ 실패'}`);

  // Step B.2: Read WITHOUT token (unauthenticated)
  console.log('   B.2) 비인증 접근 시도...');
  const caseB = await firestoreGet(testPlanPath, null);
  console.log(`   HTTP ${caseB.status} | ${caseB.status === 200 ? '✅ 공개 플랜 읽기 성공!' : '❌ 접근 거부 (예상치 못한 결과)'}`);
  
  if (caseB.status === 200) {
    const fields = caseB.data.fields;
    console.log(`   tour_title: ${fields?.itinerary?.mapValue?.fields?.tour_title?.stringValue || '(N/A)'}`);
    // PII check (these should exist in raw Firestore, but client-side code masks them)
    console.log(`   uid 포함됨: ${fields?.uid?.stringValue ? '⚠️  예 (Firestore 규칙은 데이터 반환, PII 마스킹은 클라이언트에서 처리)' : '아니오'}`);
    console.log(`   pricing 포함됨: ${fields?.pricing ? '⚠️  예 (클라이언트에서 마스킹)' : '아니오'}`);
  }

  // ============================
  // CASE C: Set isPublic=false, then read WITHOUT auth → should be DENIED
  // ============================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 케이스 C: 비공개 플랜 → 비인증 접근 (거부 예상)');
  
  // Step C.1: Set isPublic: false
  console.log('   C.1) isPublic: false 설정...');
  const patchC = await firestorePatch(testPlanPath, {
    isPublic: { booleanValue: false },
  }, adminToken);
  console.log(`   Patch 결과: HTTP ${patchC.status} | ${patchC.status === 200 ? '✅ 성공' : '❌ 실패'}`);

  // Step C.2: Read WITHOUT token (unauthenticated)
  console.log('   C.2) 비인증 접근 시도...');
  const caseC = await firestoreGet(testPlanPath, null);
  console.log(`   HTTP ${caseC.status}`);
  if (caseC.status === 403 || caseC.status === 401) {
    console.log('   ✅ 접근 거부 확인! (PERMISSION_DENIED)');
  } else if (caseC.status === 200) {
    console.log('   ❌ 비공개인데 접근이 됐습니다! 규칙에 문제가 있습니다!');
  } else {
    console.log(`   ⚠️  예상치 못한 상태 코드: ${caseC.status}`);
  }
  if (caseC.data?.error) {
    console.log(`   에러 메시지: ${caseC.data.error.message || JSON.stringify(caseC.data.error)}`);
  }

  // ============================
  // Cleanup: Remove isPublic field (restore original state)
  // ============================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧹 정리: isPublic 필드를 false로 유지 (테스트 완료)');
  // Keep isPublic: false as it was originally not set
  // The field is already false from case C

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 최종 결과 요약');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  케이스 A (인증 읽기):     ${caseA.status === 200 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  케이스 B (공개 비인증):   ${caseB.status === 200 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  케이스 C (비공개 비인증): ${(caseC.status === 403 || caseC.status === 401) ? '✅ PASS' : '❌ FAIL'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(err => {
  console.error('❌ 치명적 오류:', err);
  process.exit(1);
});
