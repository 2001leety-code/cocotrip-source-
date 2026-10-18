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
 */
export const OUTCOME_EXIT = { ok: 0, failed: 1 };

/** @param {object} row llm-compare-providers 의 결과 행 @returns {string[]} 실패 사유(빈 배열 = 통과) */
export function rowFailures(row) {
  const r = row && typeof row === 'object' ? row : {};
  const reasons = [];
  if (r.error) reasons.push('error');
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
  const ok = runErrors.length === 0 && results.length > 0 && failures.length === 0 && missingPairs.length === 0;
  return {
    ok,
    exitCode: ok ? OUTCOME_EXIT.ok : OUTCOME_EXIT.failed,
    total: results.length,
    passed: results.length - failures.length,
    runErrors,
    failures,
    missingPairs,
    missingScenarios,
    perProvider,
  };
}

/** 사람이 읽는 한 줄 요약 (CLI 출력용). */
export function formatOutcome(o) {
  const head = o.ok ? 'PASS' : 'FAIL';
  const per = Object.entries(o.perProvider).map(([p, v]) => `${p} ${v.passed}/${v.total}`).join(' · ');
  const lines = [`[compare] outcome=${head} rows ${o.passed}/${o.total}${per ? ` (${per})` : ''}`];
  for (const e of o.runErrors || []) lines.push(`  - run: ${e}`);
  if (o.total === 0) lines.push('  - no result rows');
  for (const f of o.failures) lines.push(`  - ${f.provider} ${f.scenario}: ${f.reasons.join(',')}`);
  for (const s of o.missingScenarios || []) lines.push(`  - ${s}: missing_scenario`);
  for (const m of o.missingPairs) lines.push(`  - ${m.provider} ${m.scenario}: missing_result_row`);
  return lines.join('\n');
}
