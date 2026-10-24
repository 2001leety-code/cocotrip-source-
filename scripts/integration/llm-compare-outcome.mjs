/**
 * llm-compare-providers 판정 seam (통합 2026-10-17) — 순수 함수, I/O·LLM 호출 없음.
 * 결과 행 하나라도 실패(호출 에러·파싱 실패·필수 키 누락·일수 불일치·구조 오류·식이 critical·언어 불일치)거나
 * 기대 scenario×provider 조합이 빠졌거나(시나리오 통째 누락 포함) 중복/예상 밖 행이 있거나 행이 0개면
 * exitCode=1. 판정 근거 필드가 없으면 통과가 아니라 실패(누락 ≠ 통과).
 *
 * 시나리오 식별: 행의 `scenarioId`(= 하네스 ALL 키, 예 'seoul-meat')로 판정한다. `scenario` 는 사람이
 * 읽는 표시 라벨(예 'seoul-2d-Meat-ko')로만 남긴다. 기대 목록 = 실행 산출물의 `expectedScenarios`
 * (하네스가 SCEN 을 그대로 기록). 없거나 비면 실패 — 무엇을 돌렸어야 하는지 모르면 통과시킬 수 없다.
 * 공급자 목록도 같다: 산출물의 `providers`(하네스 PROVIDERS)가 없거나 비었거나 잘못됐거나 중복이면 실패.
 * 결과 행에서 공급자를 추론하지 않는다.
 *
 * 2026-10-24 (O3): 행마다 실제 사용 공급자(providerActual — 어댑터가 Claude 초기화 실패 시 Gemini 로 폴백),
 * 종단 중복 게이트(duplicateStops), 필수 끼니(mealCoverage)도 판정한다 — 없으면 실패(누락 ≠ 통과).
 * 실제 누적 비용이 --max-usd 를 넘어 중단된 실행(budgetStop)은 exitCode 3. 비용 불명 행(usdUnknown — 예외로
 * 과금 여부 모름)은 실패이고, 누적에는 호출 전 예약 비용(usdReserved)으로 남는다.
 */
export const OUTCOME_EXIT = { ok: 0, failed: 1, budget: 3 };

/**
 * 행 하나가 누적 비용에 더하는 값. 실측 usd(숫자)가 있으면 그것, 없으면(예외로 과금 여부 불명) 호출 전 잡아 둔
 * 보수적 예약 비용 usdReserved — 비용 불명을 0 으로 치지 않는다. 둘 다 없으면 호출 전 단계에서 끝난 행 = 0.
 */
export function rowSpendUsd(row) {
  const r = row && typeof row === 'object' ? row : {};
  if (typeof r.usd === 'number' && Number.isFinite(r.usd)) return r.usd;
  if (typeof r.usdReserved === 'number' && Number.isFinite(r.usdReserved)) return r.usdReserved;
  return 0;
}

/**
 * 실제 누적 비용 상한 — 하네스가 **매 호출 전**과 **최종 저장 전**에 부른다. 합(rowSpendUsd)이 상한을 넘으면 stop.
 * @param {object[]} results @param {number} maxUsd
 * @returns {{stop: boolean, spentUsd: number, maxUsd: number}}
 */
export function budgetStop(results, maxUsd) {
  const spentUsd = (Array.isArray(results) ? results : []).reduce((a, r) => a + rowSpendUsd(r), 0);
  return { stop: spentUsd > maxUsd, spentUsd: +spentUsd.toFixed(4), maxUsd };
}

/**
 * 응답 사용량 → 행 비용 필드 (2026-10-24 r2). 실제 공급자가 mock 이면 $0 정상. 그 외에 usageMetadata 가 없거나
 * 입력·출력 토큰이 둘 다 0 이면 **비용 불명** — 0 으로 확정하지 않고 usd=null·usdUnknown=true(누적엔 예약 유지).
 * @param {{providerActual?: string, modelActual?: string, usageMetadata?: object|null, price: (model: string, cm: {cached:number,total:number,output:number}) => number}} a
 * @returns {{tokens: {cached:number,total:number,output:number}, usd: number|null, usdUnknown: boolean}}
 */
export function costFieldsFromUsage({ providerActual, modelActual, usageMetadata, price }) {
  const um = usageMetadata && typeof usageMetadata === 'object' ? usageMetadata : null;
  const tokens = {
    cached: Number(um && um.cachedContentTokenCount) || 0,
    total: Number(um && um.promptTokenCount) || 0,
    output: Number(um && um.candidatesTokenCount) || 0,
  };
  if (providerActual === 'mock') return { tokens, usd: 0, usdUnknown: false };
  if (!um || (tokens.total === 0 && tokens.output === 0)) return { tokens, usd: null, usdUnknown: true };
  return { tokens, usd: +price(modelActual, tokens).toFixed(4), usdUnknown: false };
}

/**
 * 하네스 호출 루프 — callOne(p, provider) 는 행을 돌려주고 던지지 않는다(예외는 행의 error/usdUnknown 으로).
 * 방침: **비용을 모르면 더 호출하지 않는다.** 매 호출 전 누적 상한 검사, 비용 불명 행이 나오면 즉시 중단.
 * @returns {Promise<{results: object[], stopped: object|null}>}
 */
export async function runCompareCalls({ prepared, providers, maxUsd, callOne }) {
  const results = [];
  for (const p of prepared) {
    for (const prov of providers) {
      const budget = budgetStop(results, maxUsd);
      if (budget.stop) return { results, stopped: budget };
      const row = await callOne(p, prov);
      results.push(row);
      if (row && row.usdUnknown === true) {
        const { spentUsd } = budgetStop(results, maxUsd);
        return { results, stopped: { stop: true, reason: 'unknown_cost', scenarioId: row.scenarioId, provider: row.provider, spentUsd, maxUsd } };
      }
    }
  }
  return { results, stopped: null };
}

/**
 * 하네스 마지막 단계 — 루프 중 중단(stopped)이 없어도 마지막 행까지 더한 합을 다시 검사해, 넘었으면 budgetStop 을
 * 기록하고 판정한다(마지막 호출에서 초과해도 exit 3).
 */
export function finalizeCompareRun({ providers, expectedScenarios, results, maxUsd, stopped }) {
  const finalCheck = budgetStop(results, maxUsd);
  const recorded = stopped || (finalCheck.stop ? finalCheck : null);
  return { budgetStop: recorded, outcome: evaluateCompareRun({ providers, expectedScenarios, results, maxUsd, budgetStop: recorded }) };
}

/** @param {object} row llm-compare-providers 의 결과 행 @returns {string[]} 실패 사유(빈 배열 = 통과) */
export function rowFailures(row) {
  const r = row && typeof row === 'object' ? row : {};
  const reasons = [];
  if (r.error) reasons.push('error');
  if (r.usdUnknown === true) reasons.push('cost_unknown');
  if (typeof r.providerActual !== 'string' || !r.providerActual) reasons.push('provider_actual_unknown');
  else if (r.fallback === true || r.providerActual !== r.provider) reasons.push('provider_fallback');
  if (!Number.isInteger(r.duplicateStops) || r.duplicateStops < 0) reasons.push('duplicate_stops_unknown');
  else if (r.duplicateStops > 0) reasons.push('duplicate_stops');
  const mc = r.mealCoverage;
  if (!mc || typeof mc !== 'object' || mc.checked !== true || !Array.isArray(mc.missing)) reasons.push('meal_coverage_unknown');
  else if (mc.missing.length > 0) reasons.push('meal_coverage_missing');
  if (r.parsed !== true) reasons.push('not_parsed');
  if (!Array.isArray(r.requiredKeys)) reasons.push('required_keys_unknown');
  else if (r.requiredKeys.length > 0) reasons.push('missing_required_keys');
  if (r.daysMatch !== true) reasons.push('days_mismatch');
  if (!Array.isArray(r.structureErrors)) reasons.push('structure_unknown');
  else if (r.structureErrors.length > 0) reasons.push('structure_errors');
  if (r.dietaryCritical !== false) reasons.push('dietary_critical_or_unknown');
  if (r.languageOk !== true) reasons.push('language_mismatch_or_unknown');
  return reasons;
}

const idOf = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * @param {{providers?: string[], expectedScenarios?: string[], results?: object[]}} run
 * @returns {{ok: boolean, exitCode: number, total: number, passed: number,
 *   runErrors: string[],
 *   failures: Array<{scenario: string, provider: string, reasons: string[]}>,
 *   missingPairs: Array<{scenario: string, provider: string}>,
 *   missingScenarios: string[],
 *   perProvider: Record<string, {total: number, passed: number}>}}
 */
export function evaluateCompareRun(run) {
  const results = Array.isArray(run && run.results) ? run.results : [];
  const runErrors = [];
  // 공급자 목록도 실행 산출물에 기록된 것만 믿는다. 행에서 추론하면 한 공급자가 통째로 빠진 실행
  // (예: claude 행 0개)이 남은 공급자만으로 PASS 할 수 있다 — expectedScenarios 와 같은 fail-closed 규칙.
  let providers = [];
  if (!Array.isArray(run && run.providers)) runErrors.push('providers_missing');
  else {
    providers = run.providers.map(idOf);
    if (providers.length === 0) runErrors.push('providers_empty');
    if (providers.some((p) => !p)) runErrors.push('providers_invalid');
    if (new Set(providers).size !== providers.length) runErrors.push('providers_duplicate');
    providers = [...new Set(providers.filter(Boolean))];
  }
  let expected = [];
  if (!Array.isArray(run && run.expectedScenarios)) runErrors.push('expected_scenarios_missing');
  else {
    expected = run.expectedScenarios.map(idOf);
    if (expected.length === 0) runErrors.push('expected_scenarios_empty');
    if (expected.some((s) => !s)) runErrors.push('expected_scenarios_invalid');
    if (new Set(expected).size !== expected.length) runErrors.push('expected_scenarios_duplicate');
    expected = [...new Set(expected.filter(Boolean))];
  }

  const failures = [];
  const perProvider = {};
  for (const p of providers) perProvider[p] = { total: 0, passed: 0 };
  const seen = new Set();
  for (const row of results) {
    const scenarioId = idOf(row && row.scenarioId);
    const provider = String(row && row.provider);
    const pairKey = `${scenarioId}\u0000${provider}`;
    const reasons = [];
    if (!providers.includes(provider)) reasons.push('unexpected_provider');
    if (!scenarioId) reasons.push('scenario_id_missing');
    else if (!expected.includes(scenarioId)) reasons.push('unexpected_scenario');
    if (scenarioId && seen.has(pairKey)) reasons.push('duplicate_row');
    seen.add(pairKey);
    if (!reasons.includes('unexpected_provider')) reasons.push(...rowFailures(row));
    const bucket = perProvider[provider] || (perProvider[provider] = { total: 0, passed: 0 });
    bucket.total += 1;
    const label = scenarioId || String(row && row.scenario);
    if (reasons.length) failures.push({ scenario: label, provider, reasons });
    else bucket.passed += 1;
  }
  const missingPairs = [];
  for (const scenario of expected) for (const provider of providers) {
    if (!seen.has(`${scenario}\u0000${provider}`)) missingPairs.push({ scenario, provider });
  }
  // 시나리오 통째 누락 = 어떤 공급자 행도 없음 (missingPairs 에도 포함, 별도 표기).
  const missingScenarios = expected.filter((s) => !providers.some((p) => seen.has(`${s}\u0000${p}`)));
  // 기록된 중단 객체 또는, 산출물에 maxUsd 가 있으면 저장된 행 합 재계산 — --evaluate 도 같은 판정.
  const capHit = typeof (run && run.maxUsd) === 'number' && budgetStop(results, run.maxUsd).stop;
  const budgetStopped = !!(run && run.budgetStop) || capHit;
  if (budgetStopped) runErrors.push('budget_exceeded');
  const ok = runErrors.length === 0 && results.length > 0 && failures.length === 0 && missingPairs.length === 0;
  return {
    ok,
    exitCode: budgetStopped ? OUTCOME_EXIT.budget : ok ? OUTCOME_EXIT.ok : OUTCOME_EXIT.failed,
    total: results.length,
    passed: results.length - failures.length,
    runErrors,
    failures,
    missingPairs,
    missingScenarios,
    perProvider,
    safety: summarizeSafety(results),
  };
}

/**
 * 식당 stop 이름 준수 집계 (2026-10-24 r1) — exact = **stop.name** 이 목록에 표시된 원문 식별 이름(getFoodContext 가
 * 찍는 `name.split('|')[0]`)과 같음. display_name·영문명·쉼표 앞 별칭으로만 행이 찾아지면 aliasOnly(원문 복사 실패).
 * 행을 못 찾으면 unmatched. 행 찾기는 주입(findRow = food-name-match.findSelectedFoodRow) — 이 모듈은 순수.
 * @returns {{exact: number, aliasOnly: number, unmatched: number}}
 */
export function foodNameCompliance(plan, foodIndex, fallbackCity, findRow) {
  const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
  const out = { exact: 0, aliasOnly: 0, unmatched: 0 };
  for (const day of Array.isArray(plan && plan.days) ? plan.days : []) {
    for (const stop of Array.isArray(day && day.stops) ? day.stops : []) {
      if (!stop || stop.category !== 'food') continue;
      const row = findRow(stop, foodIndex, { dayCity: day.city || fallbackCity });
      if (!row) { out.unmatched += 1; continue; }
      const listedName = norm(String(row.name || '').split('|')[0]);
      if (listedName && norm(stop.name) === listedName) out.exact += 1; else out.aliasOnly += 1;
    }
  }
  return out;
}

/**
 * 2026-10-24 (식이 준수 P4): 공급자별 안전 집계 — 원본 응답 기준. 정확 이름 준수 / 별칭으로만 회복 / 이름 못 찾음 /
 * 식이 위반 / 필수끼니 누락. 판정(rowFailures)과 별개의 관측값이다 — 식이 위반·끼니 누락 행은 rowFailures 에서 이미 실패.
 * 집계 필드가 하나도 없는 옛 산출물은 {} (formatOutcome 이 줄을 생략).
 */
export function summarizeSafety(results) {
  const out = {};
  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r !== 'object' || !r.nameCompliance) continue;
    const p = String(r.provider);
    const s = out[p] || (out[p] = { rows: 0, exactNames: 0, aliasOnlyNames: 0, unmatchedNames: 0, dietaryViolationRows: 0, mealMissingRows: 0 });
    s.rows += 1;
    s.exactNames += Number(r.nameCompliance.exact) || 0;
    s.aliasOnlyNames += Number(r.nameCompliance.aliasOnly) || 0;
    s.unmatchedNames += Number(r.nameCompliance.unmatched) || 0;
    if (r.dietaryCritical === true || Number(r.dietaryViolations) > 0) s.dietaryViolationRows += 1;
    if (r.mealCoverage && Array.isArray(r.mealCoverage.missing) && r.mealCoverage.missing.length > 0) s.mealMissingRows += 1;
  }
  return out;
}

/** 사람이 읽는 한 줄 요약 (CLI 출력용). */
export function formatOutcome(o) {
  const head = o.ok ? 'PASS' : 'FAIL';
  const per = Object.entries(o.perProvider).map(([p, v]) => `${p} ${v.passed}/${v.total}`).join(' · ');
  const lines = [`[compare] outcome=${head} rows ${o.passed}/${o.total}${per ? ` (${per})` : ''}`];
  for (const [p, s] of Object.entries(o.safety || {})) {
    lines.push(`  safety ${p}: exact=${s.exactNames} aliasOnly=${s.aliasOnlyNames} unmatched=${s.unmatchedNames} `
      + `dietaryViolationRows=${s.dietaryViolationRows} mealMissingRows=${s.mealMissingRows} (rows ${s.rows})`);
  }
  for (const e of o.runErrors || []) lines.push(`  - run: ${e}`);
  if (o.total === 0) lines.push('  - no result rows');
  for (const f of o.failures) lines.push(`  - ${f.provider} ${f.scenario}: ${f.reasons.join(',')}`);
  for (const s of o.missingScenarios || []) lines.push(`  - ${s}: missing_scenario`);
  for (const m of o.missingPairs) lines.push(`  - ${m.provider} ${m.scenario}: missing_result_row`);
  return lines.join('\n');
}
