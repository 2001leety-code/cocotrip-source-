/**
 * CocoTrip — Planner Quality Validation Runner
 * Phase 1: 기준점 측정용
 *
 * Usage: node scripts/validate-planner.js [base-url]
 * Default: https://cocotripkr.com
 *
 * 5개 시나리오를 순차 실행하여 planner-report.json 생성
 * ⚠️ Gemini API 5회 호출 (비용 발생)
 *
 * P174 (2026-05-24): paypalOrderId → ADMIN-BYPASS-VALIDATE-... (admin email 인증
 * LIVE bypass). 이전 TEST- prefix 는 BRAINTREE_ENV='production' 인 prod 에서 403
 * reject (audit P1-A) — 5/12~5/24 12일간 자율 검증 silent fail root cause.
 *
 * Caveat (P102): ADMIN-BYPASS- → decidePlannerMode 가 'legacy' 강제. 본 검증은
 * P164/P165/P166/P169/P171 효과 측정 가능. P167/P168/P172 (3pass/block-mode/PCT
 * bucketing) 는 별도 (실제 결제 또는 staging). docs/AUTOMATION.md 8 절 참조.
 */
const fs = require('fs');
const path = require('path');

// Tier 2-D: shared 9-metric scorer. Lazy ESM import (this file is .cjs).
let _qualityMod = null;
async function loadQualityMetrics() {
  if (_qualityMod) return _qualityMod;
  _qualityMod = await import('../api/_ai_core/qualityMetrics.js');
  return _qualityMod;
}

const BASE = process.argv[2] || 'https://cocotripkr.com';
const API_URL = `${BASE}/api/ai-planner-full`;

// 테스트 계정 — ai-planner-full.js의 TEST_ACCOUNTS 목록에 있어야 함
const TEST_EMAIL = process.env.HEALTH_CHECK_EMAIL || '2001leety@gmail.com';

// ── Firebase Auth: 자율점검용 idToken 발급 ────────────────────────────────
// 2026-05-04 PR #247 (audit P0-#2) 머지로 /api/ai-planner-full 가 verifyUserToken
// 호출 → Authorization: Bearer <idToken> 헤더 필수. 미주입 시 401 만 받음.
// 따라서 fetch 직전 Firebase Auth REST API 로 idToken 발급 → Bearer 헤더 주입.
//
// 필수 env:
//   - FIREBASE_WEB_API_KEY: Firebase Console → Project settings → General → Web API Key
//   - HEALTH_CHECK_PASSWORD: TEST_ACCOUNTS 계정 비밀번호
//   - (선택) HEALTH_CHECK_EMAIL: 기본값 2001leety@gmail.com
async function getIdToken() {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const password = process.env.HEALTH_CHECK_PASSWORD;
  if (!apiKey || !password) {
    throw new Error(
      'FIREBASE_WEB_API_KEY + HEALTH_CHECK_PASSWORD env 필수. ' +
      'GitHub Actions Secrets 또는 로컬 .env 에 등록 필요. ' +
      'docs/AUTOMATION.md 참조.'
    );
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password, returnSecureToken: true }),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`Firebase Auth signInWithPassword failed: HTTP ${r.status} — ${errText.substring(0, 200)}`);
  }
  const j = await r.json();
  if (!j.idToken) {
    throw new Error('Firebase Auth response missing idToken');
  }
  return j.idToken;
}

// 2026-07-03 fix: 고정 '2026-05-01'(과거)이 서버 날짜검증(PLANNER_DATE_TOO_SOON)에 걸려
// 5월 이후 5개 시나리오 전부 HTTP 400 → daily-health "Run Daily Health Check" 스텝 상시 FAIL.
// validate-prod-regression.mjs 는 PR #986(b194181c)이 동적 미래날짜로 고쳤는데 이 파일만 남아있었음.
const FUTURE_START = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

// 🔴 2026-08-05: 시나리오 3개에 **도착·출국 시각**을 넣는다.
//   그 전까지 5개 전부 시각이 없어서 applyDepartureDayFlightCap 이 조기 반환했다
//   → 도착일·출국일 계열 결함(#1225·#1227·#1228·#1229·#1231·#1236·#1237·#1239)을
//   **자동 검증이 단 한 번도 건드리지 못했다.** 전부 손으로 운영 API 를 쳐서 찾았다.
//   시나리오 수는 그대로 5개 = Gemini 호출 수 그대로 = 비용 증가 0.
//
//   커버리지 배분:
//     jeju-vegan   → legacy + 같은 권역(CJU). **legacy 를 부르는 키는 식이 제약이다**
//                    (Vegan/Halal 은 블록 매칭 실패로 legacy 폴백. Meat 는 block_mode).
//     busan-halal  → legacy + **권역 밖**(부산 손님 ↔ 인천공항 = 직선 346km, 이동 277분).
//                    #1228/#1236 거리 보정과 #1231 체크아웃 순서가 여기서만 드러난다.
//     seoul-meat   → block_mode + 같은 권역. 보정이 **걸리지 않아야** 하는 대조군.
//   rep1/rep2 는 다양성 비교쌍이라 건드리지 않는다(비교 조건을 바꾸면 중복률이 무의미해진다).
const scenarios = [
  { id: 'seoul-meat',      area: 'seoul', durationDays: 2, pax: 2, dietPrefs: ['Meat'],   priceRange: 'Moderate', language: 'ko', startDate: FUTURE_START, guestName: 'Validate-Test', arrivalTime: '14:00', departureTime: '10:00' },
  { id: 'busan-halal',     area: 'busan', durationDays: 3, pax: 4, dietPrefs: ['Halal'],  priceRange: 'Moderate', language: 'ko', startDate: FUTURE_START, guestName: 'Validate-Test', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1' },
  { id: 'jeju-vegan',      area: 'jeju',  durationDays: 2, pax: 2, dietPrefs: ['Vegan'],  priceRange: 'Budget',   language: 'en', startDate: FUTURE_START, guestName: 'Validate-Test', arrivalTime: '14:00', departureTime: '10:00' },
  { id: 'seoul-meat-rep1', area: 'seoul', durationDays: 2, pax: 2, dietPrefs: ['Meat'],   priceRange: 'Moderate', language: 'ko', startDate: FUTURE_START, guestName: 'Validate-Test' },
  { id: 'seoul-meat-rep2', area: 'seoul', durationDays: 2, pax: 2, dietPrefs: ['Meat'],   priceRange: 'Moderate', language: 'ko', startDate: FUTURE_START, guestName: 'Validate-Test' },
];

function extractStops(data) {
  const it = data?.data?.itinerary || data?.itinerary || data;
  return (it.days || []).flatMap(d =>
    (d.stops || []).map(s => ({
      name: s.name || s.name_ko || '',
      name_en: s.display_name || s.name_en || '',
      category: s.category || '',
      address: s.address || '',
      hasAddress: !!s.address,
      hasNumber: /\d/.test(s.address || ''),
      addressStartsWithCity: /^(서울|부산|제주|인천|경기|강원|충청|전라|경상|울산|대구|대전|광주|세종)/.test(s.address || ''),
      hasNaverMap: !!s.naverMapUrl,
      hasCoords: !!(s.lat && s.lng),
      verified: !!s.verified,
      tip_lang: detectTipLang(s),
      stay_min: s.stay_min || 0,
    }))
  );
}

function detectTipLang(stop) {
  // 새 스키마: tip 필드
  const tip = stop.tip || stop.tip_en || '';
  if (!tip) return 'none';
  if (/^[A-Za-z0-9\s.,!?'\-:()]+$/.test(tip)) return 'en';
  if (/[\uAC00-\uD7A3]/.test(tip)) return 'ko';
  return 'mixed';
}

function calcDiversity(results) {
  const rep1 = results.find(r => r.scenario.id === 'seoul-meat-rep1');
  const rep2 = results.find(r => r.scenario.id === 'seoul-meat-rep2');
  if (!rep1?.stops?.length || !rep2?.stops?.length) return { overlap: 1, note: 'missing data' };

  const names1 = new Set(rep1.stops.map(s => s.name));
  const names2 = new Set(rep2.stops.map(s => s.name));
  const overlap = [...names1].filter(n => names2.has(n)).length;
  const total = Math.max(names1.size, names2.size);
  return {
    overlap_count: overlap,
    total_stops: total,
    overlap_ratio: total > 0 ? Math.round(overlap / total * 100) : 0,
    shared: [...names1].filter(n => names2.has(n)),
  };
}

function analyzeIssues(stops, lang) {
  const issues = [];
  for (const stop of stops) {
    // 주소 형식
    if (stop.address && !stop.addressStartsWithCity) {
      issues.push({ type: 'bad_address_prefix', stop: stop.name, value: stop.address });
    }
    if (stop.category === 'food' && stop.address && !stop.hasNumber) {
      issues.push({ type: 'address_missing_number', stop: stop.name });
    }
    // 언어 혼합
    if (lang === 'ko' && stop.tip_lang === 'en') {
      issues.push({ type: 'language_mismatch', stop: stop.name, field: 'tip' });
    }
    if (lang === 'en' && stop.tip_lang === 'ko') {
      issues.push({ type: 'language_mismatch', stop: stop.name, field: 'tip' });
    }
    // 비현실적 stay_min
    if (stop.stay_min > 0 && (stop.stay_min < 15 || stop.stay_min > 240)) {
      issues.push({ type: 'unrealistic_stay', stop: stop.name, value: stop.stay_min });
    }
    // 검증 안 된 식당
    if (stop.category === 'food' && !stop.verified) {
      issues.push({ type: 'unverified_restaurant', stop: stop.name });
    }
  }
  return issues;
}

async function runAll() {
  console.log(`\n🧪 CocoTrip Planner Validation Runner`);
  console.log(`   API: ${API_URL}`);
  console.log(`   Test account: ${TEST_EMAIL}`);
  console.log(`   Scenarios: ${scenarios.length}\n`);

  // ── Firebase idToken 발급 (PR #247 audit P0-#2 이후 필수) ──────────────
  console.log('🔑 Issuing Firebase ID token for authentication...');
  let idToken;
  try {
    idToken = await getIdToken();
    console.log(`   ✅ Token issued (length=${idToken.length})\n`);
  } catch (e) {
    console.error(`   ❌ Token issuance failed: ${e.message}`);
    console.error('   자율점검 중단 — secret 등록 후 재시도. docs/AUTOMATION.md 참조.');
    throw e;
  }

  const results = [];

  for (const s of scenarios) {
    console.log(`▶ Running: ${s.id} (${s.area}, ${s.dietPrefs.join('/')}, ${s.language})...`);
    const startTime = Date.now();

    try {
      const body = {
        ...s,
        email: TEST_EMAIL,
        adults: s.pax,
        // 시나리오가 공항을 명시하면 그것을 쓴다 — 권역 밖 조합(부산 손님 ↔ 인천공항)을
        // 만들려면 area 로 유추한 값(PUS)으로는 안 된다. 미명시면 기존 유추 그대로.
        arrival_airport: s.arrival_airport || (s.area === 'jeju' ? 'CJU' : (s.area === 'busan' ? 'PUS' : 'ICN_T1')),
        departure_airport: s.departure_airport || (s.area === 'jeju' ? 'CJU' : (s.area === 'busan' ? 'PUS' : 'ICN_T1')),
        styles: ['culture', 'food'],
        allergies: [],
        // P174 (2026-05-24): ADMIN-BYPASS- prefix — admin email (HEALTH_CHECK_EMAIL,
        // ADMIN_BYPASS_EMAILS 또는 hardcoded fallback `2001leety@gmail.com`) 인증 시
        // LIVE 모드 결제 우회 가능. TEST- prefix 는 BRAINTREE_ENV='production' 인 prod
        // 에서 403 reject (audit P1-A) — 5/12 부터 자율 검증 silent fail 의 root cause.
        // Caveat (P102): ADMIN-BYPASS- → decidePlannerMode 가 'legacy' 강제. 따라서
        // 본 검증은 prompt/output (P164/P166) + duration (P165) + streaming (P169) +
        // admin Flash (P171) 효과 측정 가능 — 3pass/block-mode (P167/P168) 는 별도.
        paypalOrderId: `ADMIN-BYPASS-VALIDATE-${s.id}-${Date.now()}`,
      };

      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300000), // 5 min timeout
      });

      const elapsed = Date.now() - startTime;

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        results.push({
          scenario: { id: s.id, area: s.area, diet: s.dietPrefs, lang: s.language },
          ok: false,
          error: `HTTP ${resp.status}: ${errText.substring(0, 300)}`,
          elapsed_ms: elapsed,
        });
        console.log(`   ❌ ${s.id}: HTTP ${resp.status} (${elapsed}ms)`);
        console.log(`      ${errText.substring(0, 150)}`);
        continue;
      }

      const data = await resp.json();
      const stops = extractStops(data);

      // Tier 2-D: shared 9-metric scorer applied to itinerary directly.
      const itin = data?.data?.itinerary || data?.itinerary || data;
      let qualityScore = null;
      try {
        const { computeQualityScore } = await loadQualityMetrics();
        qualityScore = computeQualityScore(itin, s.dietPrefs, s.area, [], { lang: s.language });
      } catch (qErr) {
        console.warn(`   ⚠ qualityMetrics failed for ${s.id}:`, qErr.message);
      }

      // 🔴 출국일이 항공기 출발 마감을 넘는가 (2026-08-05).
      //   손님이 비행기를 놓치는 조건이다. 시각을 준 시나리오에서만 판정한다
      //   (`departureTime` 없으면 탐지기가 빈 배열을 낸다 = 기존 시나리오 무영향).
      let departureOverrun = [];
      try {
        const { detectDepartureFlightOverrun } = await loadQualityMetrics();
        departureOverrun = detectDepartureFlightOverrun(itin, s.departureTime);
      } catch (dErr) {
        console.warn(`   ⚠ departure overrun check failed for ${s.id}:`, dErr.message);
      }
      if (departureOverrun.length > 0) {
        console.log(`   🛫 ${s.id}: 출국일이 항공 마감(${s.departureTime} −3시간)을 넘었다 — ${departureOverrun.length}건`);
        for (const o of departureOverrun.slice(0, 5)) {
          console.log(`      Day${o.day} ${o.start_time} "${o.name}" (${o.category})`);
        }
      }

      // 서버 측 검증 이슈 + 클라이언트 측 추가 분석
      const serverIssues = data?.data?._validation_issues || data._validation_issues || [];
      const clientIssues = analyzeIssues(stops, s.language);
      const allIssues = [...serverIssues, ...clientIssues];
      
      // 중복 제거 (type + stop 조합)
      const seen = new Set();
      const dedupedIssues = allIssues.filter(iss => {
        const key = `${iss.type}|${iss.stop}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      results.push({
        scenario: { id: s.id, area: s.area, diet: s.dietPrefs, lang: s.language },
        ok: true,
        elapsed_ms: elapsed,
        days: (data.itinerary?.days || []).length,
        total_stops: stops.length,
        food_stops: stops.filter(s => s.category === 'food').length,
        geocoded_stops: stops.filter(s => s.hasCoords).length,
        verified_food: stops.filter(s => s.category === 'food' && s.verified).length,
        issues: dedupedIssues,
        issue_count: dedupedIssues.length,
        qualityScore,
        departure_overrun: departureOverrun,
        stops,
      });

      console.log(`   ✅ ${s.id}: ${stops.length} stops (${stops.filter(s => s.category === 'food').length} food), ${dedupedIssues.length} issues (${elapsed}ms)`);

    } catch (e) {
      const elapsed = Date.now() - startTime;
      results.push({
        scenario: { id: s.id, area: s.area, diet: s.dietPrefs, lang: s.language },
        ok: false,
        error: e.message,
        elapsed_ms: elapsed,
      });
      console.log(`   ❌ ${s.id}: ${e.message} (${(elapsed/1000).toFixed(1)}s)`);
    }
  }

  // ── 다양성 점수 ──
  const diversity = calcDiversity(results);
  const overrunTotal = results.reduce((n, r) => n + (r.departure_overrun?.length || 0), 0);

  // ── 리포트 저장 ──
  const report = {
    timestamp: new Date().toISOString(),
    api_url: API_URL,
    total_scenarios: scenarios.length,
    success_count: results.filter(r => r.ok).length,
    fail_count: results.filter(r => !r.ok).length,
    total_issues: results.reduce((s, r) => s + (r.issue_count ?? 0), 0),
    departure_overrun_total: overrunTotal,
    avg_elapsed_ms: Math.round(results.filter(r => r.ok).reduce((s, r) => s + r.elapsed_ms, 0) / Math.max(1, results.filter(r => r.ok).length)),
    diversity_overlap: diversity,
    results,
  };

  const outPath = path.join(__dirname, 'planner-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // ── 요약 출력 ──
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📊 PLANNER QUALITY REPORT`);
  console.log(`${'═'.repeat(55)}`);
  console.log(`  성공: ${report.success_count}/${report.total_scenarios}`);
  console.log(`  총 이슈: ${report.total_issues}건`);
  console.log(`  출국일 항공 마감 초과: ${overrunTotal}건${overrunTotal > 0 ? '  ← 🛫 손님이 비행기를 놓친다' : ''}`);
  console.log(`  평균 응답: ${(report.avg_elapsed_ms / 1000).toFixed(1)}초`);

  // 이슈 유형별 카운트
  const issueCounts = {};
  for (const r of results) {
    for (const iss of (r.issues || [])) {
      issueCounts[iss.type] = (issueCounts[iss.type] || 0) + 1;
    }
  }
  if (Object.keys(issueCounts).length > 0) {
    console.log(`\n  📋 이슈 분류:`);
    for (const [type, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    - ${type}: ${count}`);
    }
  }

  console.log(`\n  🎲 다양성: 중복률 ${diversity.overlap_ratio ?? '?'}% (${diversity.overlap_count ?? 0}/${diversity.total_stops ?? 0})`);
  if (diversity.shared?.length) {
    console.log(`    중복 장소: ${diversity.shared.join(', ')}`);
  }

  // 시나리오별 요약 테이블
  console.log(`\n  📊 시나리오별 결과:`);
  console.log(`    ${'ID'.padEnd(20)} ${'Stops'.padStart(6)} ${'Food'.padStart(5)} ${'Issues'.padStart(7)} ${'Time'.padStart(8)}`);
  console.log(`    ${'─'.repeat(50)}`);
  for (const r of results) {
    if (r.ok) {
      console.log(`    ${r.scenario.id.padEnd(20)} ${String(r.total_stops).padStart(6)} ${String(r.food_stops).padStart(5)} ${String(r.issue_count).padStart(7)} ${(r.elapsed_ms/1000).toFixed(1).padStart(7)}s`);
    } else {
      console.log(`    ${r.scenario.id.padEnd(20)} ${'FAIL'.padStart(6)}   ${r.error.substring(0, 30)}`);
    }
  }

  console.log(`\n💾 저장: ${outPath}`);
  console.log(`${'═'.repeat(55)}\n`);

  // 🔴 출국일 마감 초과는 손님이 비행기를 놓치는 조건이다. 다만 **여기서 exit 1 을 하지 않는다** —
  //   daily-health-check 는 이 스크립트를 execSync 로 부르므로 non-zero 면 throw 로 잡혀
  //   "validate-planner 실행 실패(silent fail 차단)" 라는 **엉뚱한 원인**이 보고된다.
  //   #1230 과 같은 함정(위반 문자열이 틀린 기준을 말해 다음 단계를 오도)이다.
  //   → 보고는 여기서(report + 콘솔), 게이트는 daily-health-check 이 report 를 읽어서 건다.
  if (overrunTotal > 0) {
    console.error(`\n❌ 출국일 항공 마감 초과 ${overrunTotal}건 — 손님이 비행기를 놓치는 일정이다.`);
    console.error(`   applyDepartureDayFlightCap 배선 확인 (postResponsePipeline.applyBackfillsAndTmoney).`);
  }
}

runAll().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
