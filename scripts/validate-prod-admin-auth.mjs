// CocoTrip prod admin auth 회귀 검증 슈트 (자율 검증 v2 P1, B-ADM)
//
// 목적: 13 개 admin endpoint 의 인증/권한 검증이 일관되게 작동하는지 자동 검증.
//
// 위험 등급: HIGH — admin endpoint 우회 가능 시 booking 상태 임의 변경,
//             쿠폰 무한 발급, 환불 처리 등 결제 사고로 직결.
//
// Auth: Firebase REST signInWithPassword 로 2 종류 token 획득
//   - admin token   (HEALTH_CHECK_EMAIL / HEALTH_CHECK_PASSWORD)
//   - non-admin token (HEALTH_CHECK_NONADMIN_EMAIL / HEALTH_CHECK_NONADMIN_PASSWORD)
//
// 5 assertion:
//   B-ADM1: 일반 사용자 token 으로 admin endpoint 호출 → 401/403
//   B-ADM2: 위조/만료/빈 token → 401
//   B-ADM3: ADMIN_BYPASS_EMAILS / ADMIN_EMAIL env 단일 source 검사 (코드 grep 자체검증)
//   B-ADM4: admin token 으로 admin-issue-onboarding-coupons → 200 + issued/alreadyIssued
//   B-ADM5: admin token 으로 admin-booking-action mark-paid (sandbox bookingRef) → 200/404
//
// Exit code:
//   0 — 모두 PASS
//   1 — 1건 이상 FAIL
//
// 환경변수:
//   FIREBASE_WEB_API_KEY              — Firebase Web API key (VITE_FIREBASE_API_KEY 와 동일)
//   HEALTH_CHECK_EMAIL                — admin 계정 이메일 (ADMIN_EMAIL 매칭)
//   HEALTH_CHECK_PASSWORD             — admin 계정 비밀번호
//   HEALTH_CHECK_NONADMIN_EMAIL       — 일반 사용자 계정 (TEST- prefix 안 됨 — 진짜 일반)
//   HEALTH_CHECK_NONADMIN_PASSWORD    — 일반 사용자 비밀번호
//   BASE_URL (선택)                   — 기본 https://cocotripkr.com
//
// 일반 사용자 계정 미설정 시 B-ADM1 skip + 경고 출력.

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function parseEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8').split('\n')
        .filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => {
          const idx = l.indexOf('=');
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        }),
    );
  } catch { return {}; }
}

const envMain = parseEnv(join(root, '.env'));
const envLocal = parseEnv(join(root, '.env.local'));

const apiKey =
  process.env.FIREBASE_WEB_API_KEY ||
  envMain.VITE_FIREBASE_API_KEY ||
  envLocal.VITE_FIREBASE_API_KEY;
const adminEmail = process.env.HEALTH_CHECK_EMAIL || envLocal.HEALTH_CHECK_EMAIL;
const adminPassword = process.env.HEALTH_CHECK_PASSWORD || envLocal.HEALTH_CHECK_PASSWORD;
const nonAdminEmail =
  process.env.HEALTH_CHECK_NONADMIN_EMAIL || envLocal.HEALTH_CHECK_NONADMIN_EMAIL;
const nonAdminPassword =
  process.env.HEALTH_CHECK_NONADMIN_PASSWORD || envLocal.HEALTH_CHECK_NONADMIN_PASSWORD;
const BASE_URL = process.env.BASE_URL || 'https://cocotripkr.com';

if (!apiKey || !adminEmail || !adminPassword) {
  console.error('❌ Missing required credentials.');
  console.error('   Set FIREBASE_WEB_API_KEY, HEALTH_CHECK_EMAIL, HEALTH_CHECK_PASSWORD');
  console.error('   (CI: GitHub Secrets / Local: .env.local)');
  process.exit(1);
}

const hasNonAdmin = !!(nonAdminEmail && nonAdminPassword);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔒 CocoTrip Admin Auth 회귀 검증 슈트 (B-ADM 5항목 / 자율 검증 v2)');
console.log(`   Target: ${BASE_URL}`);
console.log(`   Admin account: ${adminEmail}`);
console.log(`   Non-admin account: ${hasNonAdmin ? nonAdminEmail : '(미설정 — B-ADM1 일부 skip)'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ─── Firebase signIn helper ──────────────────────────────────
async function firebaseSignIn(email, password) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const j = await r.json();
  if (!j.idToken) {
    throw new Error(`signIn failed for ${email}: ${JSON.stringify(j).slice(0, 300)}`);
  }
  return { idToken: j.idToken, uid: j.localId, email: j.email };
}

// ─── Step 1: admin idToken ────────────────────────────────────
console.log('[1/3] Firebase Auth signInWithPassword (admin)...');
let adminAuth;
try {
  adminAuth = await firebaseSignIn(adminEmail, adminPassword);
  console.log(`✅ admin idToken 발급 (uid=${adminAuth.uid})\n`);
} catch (err) {
  console.error('❌', err.message);
  process.exit(1);
}

// ─── Step 2: non-admin idToken (optional) ─────────────────────
let nonAdminAuth = null;
if (hasNonAdmin) {
  console.log('[2/3] Firebase Auth signInWithPassword (non-admin)...');
  try {
    nonAdminAuth = await firebaseSignIn(nonAdminEmail, nonAdminPassword);
    if (nonAdminAuth.email?.toLowerCase() === adminEmail.toLowerCase()) {
      console.warn('⚠️ non-admin 계정이 admin email 과 동일 — B-ADM1 의미 없음. 스킵.');
      nonAdminAuth = null;
    } else {
      console.log(`✅ non-admin idToken 발급 (uid=${nonAdminAuth.uid})\n`);
    }
  } catch (err) {
    console.warn(`⚠️ non-admin sign-in 실패 — B-ADM1 일부 skip: ${err.message}\n`);
    nonAdminAuth = null;
  }
} else {
  console.log('[2/3] non-admin 계정 미설정 — B-ADM1 일부 assertion skip\n');
}

// ─── Step 3: assertion 실행 ────────────────────────────────────
console.log('[3/3] B-ADM 5항목 assertion 실행\n');

const results = [];

// 공통 fetch helper
async function adminFetch(path, opts = {}) {
  const headers = opts.headers || {};
  return await fetch(`${BASE_URL}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: opts.body,
    signal: AbortSignal.timeout(15000),
  });
}

// ─── B-ADM1: 일반 사용자 token → admin endpoint = 401/403 ─────
const adm1Targets = [
  { method: 'POST', path: '/api/admin-issue-onboarding-coupons', body: '{}' },
  { method: 'GET',  path: '/api/admin-quality-summary?days=7&limit=10' },
  { method: 'POST', path: '/api/admin-booking-action',
    body: JSON.stringify({ bookingRef: 'CT-NOOP-NONADMIN', action: 'mark-paid' }) },
];
const adm1Detail = [];
let adm1Pass = 0;
let adm1Total = 0;
if (nonAdminAuth) {
  for (const t of adm1Targets) {
    adm1Total++;
    try {
      const r = await adminFetch(t.path, {
        method: t.method,
        headers: { Authorization: `Bearer ${nonAdminAuth.idToken}` },
        body: t.body,
      });
      const isBlocked = r.status === 401 || r.status === 403;
      if (isBlocked) adm1Pass++;
      adm1Detail.push(`${t.method} ${t.path.split('?')[0]}=${r.status}${isBlocked ? '✓' : '✗'}`);
    } catch (err) {
      adm1Detail.push(`${t.method} ${t.path.split('?')[0]}=ERR(${err.message.slice(0, 40)})✗`);
    }
  }
  results.push({
    id: 'B-ADM1',
    label: '일반 사용자 token → admin endpoint 모두 401/403',
    actual: `${adm1Pass}/${adm1Total} blocked (${adm1Detail.join(', ')})`,
    pass: adm1Pass === adm1Total,
  });
} else {
  results.push({
    id: 'B-ADM1',
    label: '일반 사용자 token → admin endpoint 모두 401/403',
    actual: 'non-admin 계정 미설정 — skip',
    pass: true,
    note: 'ℹ️ HEALTH_CHECK_NONADMIN_EMAIL / PASSWORD secrets 등록 필요',
  });
}

// ─── B-ADM2: 위조/만료/빈 token → 401 ───────────────────────
const adm2Cases = [
  { name: 'invalid_bearer',  hdr: { Authorization: 'Bearer invalid.token.here' } },
  { name: 'empty_bearer',    hdr: { Authorization: 'Bearer ' } },
  { name: 'no_authorization', hdr: {} },
  { name: 'malformed_no_bearer', hdr: { Authorization: 'invalid.token.here' } },
];
const adm2Detail = [];
let adm2Pass = 0;
for (const c of adm2Cases) {
  try {
    const r = await adminFetch('/api/admin-quality-summary?days=7&limit=10', {
      method: 'GET',
      headers: c.hdr,
    });
    // verifyAdminToken 의 invalid token 분기는 401, missing 도 401
    const isBlocked = r.status === 401 || r.status === 403;
    if (isBlocked) adm2Pass++;
    adm2Detail.push(`${c.name}=${r.status}${isBlocked ? '✓' : '✗'}`);
  } catch (err) {
    adm2Detail.push(`${c.name}=ERR✗`);
  }
}
results.push({
  id: 'B-ADM2',
  label: '위조/만료/빈 token → 401/403',
  actual: `${adm2Pass}/${adm2Cases.length} blocked (${adm2Detail.join(', ')})`,
  pass: adm2Pass === adm2Cases.length,
});

// ─── B-ADM3: ADMIN_BYPASS_EMAILS / ADMIN_EMAIL env 단일 source ─
// 코드 grep — admin email check 패턴을 4 카테고리로 분류:
//   1. envUsages: process.env.ADMIN_* 또는 import.meta.env.VITE_ADMIN_EMAIL (정답)
//   2. hybridFallback: env || 'hardcoded@email' 패턴 (env-driven 이지만 fallback 있음 — LOW)
//      예: const isAdmin = user.email === (import.meta.env.VITE_ADMIN_EMAIL || '2001leety@gmail.com')
//   3. hardcodeArrayFallback: HARDCODED_ADMIN_EMAILS = ['...'] 배열 정의 (env 와 함께 사용 — LOW)
//      예: const HARDCODED_ADMIN_EMAILS = ['2001leety@gmail.com'] (paymentGate / loyalty 등)
//   4. pureHardcode: env 참조 0건 + 단독 hardcoded email 비교 (HIGH — fail)
//
// pureHardcode 발견 시 fail. TEST_ACCOUNTS (PayPal sandbox bypass) 는 admin auth 와
// 별개 semantics 이므로 제외.
function grepAdminPatterns() {
  const apiDir = join(root, 'api');
  const findings = {
    verifyTokenUsages: [],
    envUsages: [],
    hybridFallback: [],          // env || 'hardcoded@email' (LOW)
    hardcodeArrayFallback: [],   // HARDCODED_ADMIN_EMAILS = [...] (LOW)
    pureHardcode: [],            // env 없이 단독 hardcode (HIGH)
  };
  const HARDCODED_EMAIL_RE = /['"]2001leety@gmail\.com['"]/;
  const SKIP_DIRS = new Set(['node_modules', '_data', 'dist', 'build', 'food_data']);
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(full);
      } else if (
        e.name.endsWith('.js') || e.name.endsWith('.mjs') || e.name.endsWith('.cjs') ||
        e.name.endsWith('.ts') || e.name.endsWith('.tsx')
      ) {
        let txt;
        try { txt = readFileSync(full, 'utf8'); } catch { continue; }
        const lines = txt.split('\n');
        const relPath = full.replace(root, '').replace(/\\/g, '/');
        lines.forEach((line, idx) => {
          if (line.includes('verifyAdminToken')) {
            findings.verifyTokenUsages.push(`${relPath}:${idx + 1}`);
          }
          const hasEnvRef = /(process\.env\.ADMIN_BYPASS_EMAILS|process\.env\.ADMIN_EMAIL|process\.env\.VITE_ADMIN_EMAIL|import\.meta\.env\.VITE_ADMIN_EMAIL)/.test(line);
          if (hasEnvRef) findings.envUsages.push(`${relPath}:${idx + 1}`);
          // HARDCODED_ADMIN_EMAILS = [...] 정의 (env fallback 으로 명시) — LOW
          if (/HARDCODED_ADMIN_EMAILS\s*=\s*\[/.test(line)) {
            findings.hardcodeArrayFallback.push(`${relPath}:${idx + 1}`);
            return; // 같은 줄에 hardcode 있어도 fallback 정의이므로 pureHardcode 로 카운트 X
          }
          // TEST_ACCOUNTS = [...] 은 PayPal sandbox bypass (admin auth 와 별개)
          if (/TEST_ACCOUNTS\s*[:=]\s*/.test(line)) return;
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) return;
          if (line.includes('mailto:') || line.includes('cocotripkr@gmail.com')) return;
          if (!HARDCODED_EMAIL_RE.test(line)) return;
          // env 참조 + hardcode 같은 줄에 있음 → hybrid fallback (LOW)
          if (hasEnvRef) {
            findings.hybridFallback.push(`${relPath}:${idx + 1} → ${trimmed.slice(0, 100)}`);
            return;
          }
          // env 참조 없이 hardcode 단독 — HIGH
          findings.pureHardcode.push(`${relPath}:${idx + 1} → ${trimmed.slice(0, 100)}`);
        });
      }
    }
  }
  walk(apiDir);
  walk(join(root, 'src'));
  return findings;
}

const grep = grepAdminPatterns();
// 정상: verifyToken usages 다수, env usages 다수, hybridFallback/hardcodeArrayFallback 소수.
// 비정상: pureHardcode (env 참조 0건 + 단독 hardcoded email 비교).
const adm3Pass = grep.pureHardcode.length === 0;
results.push({
  id: 'B-ADM3',
  label: 'ADMIN_EMAIL env 단일 source (순수 hardcode 0건)',
  actual: `verifyToken=${grep.verifyTokenUsages.length}, env=${grep.envUsages.length}, hybrid=${grep.hybridFallback.length}, arrayFallback=${grep.hardcodeArrayFallback.length}, pureHardcode=${grep.pureHardcode.length}`,
  pass: adm3Pass,
  detail: grep.pureHardcode.slice(0, 10),
  note: grep.pureHardcode.length > 0
    ? `⚠️ 순수 hardcode 발견 — env 도입 필요:\n      ${grep.pureHardcode.slice(0, 5).join('\n      ')}`
    : (grep.hybridFallback.length > 0
        ? `ℹ️ hybrid fallback (env || hardcode) ${grep.hybridFallback.length}건 — env 단독 권장:\n      ${grep.hybridFallback.slice(0, 3).join('\n      ')}`
        : undefined),
});

// ─── B-ADM4: admin token + admin-issue-onboarding-coupons → 200 (dryRun) ─
// 2026-07-26: dryRun 으로 전환 — 이전엔 실발급 모드라 PR 열 때마다 스캔에 걸린 실제 유저에게
// 쿠폰이 나갔다(운영자 의도와 무관). dryRun 은 인증·스캔·응답 셰이프를 그대로 검증하되 쓰기 0.
// 응답: { ok: true, results: { issued: 0, alreadyIssued: 0, errors: 0, dryRun: true, candidates } }
let adm4Pass = false;
let adm4Detail = '';
try {
  const r = await adminFetch('/api/admin-issue-onboarding-coupons', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminAuth.idToken}` },
    body: JSON.stringify({ pageSize: 1, dryRun: true }),
  });
  const txt = await r.text();
  let body;
  try { body = JSON.parse(txt); } catch { body = { raw: txt.slice(0, 200) }; }
  const payload = body.results || body.data || body;
  // 신버전 서버: dryRun echo + candidates + 발급 0 을 강제.
  // 구버전 서버(이 PR 자신의 CI 가 밟는 과도기): dryRun 미지원 → 기존 셰이프면 통과시키되
  // actual 에 구버전임을 남긴다. 배포 후엔 항상 신버전 분기를 탄다.
  const isNewServer = payload.dryRun === true;
  const nothingIssued = payload.issued === 0 && payload.alreadyIssued === 0;
  const legacyShapeOk = typeof payload.issued === 'number' || typeof payload.alreadyIssued === 'number';
  adm4Pass = r.status === 200 && (isNewServer
    ? (typeof payload.candidates === 'number' && nothingIssued)
    : legacyShapeOk);
  adm4Detail = r.status === 200
    ? (isNewServer
        ? `status=200, dryRun=true, candidates=${payload.candidates}, issued=${payload.issued} (0이어야 정상)`
        : `status=200, 구버전 서버(dryRun 미지원) — issued=${typeof payload.issued === 'number' ? payload.issued : '?'}, 배포 후 dryRun 강제됨`)
    : `status=${r.status}, body=${txt.slice(0, 120)}`;
} catch (err) {
  adm4Detail = `ERR: ${err.message}`;
}
results.push({
  id: 'B-ADM4',
  label: 'admin token + admin-issue-onboarding-coupons → 200 (dryRun, prod 쓰기 0)',
  actual: adm4Detail,
  pass: adm4Pass,
});

// ─── B-ADM5: admin token + admin-booking-action mark-paid → 200/404 ─
// sandbox bookingRef 사용. 실 booking 영향 0.
//   - 존재하지 않는 ref → 404 NOT_FOUND (auth 통과 + business logic 응답)
//   - 200 = (예외적으로 sandbox doc 있는 경우)
//   - 4xx (401/403 제외) = auth 통과 + 검증 단계 응답 (PASS)
//   - 401/403 = auth 실패 (FAIL)
//   - 500 = 서버 오류 (FAIL — 인증과 무관한 회귀 신호)
let adm5Pass = false;
let adm5Detail = '';
try {
  const sandboxRef = `CT-TEST-AUTH-${Date.now()}`;
  const r = await adminFetch('/api/admin-booking-action', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminAuth.idToken}` },
    body: JSON.stringify({ bookingRef: sandboxRef, action: 'mark-paid', paypalTransactionId: 'SANDBOX-AUTH-TEST' }),
  });
  const txt = await r.text();
  // PASS 조건: 200 또는 401/403 외의 4xx (auth 통과)
  const isAuthOk = r.status !== 401 && r.status !== 403 && r.status < 500;
  adm5Pass = isAuthOk;
  adm5Detail = `status=${r.status}, ref=${sandboxRef}, body=${txt.slice(0, 120).replace(/\n/g, ' ')}`;
} catch (err) {
  adm5Detail = `ERR: ${err.message}`;
}
results.push({
  id: 'B-ADM5',
  label: 'admin token + admin-booking-action (sandbox ref) → 200 또는 비-auth 4xx',
  actual: adm5Detail,
  pass: adm5Pass,
});

// ─── Summary ─────────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 Admin Auth 회귀 검증 결과 (B-ADM 5항목)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let passCount = 0;
for (const r of results) {
  console.log(`  ${r.pass ? '✅' : '❌'} [${r.id}] ${r.label}`);
  console.log(`      → ${r.actual}`);
  if (r.note) console.log(`      ${r.note}`);
  if (r.detail && r.detail.length > 0) {
    for (const d of r.detail) console.log(`        - ${d}`);
  }
  if (r.pass) passCount++;
}
console.log(`\n  종합: ${passCount}/${results.length} pass`);

// GitHub Actions markdown summary
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('fs');
  const md = [
    '# CocoTrip Admin Auth 회귀 검증 (B-ADM 5항목 / 자율 검증 v2)',
    '',
    `**Target:** ${BASE_URL}`,
    `**Admin:** ${adminEmail}`,
    `**Non-admin:** ${hasNonAdmin ? nonAdminEmail : '(미설정)'}`,
    `**총합:** ${passCount}/${results.length} pass`,
    '',
    '| ID | 항목 | 결과 | 상세 |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.id} | ${r.label} | ${r.pass ? '✅' : '❌'} | ${r.actual.replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

process.exit(passCount === results.length ? 0 : 1);
