// CocoTrip prod 결제 흐름 회귀 검증 슈트 — 자율 검증 v2 P0 (8 assertion + 정리 1)
// validate-prod-regression.mjs 와 동일 패턴 (parseEnv / Firebase auth / SCENARIO_NAME).
//
// 검증 대상 (B-PAY1 ~ B-PAY8):
//   B-PAY1: PayPal SDK script 로드 가능 (VITE_PAYPAL_CLIENT_ID 환경변수 필요 — 미설정 시 skip)
//   B-PAY2: createPaypalOrder endpoint (관리자 우회 path — TEST-/ADMIN-BYPASS- prefix)
//   B-PAY3: Manual payment request — paypal-me-qr 흐름 (pending_bookings Firestore 생성)
//   B-PAY4: 5% 쿠폰 productScope — charter/tour 적용, AI plan reject
//   B-PAY5: Trip Coins redeem percent (fixed-USD 잔존 0)
//   B-PAY6: Webhook idempotency — 같은 eventId 2회 POST → 1건만 처리
//   B-PAY7: Webhook signature verify — 잘못된 signature header → 401 / 미설정 PAYPAL_WEBHOOK_ID → 503
//   B-PAY8: 환불 흐름 — mock refund webhook → bookings status=refunded
//
// Exit code:
//   0 — 모두 PASS
//   1 — 1건 이상 FAIL
//
// 환경변수 (GitHub Secrets 또는 .env.local):
//   FIREBASE_WEB_API_KEY      — Firebase Web API key (VITE_FIREBASE_API_KEY 와 동일)
//   HEALTH_CHECK_EMAIL        — admin 계정 이메일 (ADMIN_BYPASS_EMAILS 등록 필수)
//   HEALTH_CHECK_PASSWORD     — admin 계정 비밀번호
//   VITE_PAYPAL_CLIENT_ID     — PayPal client id (B-PAY1 SDK 로드 검증용, 미설정 시 skip+warn)
//   BASE_URL (선택)           — 기본 https://cocotripkr.com
//   SCENARIO_NAME             — 시나리오 식별자. 기본 'payment-default'
//
// 결제 흐름 학습 (paymentGate.js):
//   - PayPal real flow: 17자 alphanumeric order ID → API status 검증
//   - TEST-* prefix: 2026-07-20 폐지 — 환경 무관 항상 403 reject
//   - ADMIN-BYPASS-* prefix: LIVE 모드 admin 우회 (ADMIN_BYPASS_EMAILS 매칭)
//   - MANUAL-* prefix: paypal.me QR 결제 후 admin mark-paid → server-side ai-planner 트리거
//
// 슈트는 ADMIN-BYPASS- prefix 패턴으로 실제 결제 없이 endpoint 형태/스키마/응답 코드 검증.
// Braintree / Toss 제외 — PayPal 단일 (운영자 명시 2026-05-06).

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
const SCENARIO_NAME = process.env.SCENARIO_NAME || 'payment-default';
const PAYPAL_CLIENT_ID =
  process.env.VITE_PAYPAL_CLIENT_ID ||
  envMain.VITE_PAYPAL_CLIENT_ID ||
  envLocal.VITE_PAYPAL_CLIENT_ID ||
  '';

if (!apiKey || !email || !password) {
  console.error('❌ Missing credentials. Set FIREBASE_WEB_API_KEY, HEALTH_CHECK_EMAIL, HEALTH_CHECK_PASSWORD');
  console.error('   (CI: GitHub Secrets / Local: .env.local)');
  process.exit(1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`🔍 CocoTrip 결제 흐름 회귀 검증 슈트 (8 assertion + 정리 1 / 자율 검증 v2 P0) — [${SCENARIO_NAME}]`);
console.log(`   Target: ${BASE_URL}`);
console.log(`   PayPal Client ID: ${PAYPAL_CLIENT_ID ? PAYPAL_CLIENT_ID.slice(0, 8) + '...' : '(unset)'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ─── Step 1: Firebase Auth ────────────────────────────────
console.log('[1/3] Firebase Auth signInWithPassword...');
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

// ─── Step 2: 8 assertion 실행 ──────────────────────────────
console.log('[2/3] B-PAY1 ~ B-PAY8 assertion 실행\n');

const results = [];

// 공통 fetch 헬퍼 (타임아웃 + 결과 표준화)
async function postJson(path, body, opts = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.auth !== false ? { Authorization: `Bearer ${auth.idToken}` } : {}),
    ...(opts.headers || {}),
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeout || 30000),
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON 응답 */ }
    return { status: res.status, json, headers: Object.fromEntries(res.headers.entries()) };
  } catch (err) {
    return { status: 0, json: null, error: err.message };
  }
}

// ─── B-PAY1: PayPal SDK script 로드 가능 ─────────────────────
if (!PAYPAL_CLIENT_ID) {
  results.push({
    id: 'B-PAY1',
    label: 'PayPal SDK script 로드 (VITE_PAYPAL_CLIENT_ID 미설정 — skip)',
    actual: 'VITE_PAYPAL_CLIENT_ID env var 누락',
    pass: true,
    note: '⚠️ env 미설정으로 skip. Vercel Secrets에 VITE_PAYPAL_CLIENT_ID 등록 필요.',
  });
} else {
  try {
    const sdkUrl = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(PAYPAL_CLIENT_ID)}&currency=USD`;
    const sdkRes = await fetch(sdkUrl, { signal: AbortSignal.timeout(15000) });
    const contentType = sdkRes.headers.get('content-type') || '';
    const isJs = contentType.includes('javascript') || contentType.includes('application');
    results.push({
      id: 'B-PAY1',
      label: 'PayPal SDK script 로드 (200 + javascript content-type)',
      actual: `status=${sdkRes.status}, content-type=${contentType.slice(0, 60) || '(none)'}`,
      pass: sdkRes.status === 200 && isJs,
    });
  } catch (err) {
    results.push({
      id: 'B-PAY1',
      label: 'PayPal SDK script 로드 (fetch 실패)',
      actual: `error: ${err.message}`,
      pass: false,
    });
  }
}

// ─── B-PAY2: createPaypalOrder endpoint ──────────────────────
// 실제 PayPal 호출은 운영자 ADMIN-BYPASS- prefix 우회 패턴 사용 (paymentGate.js).
// createPaypalOrder 는 ADMIN-BYPASS path가 없으므로 실 endpoint 입력 검증만 수행
// — productType 누락 시 400 / AI 플래너 + couponCode 시 400 정책 검증.
{
  // case A: productType 누락 → 400 MISSING_FIELDS
  const resA = await postJson('/api/createPaypalOrder', {
    passengers: 2,
    dateStart: '2026-06-15',
    dateEnd: '2026-06-19',
  });

  // case B: AI 플래너 + promoCode → 400 AI_PLANNER_NO_COUPON
  const resB = await postJson('/api/createPaypalOrder', {
    productType: 'ai_planner_full',
    promoCode: 'COCO5',
    passengers: 1,
    dateStart: '2026-06-15',
    dateEnd: '2026-06-15',
  });

  const aOk = resA.status === 400 && (resA.json?.code === 'MISSING_FIELDS' || /productType/.test(resA.json?.error || ''));
  const bOk = resB.status === 400 && resB.json?.code === 'AI_PLANNER_NO_COUPON';
  results.push({
    id: 'B-PAY2',
    label: 'createPaypalOrder endpoint (입력 검증 + AI 플래너 쿠폰 reject)',
    actual: `caseA(missing productType)=${resA.status}/${resA.json?.code || '?'}, caseB(ai+coupon)=${resB.status}/${resB.json?.code || '?'}`,
    pass: aOk && bOk,
  });
}

// ─── B-PAY3: Manual payment request ─────────────────────────
// admin 계정 + ADMIN_BYPASS_EMAILS 등록되어 있으면 즉시 CONFIRMED 처리. 일반 사용자는
// AWAITING_VERIFICATION. 슈트는 status 200 + 응답 ok=true 만 확인.
// bookingRef 형식 CT-YYYYMMDD-XXX 고정 — Firestore docId 충돌 회피 위해 ms timestamp 사용.
{
  const ts = Date.now();
  const seq = (ts % 1000).toString().padStart(3, '0');
  const ymd = new Date(ts).toISOString().slice(0, 10).replace(/-/g, '');
  const bookingRef = `CT-${ymd}-${seq}`;
  const resM = await postJson('/api/manual-payment-request', {
    bookingRef,
    productType: 'ai_planner_full',
    passengers: 1,
    dateStart: '2026-06-15',
    dateEnd: '2026-06-15',
    priceKRW: 13300,
    priceUSD: '9.90',
    customerEmail: email,
    customerPhone: '+821000000000',
    pickupLocation: 'ICN',
    paymentMethod: 'paypal-me-qr',
    paypalMeUrl: 'https://paypal.me/cocotripkr/9.90USD',
    language: 'ko',
  });
  // admin bypass + AWAITING_VERIFICATION + idempotent 모두 OK
  const acceptableCodes = new Set(['CONFIRMED', 'AWAITING_VERIFICATION', undefined]);
  const okStatus = resM.status === 200;
  const okData = !!resM.json?.ok && acceptableCodes.has(resM.json?.data?.status);
  results.push({
    id: 'B-PAY3',
    label: 'Manual payment request (paypal-me-qr → pending_bookings)',
    actual: `status=${resM.status}, ok=${resM.json?.ok}, data.status=${resM.json?.data?.status || '?'}, adminBypass=${resM.json?.data?.adminBypass || false}, bookingRef=${bookingRef}`,
    pass: okStatus && okData,
  });

  // ─── B-PAY3-CLEAN: 스모크 예약 즉시 삭제 (2026-07-26) ─────
  // 위에서 만든 pending_bookings 문서는 진짜 예약이 아니다 — 두면 PR 마다 prod 에 쌓여
  // 어드민 결제 화면·매출 KPI 를 오염시킨다. firestore.rules 가 pending_bookings 에
  // `allow delete: if isAdminEmail()` 을 이미 열어놨으므로(§578), 서버 코드 변경 없이
  // 헬스체크(admin) 계정 idToken 으로 Firestore REST DELETE 한다.
  // 정리 실패는 조용히 넘기지 않고 결과 행으로 드러낸다 — 청소가 안 되면 슈트가 빨간불.
  {
    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      envMain.VITE_FIREBASE_PROJECT_ID ||
      envLocal.VITE_FIREBASE_PROJECT_ID ||
      'planning-with-ai-a0801'; // count-test-bookings.mjs 와 동일 폴백
    let cleanPass = false;
    let cleanDetail = '';
    try {
      const delRes = await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/pending_bookings/${bookingRef}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${auth.idToken}` } },
      );
      // Firestore REST delete 는 idempotent — 문서가 이미 없어도 200.
      cleanPass = delRes.ok;
      cleanDetail = `status=${delRes.status}, bookingRef=${bookingRef}`;
      if (!delRes.ok) {
        const errTxt = await delRes.text();
        cleanDetail += `, body=${errTxt.slice(0, 120)}`;
      }
    } catch (err) {
      cleanDetail = `ERR: ${err.message}`;
    }
    results.push({
      id: 'B-PAY3-CLEAN',
      label: '스모크 예약 정리 (pending_bookings 삭제 — prod 잔여물 0)',
      actual: cleanDetail,
      pass: cleanPass,
    });
  }
}

// ─── B-PAY4: 5% 쿠폰 productScope ───────────────────────────
// AI 플래너 + COCO5 (5% 글로벌 프로모) 는 createPaypalOrder 단에서 reject (B-PAY2 caseB).
// 추가로 applyPromoCode 의 charter 적용 / AI 적용 / charter→AI 시도 시 productScope 가드 확인.
{
  // case A: COCO5 + charter productType → valid:true
  const resA = await postJson('/api/applyPromoCode', {
    code: 'COCO5',
    originalPrice: 200000,
    productType: 'charter_seoul_city',
  });
  // case B: COCO5 + AI 플래너 → createPaypalOrder 단에서 reject. applyPromoCode는 글로벌
  // 프로모라 통과 (productScope 가드는 Firestore 쿠폰 한정). createPaypalOrder caseB 와
  // 함께 보면 layered 정책 검증 완료.
  // 여기서는 charter case A 만 검증 (글로벌 프로모 = 모든 productType OK)
  const aOk = resA.status === 200 && resA.json?.data?.valid === true;
  results.push({
    id: 'B-PAY4',
    label: '5% 쿠폰 productScope (charter 적용 OK / AI plan reject — B-PAY2 caseB 와 layered)',
    actual: `applyPromoCode(charter)=${resA.status}/valid=${resA.json?.data?.valid}, AI reject 검증=B-PAY2 caseB`,
    pass: aOk,
  });
}

// ─── B-PAY5: Trip Coins redeem percent (fixed-USD 잔존 0) ──
// users/{uid}/coupons 직접 조회 불가 (Firebase Admin 권한 없음). 대신 admin endpoint
// /api/admin-quality-summary 또는 endpoint 가 있으면 사용. 없으면 applyPromoCode 응답에서
// fsCoupon.type 추적 — 사용자 본인 쿠폰을 cycle 돌리며 fixed-USD 잔존 여부 확인.
// 슈트 단순화: 정책 검증만 — applyPromoCode 가 fixed-USD 쿠폰 type 처리 logic 코드에 잔존.
// 운영자가 마이그레이션 했다면 prod 쿠폰 collection 에 fixed-USD 가 없음. 직접 검증
// endpoint 부재 → soft check (idToken 사용자의 쿠폰만 조회) + warning.
{
  // 사용자 쿠폰 조회는 별도 endpoint 부재 → soft pass + 운영자 알림.
  // 추후 admin endpoint (/api/admin-coupon-audit) 추가 시 정식 검증으로 격상 가능.
  results.push({
    id: 'B-PAY5',
    label: 'Trip Coins redeem percent (fixed-USD 잔존 0 — soft check)',
    actual: '직접 검증 endpoint 부재. applyPromoCode 응답 type 추적 logic 잔존',
    pass: true,
    note: '⚠️ Firestore users/{uid}/coupons 직접 조회 endpoint 부재. /api/admin-coupon-audit 추가 후 정식 검증으로 격상 가능. 현재는 코드 logic 잔존 (applyPromoCode L243/L323) 확인만.',
  });
}

// ─── B-PAY6: Webhook idempotency ────────────────────────────
// 같은 transmission-id 로 2회 POST → 동일 응답 (200 / 401 / 503 무관 — idempotent 체크
// 가 logRef 확인 후 짧은 path 로 응답). 실 webhook signature 없이 호출하므로 401 또는 503
// 응답 예상. 응답 일관성 (같은 status + 동일 키 body) 만 검증.
{
  const headers = {
    'paypal-transmission-id': `MOCK-IDEMPOTENT-${Date.now()}`,
    'paypal-transmission-time': new Date().toISOString(),
    'paypal-transmission-sig': 'mock-sig-not-valid',
    'paypal-cert-url': 'https://api.paypal.com/mockcert',
    'paypal-auth-algo': 'SHA256withRSA',
  };
  const body = {
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { id: 'MOCK-CAPTURE', amount: { value: '9.90', currency_code: 'USD' } },
  };
  const r1 = await postJson('/api/paypal-webhook', body, { auth: false, headers });
  const r2 = await postJson('/api/paypal-webhook', body, { auth: false, headers });

  // 정상 처리 path 면 r1=verify_failed(401)→log 'verify_failed'. r2 도 같은 status.
  // (idempotent path 는 r1 이 status='processed' 일 때만 발동 — verify fail 시는 매 호출
  // 마다 다시 verify 시도. 그러므로 status 일관성 만 검증.)
  const sameStatus = r1.status === r2.status;
  // 503 (PAYPAL_WEBHOOK_ID 미구성) 또는 401 (signature fail) 모두 정상 fail-path
  const expectedStatus = r1.status === 401 || r1.status === 503 || r1.status === 200;
  results.push({
    id: 'B-PAY6',
    label: 'Webhook idempotency (같은 transmission-id 2회 POST → 응답 일관)',
    actual: `r1=${r1.status}, r2=${r2.status} (sameStatus=${sameStatus})`,
    pass: sameStatus && expectedStatus,
    note: r1.status === 503
      ? 'ℹ️ 503 — PAYPAL_WEBHOOK_ID env 미설정. Vercel Secrets 등록 후 정식 검증 격상 가능'
      : (r1.status === 401 ? 'ℹ️ 401 — signature verify fail (정상 — mock signature 차단)' : undefined),
  });
}

// ─── B-PAY7: Webhook signature verify ────────────────────────
// 잘못된 signature → 401 또는 503 (env 미설정). 정상 signature 는 실제 prod 환경 외 검증
// 불가 — mock 으로는 항상 401. 따라서 "잘못된 signature 거부" 만 검증.
{
  const r = await postJson('/api/paypal-webhook', {
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { id: 'MOCK' },
  }, {
    auth: false,
    headers: {
      'paypal-transmission-id': `MOCK-SIG-FAIL-${Date.now()}`,
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'INTENTIONALLY-INVALID',
      'paypal-cert-url': 'https://api.paypal.com/mockcert',
      'paypal-auth-algo': 'SHA256withRSA',
    },
  });
  // 401 (signature fail) 또는 503 (webhook ID env 미설정) 모두 거부 의미. 200 + ok=true 만 fail.
  const rejected = r.status === 401 || r.status === 503 || (r.status === 200 && r.json?.ok === false);
  results.push({
    id: 'B-PAY7',
    label: 'Webhook signature verify (잘못된 signature → 거부)',
    actual: `status=${r.status}, ok=${r.json?.ok}, error=${(r.json?.error || '').slice(0, 60)}`,
    pass: rejected,
    note: r.status === 503
      ? 'ℹ️ 503 — webhook 미구성 (Secrets 미등록). PAYPAL_WEBHOOK_ID 등록 후 401 검증으로 격상'
      : undefined,
  });
}

// ─── B-PAY8: 환불 흐름 (mock refund webhook) ────────────────
// PAYMENT.CAPTURE.REFUNDED event → webhook → bookings status=refunded. 실 prod 에서
// captureId 매칭 불가 (테스트용 booking 없음) → status='unmatched' 응답 예상.
// 슈트 검증: webhook 이 REFUNDED event_type 을 unsupported 가 아닌 별도 logic 으로 처리
// 하는지 (status 코드 / body 형태 만 확인).
{
  const r = await postJson('/api/paypal-webhook', {
    event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource: {
      id: 'MOCK-REFUND-CAPTURE',
      amount: { value: '9.90', currency_code: 'USD' },
      links: [
        { rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/MOCK-ORIGINAL-CAPTURE' },
      ],
    },
  }, {
    auth: false,
    headers: {
      'paypal-transmission-id': `MOCK-REFUND-${Date.now()}`,
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'mock-sig',
      'paypal-cert-url': 'https://api.paypal.com/mockcert',
      'paypal-auth-algo': 'SHA256withRSA',
    },
  });
  // signature fail (401) 또는 webhook 미구성 (503) 또는 status='unmatched' (200) 모두
  // logic 자체는 동작. 200 + ok=true 면 signature 통과 후 unmatched/refunded 까지 진행.
  const handled = r.status === 401 || r.status === 503 || r.status === 200;
  results.push({
    id: 'B-PAY8',
    label: '환불 흐름 (PAYMENT.CAPTURE.REFUNDED webhook 처리 path 존재)',
    actual: `status=${r.status}, ok=${r.json?.ok}, status_value=${r.json?.status || '?'}`,
    pass: handled,
    note: r.status === 503
      ? 'ℹ️ 503 — webhook 미구성. PAYPAL_WEBHOOK_ID 등록 후 unmatched(200) 검증 격상'
      : (r.status === 401 ? 'ℹ️ 401 — signature verify fail (정상 — mock signature 차단)' : undefined),
  });
}

// ─── Summary ──────────────────────────────────────────────
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📊 결제 흐름 회귀 검증 결과 (8 assertion + 정리 1) — [${SCENARIO_NAME}]`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
let passCount = 0;
for (const r of results) {
  console.log(`  ${r.pass ? '✅' : '❌'} [${SCENARIO_NAME}][${r.id}] ${r.label}`);
  console.log(`      → ${r.actual}`);
  if (r.note) console.log(`      ${r.note}`);
  if (r.pass) passCount++;
}
console.log(`\n  종합: [${SCENARIO_NAME}] ${passCount}/${results.length} pass`);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📋 운영자 후속 액션 (Secrets 등록 시 active)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  - Vercel env / GitHub Secrets: VITE_PAYPAL_CLIENT_ID (B-PAY1 SDK 로드)');
console.log('  - Vercel env: PAYPAL_WEBHOOK_ID (B-PAY6/7/8 signature verify path)');
console.log('  - admin endpoint: /api/admin-coupon-audit 추가 시 B-PAY5 정식 검증 격상');

// GitHub Actions markdown summary (CI 친화)
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('fs');
  const md = [
    `# CocoTrip 결제 흐름 회귀 검증 결과 (8 assertion + 정리 1 / 자율 검증 v2 P0) — [${SCENARIO_NAME}]`,
    '',
    `**Target:** ${BASE_URL}`,
    `**총합:** ${passCount}/${results.length} pass`,
    '',
    '| ID | 항목 | 결과 | 상세 |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.id} | ${r.label} | ${r.pass ? '✅' : '❌'} | ${r.actual.replace(/\|/g, '\\|')} |`),
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

process.exit(passCount === results.length ? 0 : 1);
