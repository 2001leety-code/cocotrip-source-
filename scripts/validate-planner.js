/**
 * CocoTrip — Planner Quality Validation Runner
 * Phase 1: 기준점 측정용
 * 
 * Usage: node scripts/validate-planner.js [base-url]
 * Default: https://cocotripkr.com
 * 
 * 5개 시나리오를 순차 실행하여 planner-report.json 생성
 * ⚠️ Gemini API 5회 호출 (비용 발생)
 */
const fs = require('fs');
const path = require('path');

const BASE = process.argv[2] || 'https://cocotripkr.com';
const API_URL = `${BASE}/api/ai-planner-full`;

// 테스트 계정 — ai-planner-full.js의 TEST_ACCOUNTS 목록에 있어야 함
const TEST_EMAIL = '2001leety@gmail.com';

const scenarios = [
  { id: 'seoul-meat',      area: 'seoul', durationDays: 2, pax: 2, dietPrefs: ['Meat'],   priceRange: 'Moderate', language: 'ko', startDate: '2026-05-01', guestName: 'Validate-Test' },
  { id: 'busan-halal',     area: 'busan', durationDays: 3, pax: 4, dietPrefs: ['Halal'],  priceRange: 'Moderate', language: 'ko', startDate: '2026-05-01', guestName: 'Validate-Test' },
  { id: 'jeju-vegan',      area: 'jeju',  durationDays: 2, pax: 2, dietPrefs: ['Vegan'],  priceRange: 'Budget',   language: 'en', startDate: '2026-05-01', guestName: 'Validate-Test' },
  { id: 'seoul-meat-rep1', area: 'seoul', durationDays: 2, pax: 2, dietPrefs: ['Meat'],   priceRange: 'Moderate', language: 'ko', startDate: '2026-05-01', guestName: 'Validate-Test' },
  { id: 'seoul-meat-rep2', area: 'seoul', durationDays: 2, pax: 2, dietPrefs: ['Meat'],   priceRange: 'Moderate', language: 'ko', startDate: '2026-05-01', guestName: 'Validate-Test' },
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

  const results = [];

  for (const s of scenarios) {
    console.log(`▶ Running: ${s.id} (${s.area}, ${s.dietPrefs.join('/')}, ${s.language})...`);
    const startTime = Date.now();

    try {
      const body = {
        ...s,
        email: TEST_EMAIL,
        adults: s.pax,
        arrival_airport: s.area === 'jeju' ? 'CJU' : (s.area === 'busan' ? 'PUS' : 'ICN_T1'),
        departure_airport: s.area === 'jeju' ? 'CJU' : (s.area === 'busan' ? 'PUS' : 'ICN_T1'),
        styles: ['culture', 'food'],
        allergies: [],
        // TEST- prefix 바이패스 — ai-planner-full.js에서 TEST_ACCOUNTS 확인 후 PayPal 검증 스킵
        paypalOrderId: `TEST-VALIDATE-${s.id}-${Date.now()}`,
      };

      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // ── 리포트 저장 ──
  const report = {
    timestamp: new Date().toISOString(),
    api_url: API_URL,
    total_scenarios: scenarios.length,
    success_count: results.filter(r => r.ok).length,
    fail_count: results.filter(r => !r.ok).length,
    total_issues: results.reduce((s, r) => s + (r.issue_count ?? 0), 0),
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
}

runAll().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
