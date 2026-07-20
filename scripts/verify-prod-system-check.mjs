#!/usr/bin/env node
// 2026-05-13 사용자 종합 검증 요청 — AI 플래너 100 + 차터 10 + 투어 10
//
// ⚠️ 중요 (2026-07-20 갱신): TEST- prefix orderId 경로는 **폐지됐다**. 환경과 무관하게 항상 403.
//          구 안내였던 "BRAINTREE_ENV=sandbox 환경 사용" 은 더 이상 유효하지 않다 —
//          그 env var 는 Vercel 에 등록된 적조차 없었고, admin 검사 없는 우회라 제거했다.
//          이제 유일한 경로는 ADMIN-BYPASS- prefix + admin Firebase ID token 이다
//          (아래 orderId 는 이미 이주 완료). 토큰 발급 패턴 = scripts/validate-planner.cjs::getIdToken.
//
// 사용법:
//   1. Vercel preview URL 결정 (예: https://cocotrip-source2026-xxxxx.vercel.app)
//      또는 admin 계정으로 PROD 사용 (ADMIN-BYPASS- 변경 필요)
//   2. Firebase ID token 발급 (브라우저 dev tools 에서 추출):
//      - {URL} 로그인 (TEST_ACCOUNTS: 2001leety@gmail.com 권장)
//      - DevTools Console:
//          (await firebase.auth().currentUser.getIdToken()).slice(0)
//      - 출력된 토큰 복사
//   3. 환경변수 설정 후 실행:
//      $env:BASE_URL = "https://cocotrip-source2026-xxxxx.vercel.app"
//      $env:FIREBASE_ID_TOKEN = "<paste token>"
//      node scripts/verify-prod-system-check.mjs --plans 100 --charters 10 --tours 10
//
//   4. (선택) Dry-run 으로 payload 확인:
//      node scripts/verify-prod-system-check.mjs --plans 5 --dry-run
//
// 비용 예상 (PROD 기준):
//   - AI 플래너 100회: Gemini API ~$10, Vercel function time ~3-5h (병렬 8 worker 시 ~30분)
//   - 차터 10회: payment gateway sandbox bypass — 무료, ~1분
//   - 투어 10회: 동일 — 무료, ~1분
//
// 결과:
//   - JSON 보고서: outputs/verify-{timestamp}.json
//   - 콘솔 요약: 성공률, 에러 분포, latency p50/p95/p99
//
// 운영자 동시 모니터링:
//   - Telegram bot (error channel)
//   - Sentry dashboard
//   - Vercel function logs (`gh ... vercel logs ...` 또는 dashboard)
//   - Admin dashboard (/admin)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.BASE_URL || 'https://cocotripkr.com';
const ID_TOKEN = process.env.FIREBASE_ID_TOKEN;
const CONCURRENCY = Number(process.env.CONCURRENCY) || 4; // 병렬 worker

if (!ID_TOKEN) {
  console.error('❌ FIREBASE_ID_TOKEN env 미설정. 브라우저 console:');
  console.error('   (await firebase.auth().currentUser.getIdToken()).slice(0)');
  process.exit(1);
}

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, defaultVal) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? Number(args[idx + 1]) : defaultVal;
};
const TARGET_PLANS = getArg('plans', 100);
const TARGET_CHARTERS = getArg('charters', 10);
const TARGET_TOURS = getArg('tours', 10);
const DRY_RUN = args.includes('--dry-run');

console.log(`[verify] base=${BASE_URL} concurrency=${CONCURRENCY} dryRun=${DRY_RUN}`);
console.log(`[verify] targets: AI plans=${TARGET_PLANS}, charters=${TARGET_CHARTERS}, tours=${TARGET_TOURS}`);

// ── Synthetic input pools ────────────────────────────────────────────────────
const CITIES = ['Seoul', 'Busan', 'Jeju', 'Gangneung', 'Sokcho', 'Gyeongju', 'Jeonju'];
const STYLES_POOL = [['culture'], ['food'], ['shopping'], ['kpop'], ['hanbok'], ['culture', 'food']];
const DIETARIES_POOL = [[], ['halal'], ['vegan'], ['vegetarian'], ['seafood'], ['halal', 'no_pork']];
const LANGS = ['ko', 'en', 'ja', 'zh'];
const DURATIONS = [1, 2, 3, 4, 5, 7]; // single ~ week

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function tomorrow(daysAhead = 1) {
  const d = new Date(Date.now() + (daysAhead + 1) * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function buildPlannerPayload(i) {
  const days = pick(DURATIONS);
  const isMulti = Math.random() < 0.35 && days >= 2;
  const cities = isMulti ? [pick(CITIES), pick(CITIES.filter(c => c !== 'Seoul'))] : [pick(CITIES)];
  return {
    orderId: `ADMIN-BYPASS-VERIFY-${Date.now()}-${i}`,
    guest_name: `Guest-${i}`,
    pax: 1 + Math.floor(Math.random() * 5),
    styles: pick(STYLES_POOL),
    dietary: pick(DIETARIES_POOL),
    durationDays: days,
    date: tomorrow(1 + Math.floor(Math.random() * 30)),
    regions: cities,
    area: cities[0],
    language: pick(LANGS),
    arrival_airport: cities[0] === 'Busan' ? 'PUS' : cities[0] === 'Jeju' ? 'CJU' : 'ICN',
    mobility: 'ok',
  };
}

function buildCharterPayload(i) {
  return {
    orderId: `ADMIN-BYPASS-VERIFY-CHARTER-${Date.now()}-${i}`,
    serviceMode: pick(['airport_transfer', 'day_tour', 'multi_day']),
    vehicleType: pick(['staria_8', 'sprinter', 'large_bus']),
    paxAdult: 2 + Math.floor(Math.random() * 6),
    origin: 'Incheon Intl Airport',
    destination: pick(['Seoul', 'Busan', 'Gyeongju']),
    date: tomorrow(1 + Math.floor(Math.random() * 30)),
    language: pick(LANGS),
  };
}

function buildTourPayload(i) {
  return {
    orderId: `ADMIN-BYPASS-VERIFY-TOUR-${Date.now()}-${i}`,
    tourSlug: pick(['gyeongju-day-tour', 'busan-1day', 'jeju-east-circle']),
    date: tomorrow(1 + Math.floor(Math.random() * 30)),
    paxAdult: 1 + Math.floor(Math.random() * 4),
    language: pick(LANGS),
  };
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
async function postEndpoint(path, body, label) {
  const start = Date.now();
  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ID_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    const latency = Date.now() - start;
    let json;
    try { json = await res.json(); } catch { json = { _parseError: true }; }
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: latency,
      code: json?.code,
      error: json?.error,
      planId: json?.data?.planId || json?.data?.bookingId,
      payload: body,
      label,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
      code: 'FETCH_ERROR',
      error: String(err.message || err),
      payload: body,
      label,
    };
  }
}

// ── Concurrency runner ───────────────────────────────────────────────────────
async function runBatch(buildFn, endpoint, count, label) {
  const results = [];
  const workers = Math.min(CONCURRENCY, count);
  let nextIdx = 0;
  let done = 0;
  const startBatch = Date.now();

  async function worker(workerId) {
    while (true) {
      const i = nextIdx++;
      if (i >= count) return;
      const payload = buildFn(i);
      if (DRY_RUN) {
        results.push({ ok: true, dryRun: true, payload, label });
        continue;
      }
      const r = await postEndpoint(endpoint, payload, label);
      results.push(r);
      done++;
      if (done % 5 === 0 || done === count) {
        const elapsed = ((Date.now() - startBatch) / 1000).toFixed(1);
        const okCount = results.filter(x => x.ok).length;
        console.log(`  [${label}] ${done}/${count} (✓${okCount}/✗${done - okCount}) elapsed=${elapsed}s`);
      }
    }
  }

  await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
  return results;
}

// ── Aggregation ──────────────────────────────────────────────────────────────
function aggregate(results, label) {
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  const codes = {};
  for (const r of fail) {
    const k = r.code || `HTTP_${r.status}`;
    codes[k] = (codes[k] || 0) + 1;
  }
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const pct = (p) => latencies.length ? latencies[Math.floor(latencies.length * p / 100)] : 0;
  return {
    label,
    total: results.length,
    ok: ok.length,
    fail: fail.length,
    successRate: results.length ? (ok.length / results.length * 100).toFixed(1) : 0,
    errorCodes: codes,
    latency: {
      p50: pct(50),
      p95: pct(95),
      p99: pct(99),
      max: Math.max(...latencies, 0),
    },
    sampleErrors: fail.slice(0, 5).map(r => ({ status: r.status, code: r.code, error: r.error })),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const overallStart = Date.now();
  console.log('\n=== Phase 1: AI Planner ' + TARGET_PLANS + 'x ===');
  const plannerResults = await runBatch(buildPlannerPayload, '/api/ai-planner-full', TARGET_PLANS, 'AI Planner');

  console.log('\n=== Phase 2: Charter ' + TARGET_CHARTERS + 'x ===');
  const charterResults = await runBatch(buildCharterPayload, '/api/booking', TARGET_CHARTERS, 'Charter');

  console.log('\n=== Phase 3: Tour ' + TARGET_TOURS + 'x ===');
  const tourResults = await runBatch(buildTourPayload, '/api/booking', TARGET_TOURS, 'Tour');

  const totalElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);

  const summary = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    targets: { plans: TARGET_PLANS, charters: TARGET_CHARTERS, tours: TARGET_TOURS },
    totalElapsedSec: totalElapsed,
    aiPlanner: aggregate(plannerResults, 'AI Planner'),
    charter: aggregate(charterResults, 'Charter'),
    tour: aggregate(tourResults, 'Tour'),
  };

  // Persist
  const outDir = path.join(__dirname, '..', 'outputs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(outDir, `verify-${ts}.json`);
  const detailsPath = path.join(outDir, `verify-${ts}-details.json`);
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(detailsPath, JSON.stringify({
    aiPlanner: plannerResults,
    charter: charterResults,
    tour: tourResults,
  }, null, 2));

  // Console summary
  console.log('\n\n══════════════════════════════════════════════════════════════');
  console.log('  CocoTrip 종합 검증 결과 (' + totalElapsed + 's)');
  console.log('══════════════════════════════════════════════════════════════');
  for (const sec of [summary.aiPlanner, summary.charter, summary.tour]) {
    console.log(`\n[${sec.label}] ${sec.ok}/${sec.total} PASS (성공률 ${sec.successRate}%)`);
    console.log(`  latency p50=${sec.latency.p50}ms  p95=${sec.latency.p95}ms  p99=${sec.latency.p99}ms  max=${sec.latency.max}ms`);
    if (sec.fail > 0) {
      console.log(`  에러 분포:`);
      for (const [code, count] of Object.entries(sec.errorCodes)) {
        console.log(`    ${code}: ${count}건`);
      }
      console.log(`  샘플 에러 (최대 5):`);
      for (const e of sec.sampleErrors) {
        console.log(`    [${e.status}] ${e.code}: ${e.error}`);
      }
    }
  }
  console.log('\n결과:');
  console.log(`  요약 보고서: ${reportPath}`);
  console.log(`  상세 데이터: ${detailsPath}`);
  console.log('\n운영자 후속 액션:');
  console.log('  - Telegram error channel 확인 (예상: PLAN_VALIDATION_FAILED 빈도)');
  console.log('  - Sentry dashboard 확인 (captureError 발생 패턴)');
  console.log('  - Vercel function logs grep `[validator] B-MEAL` `[validator] B-DC` `[Route]`');
  console.log('  - Admin /admin/plans 페이지에서 생성된 plan 검수 (sample 5+)');
  console.log('  - Firestore plans/{id} 검사 — durationDays 일치, meal coverage 확인');
})();
