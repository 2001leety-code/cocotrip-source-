/**
 * daily diversity health "actual fail" gate (2026-08-24).
 *
 * 잠근 사고 후보: 5개 시나리오 자율 검증이 다양성(중복률) 게이트를 계산만 하고 한 번도
 *   실제로 걸지 않았다 — daily-health-check.mjs 는 issues/departure-overrun/ping 만
 *   exit code 에 넣었고 diversity_overlap 은 표시만 했다. 게다가 그 표시 로직 자체가
 *   `(report.diversity_overlap && report.diversity_overlap.overlap_ratio) || null` 이라
 *   overlap 이 진짜 0(완벽한 다양성)이면 `0 && ... → 0`, `0 || null → null` 로 뭉개졌다
 *   — "0건 중복" 이 "측정 안 됨" 으로 보고된 것이다.
 *
 * 여기서는 두 개의 순수 함수를 경계값으로 잠근다:
 *   - validate-planner.cjs 의 calcDiversity — overlap 자체 계산 + 비교쌍 결측 처리
 *   - daily-health-check.mjs 의 evaluateHealthRecord — 전체 게이트 판정(신설)
 * 둘 다 네트워크/Gemini 호출 없이 순수 데이터로 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { calcDiversity } from '../../scripts/validate-planner.cjs';
import { evaluateHealthRecord } from '../../scripts/daily-health-check.mjs';

// ── calcDiversity — overlap 경계값 ──────────────────────────────────────
describe('calcDiversity — overlap 경계값 (< 30 통과, >= 30 실패)', () => {
  const resultsFor = (rep1Names: string[], rep2Names: string[]) => ([
    { scenario: { id: 'seoul-meat-rep1' }, stops: rep1Names.map((name) => ({ name })) },
    { scenario: { id: 'seoul-meat-rep2' }, stops: rep2Names.map((name) => ({ name })) },
  ]);

  it('overlap = 0 (완전히 다른 장소) → 통과, overlap_ratio 는 숫자 0 (null 아님)', () => {
    const d = calcDiversity(resultsFor(['A', 'B'], ['C', 'D']));
    expect(d.overlap_ratio).toBe(0);
    expect(d.overlap_ratio).not.toBeNull();
    expect(typeof d.overlap_ratio).toBe('number');
    expect(d.ok).toBe(true);
  });

  it('overlap ≈ 29.99% → 통과 (반올림하면 30%로 뭉개져 경계가 사라진다)', () => {
    // 10000개 중 2999개 중복 = 정확히 29.99%. Math.round 였다면 30 이 되어 fail 로 뒤집힌다.
    const rep1 = Array.from({ length: 10000 }, (_, i) => `s${i}`);
    const rep2 = [
      ...rep1.slice(0, 2999), // 겹치는 2999개
      ...Array.from({ length: 7001 }, (_, i) => `other${i}`), // 안 겹치는 나머지
    ];
    const d = calcDiversity(resultsFor(rep1, rep2));
    expect(d.overlap_ratio).toBeCloseTo(29.99, 2);
    expect(d.ok).toBe(true);
  });

  it('overlap = 30% 정확히 → 실패 (경계는 fail 쪽 포함)', () => {
    const rep1 = Array.from({ length: 100 }, (_, i) => `s${i}`);
    const rep2 = [
      ...rep1.slice(0, 30),
      ...Array.from({ length: 70 }, (_, i) => `other${i}`),
    ];
    const d = calcDiversity(resultsFor(rep1, rep2));
    expect(d.overlap_ratio).toBe(30);
    expect(d.ok).toBe(false);
    expect(d.reason).toContain('30%');
  });

  it('비교쌍(rep1/rep2) 생성 증거 누락 → 실패, 사유 명시 (조용한 통과 금지)', () => {
    const missingRep2 = [
      { scenario: { id: 'seoul-meat-rep1' }, stops: [{ name: 'A' }] },
      { scenario: { id: 'seoul-meat-rep2' }, stops: [] }, // 생성 실패 → stops 비어있음
    ];
    const d = calcDiversity(missingRep2);
    expect(d.ok).toBe(false);
    expect(d.overlap_ratio).toBeNull();
    expect(d.reason).toMatch(/생성 증거 누락/);
  });

  it('rep1/rep2 자체가 results 에 없음 → 실패, 사유 명시', () => {
    const d = calcDiversity([{ scenario: { id: 'seoul-meat' }, stops: [{ name: 'A' }] }]);
    expect(d.ok).toBe(false);
    expect(d.reason).toBeTruthy();
  });
});

// ── evaluateHealthRecord — 전체 게이트 판정 ─────────────────────────────
describe('evaluateHealthRecord — 시나리오/이슈/다양성/출국일 게이트 종합 판정', () => {
  const okPings = [{ name: 'homepage', status: 200, ok: true, elapsed_ms: 10 }];
  const baseValidation = {
    ok: true,
    total_issues: 0,
    total_scenarios: 5,
    success_count: 5,
    fail_count: 0,
    failed_scenario_ids: [],
    departure_overrun_total: 0,
    diversity_overlap: 0,
    diversity_ok: true,
    diversity_reason: null,
  };

  it('전부 정상 → 통과, reasons 비어있음', () => {
    const g = evaluateHealthRecord({ pings: okPings, validation: baseValidation, expectedScenarioCount: 5 });
    expect(g.ok).toBe(true);
    expect(g.reasons).toEqual([]);
  });

  it('issues = 9 → 통과, issues = 10 → 실패', () => {
    const pass = evaluateHealthRecord({ pings: okPings, validation: { ...baseValidation, total_issues: 9 }, expectedScenarioCount: 5 });
    expect(pass.issues_within_threshold).toBe(true);
    expect(pass.ok).toBe(true);

    const fail = evaluateHealthRecord({ pings: okPings, validation: { ...baseValidation, total_issues: 10 }, expectedScenarioCount: 5 });
    expect(fail.issues_within_threshold).toBe(false);
    expect(fail.ok).toBe(false);
    expect(fail.reasons.some((r) => r.includes('10'))).toBe(true);
  });

  it('출국일 마감 초과 1건 → 실패 (0건만 통과, 임계값 없음)', () => {
    const fail = evaluateHealthRecord({ pings: okPings, validation: { ...baseValidation, departure_overrun_total: 1 }, expectedScenarioCount: 5 });
    expect(fail.no_departure_overrun).toBe(false);
    expect(fail.ok).toBe(false);

    const pass = evaluateHealthRecord({ pings: okPings, validation: { ...baseValidation, departure_overrun_total: 0 }, expectedScenarioCount: 5 });
    expect(pass.no_departure_overrun).toBe(true);
  });

  it('시나리오 생성 4/5 성공 → 실패, 어떤 시나리오인지 사유에 남는다 (부분 성공 불인정)', () => {
    const g = evaluateHealthRecord({
      pings: okPings,
      validation: { ...baseValidation, success_count: 4, fail_count: 1, failed_scenario_ids: ['seoul-meat-rep2'] },
      expectedScenarioCount: 5,
    });
    expect(g.all_generations_succeeded).toBe(false);
    expect(g.ok).toBe(false);
    expect(g.reasons.some((r) => r.includes('seoul-meat-rep2'))).toBe(true);
    expect(g.reasons.some((r) => r.includes('4') && r.includes('5'))).toBe(true);
  });

  it('다양성 게이트 실패(overlap >= 30 또는 비교쌍 결측) → 전체 실패, 사유 전달', () => {
    const g = evaluateHealthRecord({
      pings: okPings,
      validation: { ...baseValidation, diversity_ok: false, diversity_reason: '중복률 42.00% ≥ 30% 임계값' },
      expectedScenarioCount: 5,
    });
    expect(g.diversity_ok).toBe(false);
    expect(g.ok).toBe(false);
    expect(g.reasons).toContain('중복률 42.00% ≥ 30% 임계값');
  });

  it('overlap 이 정확히 0 이어도 diversity_ok=true 면 통과 — 0 이 실패로 오판되지 않는다', () => {
    const g = evaluateHealthRecord({
      pings: okPings,
      validation: { ...baseValidation, diversity_overlap: 0, diversity_ok: true },
      expectedScenarioCount: 5,
    });
    expect(g.diversity_ok).toBe(true);
    expect(g.ok).toBe(true);
  });

  it('ping 하나라도 실패 → 전체 실패', () => {
    const g = evaluateHealthRecord({
      pings: [...okPings, { name: 'plan-status', status: 500, ok: false, elapsed_ms: 20 }],
      validation: baseValidation,
      expectedScenarioCount: 5,
    });
    expect(g.all_pings_ok).toBe(false);
    expect(g.ok).toBe(false);
    expect(g.reasons.some((r) => r.includes('plan-status'))).toBe(true);
  });
});
