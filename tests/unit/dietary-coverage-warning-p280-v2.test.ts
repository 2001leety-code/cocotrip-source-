/**
 * P280 v2 (2026-05-29): dietary coverage depth check — severity='warning' 재설계 회귀 차단.
 *
 * P280 v1 (PR #680 → revert #693) lesson:
 *   severity='critical' + retry trigger → Korea halal 식당 매칭 거의 0 → 무한 retry → plan stuck.
 *
 * P280 v2:
 *   severity='warning' (retry trigger 안 됨)
 *   박제만 (admin panel 노출)
 *   사용자 plan 생성 보장
 *
 * 회귀 시: severity='critical' 회귀 → retry loop 재발 → plan stuck → SAFETY-CRITICAL 사용자 영향.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateResponse, hasCriticalDietaryViolation } from '../../api/_ai_core/responseValidator.js';

describe('P280 v2 dietary coverage — severity=warning (retry loop 차단)', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/responseValidator.js');
  const src = readFileSync(srcPath, 'utf8');

  it('source — checkDietaryCoverage function 재추가 (P280 v2)', () => {
    expect(src).toMatch(/function\s+checkDietaryCoverage/);
    expect(src).toContain('P280 v2');
    expect(src).toContain('retry loop 회피');
  });

  it('source — dietary_coverage_low severity=warning (critical 아님 — 회귀 차단)', () => {
    expect(src).toMatch(/type:\s*'dietary_coverage_low'[\s\S]{0,200}severity:\s*'warning'/);
    // critical 회귀 차단
    expect(src).not.toMatch(/type:\s*'dietary_coverage_low'[\s\S]{0,200}severity:\s*'critical'/);
  });

  it('source — hasCriticalDietaryViolation 가 coverage_low 제외 (retry trigger 안 됨)', () => {
    // dietary_violation critical 만 retry — coverage_low 제외 명시
    expect(src).toMatch(/return\s+issues\.some\(\(i\)\s*=>\s*i\s*&&\s*i\.type\s*===\s*'dietary_violation'\s*&&\s*i\.severity\s*===\s*'critical'\)/);
    expect(src).not.toMatch(/dietary_coverage_low.*hasCriticalDietaryViolation/);
  });

  // ── runtime ────────────────────────────────────────────────────────────────

  function makeData(stops: Array<any>) {
    return { days: [{ stops }] };
  }

  it('runtime — dietary=[halal] + 0 halal-claim food stops → coverage_low warning 박제', () => {
    const data = makeData([
      { name: '명동교자', category: 'food', address: '서울시 중구' },
      { name: '서울식당', category: 'food', address: '서울시 강남구' },
      { name: '한국집', category: 'food', address: '서울시 마포구' },
      { name: '경복궁식당', category: 'food', address: '서울시 종로구' },
    ]);
    const issues = validateResponse(data, { dietary: ['halal'], lang: 'en' }, []);
    const coverage = issues.filter(i => i.type === 'dietary_coverage_low');
    expect(coverage.length).toBe(1);
    expect(coverage[0].severity).toBe('warning');  // NOT 'critical'
    expect(coverage[0].coverage).toBe(0);
  });

  it('runtime — hasCriticalDietaryViolation 가 coverage_low 무시 (retry 안 trigger)', () => {
    const issues = [
      { type: 'dietary_coverage_low', severity: 'warning', dietary_pref: 'halal' },
    ];
    expect(hasCriticalDietaryViolation(issues)).toBe(false);
  });

  it('runtime — coverage_low 와 dietary_violation 동시 → critical (dietary_violation) 만 retry', () => {
    const issues = [
      { type: 'dietary_coverage_low', severity: 'warning', dietary_pref: 'halal' },
      { type: 'dietary_violation', severity: 'critical', stop: '돼지국밥', diet: 'halal' },
    ];
    expect(hasCriticalDietaryViolation(issues)).toBe(true);  // dietary_violation 가 trigger
  });

  it('runtime — dietary=[] (입력 없음) → coverage check skip', () => {
    const data = makeData([
      { name: '명동교자', category: 'food', address: '서울시 중구' },
    ]);
    const issues = validateResponse(data, { dietary: [], lang: 'en' }, []);
    const coverage = issues.filter(i => i.type === 'dietary_coverage_low');
    expect(coverage.length).toBe(0);
  });

  it('runtime — food stops 0 → coverage skip (N/A)', () => {
    const data = makeData([
      { name: '경복궁', category: 'attraction', address: '서울시 종로구' },
    ]);
    const issues = validateResponse(data, { dietary: ['halal'], lang: 'en' }, []);
    const coverage = issues.filter(i => i.type === 'dietary_coverage_low');
    expect(coverage.length).toBe(0);
  });
});
