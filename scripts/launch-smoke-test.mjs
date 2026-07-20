#!/usr/bin/env node
/**
 * launch-smoke-test.mjs — Launch 직전/후 prod endpoint 스모크 검증.
 *
 * 사용:
 *   node scripts/launch-smoke-test.mjs              # prod (cocotripkr.com) 검증
 *   node scripts/launch-smoke-test.mjs --base=https://preview-url  # preview 검증
 *   node scripts/launch-smoke-test.mjs --bypass=<token>             # Vercel SSO bypass
 *
 * 검증 항목:
 *   1. /api/ai-planner-full        — Bearer 미포함 → 401 AUTH_REQUIRED (P0-#2)
 *   2. /api/onboarding-coupons     — Bearer 미포함 → 401 (PR #253)
 *   3. /api/cancelBooking          — POST 빈 body → 400 또는 405 (handler 살아있음)
 *   4. /api/voucher                — GET → 401 (인증 필요, 핸들러 살아있음)
 *
 * 참고: Braintree Drop-in(/api/braintreeClientToken) 검증은 게이트웨이 제거(2026-05-06~07)로
 * 엔드포인트가 사라져 함께 삭제됨. PayPal 결제 경로는 아직 스모크 커버리지 없음.
 *
 * Exit code 0 = all pass, 1 = 1+ fail
 */

const args = process.argv.slice(2);
const baseUrl = args.find(a => a.startsWith('--base='))?.split('=')[1] || 'https://cocotripkr.com';
const bypassToken = args.find(a => a.startsWith('--bypass='))?.split('=')[1] || '';

const baseUrlWithBypass = bypassToken
  ? (url) => `${url}${url.includes('?') ? '&' : '?'}x-vercel-protection-bypass=${bypassToken}`
  : (url) => url;

const TIMEOUT_MS = 15000;

const tests = [
  {
    name: 'P0-#2 — /api/ai-planner-full no Bearer → 401 AUTH_REQUIRED',
    method: 'POST',
    path: '/api/ai-planner-full',
    body: { email: 'smoke-test@example.com', paypalOrderId: 'TEST-fake', planData: {} },
    expectStatus: 401,
    expectBodyContains: 'AUTH_REQUIRED',
  },
  {
    name: 'PR #253 — /api/onboarding-coupons no Bearer → 401',
    method: 'POST',
    path: '/api/onboarding-coupons',
    expectStatus: 401,
  },
  {
    name: 'Refund handler alive — /api/cancelBooking POST → 400 or 405 (no auth)',
    method: 'POST',
    path: '/api/cancelBooking',
    body: {},
    expectStatusOneOf: [400, 401, 403, 405],
  },
  {
    name: 'Voucher handler alive — /api/voucher GET → 400 or 401',
    method: 'GET',
    path: '/api/voucher',
    expectStatusOneOf: [400, 401, 405],
  },
];

async function runTest(test) {
  const url = baseUrlWithBypass(`${baseUrl}${test.path}`);
  const opts = {
    method: test.method,
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  if (test.body !== undefined) opts.body = JSON.stringify(test.body);

  let res;
  let bodyText = '';
  try {
    res = await fetch(url, opts);
    bodyText = await res.text();
  } catch (e) {
    return { pass: false, status: 0, error: e.message };
  }

  const statusOk = test.expectStatus
    ? res.status === test.expectStatus
    : test.expectStatusOneOf?.includes(res.status);

  const bodyOk = test.expectBodyContains
    ? bodyText.includes(test.expectBodyContains)
    : true;

  return {
    pass: statusOk && bodyOk,
    status: res.status,
    bodyExcerpt: bodyText.slice(0, 100),
    statusOk,
    bodyOk,
  };
}

async function main() {
  console.log(`\n🚀 Launch smoke test — base: ${baseUrl}`);
  if (bypassToken) console.log('   (Vercel SSO bypass enabled)');
  console.log('─'.repeat(70));

  let passCount = 0;
  let failCount = 0;

  for (const test of tests) {
    process.stdout.write(`  ${test.name}\n`);
    const result = await runTest(test);
    if (result.pass) {
      console.log(`  ✓ PASS — HTTP ${result.status}`);
      passCount++;
    } else {
      console.log(`  ✗ FAIL — HTTP ${result.status}, body: ${result.bodyExcerpt || result.error || '(empty)'}`);
      console.log(`    statusOk=${result.statusOk}, bodyOk=${result.bodyOk}`);
      failCount++;
    }
    console.log();
  }

  console.log('─'.repeat(70));
  console.log(`Result: ${passCount}/${tests.length} pass, ${failCount} fail`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
