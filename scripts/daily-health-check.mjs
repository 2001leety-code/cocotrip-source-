/**
 * CocoTrip — Daily Health Check
 *
 * Runs endpoint pings + validate-planner + appends results to JSONL log.
 * Designed for GitHub Actions cron (UTC 00:00 daily).
 *
 * Usage:
 *   node scripts/daily-health-check.mjs [base-url]
 *   Default: https://cocotripkr.com
 *
 * Output: scripts/health-log.jsonl (append)
 *
 * Exit codes:
 *   0 = healthy (issues ≤ 9)
 *   1 = degraded (issues > 9 or endpoint failures)
 */

import { execSync } from 'child_process';
import { appendFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || 'https://cocotripkr.com';
const LOG_PATH = join(__dirname, 'health-log.jsonl');

// ── 1. Endpoint Pings ──────────────────────────────────────────────────
async function pingEndpoints() {
  const endpoints = [
    { name: 'homepage', url: `${BASE}/`, method: 'HEAD' },
    { name: 'plan-status', url: `${BASE}/api/plan-status`, method: 'GET' },
    { name: 'planner-page', url: `${BASE}/planner`, method: 'HEAD' },
  ];

  const results = [];
  for (const ep of endpoints) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(ep.url, {
        method: ep.method,
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      results.push({
        name: ep.name,
        status: res.status,
        ok: res.status < 500,
        elapsed_ms: Date.now() - start,
      });
    } catch (err) {
      results.push({
        name: ep.name,
        status: 0,
        ok: false,
        error: err.message,
        elapsed_ms: Date.now() - start,
      });
    }
  }
  return results;
}

// ── 2. Run validate-planner.cjs ─────────────────────────────────────────
// .cjs because parent package.json is "type": "module" but the script uses
// CommonJS require(). Renaming to .cjs lets Node load it as CommonJS.
function runValidatePlanner() {
  const reportPath = join(__dirname, 'planner-report.json');

  try {
    console.log('🧪 Running validate-planner.cjs...');
    execSync(`node "${join(__dirname, 'validate-planner.cjs')}" "${BASE}"`, {
      stdio: 'inherit',
      timeout: 600_000, // 10 min timeout
      env: { ...process.env },
    });

    if (existsSync(reportPath)) {
      const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
      const diversity = report.diversity_overlap || null;
      return {
        ok: true,
        total_issues: report.total_issues,
        total_scenarios: report.total_scenarios,
        // 🔴 2026-08-05: 출국일이 항공기 출발 마감을 넘은 stop 수 — 손님이 비행기를 놓친다.
        //   applyDepartureDayFlightCap 이 코드로 막고 있으므로 > 0 이면 컷이 배선에서
        //   빠졌거나 조용히 skip 된 것이다(#1237 이 정확히 그 경우였고 아무도 못 봤다).
        departure_overrun_total: report.departure_overrun_total || 0,
        success_count: report.success_count,
        fail_count: report.fail_count,
        // 실패한 시나리오 id — "4/5 성공" 이 무엇 때문인지 이름을 남긴다.
        failed_scenario_ids: (report.results || []).filter(r => !r.ok).map(r => r.scenario.id),
        avg_elapsed_ms: report.avg_elapsed_ms,
        // 🔴 2026-08-24: 0 을 || 로 접으면 falsy 라 사라진다. overlap 0(완벽한 다양성)도
        //   숫자 그대로 살아야 한다 — 명시적 typeof 검사만 쓴다.
        diversity_overlap: diversity && typeof diversity.overlap_ratio === 'number' ? diversity.overlap_ratio : null,
        // diversity 리포트 자체가 없거나(구버전) ok:false 면 통과가 아니라 실패 — skip 은 허용 안 함.
        diversity_ok: diversity ? diversity.ok !== false : false,
        diversity_reason: diversity ? diversity.reason : '다양성 리포트 없음 — validate-planner report 형식 확인 필요',
        issue_breakdown: (report.results || []).reduce((acc, r) => {
          for (const iss of (r.issues || [])) {
            acc[iss.type] = (acc[iss.type] || 0) + 1;
          }
          return acc;
        }, {}),
      };
    }
    return { ok: false, error: 'Report file not found after execution' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── 2.5 순수 판정 헬퍼 (2026-08-24) ───────────────────────────────────────
// pings/validation 은 이미 만들어진 값(fixture 로도 만들 수 있다) — 네트워크·execSync
// 없이 unit test 가능. "몇 번째 시나리오가 왜 실패했는지" 를 reasons 에 이름으로 남긴다
// (제네릭 "failed" 금지 요구사항).
export function evaluateHealthRecord({ pings, validation, expectedScenarioCount }) {
  const reasons = [];

  const all_pings_ok = pings.every(p => p.ok);
  for (const p of pings.filter(p => !p.ok)) {
    reasons.push(`ping 실패: ${p.name} (status=${p.status})`);
  }

  // P174 (2026-05-24): validate-planner 가 5/5 fail (success_count=0) 이면
  // total_issues=0 → `0 <= 9` 만으로는 silent "healthy" 판정. success_count > 0
  // (실제 plan 생성됐는지) + validation.ok != false (실행 자체 성공) 도 본다.
  const validation_actually_ok = validation.ok !== false &&
    (validation.success_count == null || validation.success_count > 0);
  if (!validation_actually_ok) {
    reasons.push(`validate-planner.cjs 실행 실패 — success_count=${validation.success_count != null ? validation.success_count : 'n/a'}, ok=${validation.ok}`);
  }

  // 요구사항: N 개 시나리오 전부 성공해야 한다. "4/5" 는 부분 성공이 아니라 실패다.
  const expectedCount = expectedScenarioCount != null ? expectedScenarioCount : validation.total_scenarios;
  const all_generations_succeeded = expectedCount == null || validation.success_count == null
    ? validation_actually_ok
    : validation.success_count === expectedCount;
  if (validation_actually_ok && !all_generations_succeeded) {
    const failed = (validation.failed_scenario_ids && validation.failed_scenario_ids.length)
      ? ` (실패: ${validation.failed_scenario_ids.join(', ')})`
      : '';
    reasons.push(`시나리오 생성 ${validation.success_count}/${expectedCount} 만 성공${failed} — 전량 성공 필요`);
  }

  const issues_within_threshold = (typeof validation.total_issues === 'number' ? validation.total_issues : 99) <= 9;
  if (!issues_within_threshold) {
    reasons.push(`이슈 ${validation.total_issues}건 > 9건 임계값`);
  }

  // 다양성 게이트 — overlap_ratio 결측(비교쌍 생성 증거 누락) 또는 30% 이상은 둘 다 실패.
  // diversity_ok 가 없으면(구버전 report) skip 이 아니라 fail-closed.
  const diversity_ok = validation.diversity_ok === true;
  if (!diversity_ok) {
    reasons.push(validation.diversity_reason || '다양성 게이트 실패 — 사유 불명');
  }

  const gate = {
    all_pings_ok,
    issues_within_threshold,
    validation_actually_ok,
    // 임계값 없음 — 1건이라도 있으면 실패다. 다른 품질 이슈와 달리 "손님이 비행기를 놓친다".
    no_departure_overrun: (validation.departure_overrun_total || 0) === 0,
    all_generations_succeeded,
    diversity_ok,
  };
  if (!gate.no_departure_overrun) {
    reasons.push(`출국일 항공 마감 초과 ${validation.departure_overrun_total}건 — 손님이 비행기를 놓치는 일정이다`);
  }
  gate.ok = all_pings_ok && validation_actually_ok && all_generations_succeeded
    && issues_within_threshold && gate.no_departure_overrun && diversity_ok;
  gate.reasons = reasons;
  return gate;
}

// ── 3. Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏥 CocoTrip Daily Health Check`);
  console.log(`   Base: ${BASE}`);
  console.log(`   Time: ${new Date().toISOString()}\n`);

  // Ping endpoints
  console.log('📡 Pinging endpoints...');
  const pings = await pingEndpoints();
  for (const p of pings) {
    const icon = p.ok ? '✅' : '❌';
    console.log(`  ${icon} ${p.name}: ${p.status} (${p.elapsed_ms}ms)`);
  }

  // Run planner validation
  const validation = runValidatePlanner();

  // Build health record — 판정 로직은 evaluateHealthRecord() (순수 함수, unit test 대상).
  const gate = evaluateHealthRecord({ pings, validation, expectedScenarioCount: validation.total_scenarios });
  const record = {
    timestamp: new Date().toISOString(),
    base_url: BASE,
    pings,
    validation,
    all_pings_ok: gate.all_pings_ok,
    issues_within_threshold: gate.issues_within_threshold,
    validation_actually_ok: gate.validation_actually_ok,
    // 임계값 없음 — 1건이라도 있으면 실패다. 다른 품질 이슈와 달리 "손님이 비행기를 놓친다".
    no_departure_overrun: gate.no_departure_overrun,
    all_generations_succeeded: gate.all_generations_succeeded,
    diversity_ok: gate.diversity_ok,
    fail_reasons: gate.reasons,
  };

  // Append to JSONL log
  appendFileSync(LOG_PATH, JSON.stringify(record) + '\n', 'utf-8');

  // Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`🏥 HEALTH CHECK SUMMARY`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`  Endpoints: ${pings.filter(p => p.ok).length}/${pings.length} OK`);
  console.log(`  Planner issues: ${validation.total_issues != null ? validation.total_issues : 'N/A'} (threshold: ≤ 9)`);
  console.log(`  Diversity overlap: ${validation.diversity_overlap != null ? validation.diversity_overlap : 'N/A'}% (threshold: < 30, diversity_ok=${record.diversity_ok})`);
  // 0 을 'N/A' 로 뭉개면 안 된다 — `|| 'N/A'` 가 아니라 명시 비교.
  console.log(`  출국일 항공 마감 초과: ${validation.departure_overrun_total == null ? 'N/A' : validation.departure_overrun_total}건 (임계값 0)`);
  console.log(`  생성 성공: ${validation.success_count != null ? validation.success_count : 'N/A'}/${validation.total_scenarios != null ? validation.total_scenarios : 'N/A'} (전량 성공 필요)`);
  console.log(`  Status: ${gate.ok ? '🟢 HEALTHY' : '🔴 DEGRADED'}`);
  if (!record.no_departure_overrun) {
    console.log(`  🛫 출국일이 항공기 출발 마감을 넘었다 — 손님이 비행기를 놓치는 일정이다.`);
    console.log(`     applyDepartureDayFlightCap 배선 확인 (postResponsePipeline.applyBackfillsAndTmoney).`);
  }
  if (!record.validation_actually_ok) {
    console.log(`  🔴 validate-planner.cjs 실행 실패 — success_count=${validation.success_count != null ? validation.success_count : 'n/a'}, ok=${validation.ok}. silent fail 차단.`);
  }
  if (gate.reasons.length > 0) {
    console.log(`  실패 사유:`);
    for (const r of gate.reasons) console.log(`    - ${r}`);
  }
  console.log(`  Log: ${LOG_PATH}`);
  console.log(`${'═'.repeat(50)}\n`);

  // Exit code — P174 (2026-05-24): validation_actually_ok 도 검사 (silent fail 차단).
  // + 2026-08-24: 전량 생성 성공(all_generations_succeeded) + 다양성 게이트(diversity_ok) 추가.
  if (!record.all_pings_ok || !record.issues_within_threshold || !record.validation_actually_ok
      || !record.no_departure_overrun || !record.all_generations_succeeded || !record.diversity_ok) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
