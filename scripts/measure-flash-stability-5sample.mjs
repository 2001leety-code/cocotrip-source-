/**
 * Flash 3.5 안정 통계 측정 — 5/25 cycle 39.1초 결과의 1 sample 한계 검증
 * 통제 변수: 0 (동일 input × 5회 반복)
 * 검증 의도: A/B 아님. 1 sample 통계 신뢰성 (noise vs 안정 판정)
 * 동일 input: seoul+busan 5일 (measure-p138-final.mjs 와 동일)
 * 회수: 5회
 * 추정 비용: Gemini Flash $0 + Vercel CPU ~$1.50
 * 하드 타임아웃: 회당 20분, 전체 110분
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
const EXPECTED_MODEL = 'gemini-3.5-flash';
const SAMPLE_COUNT = 5;
const SLEEP_BETWEEN_SAMPLES_MS = 10_000;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Flash 3.5 안정 통계 측정 (${SAMPLE_COUNT} sample)`);
console.log(`Target: ${BASE_URL}`);
console.log(`Input: seoul+busan 5일 (동일 input × ${SAMPLE_COUNT}회)`);
console.log(`통제 변수: 0`);
console.log(`기대 모델: ${EXPECTED_MODEL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (!FIREBASE_API_KEY) {
  console.error('VITE_FIREBASE_API_KEY 미설정');
  process.exit(1);
}
if (!HEALTH_PASSWORD) {
  console.error('HEALTH_CHECK_PASSWORD 미설정');
  process.exit(1);
}

console.log('[Setup] Firebase Auth signInWithPassword...');
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

const samples = [];

for (let i = 1; i <= SAMPLE_COUNT; i++) {
  const orderId = `ADMIN-BYPASS-FLASH-STAB-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  console.log(`\n━━━ Sample ${i}/${SAMPLE_COUNT} ━━━`);
  console.log(`orderId: ${orderId}`);

  const planStart = Date.now();
  let planRes;
  let err = null;
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
        guestName: 'FlashStab',
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
      signal: AbortSignal.timeout(1200000),
    });
  } catch (e) {
    err = e.message;
  }

  const planMs = Date.now() - planStart;
  const planSec = (planMs / 1000).toFixed(1);

  if (err) {
    console.log(`❌ Sample ${i} ERROR after ${planSec}초 — ${err}`);
    samples.push({ sample: i, status: 0, sec: parseFloat(planSec), secHttp: parseFloat(planSec), secPoll: 0, finalStatus: 'error', model: null, planId: null, err, isSuccess: false });
  } else {
    const planBody = await planRes.json().catch(() => null);
    const data = planBody?.data || {};
    const debug = data._debug || {};
    const modelMain = debug.modelMain || '(없음)';
    const planId = data.planId || null;
    const initialStatus = data.status || 'unknown'; // 'streaming' | 'ready' | 'unknown'

    // ── P206: status='streaming' 이면 /api/plan-status polling 의무화 ──────────
    // 5/26 발견: HTTP 200 + 35초 = measure "성공"이지만 실제 plan 미완성
    // (background pipeline 계속). OpenAI Background Mode / Replicate 동일 패턴.
    // deep-search: reports/visual-2026-05-26/deepsearch-p206.md
    // polling 간격: 5초, timeout: 10분 (Vercel maxDuration 600s 일치)
    let finalStatus = initialStatus;
    let pollElapsedMs = 0;
    const POLL_INTERVAL_MS = 5_000;
    const POLL_TIMEOUT_MS = 10 * 60_000; // 10분 하드 타임아웃

    if (planId && initialStatus === 'streaming') {
      console.log(`  → status=streaming. Polling /api/plan-status until ready... (max 10min)`);
      const pollStart = Date.now();
      while (pollElapsedMs < POLL_TIMEOUT_MS) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        pollElapsedMs = Date.now() - pollStart;
        try {
          const statusRes = await fetch(
            `${BASE_URL}/api/plan-status?planId=${planId}`,
            {
              headers: { 'Authorization': `Bearer ${auth.idToken}` },
              signal: AbortSignal.timeout(10_000),
            },
          );
          const statusBody = await statusRes.json().catch(() => null);
          finalStatus = statusBody?.data?.status || 'unknown';
          const days = statusBody?.data?.days !== undefined ? statusBody.data.days : '?';
          console.log(`  → [poll +${(pollElapsedMs / 1000).toFixed(0)}s] status=${finalStatus} days=${days}`);
          if (finalStatus === 'ready' || finalStatus === 'error') break;
        } catch (pollErr) {
          console.warn(`  → poll error: ${pollErr.message}`);
        }
      }
      if (finalStatus !== 'ready') {
        console.warn(`  → TIMEOUT or error after ${(pollElapsedMs / 1000).toFixed(0)}s. finalStatus=${finalStatus}`);
        finalStatus = finalStatus === 'unknown' ? 'timeout' : finalStatus;
      }
    }

    // ③ 전체 elapsed = HTTP 응답 시간 + polling 대기 시간
    const totalMs = planMs + pollElapsedMs;
    const totalSec = (totalMs / 1000).toFixed(1);
    const secPoll = parseFloat((pollElapsedMs / 1000).toFixed(1));
    // 비스트리밍(unknown) = HTTP 200 즉시 완료, streaming = polling 후 ready 확인
    const isSuccess = finalStatus === 'ready' || (initialStatus === 'unknown' && planRes.status === 200);

    console.log(`HTTP: ${planRes.status} / initialStatus: ${initialStatus} / finalStatus: ${finalStatus} / httpSec: ${planSec}초 / pollSec: ${secPoll}초 / totalSec: ${totalSec}초 / planId: ${planId ? planId.slice(0, 8) : '없음'}`);
    samples.push({
      sample: i,
      status: planRes.status,
      finalStatus,
      sec: parseFloat(totalSec),      // 진짜 완료까지 걸린 시간 (통계 기준)
      secHttp: parseFloat(planSec),   // HTTP 응답만
      secPoll,                         // polling 대기 시간
      isSuccess,
      model: modelMain,
      planId,
      plannerMode: debug.plannerMode,
      blockModeUsed: debug.blockModeUsed,
      streamingEnabled: debug.streamingEnabled,
    });
  }

  if (i < SAMPLE_COUNT) {
    console.log(`(다음 sample 까지 ${SLEEP_BETWEEN_SAMPLES_MS/1000}초 대기 — Vercel cold start 노이즈 분리)`);
    await new Promise(r => setTimeout(r, SLEEP_BETWEEN_SAMPLES_MS));
  }
}

// P206: isSuccess 기준 (status=ready 확인 완료된 것만)
const successSamples = samples.filter(s => s.isSuccess);
const times = successSamples.map(s => s.sec);
const mean = times.length ? times.reduce((a,b)=>a+b,0) / times.length : 0;
const sorted = [...times].sort((a,b)=>a-b);
const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length-1)/2] : (sorted[sorted.length/2-1] + sorted[sorted.length/2])/2) : 0;
const variance = times.length ? times.reduce((a,b)=>a+(b-mean)**2, 0) / times.length : 0;
const stddev = Math.sqrt(variance);
const min = times.length ? Math.min(...times) : 0;
const max = times.length ? Math.max(...times) : 0;
const range = max - min;

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`## Flash 3.5 안정 통계 측정 결과 (${SAMPLE_COUNT} sample)`);
console.log('');
console.log('### Sample 데이터 (동일 input, 통제 변수 0)');
console.log('| # | HTTP | finalStatus | httpSec | pollSec | totalSec | Model | planId |');
console.log('|---|---|---|---|---|---|---|---|');
samples.forEach(s => {
  const planIdShort = s.planId ? s.planId.slice(0, 8) + '...' : '(에러)';
  const ok = s.isSuccess ? 'ready' : (s.finalStatus || 'fail');
  console.log(`| ${s.sample} | ${s.status} | ${ok} | ${s.secHttp !== undefined ? s.secHttp : s.sec} | ${s.secPoll !== undefined ? s.secPoll : 0} | ${s.sec} | ${s.model || '(none)'} | ${planIdShort} |`);
});

console.log('');
console.log('### 통계');
console.log(`- 성공률: ${successSamples.length}/${SAMPLE_COUNT}`);
console.log(`- mean: ${mean.toFixed(1)}초`);
console.log(`- median: ${median.toFixed(1)}초`);
console.log(`- stddev: ${stddev.toFixed(1)}초`);
console.log(`- min/max: ${min.toFixed(1)} / ${max.toFixed(1)}초`);
console.log(`- range: ${range.toFixed(1)}초 (max - min)`);
console.log(`- CV (변동계수): ${(mean > 0 ? (stddev/mean*100).toFixed(1) : 0)}%`);

console.log('');
console.log('### 5/25 cycle 1 sample (39.1초) 와 비교');
if (mean > 0) {
  const diff = mean - 39.1;
  const diffPct = (diff / 39.1 * 100).toFixed(1);
  console.log(`- 1 sample (39.1초) vs ${SAMPLE_COUNT} sample mean (${mean.toFixed(1)}초): ${diff > 0 ? '+' : ''}${diff.toFixed(1)}초 (${diffPct}%)`);
  console.log(`- 1 sample (39.1초) 이 mean 의 ${((39.1 - mean) / stddev).toFixed(1)}σ 위치`);
  if (Math.abs(39.1 - mean) <= stddev) {
    console.log(`- 판정: ✅ 39.1초는 noise 범위 안 — 안정 통계 확인`);
  } else if (Math.abs(39.1 - mean) <= 2 * stddev) {
    console.log(`- 판정: ⚠️ 39.1초는 1-2σ 위치 — 약간 outlier, 운영 범위 확인 필요`);
  } else {
    console.log(`- 판정: ❌ 39.1초는 2σ 초과 outlier — 5/25 측정이 운 좋은 1 sample 였을 가능성`);
  }
}

console.log('');
console.log('### 비용 실측');
console.log(`- Gemini: $0 (Flash free tier)`);
console.log(`- Vercel: ~$${(0.3 * SAMPLE_COUNT).toFixed(2)} (${SAMPLE_COUNT}회 × ~$0.30 Fluid Compute)`);
