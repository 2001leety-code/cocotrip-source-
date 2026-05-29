/**
 * P280 (2026-05-29): SAFETY-CRITICAL dietary coverage depth check 회귀 차단.
 *
 * 배경 (Agent 1 deep-search 발견):
 * P0-3 의 checkDietaryViolation = stop 별 fire-and-forget. coverage 부족 케이스
 *   (0개 halal restaurant 인데 dietary=['halal']) 미감지 → 사용자 건강 위험 sleeper bug.
 *
 * Fix: validateResponse 에 checkDietaryCoverage 추가 — food stops 중 dietary-claim
 *   ratio < 50% 시 dietary_coverage_low 박제 (severity=critical → caller retry trigger).
 *
 * 회귀 시: SAFETY-CRITICAL 미감지 → 사용자 halal/vegan 입력했는데 일반 식당 plan = 건강 risk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateResponse, hasCriticalDietaryViolation } from '../../api/_ai_core/responseValidator.js';

describe('P280 dietary coverage depth check (SAFETY-CRITICAL)', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/responseValidator.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — checkDietaryCoverage function 정의 (module-level)', () => {
    expect(src).toMatch(/function\s+checkDietaryCoverage\s*\(allStops,\s*dietary\)/);
    expect(src).toContain('COVERAGE_THRESHOLD = 0.5');
    expect(src).toContain('halal');
    expect(src).toContain('vegan');
    expect(src).toContain('vegetarian');
  });

  it('source — validateResponse 가 checkDietaryCoverage 호출 + dietary_coverage_low 박제', () => {
    expect(src).toMatch(/checkDietaryCoverage\s*\(allStops,\s*dietary\)/);
    expect(src).toContain('dietary_coverage_low');
    expect(src).toContain("severity: 'critical'");
    expect(src).toContain('P280');
  });

  it('source — hasCriticalDietaryViolation 가 coverage_low 도 critical 로 인식 (retry trigger)', () => {
    expect(src).toMatch(/i\.type\s*===\s*'dietary_violation'\s*\|\|\s*i\.type\s*===\s*'dietary_coverage_low'/);
  });

  // ── runtime test: validateResponse 직접 호출 ───────────────────────────────────

  function makeRequest(overrides: any = {}) {
    return {
      dietary: ['halal'],
      lang: 'en',
      ...overrides,
    };
  }

  function makeDataWithStops(foodStops: Array<any>) {
    return {
      days: [{ stops: foodStops }],
    };
  }

  it('runtime — dietary=[] (입력 없음) → coverage check skip (issues 0 dietary)', () => {
    const data = makeDataWithStops([
      { name: '명동교자', category: 'food', address: '서울시 중구' },
    ]);
    const issues = validateResponse(data, { dietary: [], lang: 'en' }, []);
    const coverageIssues = issues.filter(i => i.type === 'dietary_coverage_low');
    expect(coverageIssues.length).toBe(0);
  });

  it('runtime — dietary=["halal"] + 0 food stops → coverage skip (N/A)', () => {
    const data = makeDataWithStops([
      { name: '경복궁', category: 'attraction', address: '서울시 종로구' },
    ]);
    const issues = validateResponse(data, makeRequest({ dietary: ['halal'] }), []);
    const coverageIssues = issues.filter(i => i.type === 'dietary_coverage_low');
    expect(coverageIssues.length).toBe(0);
  });

  it('runtime — dietary=["halal"] + 4 food stops 모두 non-halal → coverage_low 박제 (SAFETY)', () => {
    const data = makeDataWithStops([
      { name: '명동교자', category: 'food', address: '서울시 중구' },
      { name: '서울식당', category: 'food', address: '서울시 강남구' },
      { name: '한국집', category: 'food', address: '서울시 마포구' },
      { name: '경복궁식당', category: 'food', address: '서울시 종로구' },
    ]);
    const issues = validateResponse(data, makeRequest({ dietary: ['halal'] }), []);
    const coverageIssues = issues.filter(i => i.type === 'dietary_coverage_low');
    expect(coverageIssues.length).toBe(1);
    expect(coverageIssues[0].dietary_pref).toBe('halal');
    expect(coverageIssues[0].coverage).toBe(0);
    expect(coverageIssues[0].food_stops_count).toBe(4);
    expect(coverageIssues[0].severity).toBe('critical');
  });

  it('runtime — dietary=["halal"] + 4 food stops 중 2 halal-claim (50% threshold = boundary) → no issue', () => {
    const data = makeDataWithStops([
      { name: 'EID Halal Korean BBQ', category: 'food', address: '서울시 이태원' },
      { name: 'Halal Guys Seoul', category: 'food', address: '서울시 강남구' },
      { name: '한국집', category: 'food', address: '서울시 마포구' },
      { name: '경복궁식당', category: 'food', address: '서울시 종로구' },
    ]);
    const issues = validateResponse(data, makeRequest({ dietary: ['halal'] }), []);
    const coverageIssues = issues.filter(i => i.type === 'dietary_coverage_low');
    expect(coverageIssues.length).toBe(0); // 50% threshold — exactly half = pass
  });

  it('runtime — dietary=["vegan"] + 5 food stops 모두 non-vegan → coverage_low 박제', () => {
    const data = makeDataWithStops([
      { name: '명동교자', category: 'food', address: '서울시 중구' },
      { name: '서울식당', category: 'food', address: '서울시 강남구' },
      { name: '한국집', category: 'food', address: '서울시 마포구' },
      { name: '경복궁식당', category: 'food', address: '서울시 종로구' },
      { name: '신촌식당', category: 'food', address: '서울시 신촌' },
    ]);
    const issues = validateResponse(data, makeRequest({ dietary: ['vegan'] }), []);
    const coverageIssues = issues.filter(i => i.type === 'dietary_coverage_low');
    expect(coverageIssues.length).toBe(1);
    expect(coverageIssues[0].dietary_pref).toBe('vegan');
  });

  it('runtime — hasCriticalDietaryViolation 가 dietary_coverage_low 도 critical 로 인식', () => {
    const issues = [
      { type: 'dietary_coverage_low', severity: 'critical', dietary_pref: 'halal' },
    ];
    expect(hasCriticalDietaryViolation(issues)).toBe(true);
  });

  it('runtime — halal + vegetarian 동시 → 둘 다 검사 (vegan 자동 제외 — vegetarian 포함)', () => {
    const data = makeDataWithStops([
      { name: '명동교자', category: 'food', address: '서울시 중구' },
      { name: '서울식당', category: 'food', address: '서울시 강남구' },
    ]);
    const issues = validateResponse(data, makeRequest({ dietary: ['halal', 'vegetarian'] }), []);
    const coverageIssues = issues.filter(i => i.type === 'dietary_coverage_low');
    // 둘 다 0% coverage → 2 issues
    expect(coverageIssues.length).toBe(2);
    const prefs = coverageIssues.map(i => i.dietary_pref).sort();
    expect(prefs).toEqual(['halal', 'vegetarian']);
  });
});
