// CocoTrip prod Voucher 회귀 검증 슈트 — 자율 검증 v2 (P0 Voucher PDF)
// validate-prod-regression.mjs 의 voucher 도메인 확장. PR 머지 전
// 'ready-for-voucher-regression' 라벨로 trigger.
//
// 배경: voucher PDF 생성 실패 = 사용자 사후 신고 패턴. 자동 회귀로 잡혀야 함.
//
// 검증 항목 (3 assertion):
//   B-VCH1 — Voucher PDF 생성 가능 (blob ≥ 10KB, %PDF- magic, application/pdf)
//   B-VCH2 — Voucher 다국어 (4-lang) ?lang= 요청 모두 valid PDF 응답
//             (현재 voucher.js 는 lang 파라미터 무시 — Helvetica only. lang 추가돼도
//              endpoint resilience 확인 + 응답 시간 < 10s 4-lang 모두)
//   B-VCH3 — Voucher 공유 URL public access (auth header 없이 GET → 200,
//             email 매칭만으로 인증 통과 — PR #229 batch 2 정책)
//
// Exit code:
//   0 — 3/3 PASS (또는 sandbox 미설정 → graceful skip + 안내)
//   1 — 1건 이상 FAIL
//
// 환경변수 (GitHub Secrets 또는 .env.local):
//   FIREBASE_WEB_API_KEY        — Firebase Web API key (auth 가능 확인용 — booking 생성 X)
//   HEALTH_CHECK_EMAIL          — admin 계정 이메일 (TEST- prefix 바이패스 권한)
//   HEALTH_CHECK_PASSWORD       — admin 계정 비밀번호
//   VOUCHER_TEST_BOOKING_ID     — sandbox booking ID (CT-YYYYMMDD-XXX 또는 admin-bypass).
//                                  미설정 시 3 assertion graceful skip + exit 0.
//   VOUCHER_TEST_BOOKING_EMAIL  — 해당 booking 의 customerEmail (소문자, voucher.js 매칭용)
//   BASE_URL (선택)             — 기본 https://cocotripkr.com
//
// 운영자 후속 액션:
//   1) 첫 사용자 결제 또는 admin-bypass booking 1건 생성 후 bookingID/email 을
//      GitHub Secrets 에 등록 → 3 assertion 활성화.
//   2) 또는 매 트리거마다 admin-bypass 로 1건 생성하는 자동화 추가 (별도 PR).

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// .env / .env.local fallback (로컬 실행 편의)
function parseEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => {
          const idx = l.indexOf('=');
          return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
        })
    );
  } catch { return {}; }
}

const envMain = parseEnv(join(root, '.env'));
const envLocal = parseEnv(join(root, '.env.local'));

// process.env 우선 (CI), 없으면 .env.local 사용 (로컬)
const apiKey =
  process.env.FIREBASE_WEB_API_KEY ||
  envMain.VITE_FIREBASE_API_KEY ||
  envLocal.VITE_FIREBASE_API_KEY;
const email = process.env.HEALTH_CHECK_EMAIL || envLocal.HEALTH_CHECK_EMAIL;
const password = process.env.HEALTH_CHECK_PASSWORD || envLocal.HEALTH_CHECK_PASSWORD;
const BASE_URL = process.env.BASE_URL || 'https://cocotripkr.com';

const VOUCHER_BOOKING_ID =
  process.env.VOUCHER_TEST_BOOKING_ID || envLocal.VOUCHER_TEST_BOOKING_ID || '';
const VOUCHER_BOOKING_EMAIL = (
  process.env.VOUCHER_TEST_BOOKING_EMAIL || envLocal.VOUCHER_TEST_BOOKING_EMAIL || ''
).toLowerCase().trim();

if (!apiKey || !email || !password) {
  console.error('❌ Missing credentials. Set FIREBASE_WEB_API_KEY, HEALTH_CHECK_EMAIL, HEALTH_CHECK_PASSWORD');
  console.error('   (CI: GitHub Secrets / Local: .env.local)');
  process.exit(1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔍 CocoTrip Voucher 회귀 검증 슈트 (자율 검증 v2 P0)');
console.log(`   Target: ${BASE_URL}`);
console.log(`   Booking: ${VOUCHER_BOOKING_ID || '(미설정 — graceful skip)'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ─── Step 1: Firebase Auth (sanity check — admin 계정 살아있는지) ───────
console.log('[1/3] Firebase Auth signInWithPassword (sanity)...');
const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  }
);
const auth = await authRes.json();
if (!auth.idToken) {
  console.error('❌ Auth failed:', JSON.stringify(auth).slice(0, 400));
  process.exit(1);
}
console.log(`✅ idToken 발급 (uid=${auth.localId})\n`);

// ─── Step 2: sandbox booking ID 확인 ──────────────────────────────────
console.log('[2/3] sandbox booking 환경변수 확인...');
if (!VOUCHER_BOOKING_ID || !VOUCHER_BOOKING_EMAIL) {
  console.log('ℹ️  VOUCHER_TEST_BOOKING_ID / VOUCHER_TEST_BOOKING_EMAIL 미설정 — graceful skip');
  console.log('   운영자 액션: 첫 결제 또는 admin-bypass booking 생성 후');
  console.log('   GitHub Secrets 에 등록하면 다음 trigger 부터 3 assertion 활성화.');
  console.log('   (예: VOUCHER_TEST_BOOKING_ID=CT-20260512-123, ');
  console.log('         VOUCHER_TEST_BOOKING_EMAIL=2001leety@gmail.com)');

  // GitHub Actions markdown summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('fs');
    const md = [
      `# Voucher 회귀 검증 (자율 검증 v2 P0)`,
      '',
      `**Target:** ${BASE_URL}`,
      `**상태:** ⏭️ SKIP — sandbox booking 미설정`,
      '',
      '운영자 액션:',
      '- 첫 결제 또는 admin-bypass booking 1건 생성',
      '- GitHub Secrets 에 `VOUCHER_TEST_BOOKING_ID` + `VOUCHER_TEST_BOOKING_EMAIL` 등록',
      '- 라벨 재부착 → 3 assertion 활성화',
    ].join('\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  }
  process.exit(0);
}
console.log(`✅ bookingID=${VOUCHER_BOOKING_ID}, email=${VOUCHER_BOOKING_EMAIL}\n`);

// ─── Step 3: 3 assertion 실행 ─────────────────────────────────────────
console.log('[3/3] B-VCH1 / B-VCH2 / B-VCH3 assertion 실행\n');

const results = [];

// 공통 fetch helper — voucher endpoint 호출 (auth header 없음 — public)
async function fetchVoucher({ extraQuery = '', withAuth = false } = {}) {
  const params = new URLSearchParams({
    bookingID: VOUCHER_BOOKING_ID,
    userEmail: VOUCHER_BOOKING_EMAIL,
  });
  if (extraQuery) {
    for (const [k, v] of new URLSearchParams(extraQuery).entries()) {
      params.set(k, v);
    }
  }
  const url = `${BASE_URL}/api/voucher?${params.toString()}`;
  const headers = {};
  if (withAuth) headers['Authorization'] = `Bearer ${auth.idToken}`;
  const start = Date.now();
  const res = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(15000),
  });
  const elapsedMs = Date.now() - start;
  const ct = res.headers.get('content-type') || '';
  let buf = null;
  if (res.status === 200 && ct.includes('application/pdf')) {
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    // 에러 응답은 JSON 일 가능성 — 디버그용으로 text 캐치
    try { buf = await res.text(); } catch { buf = ''; }
  }
  return { status: res.status, contentType: ct, body: buf, elapsedMs };
}

// ─── B-VCH1: Voucher PDF 생성 가능 ───────────────────────────────────
// 정상 (bookingID + email 매칭) → 200 + application/pdf + blob ≥ 10KB + %PDF- magic
try {
  const r = await fetchVoucher();
  const sizeKB = Buffer.isBuffer(r.body) ? (r.body.length / 1024).toFixed(1) : 'N/A';
  const isPdf =
    Buffer.isBuffer(r.body) &&
    r.body.length >= 10 * 1024 &&
    r.body.slice(0, 5).toString('ascii') === '%PDF-';
  const ctOk = r.contentType.includes('application/pdf');
  const statusOk = r.status === 200;
  results.push({
    id: 'B-VCH1',
    label: 'Voucher PDF 생성 가능 (200, application/pdf, ≥10KB, %PDF- magic)',
    actual: `status=${r.status}, ct=${r.contentType}, size=${sizeKB}KB, magic=${
      Buffer.isBuffer(r.body) ? r.body.slice(0, 5).toString('ascii') : 'n/a'
    }, ${r.elapsedMs}ms`,
    pass: statusOk && ctOk && isPdf,
  });
} catch (err) {
  results.push({
    id: 'B-VCH1',
    label: 'Voucher PDF 생성 가능 (200, application/pdf, ≥10KB, %PDF- magic)',
    actual: `exception: ${err.message}`,
    pass: false,
  });
}

// ─── B-VCH2: Voucher 다국어 (4-lang) 분기 ────────────────────────────
// 현재 voucher.js 는 lang 미지원 (Helvetica only — 영문 단일).
// 회귀 슈트는 endpoint 가 lang 쿼리에 crash 하지 않음 + 4-lang 모두 valid PDF + 응답 < 10s 검증.
// future: voucher 다국어 추가 시 size 비교 / text 추출 검증으로 강화.
const LANGS = ['ko', 'en', 'ja', 'zh'];
const langResults = [];
for (const lang of LANGS) {
  try {
    const r = await fetchVoucher({ extraQuery: `lang=${lang}` });
    const isPdf =
      Buffer.isBuffer(r.body) &&
      r.body.length >= 5 * 1024 &&
      r.body.slice(0, 5).toString('ascii') === '%PDF-';
    const sizeKB = Buffer.isBuffer(r.body) ? Math.round(r.body.length / 1024) : 0;
    const under10s = r.elapsedMs < 10_000;
    langResults.push({ lang, status: r.status, sizeKB, elapsedMs: r.elapsedMs, isPdf, under10s });
  } catch (err) {
    langResults.push({ lang, status: 0, sizeKB: 0, elapsedMs: 0, isPdf: false, under10s: false, err: err.message });
  }
}
const allLangValid =
  langResults.every((r) => r.status === 200 && r.isPdf && r.under10s);
const langSummary = langResults
  .map((r) => `${r.lang}=${r.status}/${r.sizeKB}KB/${r.elapsedMs}ms${r.err ? `[err:${r.err}]` : ''}`)
  .join(', ');
results.push({
  id: 'B-VCH2',
  label: 'Voucher 4-lang (?lang=ko/en/ja/zh) 모두 200 + valid PDF + <10s',
  actual: langSummary,
  pass: allLangValid,
  note: 'ℹ️ 현재 voucher.js 는 lang 무시 (Helvetica only) — endpoint resilience + 응답 시간만 검증',
});

// ─── B-VCH3: Voucher 공유 URL public access ─────────────────────────
// auth header 없이 GET — email 매칭 만으로 인증 (PR #229 batch 2 정책).
// 추가로 잘못된 email 입력 시 403 도 검증 — 보안 가드.
let publicAccessOk = false;
let publicStatus = 0;
let mismatchStatus = 0;
try {
  const r1 = await fetchVoucher({ withAuth: false });
  publicStatus = r1.status;
  publicAccessOk =
    r1.status === 200 &&
    r1.contentType.includes('application/pdf') &&
    Buffer.isBuffer(r1.body) &&
    r1.body.length >= 10 * 1024;
} catch (err) {
  publicStatus = -1;
}
// 보안 가드: 잘못된 email → 403
try {
  const fakeEmail = 'wrong-email-no-such-user@example.invalid';
  const params = new URLSearchParams({
    bookingID: VOUCHER_BOOKING_ID,
    userEmail: fakeEmail,
  });
  const res = await fetch(`${BASE_URL}/api/voucher?${params.toString()}`, {
    method: 'GET',
    signal: AbortSignal.timeout(10000),
  });
  mismatchStatus = res.status;
} catch (err) {
  mismatchStatus = -1;
}
results.push({
  id: 'B-VCH3',
  label: 'Voucher 공유 URL public (auth header 없이 200) + email mismatch 시 403',
  actual: `public_get=${publicStatus}, mismatch_get=${mismatchStatus}`,
  pass: publicAccessOk && mismatchStatus === 403,
});

// ─── Summary ──────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 Voucher 회귀 검증 결과 — 3 assertion');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let passCount = 0;
for (const r of results) {
  console.log(`  ${r.pass ? '✅' : '❌'} [${r.id}] ${r.label}`);
  console.log(`      → ${r.actual}`);
  if (r.note) console.log(`      ${r.note}`);
  if (r.pass) passCount++;
}
console.log(`\n  종합: ${passCount}/${results.length} pass\n`);

// GitHub Actions markdown summary (CI 친화)
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('fs');
  const md = [
    `# Voucher 회귀 검증 결과 (자율 검증 v2 P0)`,
    '',
    `**Target:** ${BASE_URL}`,
    `**Booking:** ${VOUCHER_BOOKING_ID}`,
    `**총합:** ${passCount}/${results.length} pass`,
    '',
    '| ID | 항목 | 결과 | 상세 |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.id} | ${r.label} | ${r.pass ? '✅' : '❌'} | ${String(r.actual).replace(/\|/g, '\\|')} |`),
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

process.exit(passCount === results.length ? 0 : 1);
