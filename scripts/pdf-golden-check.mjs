#!/usr/bin/env node
// scripts/pdf-golden-check.mjs — L3 게이트 (PDF 런타임 회귀 차단).
//
// 매 PR Vercel preview deploy 후 fixture plan 의 PDF 를 server endpoint
// (api/pdf/generate.js, Puppeteer + Chromium) 로 생성 → pdf-parse 로 페이지수
// + 텍스트 + 글리프 검증. P92 (PDF cut-off) / PDF_KOREAN_FONT (tofu □) 같은
// byte-output 회귀를 prod 도달 전 차단.
//
// 사용:
//   node scripts/pdf-golden-check.mjs
//
// Exit code:
//   0 — 모든 assertion PASS (또는 env 누락 skip)
//   1 — 1건 이상 fail
//
// 필수 env (운영자 GitHub Secrets 등록):
//   FIREBASE_WEB_API_KEY       — Firebase Web API key (= VITE_FIREBASE_API_KEY)
//   HEALTH_CHECK_EMAIL         — fixture plan 소유자 email
//   HEALTH_CHECK_PASSWORD      — 동일 사용자 password
//   PDF_GOLDEN_PLAN_ID         — 미리 만들어둔 fixture plan ID (long-lived)
//   BASE_URL (자동)            — Vercel preview URL (workflow 에서 deployment_status.target_url)
//
// fixture plan 생성 가이드: scripts/README-pdf-golden.md
//
// 시간 budget: Firebase auth ~1s + PDF gen 30-60s + parse ~1s = ~60s.

import { Buffer } from 'node:buffer';

const apiKey = process.env.FIREBASE_WEB_API_KEY || '';
const email = process.env.HEALTH_CHECK_EMAIL || '';
const password = process.env.HEALTH_CHECK_PASSWORD || '';
const planId = process.env.PDF_GOLDEN_PLAN_ID || '';
const BASE_URL = process.env.BASE_URL || 'https://cocotripkr.com';
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

const missing = [];
if (!apiKey) missing.push('FIREBASE_WEB_API_KEY');
if (!email) missing.push('HEALTH_CHECK_EMAIL');
if (!password) missing.push('HEALTH_CHECK_PASSWORD');
if (!planId) missing.push('PDF_GOLDEN_PLAN_ID');

if (missing.length > 0) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`⚠️  PDF golden 검증 SKIP — 누락 env: ${missing.join(', ')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('운영자 후속: scripts/README-pdf-golden.md 참조하여 fixture plan 생성');
  console.log('+ GitHub Secrets 4개 등록 (PDF_GOLDEN_PLAN_ID 포함).');
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `# PDF Golden 검증 — SKIP\n\n**누락 env:** ${missing.join(', ')}\n\n운영자가 \`scripts/README-pdf-golden.md\` 참조하여 fixture plan 생성 + Secrets 등록 시 active.\n`,
    );
  }
  process.exit(0);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🔍 PDF Golden 검증 — ${BASE_URL}`);
console.log(`   plan: ${planId}, owner: ${email.slice(0, 3)}***`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ─── Step 1: Firebase Auth ────────────────────────────────
console.log('[1/3] Firebase Auth signInWithPassword...');
const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  },
);
const auth = await authRes.json();
if (!auth.idToken) {
  console.error('❌ Auth failed:', JSON.stringify(auth).slice(0, 300));
  process.exit(1);
}
console.log(`✅ idToken 발급 (uid=${auth.localId})\n`);

// ─── Step 2: PDF 생성 ─────────────────────────────────────
console.log('[2/3] POST /api/pdf/generate (Puppeteer + Chromium, ~30-60s)...');
const t0 = Date.now();
const headers = {
  Authorization: `Bearer ${auth.idToken}`,
  'Content-Type': 'application/json',
};
if (bypassSecret) headers['x-vercel-protection-bypass'] = bypassSecret;

const pdfRes = await fetch(`${BASE_URL}/api/pdf/generate`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ planId }),
  signal: AbortSignal.timeout(90000), // 90s — server cap 60s + 여유
});

const elapsed = Date.now() - t0;
console.log(`   server response: ${pdfRes.status} (${elapsed}ms)`);

if (!pdfRes.ok) {
  const errBody = await pdfRes.text().catch(() => '(no body)');
  console.error(`❌ PDF endpoint failed: ${pdfRes.status} ${pdfRes.statusText}`);
  console.error(`   body: ${errBody.slice(0, 500)}`);
  process.exit(1);
}

const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
console.log(`✅ PDF binary 받음: ${(pdfBuffer.length / 1024).toFixed(1)} KB\n`);

// ─── Step 3: pdf-parse assertion ──────────────────────────
console.log('[3/3] pdf-parse + assertion...');
// pdf-parse 는 require 기반 (CJS). dynamic import + default access.
const { default: pdfParse } = await import('pdf-parse');
const parsed = await pdfParse(pdfBuffer);

const assertions = [];

// A1: 페이지 수 >= 3 (intro + day1 + outro 최소).
// 2026-05-19: server PDF (api/pdf/generate.js) 의 buildPlanHtml 이 단순화
// template 사용 (description / tip 등 일부 제외) → client html2canvas PDF
// 보다 페이지 수 적음. 5-day fixture 도 4 페이지 정도. 본 assertion 은 PDF
// binary 자체 정상 응답 + 최소 본문 존재 검증용. P92 cut-off (client) 의
// 진짜 회귀 차단은 pdf-capture-cutoff-pr92.test.ts (8 assertion) 가 cover.
assertions.push({
  id: 'A1_pages',
  label: 'PDF 페이지 수 >= 3 (binary 정상 + 최소 본문)',
  actual: `pages=${parsed.numpages}`,
  pass: parsed.numpages >= 3,
});

// A2: 텍스트 글자수 >= 1000 (cut-off 차단)
const textLen = (parsed.text || '').length;
assertions.push({
  id: 'A2_text_length',
  label: 'PDF 텍스트 글자수 >= 1000 (cut-off 차단)',
  actual: `chars=${textLen}`,
  pass: textLen >= 1000,
});

// A3: 한글 또는 영문 핵심 keyword 존재 (font rendering 정상)
const text = parsed.text || '';
const koWord = /서울|부산|제주|일정|식당|호텔|관광/.test(text);
const enWord = /Day\s*\d|Seoul|itinerary|restaurant|hotel/i.test(text);
assertions.push({
  id: 'A3_locale_keyword',
  label: 'locale keyword 존재 (font rendering 정상)',
  actual: `ko=${koWord}, en=${enWord}`,
  pass: koWord || enWord,
});

// A4: tofu glyph (□ U+25A1) 또는 unknown box (□ U+FFFD) 부재
// 일부 fallback 글리프는 정상이므로 비율 cap (< 0.5%) 사용.
const tofuCount = (text.match(/[□�]/g) || []).length;
const tofuRatio = textLen > 0 ? tofuCount / textLen : 0;
assertions.push({
  id: 'A4_tofu_glyph',
  label: 'tofu glyph (□ \\uFFFD) < 0.5% (한글 font 정상)',
  actual: `tofu=${tofuCount} (${(tofuRatio * 100).toFixed(3)}%)`,
  pass: tofuRatio < 0.005,
});

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 결과');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let passCount = 0;
for (const a of assertions) {
  console.log(`  ${a.pass ? '✅' : '❌'} ${a.id}: ${a.label}`);
  console.log(`      → ${a.actual}`);
  if (a.pass) passCount++;
}
console.log(`\n  종합: ${passCount}/${assertions.length} pass`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  const md = [
    `# PDF Golden 검증 결과`,
    '',
    `**Target:** ${BASE_URL}`,
    `**Plan:** \`${planId}\`  **Size:** ${(pdfBuffer.length / 1024).toFixed(1)} KB  **Generate elapsed:** ${elapsed}ms`,
    `**Pages:** ${parsed.numpages}  **Text chars:** ${textLen}`,
    `**종합:** ${passCount}/${assertions.length} pass`,
    '',
    '| ID | 항목 | 결과 | 상세 |',
    '| --- | --- | --- | --- |',
    ...assertions.map((a) => `| \`${a.id}\` | ${a.label} | ${a.pass ? '✅' : '❌'} | ${a.actual.replace(/\|/g, '\\|')} |`),
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

process.exit(passCount === assertions.length ? 0 : 1);
