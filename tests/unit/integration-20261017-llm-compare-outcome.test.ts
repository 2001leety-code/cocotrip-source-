/**
 * 통합 2026-10-17 — scripts/llm-compare-providers.mjs 는 공급자 하나라도 실패하면 0 이 아닌 코드로 끝나야 한다.
 * 이전: catch 로 row.error 만 남기고 exit 0 → 자동화가 실패를 성공으로 읽었다.
 * 후속: structureErrors 무시·시나리오 통째 누락 미검출도 실패로 잠근다 (expectedScenarios + 행별 scenarioId).
 * CORE3: providers 도 기록된 목록만 믿는다 — 없음/빈/잘못/중복이면 실패 (행에서 추론 금지).
 * 유료 호출 0: 순수 판정 함수 + CLI --evaluate(저장 결과 재판정, API 모듈 import 전 종료)만 실행한다.
 * 자식 프로세스는 고정 파일(스크립트 + 픽스처)만 실행한다 (-e/eval 없음).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';

// 무료 루프가 모델을 만들면 잡히게 — createLlmModel 만 spy(나머지는 실제).
const llm = vi.hoisted(() => ({ createLlmModel: vi.fn(() => { throw new Error('model call in free loop'); }) }));
vi.mock('../../api/_shared/llm/index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLlmModel: llm.createLlmModel,
}));
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildMockPlan } from '../../api/_shared/llm/mock.js';
import { arrivalReadyHHMM } from '../../api/_ai_core/constants.js';
import {
  evaluateCompareRun, rowFailures, formatOutcome, budgetStop, finalizeCompareRun, rowSpendUsd, costFieldsFromUsage, runCompareCalls,
} from '../../scripts/integration/llm-compare-outcome.mjs';
import { runDumpPrompts, runJudgePlan } from '../../scripts/integration/llm-compare-free.mjs';

const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'llm-compare-providers.mjs');
const FIX = join(ROOT, 'tests', 'fixtures', 'integration-20261017');
const load = (f: string) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));

const good = {
  scenarioId: 's1', scenario: 'S1 label', provider: 'gemini', providerActual: 'gemini', fallback: false, parsed: true, requiredKeys: [], daysMatch: true,
  structureErrors: [], duplicateStops: 0, mealCoverage: { checked: true, missing: [] }, dietaryCritical: false, languageOk: true,
};
const claude = { ...good, provider: 'claude', providerActual: 'claude' };
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
    // O3 (2026-10-24): 실제 공급자 · 종단 중복 게이트 · 필수 끼니
    [{ providerActual: 'gemini', provider: 'claude' }, 'provider_fallback'],
    [{ fallback: true }, 'provider_fallback'],
    [{ providerActual: undefined }, 'provider_actual_unknown'],
    [{ providerActual: '' }, 'provider_actual_unknown'],
    [{ duplicateStops: 2 }, 'duplicate_stops'],
    [{ duplicateStops: undefined }, 'duplicate_stops_unknown'],
    [{ duplicateStops: '0' }, 'duplicate_stops_unknown'],
    [{ mealCoverage: { checked: true, missing: ['Day 2: 저녁(17-21시) food stop 누락 (B-MEAL-DINNER)'] } }, 'meal_coverage_missing'],
    [{ mealCoverage: { checked: false, missing: [] } }, 'meal_coverage_unknown'],
    [{ mealCoverage: undefined }, 'meal_coverage_unknown'],
  ])('%j -> %s', (patch, reason) => {
    expect(rowFailures({ ...good, ...patch })).toContain(reason);
  });
  it('a claude row that the adapter actually served with gemini fails the whole run (comparison contaminated)', () => {
    const fallbackRow = { ...good, provider: 'claude', providerActual: 'gemini', fallback: true };
    const o = evaluateCompareRun(runOf([good, fallbackRow]));
    expect(o).toMatchObject({ ok: false, exitCode: 1 });
    expect(o.failures).toEqual([{ scenario: 's1', provider: 'claude', reasons: ['provider_fallback'] }]);
  });
  it('duplicate stops or a missing required meal on an otherwise passing row -> exitCode 1', () => {
    expect(evaluateCompareRun(runOf([good, { ...claude, duplicateStops: 1 }])).failures[0].reasons).toEqual(['duplicate_stops']);
    const meal = evaluateCompareRun(runOf([good, { ...claude, mealCoverage: { checked: true, missing: ['x (B-MEAL)'] } }]));
    expect(meal.exitCode).toBe(1);
    expect(meal.failures[0].reasons).toEqual(['meal_coverage_missing']);
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
    const rows = [good, claude];
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
    const rows = [good, claude];
    expect(evaluateCompareRun(runOf(rows)).exitCode).toBe(0);
    const o = evaluateCompareRun(runOf(rows, { providers }));
    expect(o.runErrors).toContain(reason);
    expect(o).toMatchObject({ ok: false, exitCode: 1 });
  });
  it('a non-array providers value is treated as missing, not coerced', () => {
    const rows = [good, claude];
    const o = evaluateCompareRun(runOf(rows, { providers: 'gemini,claude' }));
    expect(o.runErrors).toEqual(['providers_missing']);
    expect(o.exitCode).toBe(1);
  });
  it('display label alone is not an ID: a row without scenarioId fails', () => {
    const labelOnly: Partial<typeof good> = { ...good };
    delete labelOnly.scenarioId;
    const o = evaluateCompareRun(runOf([labelOnly, claude]));
    expect(o.exitCode).toBe(1);
    expect(o.failures[0].reasons).toContain('scenario_id_missing');
  });
  it('a duplicate scenario×provider row is a failure', () => {
    const o = evaluateCompareRun(runOf([good, claude, good]));
    expect(o.exitCode).toBe(1);
    expect(o.failures).toEqual([{ scenario: 's1', provider: 'gemini', reasons: ['duplicate_row'] }]);
  });
  it('a row for a scenario that was not expected is a failure', () => {
    const o = evaluateCompareRun(runOf([good, claude, { ...good, scenarioId: 'extra' }]));
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

describe('budgetStop (actual cumulative spend cap)', () => {
  it('stops only once the summed row usd exceeds the cap; rows without usd count as 0', () => {
    expect(budgetStop([], 5)).toEqual({ stop: false, spentUsd: 0, maxUsd: 5 });
    expect(budgetStop([{ usd: 2 }, { usd: 3 }], 5).stop).toBe(false); // = 상한은 아직 통과
    expect(budgetStop([{ usd: 2 }, { error: 'x' }, { usd: 3.01 }], 5)).toEqual({ stop: true, spentUsd: 5.01, maxUsd: 5 });
  });
  it('a run that recorded budgetStop exits 3 (even if every saved row passed) and says why', () => {
    const rows = [good, claude];
    const o = evaluateCompareRun(runOf(rows, { budgetStop: { stop: true, spentUsd: 5.2, maxUsd: 5 } }));
    expect(o).toMatchObject({ ok: false, exitCode: 3 });
    expect(o.runErrors).toContain('budget_exceeded');
    expect(formatOutcome(o)).toMatch(/run: budget_exceeded/);
    expect(evaluateCompareRun(runOf(rows, { budgetStop: null })).exitCode).toBe(0);
  });

  // Astra r1 P1 — 예외로 비용 불명인 행은 0 이 아니라 예약 비용으로 남고, 판정은 실패.
  it('a cost-unknown row (usd null) counts its reservation, not 0; a measured usd replaces the reservation', () => {
    expect(rowSpendUsd({ usd: null, usdReserved: 0.4, usdUnknown: true })).toBe(0.4);
    expect(rowSpendUsd({ usd: 0.05, usdReserved: 0.4 })).toBe(0.05);
    expect(rowSpendUsd({ usd: 0, usdReserved: 0.4 })).toBe(0); // 실측 0 은 실측
    expect(rowSpendUsd({})).toBe(0); // 호출 전 단계 실패 = 예약 없음
    expect(budgetStop([{ usd: 2 }, { usd: null, usdReserved: 3.5, usdUnknown: true }], 5)).toEqual({ stop: true, spentUsd: 5.5, maxUsd: 5 });
    expect(rowFailures({ ...good, usd: null, usdReserved: 0.4, usdUnknown: true })).toEqual(['cost_unknown']);
  });

  // Astra r1 P2 — 실제 합산 경로(finalizeCompareRun = 하네스 마지막 단계). 중단 객체를 주입하지 않는다.
  it('the last row pushing the total over the cap exits 3 even though every row passed and no in-loop stop happened', () => {
    const rows = [{ ...good, usd: 2 }, { ...claude, usd: 3.5 }];
    const f = finalizeCompareRun({ providers: ['gemini', 'claude'], expectedScenarios: ['s1'], results: rows, maxUsd: 5, stopped: null });
    expect(f.budgetStop).toEqual({ stop: true, spentUsd: 5.5, maxUsd: 5 });
    expect(f.outcome).toMatchObject({ ok: false, exitCode: 3 });
    expect(f.outcome.runErrors).toContain('budget_exceeded');
    const under = finalizeCompareRun({ providers: ['gemini', 'claude'], expectedScenarios: ['s1'], results: [{ ...good, usd: 2 }, { ...claude, usd: 3 }], maxUsd: 5, stopped: null });
    expect(under.budgetStop).toBeNull();
    expect(under.outcome.exitCode).toBe(0);
  });
  it('a cost-unknown last row is summed at its reservation and stops the run (exit 3), and the row itself fails', () => {
    const rows = [{ ...good, usd: 2 }, { ...claude, error: 'timeout', usd: null, usdReserved: 3.5, usdUnknown: true }];
    const f = finalizeCompareRun({ providers: ['gemini', 'claude'], expectedScenarios: ['s1'], results: rows, maxUsd: 5, stopped: null });
    expect(f.budgetStop).toMatchObject({ stop: true, spentUsd: 5.5 });
    expect(f.outcome.exitCode).toBe(3);
    expect(f.outcome.failures[0].reasons).toEqual(expect.arrayContaining(['error', 'cost_unknown']));
  });
  it('--evaluate path: a saved artifact with maxUsd is re-summed (no budgetStop recorded) and still exits 3', () => {
    const rows = [{ ...good, usd: 2 }, { ...claude, usd: 3.5 }];
    expect(evaluateCompareRun(runOf(rows, { maxUsd: 5 })).exitCode).toBe(3);
    expect(evaluateCompareRun(runOf(rows, { maxUsd: 6 })).exitCode).toBe(0);
  });
});

// Astra r2 — 응답 → 행 비용 경로, 그리고 "비용을 모르면 더 호출하지 않는다".
describe('costFieldsFromUsage (response → row cost)', () => {
  const price = (_m: string, cm: { total: number; output: number }) => (cm.total * 2 + cm.output * 10) / 1_000_000;
  it('real usage → measured usd', () => {
    const c = costFieldsFromUsage({ providerActual: 'claude', modelActual: 'claude-sonnet-5-5', usageMetadata: { promptTokenCount: 20000, candidatesTokenCount: 8000, cachedContentTokenCount: 0 }, price });
    expect(c).toEqual({ tokens: { cached: 0, total: 20000, output: 8000 }, usd: 0.12, usdUnknown: false });
  });
  it.each([
    ['no usageMetadata', undefined],
    ['null usageMetadata', null],
    ['both token counts 0', { promptTokenCount: 0, candidatesTokenCount: 0 }],
    ['empty object', {}],
  ])('non-mock response with %s → cost unknown (usd null, not 0)', (_label, usageMetadata) => {
    for (const providerActual of ['gemini', 'claude', undefined]) {
      expect(costFieldsFromUsage({ providerActual, modelActual: 'x', usageMetadata, price })).toMatchObject({ usd: null, usdUnknown: true });
    }
  });
  it('a real mock (providerActual mock) is $0 and known, even without usage', () => {
    expect(costFieldsFromUsage({ providerActual: 'mock', modelActual: 'mock:main', usageMetadata: undefined, price })).toMatchObject({ usd: 0, usdUnknown: false });
  });
  it('output-only usage is still a measured cost', () => {
    expect(costFieldsFromUsage({ providerActual: 'gemini', modelActual: 'g', usageMetadata: { candidatesTokenCount: 100000 }, price })).toMatchObject({ usd: 1, usdUnknown: false });
  });
});

describe('runCompareCalls (call loop, injected callOne)', () => {
  const prepared = [{ id: 's1' }, { id: 's2' }];
  const rowOf = (p: { id: string }, prov: string, extra: object = {}) => ({ ...(prov === 'claude' ? claude : good), scenarioId: p.id, usd: 0.1, ...extra });
  const counting = (make: (p: { id: string }, prov: string, n: number) => object) => {
    const calls: string[] = [];
    return { calls, callOne: async (p: { id: string }, prov: string) => { calls.push(`${p.id}/${prov}`); return make(p, prov, calls.length); } };
  };
  it('all known costs under the cap → every pair called once, no stop', async () => {
    const c = counting((p, prov) => rowOf(p, prov));
    const r = await runCompareCalls({ prepared, providers: ['gemini', 'claude'], maxUsd: 5, callOne: c.callOne });
    expect(c.calls).toEqual(['s1/gemini', 's1/claude', 's2/gemini', 's2/claude']);
    expect(r.stopped).toBeNull();
    expect(finalizeCompareRun({ providers: ['gemini', 'claude'], expectedScenarios: ['s1', 's2'], results: r.results, maxUsd: 5, stopped: r.stopped }).outcome.exitCode).toBe(0);
  });
  it('an exception row (cost unknown) stops immediately: zero further calls, exit 3, reservation counted', async () => {
    const c = counting((p, prov, n) => (n === 2 ? rowOf(p, prov, { error: 'timeout', usd: null, usdReserved: 0.4, usdUnknown: true }) : rowOf(p, prov)));
    const r = await runCompareCalls({ prepared, providers: ['gemini', 'claude'], maxUsd: 5, callOne: c.callOne });
    expect(c.calls).toEqual(['s1/gemini', 's1/claude']);
    expect(r.stopped).toEqual({ stop: true, reason: 'unknown_cost', scenarioId: 's1', provider: 'claude', spentUsd: 0.5, maxUsd: 5 });
    const f = finalizeCompareRun({ providers: ['gemini', 'claude'], expectedScenarios: ['s1', 's2'], results: r.results, maxUsd: 5, stopped: r.stopped });
    expect(f.budgetStop).toEqual(r.stopped);
    expect(f.outcome.exitCode).toBe(3);
    expect(f.outcome.failures[0].reasons).toEqual(expect.arrayContaining(['error', 'cost_unknown']));
  });
  it('a normal response without usage (cost unknown via costFieldsFromUsage) also stops immediately', async () => {
    const c = counting((p, prov, n) => {
      if (n !== 1) return rowOf(p, prov);
      const cost = costFieldsFromUsage({ providerActual: 'gemini', modelActual: 'g', usageMetadata: undefined, price: () => 0 });
      return rowOf(p, prov, { ...cost, usdReserved: 0.3 });
    });
    const r = await runCompareCalls({ prepared, providers: ['gemini', 'claude'], maxUsd: 5, callOne: c.callOne });
    expect(c.calls).toEqual(['s1/gemini']);
    expect(r.stopped).toMatchObject({ reason: 'unknown_cost', provider: 'gemini', spentUsd: 0.3 });
    expect(finalizeCompareRun({ providers: ['gemini', 'claude'], expectedScenarios: ['s1', 's2'], results: r.results, maxUsd: 5, stopped: r.stopped }).outcome.exitCode).toBe(3);
  });
  it('mock rows at $0 pass through and never stop the loop', async () => {
    const c = counting((p) => ({ ...good, provider: 'mock', providerActual: 'mock', scenarioId: p.id, ...costFieldsFromUsage({ providerActual: 'mock', modelActual: 'mock:main', usageMetadata: undefined, price: () => 1 }) }));
    const r = await runCompareCalls({ prepared, providers: ['mock'], maxUsd: 0, callOne: c.callOne });
    expect(c.calls).toEqual(['s1/mock', 's2/mock']);
    expect(r.stopped).toBeNull();
    expect(finalizeCompareRun({ providers: ['mock'], expectedScenarios: ['s1', 's2'], results: r.results, maxUsd: 0, stopped: null }).outcome.exitCode).toBe(0);
  });
  it('the cumulative cap is checked before each call (no call after the total passes the cap)', async () => {
    const c = counting((p, prov) => rowOf(p, prov, { usd: 3 }));
    const r = await runCompareCalls({ prepared, providers: ['gemini', 'claude'], maxUsd: 5, callOne: c.callOne });
    expect(c.calls).toEqual(['s1/gemini', 's1/claude']);
    expect(r.stopped).toEqual({ stop: true, spentUsd: 6, maxUsd: 5 });
  });
});

// 2026-10-24 (O7): 무료 반복 루프 — 운영과 같은 프롬프트를 파일로 내보내고, 서브에이전트가 만든 플랜을 같은 판정기로 채점.
// 2026-10-24: in-process — 오프라인 guard 가 child_process 를 막으므로 spawn 하지 않는다. CLI 는 같은 함수를 부를 뿐(소스 검사).
describe('free loop: runDumpPrompts / runJudgePlan (model calls 0, no keys, no --confirm-cost)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'llm-compare-free-'));
  beforeEach(() => { llm.createLlmModel.mockClear(); });

  it('the CLI free modes only call these functions', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/const r = await runDumpPrompts\(\{ dir: String\(args\['dump-prompts'\]\), scenarios: SCEN \}\);/);
    expect(src).toMatch(/const r = await runJudgePlan\(\{ file: String\(args\['judge-plan'\]\), scenarioId: SCEN\.length === 1 \? SCEN\[0\] : '' \}\);/);
  });

  it('runDumpPrompts writes system/user prompts per scenario + manifest, with zero model calls; offline flag restored', async () => {
    const dir = join(tmp, 'dump');
    const before = process.env.LLM_COMPARE_OFFLINE;
    const r = await runDumpPrompts({ dir, scenarios: ['jeju-vegan', 'seoul-busan-halal'] });
    expect(r.exitCode).toBe(0);
    expect(r.message).toMatch(/model calls 0/);
    expect(llm.createLlmModel).not.toHaveBeenCalled();
    expect(process.env.LLM_COMPARE_OFFLINE).toBe(before);
    expect(readdirSync(dir).sort()).toEqual(['jeju-vegan.system.txt', 'jeju-vegan.user.txt', 'manifest.json', 'seoul-busan-halal.system.txt', 'seoul-busan-halal.user.txt']);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    expect(Object.keys(manifest.scenarios)).toEqual(['jeju-vegan', 'seoul-busan-halal']);
    expect(manifest.scenarios['seoul-busan-halal']).toMatchObject({
      regions: ['seoul', 'busan'], mealCities: ['seoul', 'busan'], arrival_airport: 'ICN_T1', departure_airport: 'PUS',
      arrivalTime: '14:00', departureTime: '10:00', dietary: ['Halal'], language: 'en', systemFile: 'seoul-busan-halal.system.txt', userFile: 'seoul-busan-halal.user.txt',
    });
    const user = readFileSync(join(dir, 'seoul-busan-halal.user.txt'), 'utf8');
    expect(user).toMatch(/Restaurants in Seoul/);
    expect(user).toMatch(/Restaurants in Busan/); // 도시별 신뢰 목록(운영 buildTripFoodContext)
    expect(user).toMatch(/DIETARY SAFETY FOR THIS REQUEST \(Halal\)/);
    expect(readFileSync(join(dir, 'jeju-vegan.system.txt'), 'utf8')).toMatch(/DIETARY SAFETY — TOP RULE/);
  });

  // 같은 판정기 — jeju-vegan(2일, CJU 14:00/10:00) 입력으로 만든 mock 플랜을 정상 기준으로 쓴다.
  const plan = buildMockPlan({ userText: 'X\n' + JSON.stringify({
    duration_days: 2, styles: ['culture', 'food'], area: 'jeju', regions: ['jeju'], arrival_airport: 'CJU', departure_airport: 'CJU',
    arrival_time: '14:00', departure_time: '10:00', arrival_ready_time: arrivalReadyHHMM('14:00', 'CJU', 'jeju'), diet_preferences: ['vegan'], tour_start_time: '09:00',
  }) + '\n=== VARIATION ===' });
  const judge = async (name: string, text: string) => {
    const file = join(tmp, name);
    writeFileSync(file, text);
    const r = await runJudgePlan({ file, scenarioId: 'jeju-vegan' });
    type JudgeRow = Record<string, unknown> & { parsed?: boolean; dietaryCritical?: boolean; nameCompliance?: unknown; mealCoverage: { checked: boolean; missing: string[] } };
    return { r, row: r.row as JudgeRow, out: r.lines.join('\n') };
  };
  const clone = () => JSON.parse(JSON.stringify(plan));

  it('a compliant plan → row passes, exit 0, provider subagent at $0, no model call', async () => {
    const { r, row, out } = await judge('ok.json', JSON.stringify(plan));
    expect(r.exitCode, out).toBe(0);
    expect(row).toMatchObject({ provider: 'subagent', providerActual: 'subagent', usd: 0, parsed: true, dietaryCritical: false, duplicateStops: 0, mealCoverage: { checked: true, missing: [] } });
    expect(row.nameCompliance).toEqual({ exact: 2, aliasOnly: 0, unmatched: 0 });
    expect(row).not.toHaveProperty('plan');
    expect(out).toMatch(/outcome=PASS/);
    expect(llm.createLlmModel).not.toHaveBeenCalled();
  });

  it('a fenced answer (```json … ```) is parsed by the same repair path', async () => {
    const { r, row } = await judge('fenced.txt', '```json\n' + JSON.stringify(plan, null, 2) + '\n```');
    expect(r.exitCode).toBe(0);
    expect(row.parsed).toBe(true);
  });

  it('a non-vegan restaurant → dietary critical, exit 1', async () => {
    const p = clone();
    const food = p.days.flatMap((d: { stops: Array<Record<string, unknown>> }) => d.stops).find((s: Record<string, unknown>) => s.category === 'food');
    food.name = '돼지국밥 맛집'; food.display_name = 'Pork soup'; delete food.dietary_tags;
    const { r, row, out } = await judge('diet.json', JSON.stringify(p));
    expect(r.exitCode).toBe(1);
    expect(row.dietaryCritical).toBe(true);
    expect(out).toMatch(/subagent jeju-vegan: .*dietary_critical_or_unknown/);
  });

  it('the 10:00-departure breakfast removed → meal coverage missing, exit 1', async () => {
    const p = clone();
    p.days[p.days.length - 1].stops = p.days[p.days.length - 1].stops.filter((s: { category: string }) => s.category !== 'food');
    const { r, row, out } = await judge('meal.json', JSON.stringify(p));
    expect(r.exitCode).toBe(1);
    expect(row.mealCoverage.missing).toEqual([expect.stringMatching(/^Day 2 \(출국일\): departure_time=10:00 이른 출국 — 조식/)]);
    expect(out).toMatch(/meal_coverage_missing/);
  });

  it('runJudgePlan needs exactly one known scenario (exit 5) and a readable file (exit 4)', async () => {
    expect((await runJudgePlan({ file: join(tmp, 'ok.json'), scenarioId: '' })).exitCode).toBe(5);
    expect((await runJudgePlan({ file: join(tmp, 'ok.json'), scenarioId: 'nope' })).exitCode).toBe(5);
    expect((await runJudgePlan({ file: join(tmp, 'missing.json'), scenarioId: 'jeju-vegan' })).exitCode).toBe(4);
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
    // 2026-10-24 (O7): 무료 모드(--dump-prompts/--judge-plan)만 confirm-cost 없이 통과 — 유료 경로 게이트는 그대로 API import 전.
    expect(src.indexOf("if (!FREE_MODE && !args['confirm-cost'])")).toBeGreaterThan(-1);
    expect(src.indexOf("if (!FREE_MODE && !args['confirm-cost'])")).toBeLessThan(firstApiImport);
    expect(src).toMatch(/const FREE_MODE = Boolean\(args\['dump-prompts'\] \|\| args\['judge-plan'\]\);/);
    expect(src.indexOf('process.exit(5)')).toBeGreaterThan(-1);
    expect(src.indexOf('process.exit(5)')).toBeLessThan(firstApiImport);
    expect(src).toMatch(/scenarioId: p\.id/);
    expect(src).toMatch(/finalizeCompareRun\(\{ providers: PROVIDERS, expectedScenarios: SCEN, results, maxUsd: MAX_USD, stopped \}\)/);
    expect(src.indexOf('finalizeCompareRun({')).toBeLessThan(src.indexOf('writeFileSync(out,'));
    expect(src.indexOf('writeFileSync(out,')).toBeLessThan(src.indexOf('process.exitCode = outcome.exitCode'));
  });
  it('source: the loop is runCompareCalls (cap + unknown-cost stop); reservation precedes the call; cost comes from costFieldsFromUsage', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).toMatch(/await runCompareCalls\(\{ prepared, providers: PROVIDERS, maxUsd: MAX_USD, callOne \}\)/);
    expect(src).not.toMatch(/for \(const prov of PROVIDERS\) \{\n\s+const budget/); // 하네스 안에 따로 도는 루프 없음
    const fn = src.slice(src.indexOf('async function callOne('));
    expect(fn.indexOf('row.usdReserved =')).toBeGreaterThan(-1);
    expect(fn.indexOf('row.usdReserved =')).toBeLessThan(fn.indexOf('model.generateContent('));
    expect(src).toMatch(/if \(typeof row\.usd !== 'number'\) \{ row\.usd = null; row\.usdUnknown = true; \}/);
    expect(src).toMatch(/row\.providerActual = model\.provider;/);
    expect(src).toMatch(/row\.modelActual = model\.modelId;/);
    expect(src).toMatch(/costFieldsFromUsage\(\{ providerActual: row\.providerActual, modelActual: row\.modelActual, usageMetadata: result\.response && result\.response\.usageMetadata, price: estimateGeminiCostUsd \}\)/);
    expect(src).not.toMatch(/extractCacheMetadata/); // 누락을 0 으로 바꾸는 추출기를 비용에 쓰지 않는다
    // 판정기는 무료 루프와 공용(llm-compare-free.mjs judgePlanInto) — 유료 callOne 이 그것을 부른다.
    expect(fn).toMatch(/judgePlanInto\(row, gp\.extractTextFromResponse\(result\.response\)\.trim\(\), p, DEPS\)/);
    const freeSrc = readFileSync(join(ROOT, 'scripts', 'integration', 'llm-compare-free.mjs'), 'utf8');
    expect(freeSrc).toMatch(/validatePatternStructure\(plan, \{[^}]*\.\.\.trip \}\)/);
    expect(freeSrc).toMatch(/runDuplicateStopGate\(plan\)/);
  });
});
