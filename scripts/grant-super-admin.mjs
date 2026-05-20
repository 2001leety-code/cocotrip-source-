#!/usr/bin/env node
/**
 * One-time bootstrap — 운영자 본인에게 super-admin custom claim 부여.
 *
 * P110 (2026-05-20) — 하드코드 admin email → custom claims 마이그 Phase 1.
 *
 * 사용법:
 *   node scripts/grant-super-admin.mjs <email>
 *   node scripts/grant-super-admin.mjs 2001leety@gmail.com
 *
 * 동작:
 *   1. Firebase Admin SDK 부트스트랩 (FIREBASE_PRIVATE_KEY env 필요).
 *   2. getUserByEmail(email) → uid 조회.
 *   3. setCustomUserClaims(uid, { admin: true, roles: ['super-admin'] }).
 *   4. 결과 출력 + ID token refresh 안내.
 *
 * 효과:
 *   - 다음 client refresh 후 user.getIdTokenResult().claims.admin === true.
 *   - 그 후 /api/admin-set-claims 호출로 다른 admin 추가/변경 가능.
 *   - firestore.rules / storage.rules 의 admin claim 분기 (운영자 별도 PR)
 *     활성화 시 admin: true 사용자가 권한 통과.
 *
 * 안전:
 *   - 운영 환경 변수 (.env) 의 FIREBASE_* 키 그대로 사용 → prod Firebase 프로젝트.
 *   - 기존 ADMIN_EMAIL allowlist 와 OR 조합으로 작동 — 이 스크립트 실행해도
 *     기존 운영자 권한 불변 (점진 마이그).
 *   - 1회 실행 후 재실행해도 idempotent (같은 claim 덮어쓰기).
 *
 * 회복:
 *   - claim 회수: node scripts/grant-super-admin.mjs <email> --revoke
 *     (옵션 — 이 스크립트는 grant 만; revoke 는 /api/admin-set-claims 권장)
 */
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function bootstrap() {
  if (getApps().length) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
  const privateKey = rawKey.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY');
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith('--'));
  if (!email) {
    console.error('Usage: node scripts/grant-super-admin.mjs <email>');
    process.exit(1);
  }

  bootstrap();
  const auth = getAuth();

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email.toLowerCase().trim());
  } catch (e) {
    console.error(`getUserByEmail failed: ${e.message}`);
    process.exit(1);
  }

  const newClaims = { admin: true, roles: ['super-admin'] };
  try {
    await auth.setCustomUserClaims(userRecord.uid, newClaims);
  } catch (e) {
    console.error(`setCustomUserClaims failed: ${e.message}`);
    process.exit(1);
  }

  console.log('Granted super-admin to:', userRecord.uid, '(', email, ')');
  console.log('Claims:', JSON.stringify(newClaims));
  console.log('Note: target user must call user.getIdToken(true) or wait ~1h for token refresh.');
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
