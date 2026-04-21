/**
 * earlybird/counter 초기 문서 생성 스크립트
 *
 * Firestore에 earlybird/counter 문서를 Admin SDK로 생성.
 * 이 문서가 없으면 EarlyBirdBanner가 fallback 경로로 동작하고
 * 보안 테스트 D4가 404로 실패한다.
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

async function main() {
  console.log(`\n🔧 Project: ${PROJECT_ID}`);
  console.log('🔐 Admin token 획득...\n');
  const adminToken = await getAdminToken();

  const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

  // 1. 기존 문서 확인
  console.log('📌 기존 earlybird/counter 확인...');
  const checkRes = await fetch(`${BASE}/earlybird/counter`, {
    headers: { 'Authorization': `Bearer ${adminToken}` },
  });

  if (checkRes.status === 200) {
    const existing = await checkRes.json();
    console.log('ℹ️  이미 존재합니다:');
    console.log(JSON.stringify(existing.fields, null, 2));
    console.log('\n⚠️  기존 문서를 덮어쓰지 않습니다. 종료.');
    return;
  }

  // 2. 문서 생성
  console.log('📝 earlybird/counter 생성 중...');
  const fields = {
    count: { integerValue: '0' },
    capacity: { integerValue: '100' },
    startDate: { stringValue: '2026-04-01' },
    endDate: { stringValue: '2026-12-31' },
    updatedAt: { timestampValue: new Date().toISOString() },
  };

  const updateMask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const createRes = await fetch(`${BASE}/earlybird/counter?${updateMask}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });

  if (createRes.status === 200) {
    console.log('✅ earlybird/counter 문서 생성 완료!');
    const created = await createRes.json();
    console.log(JSON.stringify(created.fields, null, 2));
  } else {
    const errBody = await createRes.text();
    console.error(`❌ 생성 실패: HTTP ${createRes.status}`);
    console.error(errBody);
  }

  // 3. 비인증 read 검증
  console.log('\n🔍 비인증 read 검증...');
  const pubRes = await fetch(`${BASE}/earlybird/counter`);
  console.log(`   → HTTP ${pubRes.status} (200이면 공개 읽기 성공)`);

  if (pubRes.status === 200) {
    console.log('\n🎉 earlybird/counter 생성 및 공개 읽기 검증 완료!');
  } else {
    console.log('\n⚠️  공개 읽기 실패 — firestore.rules 확인 필요');
  }
}

main().catch(err => {
  console.error('❌ 치명적 오류:', err);
  process.exit(1);
});
