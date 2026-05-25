/**
 * P138 재측정 스크립트 — ENV GEMINI_ADMIN_BYPASS_MODEL 수정 후 1회 측정
 * 통제 변수: ENV 1개 (gemini-3.5-flash → gemini-2.5-flash)
 * 동일 input: 다도시 seoul+busan 5일 (P138 트리거 조건)
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

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('P138 재측정 — ENV GEMINI_ADMIN_BYPASS_MODEL 수정 후');
console.log(`Target: ${BASE_URL}`);
console.log(`Input: seoul+busan 다도시 5일 (다도시 = P138 트리거 조건)`);
console.log(`통제 변수: ENV 1개 (gemini-3.5-flash → gemini-2.5-flash)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

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
console.log(`Auth 성공 (uid=${auth.localId}) — ${Date.now()-authStart}ms\n`);

// Step 2: ADMIN-BYPASS- plan 생성
const orderId = `ADMIN-BYPASS-P138-RECHECK-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
console.log(`[2/2] POST /api/ai-planner-full...`);
console.log(`  orderId: ${orderId}`);
console.log(`  시나리오: seoul+busan 5일 다도시 (이전 측정과 동일 input)\n`);

const planStart = Date.now();
const planRes = await fetch(`${BASE_URL}/api/ai-planner-full`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${auth.idToken}`,
  },
  body: JSON.stringify({
    paypalOrderId: orderId,
    uid: auth.localId,
    guestName: 'P138ReCheck',
    pax: 2,
    durationDays: 5,
    startDate: '2026-06-20',
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
  signal: AbortSignal.timeout(300000),
});

const planMs = Date.now() - planStart;
const planSec = (planMs / 1000).toFixed(1);

console.log(`HTTP status: ${planRes.status}`);
console.log(`응답 시간: ${planSec}초`);

const planBody = await planRes.json().catch(() => null);

if (!planRes.ok) {
  console.log('\n플랜 생성 실패 (HTTP ' + planRes.status + ')');
  console.log('오류 내용:', JSON.stringify(planBody, null, 2)?.slice(0, 1500));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('## P138 재측정 결과 (ENV 수정 후, 1 sample)');
  console.log('');
  console.log('### measure 데이터');
  console.log(`- HTTP status: ${planRes.status}`);
  console.log(`- 응답 시간: ${planSec}초`);
  console.log('- _debug: 응답 없음 (HTTP ' + planRes.status + ')');
  console.log('');
  console.log('### 판정');
  console.log('- 이전 (5/21 baseline): 270초');
  console.log('- 5/24 측정 (ENV 활성화 전): 89~141초');
  console.log(`- 현재 (ENV 수정 후): ${planSec}초 — HTTP ${planRes.status}`);
  console.log('- P138 close-out: HTTP 500 — ENV 미반영 가능성');
  console.log('');
  console.log('### admin-bypass 정상화');
  console.log('- ENV 반영: (500 응답으로 확인 불가)');
  console.log('- HTTP 500 차단: 아직 발생 중');
  process.exit(1);
}

const data = planBody?.data || {};
const debug = data._debug || {};

console.log('\n플랜 생성 성공');
console.log(`planId: ${data.planId}`);
console.log('_debug 원본:', JSON.stringify(debug, null, 2));

// _debug 파싱
const modelMain = debug.modelMain || '(없음)';
const plannerMode = debug.plannerMode || '(없음)';
const abReason = debug.abReason || '(없음)';
const blockModeUsed = debug.blockModeUsed;
const streamingEnabled = debug.streamingEnabled;
const isAdminBypass = debug.isAdminBypass;

// 모델 판정
let modelEmoji;
if (modelMain === 'gemini-2.5-flash') modelEmoji = 'PASS';
else if (modelMain.includes('gemini-3.5-flash')) modelEmoji = 'FAIL (ENV 미반영)';
else if (modelMain.includes('gemini-2.5-pro')) modelEmoji = 'WARN (Pro 사용중)';
else modelEmoji = 'WARN (예상치 못한 모델)';

// P138 판정
let p138Result;
if (planSec <= 120 && planRes.status === 200 && modelMain === 'gemini-2.5-flash') {
  p138Result = 'P138 완전 close-out';
} else if (planRes.status === 200 && modelMain === 'gemini-2.5-flash') {
  p138Result = '부분 (120s 초과 — 추가 최적화 필요)';
} else if (planRes.status !== 200) {
  p138Result = 'HTTP 500 — ENV 미반영';
} else {
  p138Result = '모델 불일치 (' + modelMain + ')';
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('## P138 재측정 결과 (ENV 수정 후, 1 sample)');
console.log('');
console.log('### measure 데이터');
console.log(`- HTTP status: ${planRes.status}`);
console.log(`- 응답 시간: ${planSec}초`);
console.log(`- modelMain: ${modelMain} — ${modelEmoji}`);
console.log(`- plannerMode: ${plannerMode}`);
console.log(`- abReason: ${abReason}`);
console.log(`- blockModeUsed: ${blockModeUsed}`);
console.log(`- streamingEnabled: ${streamingEnabled}`);
console.log(`- isAdminBypass: ${isAdminBypass}`);
console.log('');
console.log('### 판정');
console.log('- 이전 (5/21 baseline): 270초');
console.log('- 5/24 측정 (ENV 활성화 전): 89~141초');
console.log(`- 현재 (ENV 수정 후): ${planSec}초`);
console.log(`- P138 close-out: ${p138Result}`);
console.log('');
console.log('### admin-bypass 정상화');
console.log(`- ENV 반영: ${modelMain === 'gemini-2.5-flash' ? '정상 (gemini-2.5-flash)' : '이상 (' + modelMain + ')'}`);
console.log(`- HTTP 500 차단: ${planRes.status === 200 ? '정상 (200 응답)' : '실패 (' + planRes.status + ')'}`);
console.log('');
console.log('### 비용 추정');
if (modelMain.includes('flash') && !modelMain.includes('lite')) {
  console.log('- Gemini API: ~$0.02 (Flash — 5일 plan ~100K token)');
} else if (modelMain.includes('pro')) {
  console.log('- Gemini API: ~$0.20 (Pro — 5일 plan ~100K token)');
} else {
  console.log('- Gemini API: 확인 필요');
}
console.log('- Vercel CPU: ~$0.005 (5분 이내)');
