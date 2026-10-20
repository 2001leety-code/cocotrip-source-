/**
 * 통합 2026-10-17 — scripts/llm-compare-providers.mjs 는 공급자 하나라도 실패하면 0 이 아닌 코드로 끝나야 한다.
 * 이전: catch 로 row.error 만 남기고 exit 0 → 자동화가 실패를 성공으로 읽었다.
 * 후속: structureErrors 무시·시나리오 통째 누락 미검출도 실패로 잠근다 (expectedScenarios + 행별 scenarioId).
 * CORE3: providers 도 기록된 목록만 믿는다 — 없음/빈/잘못/중복이면 실패 (행에서 추론 금지).
 * 유료 호출 0: 순수 판정 함수 + CLI --evaluate(저장 결과 재판정, API 모듈 import 전 종료)만 실행한다.
 * 자식 프로세스는 고정 파일(스크립트 + 픽스처)만 실행한다 (-e/eval 없음).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateCompareRun, rowFailures, formatOutcome } from '../../scripts/integration/llm-compare-outcome.mjs';

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'llm-compare-providers.mjs');
const FIX = join(ROOT, 'tests', 'fixtures', 'integration-20261017');
const load = (f: string) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));

const good = { scenarioId: 's1', scenario: 'S1 label', provider: 'gemini', parsed: true, requiredKeys: [], daysMatch: true, structureErrors: [], dietaryCritical: false, languageOk: true };
const runOf = (results: object[], extra: object = {}) => ({ providers: ['gemini', 'claude'], expectedScenarios: ['s1'], results, ...extra });

describe('rowFailures', () => {
  it('a complete passing row has no failures', () => {
    expect(rowFailures(good)).toEqual([]);
  });
  it.each([
    [{ error: 'boom' }, 'error'],
    [{ parsed: false }, 'not_parsed'],
    [{ requiredKeys: ['days'] }, 'missing_required_keys'],
    [{ requiredKeys: undefined }, 'required_keys_unknown'],
    [{ daysMatch: false }, 'days_mismatch'],
    [{ structureErrors: ['B-12: day 1 has 3 stops'] }, 'structure_errors'],
    [{ structureErrors: undefined }, 'structure_unknown'],
    [{ structureErrors: 'B-12' }, 'structure_unknown'],
    [{ dietaryCritical: true }, 'dietary_critical_or_unknown'],
    [{ dietaryCritical: undefined }, 'dietary_critical_or_unknown'],
    [{ languageOk: false }, 'language_mismatch_or_unknown'],
  ])('%j -> %s', (patch, reason) => {
    expect(rowFailures({ ...good, ...patch })).toContain(reason);
  });
  it('an error-only row (what the catch block produces) fails on every evidence field, not just error', () => {
    const r = rowFailures({ scenarioId: 's1', provider: 'claude', error: 'x' });
    expect(r).toEqual(expect.arrayContaining(['error', 'not_parsed', 'structure_unknown']));
  });
});

describe('evaluateCompareRun', () => {
  it('all rows pass for every provider -> exitCode 0', () => {
    const o = evaluateCompareRun(load('llm-compare-all-pass.json'));
    expect(o).toMatchObject({ ok: true, exitCode: 0, total: 2, passed: 2, runErrors: [], failures: [], missingPairs: [], missingScenarios: [] });
    expect(formatOutcome(o)).toMatch(/outcome=PASS/);
  });
  it('one provider error -> exitCode 1, failure attributed to that provider only', () => {
    const o = evaluateCompareRun(load('llm-compare-provider-error.json'));
    expect(o.ok).toBe(false);
    expect(o.exitCode).toBe(1);
    expect(o.failures.map((f) => f.provider)).toEqual(['claude']);
    expect(o.perProvider).toEqual({ gemini: { total: 1, passed: 1 }, claude: { total: 1, passed: 0 } });
    expect(formatOutcome(o)).toMatch(/outcome=FAIL[\s\S]*claude seoul-meat: error/);
  });
  it('non-empty structureErrors on an otherwise passing row -> exitCode 1', () => {
    const o = evaluateCompareRun(load('llm-compare-structure-error.json'));
    expect(o.exitCode).toBe(1);
    expect(o.failures).toEqual([{ scenario: 'seoul-meat', provider: 'claude', reasons: ['structure_errors'] }]);
    expect(formatOutcome(o)).toMatch(/claude seoul-meat: structure_errors/);
  });
  it('an entire expected scenario with no rows for any provider -> exitCode 1, reported as missing_scenario', () => {
    const o = evaluateCompareRun(load('llm-compare-missing-scenario.json'));
    expect(o.exitCode).toBe(1);
    expect(o.failures).toEqual([]);
    expect(o.missingScenarios).toEqual(['jeju-vegan']);
    expect(o.missingPairs).toEqual([{ scenario: 'jeju-vegan', provider: 'gemini' }, { scenario: 'jeju-vegan', provider: 'claude' }]);
    expect(formatOutcome(o)).toMatch(/jeju-vegan: missing_scenario/);
  });
  it('a provider with no row for a scenario is a failure (missing is not success)', () => {
    const o = evaluateCompareRun(runOf([good]));
    expect(o.exitCode).toBe(1);
    expect(o.missingPairs).toEqual([{ scenario: 's1', provider: 'claude' }]);
    expect(o.missingScenarios).toEqual([]);
  });
  it('missing / empty / duplicated expectedScenarios fails closed even with passing rows', () => {
    const rows = [good, { ...good, provider: 'claude' }];
    expect(evaluateCompareRun(runOf(rows)).exitCode).toBe(0);
    const noExpected: Partial<ReturnType<typeof runOf>> = { ...runOf(rows) };
    delete noExpected.expectedScenarios;
    expect(evaluateCompareRun(noExpected).runErrors).toContain('expected_scenarios_missing');
    expect(evaluateCompareRun(noExpected).exitCode).toBe(1);
    expect(evaluateCompareRun(runOf(rows, { expectedScenarios: [] })).runErrors).toContain('expected_scenarios_empty');
    expect(evaluateCompareRun(runOf(rows, { expectedScenarios: ['s1', 's1'] })).runErrors).toContain('expected_scenarios_duplicate');
    expect(evaluateCompareRun(runOf(rows, { expectedScenarios: ['s1', ''] })).runErrors).toContain('expected_scenarios_invalid');
  });
  it('providers are never inferred from rows: a run whose claude rows were all lost cannot pass on gemini alone', () => {
    const geminiOnly = [good];
    const noProviders: Partial<ReturnType<typeof runOf>> = { ...runOf(geminiOnly) };
    delete noProviders.providers;
    const missing = evaluateCompareRun(noProviders);
    expect(missing.runErrors).toContain('providers_missing');
    expect(missing).toMatchObject({ ok: false, exitCode: 1 });
    expect(formatOutcome(missing)).toMatch(/outcome=FAIL[\s\S]*run: providers_missing/);
    const empty = evaluateCompareRun(runOf(geminiOnly, { providers: [] }));
    expect(empty.runErrors).toContain('providers_empty');
    expect(empty.exitCode).toBe(1);
    // 기록된 공급자 목록이 있으면 빠진 공급자는 행 누락으로 드러난다 (정책 확장 없음).
    expect(evaluateCompareRun(runOf(geminiOnly)).missingPairs).toEqual([{ scenario: 's1', provider: 'claude' }]);
  });
  it.each([
    [['gemini', ''], 'providers_invalid'],
    [['gemini', '   '], 'providers_invalid'],
    [['gemini', null], 'providers_invalid'],
    [['gemini', 7], 'providers_invalid'],
    [['gemini', 'claude', 'gemini'], 'providers_duplicate'],
  ])('providers %j fails closed with %s even when every recorded pair has a passing row', (providers, reason) => {
    const rows = [good, { ...good, provider: 'claude' }];
    expect(evaluateCompareRun(runOf(rows)).exitCode).toBe(0);
    const o = evaluateCompareRun(runOf(rows, { providers }));
    expect(o.runErrors).toContain(reason);
    expect(o).toMatchObject({ ok: false, exitCode: 1 });
  });
  it('a non-array providers value is treated as missing, not coerced', () => {
    const rows = [good, { ...good, provider: 'claude' }];
    const o = evaluateCompareRun(runOf(rows, { providers: 'gemini,claude' }));
    expect(o.runErrors).toEqual(['providers_missing']);
    expect(o.exitCode).toBe(1);
  });
  it('display label alone is not an ID: a row without scenarioId fails', () => {
    const labelOnly: Partial<typeof good> = { ...good };
    delete labelOnly.scenarioId;
    const o = evaluateCompareRun(runOf([labelOnly, { ...good, provider: 'claude' }]));
    expect(o.exitCode).toBe(1);
    expect(o.failures[0].reasons).toContain('scenario_id_missing');
  });
  it('a duplicate scenario×provider row is a failure', () => {
    const o = evaluateCompareRun(runOf([good, { ...good, provider: 'claude' }, good]));
    expect(o.exitCode).toBe(1);
    expect(o.failures).toEqual([{ scenario: 's1', provider: 'gemini', reasons: ['duplicate_row'] }]);
  });
  it('a row for a scenario that was not expected is a failure', () => {
    const o = evaluateCompareRun(runOf([good, { ...good, provider: 'claude' }, { ...good, scenarioId: 'extra' }]));
    expect(o.exitCode).toBe(1);
    expect(o.failures).toEqual([{ scenario: 'extra', provider: 'gemini', reasons: ['unexpected_scenario'] }]);
  });
  it('zero rows is a failure', () => {
    expect(evaluateCompareRun({ providers: ['gemini'], expectedScenarios: ['s1'], results: [] }).exitCode).toBe(1);
    const nothing = evaluateCompareRun({});
    expect(nothing.exitCode).toBe(1);
    expect(nothing.runErrors).toEqual(expect.arrayContaining(['providers_missing', 'expected_scenarios_missing']));
  });
  it('a row from a provider that was not requested is a failure', () => {
    const o = evaluateCompareRun({ providers: ['gemini'], expectedScenarios: ['s1'], results: [good, { ...good, provider: 'mystery' }] });
    expect(o.exitCode).toBe(1);
    expect(o.failures[0].reasons).toEqual(['unexpected_provider']);
  });
});

describe('CLI exit codes (no LLM calls)', () => {
  const env = { ...process.env };
  for (const k of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_PROVIDER']) delete env[k];
  const run = (...a: string[]) => spawnSync(process.execPath, [SCRIPT, ...a], { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });

  it('--evaluate on a passing artifact exits 0', () => {
    const r = run(`--evaluate=${join(FIX, 'llm-compare-all-pass.json')}`);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/outcome=PASS/);
  });
  it('--evaluate on an artifact with one provider error exits non-zero', () => {
    const r = run(`--evaluate=${join(FIX, 'llm-compare-provider-error.json')}`);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/outcome=FAIL/);
  });
  it('--evaluate on an artifact with structureErrors exits non-zero', () => {
    const r = run(`--evaluate=${join(FIX, 'llm-compare-structure-error.json')}`);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/structure_errors/);
  });
  it('--evaluate on an artifact missing a whole scenario exits non-zero', () => {
    const r = run(`--evaluate=${join(FIX, 'llm-compare-missing-scenario.json')}`);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/jeju-vegan: missing_scenario/);
  });
  it('--evaluate on an unreadable file exits 4', () => {
    expect(run(`--evaluate=${join(FIX, 'does-not-exist.json')}`).status).toBe(4);
  });
  it('without --confirm-cost it still refuses (exit 2)', () => {
    expect(run().status).toBe(2);
  });
  it('source order: early exits happen before any api/ module import; live path records expected IDs and sets exitCode after saving', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const firstApiImport = src.indexOf("await import('../api/");
    expect(firstApiImport).toBeGreaterThan(-1);
    expect(src.indexOf('if (args.evaluate)')).toBeLessThan(firstApiImport);
    expect(src.indexOf("if (!args['confirm-cost'])")).toBeLessThan(firstApiImport);
    expect(src.indexOf('process.exit(5)')).toBeGreaterThan(-1);
    expect(src.indexOf('process.exit(5)')).toBeLessThan(firstApiImport);
    expect(src).toMatch(/scenarioId: p\.id/);
    expect(src).toMatch(/evaluateCompareRun\(\{ providers: PROVIDERS, expectedScenarios: SCEN, results \}\)/);
    expect(src.indexOf('writeFileSync(out,')).toBeLessThan(src.indexOf('process.exitCode = outcome.exitCode'));
  });
});
