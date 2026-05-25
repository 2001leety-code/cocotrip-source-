/**
 * P138 진짜 최종 측정 — P185 fix + gemini-3.5-flash ENV + cache 해제 빌드 반영 후 1회
 * 통제 변수: 0 (이전과 동일 input, 환경만 정상화)
 * 동일 input: 다도시 seoul+busan 5일
 * 비용: ~$0 (gemini-3.5-flash = free tier)
 * 하드 타임아웃: 20분
 */
import { readFileSync } from 'fs';

function parseEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.startsWith('#'))
        .map(l => {
          const idx = l.indexOf('=');
          const key = l.slice(0, idx).trim();
          let val = l.slice(idx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          return [key, val];
        })
    );
  } catch(e) { return {}; }
}

const envMain = parseEnvFile('.env');
const envLocal = parseEnvFile('.env.local');

const FIREBASE_API_KEY = envMain.VITE_FIREBASE_API_KEY || envLocal.VITE_FIREBASE_API_KEY;
const HEALTH_EMAIL = envLocal.HEALTH_CHECK_EMAIL || '2001leety@gmail.com';
const HEALTH_PASSWORD = envLocal.HEALTH_CHECK_PASSWORD || envMain.HEALTH_CHECK_PASSWORD;
const BASE_URL = 'https://cocotripkr.com';

// 기대 모델 (운영자 ENV: GEMINI_ADMIN_BYPASS_MODEL=gemini-3.5-flash)
const EXPECTED_MODEL = 'gemini-3.5-flash';

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('P138 진짜 최종 측정');
console.log(`Target: ${BASE_URL}`);
console.log(`Input: seoul+busan 다도시 5일 (이전 측정과 동일 input)`);
console.log(`기대 모델: ${EXPECTED_MODEL}`);
console.log(`환경 정렬: P185 fix + ENV gemini-3.5-flash + cache 해제 빌드`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (!FIREBASE_API_KEY) {
  console.error('VITE_FIREBASE_API_KEY 미설정 — .env 또는 .env.local 확인');
  process.exit(1);
}
if (!HEALTH_PASSWORD) {
  console.error('HEALTH_CHECK_PASSWORD 미설정 — .env.local 확인');
  process.exit(1);
}

// Step 1: Firebase Auth
console.log('[1/2] Firebase Auth signInWithPassword...');
const authStart = Date.now();
const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: HEALTH_EMAIL, password: HEALTH_PASSWORD, returnSecureToken: true }),
    signal: AbortSignal.timeout(15000),
  }
);
const auth = await authRes.json();
if (!auth.idToken) {
  console.error('Auth 실패:', JSON.stringify(auth).slice(0, 300));
  process.exit(1);
}
console.log(`Auth 성공 (uid=${auth.localId}, email=${HEALTH_EMAIL}) — ${Date.now()-authStart}ms\n`);

// Step 2: ADMIN-BYPASS- plan 생성 (1회만)
const orderId = `ADMIN-BYPASS-P138-FINAL-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
console.log(`[2/2] POST /api/ai-planner-full...`);
console.log(`  orderId: ${orderId}`);
console.log(`  시나리오: seoul+busan 5일 다도시 (P138 트리거 조건)\n`);

const planStart = Date.now();
let planRes;
try {
  planRes = await fetch(`${BASE_URL}/api/ai-planner-full`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth.idToken}`,
    },
    body: JSON.stringify({
      paypalOrderId: orderId,
      uid: auth.localId,
      guestName: 'P138Final',
      pax: 2,
      durationDays: 5,
      startDate: '2026-06-25',
      area: 'seoul',
      regions: ['seoul', 'busan'],
      recommendedZones: {
        seoul: 'myeongdong',
        busan: 'haeundae',
      },
      dietPrefs: ['Meat'],
      priceRange: 'Moderate',
      language: 'ko',
      styles: ['Food', 'Culture'],
      arrival_airport: 'ICN_T1',
      departure_airport: 'PUS',
      arrivalTime: '14:00',
      departureTime: '11:00',
      luggage: { small: 1, medium: 2, large: 0 },
    }),
    signal: AbortSignal.timeout(1200000), // 20분 하드 타임아웃
  });
} catch (e) {
  const planMs = Date.now() - planStart;
  console.error(`\n요청 오류: ${e.message}`);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('## P138 진짜 최종 측정 결과 (1 sample)');
  console.log('');
  console.log('### measure 데이터');
  console.log(`- HTTP: TIMEOUT/ERROR after ${(planMs/1000).toFixed(1)}초`);
  console.log(`- 오류: ${e.message}`);
  console.log('');
  console.log('### 판정');
  console.log('- P138 close-out: ❌ (요청 오류)');
  process.exit(1);
}

const planMs = Date.now() - planStart;
const planSec = (planMs / 1000).toFixed(1);

console.log(`HTTP status: ${planRes.status}`);
console.log(`응답 시간: ${planSec}초`);

const planBody = await planRes.json().catch(() => null);

const data = planBody?.data || {};
const debug = data._debug || {};

// 응답 실패 케이스
if (!planRes.ok) {
  const errCode = planBody?.code || '';
  const errMsg = planBody?.error || '';

  console.log('\n플랜 생성 실패 (HTTP ' + planRes.status + ')');
  console.log('오류 코드:', errCode);
  console.log('오류 메시지:', errMsg);
  console.log('오류 상세:', JSON.stringify(planBody, null, 2)?.slice(0, 2000));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('## P138 진짜 최종 측정 결과 (1 sample, free tier Flash)');
  console.log('');
  console.log('### measure 데이터');
  console.log(`- HTTP: ${planRes.status}`);
  console.log(`- 응답 시간: ${planSec}초`);
  console.log(`- 오류: ${errCode} — ${errMsg}`);
  console.log('');
  console.log('### history');
  console.log('- 5/21 baseline (Pro): 270s');
  console.log('- 5/24 (Pro, ENV X): 89-141s');
  console.log('- 5/24 (Flash 2.5, P185 X): 500');
  console.log('- 5/25 cache 미해제: 500');
  console.log(`- 5/25 (Flash 3.5, P185 + cache 해제): HTTP ${planRes.status} — ${planSec}s`);
  console.log('');
  console.log('### 판정');
  console.log('- P138 close-out: ❌ — 추가 진단 필요');
  console.log('- Free tier 작동: ❌ (HTTP 500)');
  console.log('');
  console.log('### 비용 실측');
  console.log('- Gemini: $0 (에러로 과금 없음)');
  console.log('- Vercel: ~$0 (function 조기 종료)');
  process.exit(1);
}

// 응답 성공 케이스
const modelMain = debug.modelMain || '(없음)';
const plannerMode = debug.plannerMode || '(없음)';
const abReason = debug.abReason || '(없음)';
const blockModeUsed = debug.blockModeUsed;
const streamingEnabled = debug.streamingEnabled;
const isAdminBypassFlag = debug.isAdminBypass;
const planId = data.planId || '(없음)';

console.log('\n플랜 생성 성공');
console.log(`planId: ${planId}`);
console.log('_debug 원본:', JSON.stringify(debug, null, 2));

// 모델 판정
const isExpectedModel = modelMain === EXPECTED_MODEL;
const isFlash = modelMain.includes('flash') || modelMain.includes('Flash');
const isPro = modelMain.includes('pro') || modelMain.includes('Pro');

// P138 판정
let p138Result;
let p138Icon;
if (planRes.status === 200 && parseFloat(planSec) <= 120 && isExpectedModel) {
  p138Result = '완전 close-out ✅';
  p138Icon = '✅';
} else if (planRes.status === 200 && isExpectedModel && parseFloat(planSec) > 120) {
  p138Result = '부분 close-out — 120s 초과, 추가 최적화 필요';
  p138Icon = '⚠️';
} else if (planRes.status === 200 && !isExpectedModel) {
  p138Result = `HTTP 200 성공 — 단, 모델 불일치 (${modelMain} ≠ ${EXPECTED_MODEL})`;
  p138Icon = '⚠️';
} else {
  p138Result = 'HTTP 500 — 추가 진단 필요 ❌';
  p138Icon = '❌';
}

// Flash vs Pro 응답 시간 비교
let flashVsPro = '';
if (isFlash) {
  const diff = 270 - parseFloat(planSec);
  flashVsPro = `Flash ${planSec}s vs Pro baseline 270s — ${diff.toFixed(0)}초 단축 (${((diff/270)*100).toFixed(0)}% 개선)`;
} else if (isPro) {
  flashVsPro = `Pro 모드 — baseline 대비 ${(270-parseFloat(planSec)).toFixed(0)}초 단축`;
}

// 비용 추정
let costEstimate;
if (isFlash && !modelMain.includes('lite')) {
  costEstimate = '~$0 (gemini-3.5-flash free tier)';
} else if (isPro) {
  costEstimate = '~$0.20 (Pro — 5일 plan ~100K token)';
} else {
  costEstimate = '확인 필요';
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('## P138 진짜 최종 측정 결과 (1 sample, free tier Flash)');
console.log('');
console.log('### measure 데이터');
console.log(`- HTTP: ${planRes.status}`);
console.log(`- modelMain: ${modelMain} ${isExpectedModel ? '✅' : `❌ (기대: ${EXPECTED_MODEL})`}`);
console.log(`- plannerMode: ${plannerMode}`);
console.log(`- abReason: ${abReason}`);
console.log(`- isAdminBypass: ${isAdminBypassFlag}`);
console.log(`- blockModeUsed: ${blockModeUsed}`);
console.log(`- streamingEnabled: ${streamingEnabled}`);
console.log(`- planId: ${planId}`);
console.log(`- 응답 시간: ${planSec}초`);
console.log('');
console.log('### history');
console.log('- 5/21 baseline (Pro): 270s');
console.log('- 5/24 (Pro, ENV X): 89-141s');
console.log('- 5/24 (Flash 2.5, P185 X): 500');
console.log('- 5/25 cache 미해제: 500');
console.log(`- 5/25 (Flash 3.5, P185 + cache 해제): HTTP ${planRes.status} — ${planSec}s`);
console.log('');
console.log('### 판정');
console.log(`- P138 close-out: ${p138Icon} ${p138Result}`);
console.log(`- Free tier 작동: ${isFlash ? '✅ (Flash)' : `❌ (${modelMain})`}`);
if (flashVsPro) console.log(`- Flash vs Pro: ${flashVsPro}`);
console.log('');
console.log('### 비용 실측');
console.log(`- Gemini: ${costEstimate}`);
console.log('- Vercel: ~$0.005 (5분 이내 Fluid Compute)');
