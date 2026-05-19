#!/usr/bin/env node
// scripts/preflight-sdk-urls.mjs — third-party SDK URL preflight (CI 게이트).
//
// 목적: PR 머지 전, 우리 코드가 실제로 만드는 third-party SDK URL 을 fetch 해서
//      contract 위반 (400/403) 을 사전에 차단. P95 (enable-funding=googlepay,applepay
//      400) 같은 SDK reject 패턴이 prod 도달 전에 막히도록 게이트.
//
// 사용:
//   node scripts/preflight-sdk-urls.mjs                   # 모든 entry 검증
//   node scripts/preflight-sdk-urls.mjs --id paypal_sdk_live  # 특정 entry 만
//
// Exit code:
//   0 — 모든 entry pass (또는 required_env 누락으로 skip)
//   1 — 1건 이상 fail
//
// Manifest: scripts/sdk-urls-manifest.json
// 코드에서 SDK URL 변경 시 manifest 도 같이 변경 (mistake-lint enforce).

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const manifest = JSON.parse(readFileSync(join(__dirname, 'sdk-urls-manifest.json'), 'utf8'));

const args = process.argv.slice(2);
const idFilter = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;

const entries = manifest.entries.filter((e) => !idFilter || e.id === idFilter);
if (entries.length === 0) {
  console.error(`No entries match --id=${idFilter}`);
  process.exit(1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🔍 SDK URL preflight (${entries.length} entry)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

function substitute(template, envMap) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    const v = envMap[key];
    if (v == null || v === '') throw new Error(`MISSING_ENV:${key}`);
    return encodeURIComponent(v);
  });
}

const results = [];

for (const entry of entries) {
  const envMap = {};
  let missing = [];
  for (const k of entry.required_env) {
    const v = process.env[k];
    if (!v) missing.push(k);
    else envMap[k] = v;
  }

  if (missing.length > 0) {
    results.push({
      id: entry.id,
      label: entry.label,
      status: 'skip',
      message: `required_env 누락: ${missing.join(', ')} — fork PR / secrets 미설정`,
    });
    console.log(`⚠️  [${entry.id}] SKIP — required_env 누락: ${missing.join(', ')}`);
    continue;
  }

  let url;
  try {
    url = substitute(entry.url_template, envMap);
  } catch (err) {
    results.push({ id: entry.id, label: entry.label, status: 'fail', message: err.message });
    console.log(`❌ [${entry.id}] FAIL — ${err.message}`);
    continue;
  }

  const redacted = url.replace(/(client-id=)[^&]+/, '$1[REDACTED]');
  console.log(`→ [${entry.id}] ${redacted}`);

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    const ct = res.headers.get('content-type') || '';
    const ctOk = entry.expected_content_type_includes.some((needle) => ct.includes(needle));
    const statusOk = res.status === entry.expected_status;
    const pass = statusOk && ctOk;

    results.push({
      id: entry.id,
      label: entry.label,
      status: pass ? 'pass' : 'fail',
      message: `status=${res.status} (expected ${entry.expected_status}), content-type=${ct.slice(0, 80) || '(none)'}`,
      hint: pass
        ? null
        : (res.status === 400
          ? `PayPal CDN 400 — SDK URL 의 query param 중 하나가 contract 위반. enable-funding/disable-funding/components 값을 PayPal 공식 dictionary 와 대조. ${entry.notes || ''}`
          : (res.status === 403
            ? `403 — client-id 가 valid 하지만 도메인/funding 권한 부족. PayPal 머천트 대시보드 확인.`
            : `unexpected status — 네트워크 또는 PayPal 측 일시 장애 가능. 30초 후 재시도.`)),
    });

    console.log(
      `${pass ? '✅' : '❌'} [${entry.id}] ${pass ? 'PASS' : 'FAIL'} — status=${res.status}, content-type=${ct.slice(0, 60)}`
    );
    if (!pass && entry.notes) console.log(`   notes: ${entry.notes}`);
  } catch (err) {
    results.push({
      id: entry.id,
      label: entry.label,
      status: 'fail',
      message: `fetch error: ${err.message}`,
    });
    console.log(`❌ [${entry.id}] FAIL — ${err.message}`);
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skip');
const passed = results.filter((r) => r.status === 'pass');
console.log(`📊 결과: ${passed.length} pass / ${failed.length} fail / ${skipped.length} skip`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('fs');
  const md = [
    `# SDK URL Preflight 결과`,
    '',
    `**총합:** ${passed.length} pass / ${failed.length} fail / ${skipped.length} skip`,
    '',
    '| ID | 라벨 | 결과 | 상세 |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => `| \`${r.id}\` | ${r.label} | ${r.status === 'pass' ? '✅' : r.status === 'skip' ? '⚠️' : '❌'} | ${(r.message || '').replace(/\|/g, '\\|')} |`),
    '',
    ...(failed.length > 0 ? [
      '## ❌ 실패 entry 진단',
      '',
      ...failed.flatMap((r) => [
        `### \`${r.id}\` — ${r.label}`,
        '',
        `**증상:** ${r.message}`,
        '',
        ...(r.hint ? [`**힌트:** ${r.hint}`, ''] : []),
      ]),
    ] : []),
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

process.exit(failed.length === 0 ? 0 : 1);
