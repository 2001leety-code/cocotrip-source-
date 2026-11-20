#!/usr/bin/env node
/**
 * 자동 검사(GitHub Actions) 전용 계정 준비 + 운영자 관리자 계정 비밀번호 로그인 끊기 (2026-11-21).
 *
 * 왜: 자동 검사가 운영자 관리자 계정의 이메일·비밀번호(GitHub secrets)로 로그인했다. 그 비밀번호가
 *   살아 있는 한 관리자 계정을 2단계 인증만으로 지킬 수 없다. 그래서 검사는 맞춤 권한
 *   roles:['health-check'] 만 가진 테스트 계정으로 옮기고(api/_shared/user-auth.js HEALTH_CHECK_ROLE),
 *   관리자 계정에서는 비밀번호 로그인 연결을 뗀다(구글 로그인만 남김).
 *
 * 운영자 PC 에서만 실행 (서비스 계정 키 필요: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).
 * 기본은 "보기만"(아무것도 안 바꿈). 바꾸려면 --apply.
 *
 *   node --env-file=<운영자 env 파일> scripts/provision-health-check-account.mjs <테스트계정 이메일>
 *   node --env-file=<운영자 env 파일> scripts/provision-health-check-account.mjs <테스트계정 이메일> --apply
 *     → 맞춤 권한 = 정확히 { roles: ['health-check'] }, 이메일 확인됨 = true.
 *       운영자 계정·관리자 권한(admin:true, super-admin)이 있는 계정이면 거부.
 *
 *   node --env-file=<운영자 env 파일> scripts/provision-health-check-account.mjs --unlink-password <관리자 이메일>
 *   node --env-file=<운영자 env 파일> scripts/provision-health-check-account.mjs --unlink-password <관리자 이메일> --apply
 *     → 그 계정 하나에서만 비밀번호 로그인 연결을 뗀다. 구글 로그인이 붙어 있지 않으면 거부(잠김 방지).
 *       ⚠️ Firebase 콘솔의 "이메일/비밀번호" 로그인 방식 자체를 끄면 안 된다 — 테스트 계정도 같이 죽는다.
 *
 * 비밀번호는 이 스크립트가 다루지 않는다(콘솔에서 운영자가 정함). 출력에도 안 나온다.
 */
import { pathToFileURL } from 'node:url';
import { HARDCODED_OPERATOR_EMAILS } from '../api/_shared/admin-bypass-detector.js';

export const HEALTH_CHECK_CLAIMS = Object.freeze({ roles: ['health-check'] });

const norm = (e) => String(e || '').toLowerCase().trim();

/** 운영자 계정으로 취급할 이메일 — 하드코딩 운영자 + ADMIN_EMAIL + ADMIN_BYPASS_EMAILS. */
export function operatorEmails(env = process.env) {
  const list = [...HARDCODED_OPERATOR_EMAILS, env.ADMIN_EMAIL, env.VITE_ADMIN_EMAIL,
    ...String(env.ADMIN_BYPASS_EMAILS || '').split(',')];
  return [...new Set(list.map(norm).filter(Boolean))];
}

const providerIds = (user) => (Array.isArray(user?.providerData) ? user.providerData.map((p) => p && p.providerId) : []);

/**
 * 테스트 계정에 맞춤 권한을 줘도 되는지.
 * @param {{ email: string, providerData?: {providerId:string}[], customClaims?: object }} user — getUserByEmail 결과
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkProvisionTarget(user, opEmails) {
  const email = norm(user?.email);
  if (!email) return { ok: false, reason: '계정에 이메일이 없음' };
  if (opEmails.includes(email)) return { ok: false, reason: '운영자 계정에는 자동 검사 역할을 주지 않는다' };
  if (!providerIds(user).includes('password')) {
    return { ok: false, reason: '비밀번호 로그인이 없는 계정 — 자동 검사는 이메일+비밀번호로 로그인한다' };
  }
  const claims = user.customClaims || {};
  if (claims.admin === true) return { ok: false, reason: '이미 admin:true 인 계정 — 관리자 권한을 내리는 일은 이 스크립트가 하지 않는다' };
  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  const otherRoles = roles.filter((r) => r !== 'health-check');
  if (otherRoles.length) return { ok: false, reason: `다른 역할이 있음(${otherRoles.join(',')}) — 전용 계정을 새로 만들 것` };
  const otherKeys = Object.keys(claims).filter((k) => k !== 'roles' && k !== 'admin');
  if (otherKeys.length) return { ok: false, reason: `다른 맞춤 권한이 있음(${otherKeys.join(',')}) — 전용 계정을 새로 만들 것` };
  return { ok: true };
}

/**
 * 관리자 계정에서 비밀번호 로그인을 떼도 되는지 (구글 로그인이 남아야 함).
 * @returns {{ ok: true } | { ok: false, reason: string, done?: boolean }}
 */
export function checkUnlinkTarget(user) {
  const ids = providerIds(user);
  if (!ids.includes('google.com')) return { ok: false, reason: '구글 로그인이 연결돼 있지 않음 — 떼면 계정이 잠긴다' };
  if (!ids.includes('password')) return { ok: false, done: true, reason: '이미 비밀번호 로그인이 없음' };
  return { ok: true };
}

function bootstrap(initializeApp, getApps, cert) {
  if (getApps().length) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    console.error('FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY 가 없음 (--env-file 로 넘길 것)');
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

function describe(user) {
  return `uid=${user.uid} providers=[${providerIds(user).join(',')}] emailVerified=${user.emailVerified} claims=${JSON.stringify(user.customClaims || {})}`;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const unlinkIdx = args.indexOf('--unlink-password');
  const email = unlinkIdx >= 0 ? args[unlinkIdx + 1] : args.find((a) => !a.startsWith('--'));
  if (!email || email.startsWith('--')) {
    console.error('사용법: provision-health-check-account.mjs <테스트계정 이메일> [--apply]');
    console.error('       provision-health-check-account.mjs --unlink-password <관리자 이메일> [--apply]');
    process.exit(1);
  }

  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  bootstrap(initializeApp, getApps, cert);
  const auth = getAuth();
  const user = await auth.getUserByEmail(norm(email));
  console.log('지금:', describe(user));

  if (unlinkIdx >= 0) {
    const check = checkUnlinkTarget(user);
    if (!check.ok) { console.log(check.done ? `할 일 없음 — ${check.reason}` : `거부 — ${check.reason}`); process.exit(check.done ? 0 : 1); }
    if (!apply) { console.log('보기만 — 바꾸려면 --apply. 바꾸면 이 계정은 구글 로그인만 남는다.'); return; }
    await auth.updateUser(user.uid, { providersToUnlink: ['password'] });
    const after = await auth.getUser(user.uid);
    console.log('바뀐 뒤:', describe(after));
    if (providerIds(after).includes('password')) { console.error('❌ 비밀번호 로그인이 아직 남아 있음'); process.exit(1); }
    console.log('✅ 비밀번호 로그인 연결 끊음. 다음: 구글 계정 2단계 인증 켜기.');
    return;
  }

  const check = checkProvisionTarget(user, operatorEmails());
  if (!check.ok) { console.error(`거부 — ${check.reason}`); process.exit(1); }
  if (!apply) { console.log(`보기만 — 바꾸려면 --apply. 바꾸면 claims=${JSON.stringify(HEALTH_CHECK_CLAIMS)}, emailVerified=true.`); return; }
  await auth.setCustomUserClaims(user.uid, { ...HEALTH_CHECK_CLAIMS });
  if (user.emailVerified !== true) await auth.updateUser(user.uid, { emailVerified: true });
  const after = await auth.getUser(user.uid);
  console.log('바뀐 뒤:', describe(after));
  console.log('✅ 자동 검사 계정 준비 끝. 다음: GitHub secrets HEALTH_CHECK_EMAIL / HEALTH_CHECK_PASSWORD 를 이 계정 값으로.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error('실패:', e.code || e.message); process.exit(1); });
}
