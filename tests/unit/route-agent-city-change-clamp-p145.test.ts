/**
 * P145 (2026-05-22) regression — RouteAgent Phase 3 city-change day currentTime
 * cap (KTX 도착 → 첫 stop 5h+ 공백 root cause 차단).
 *
 * Root cause (plan 209de47b):
 *   RouteAgent.js:855-864 의 `currentTime = Math.max(arrivalMin + 30, geminiFirstMin)`
 *   이 Gemini 임의값 17:43 그대로 통과시킴. KTX 12:15 도착인데 첫 부산 stop 17:43
 *   = 5h 28min 공백. P143 이 detect 만 했던 회귀의 진짜 차단.
 *
 * Fix:
 *   `currentTime = clamp(Gemini, [arrivalMin + 30, arrivalMin + cap])` where
 *   cap = 240min (lodging — 호텔 체크인 통상) or 90min (활동 stop).
 *
 * Test scenarios:
 *   A. plan 209de47b 재현: KTX 12:15 도착 + Gemini 17:43 + first.category=lodging
 *      → clamp +240min = 16:15.
 *   B. activity first stop: KTX 12:15 도착 + Gemini 17:43 + first.category=culture
 *      → clamp +90min = 13:45.
 *   C. within bounds: KTX 12:15 + Gemini 13:30 + lodging → 13:30 통과 (no clamp).
 *   D. too early: KTX 12:15 + Gemini 12:00 → arrival+30 = 12:45 (lower bound).
 *   E. exactly at upper bound: KTX 12:15 + Gemini 13:45 + activity → 13:45 통과.
 *   F. exactly at upper bound + 1min: KTX 12:15 + Gemini 13:46 + activity → 13:45 (clamp).
 *   G. KTX evening + lodging: 19:00 도착 + Gemini 21:30 + lodging → 21:30 통과 (+150min < +240).
 */
import { describe, it, expect } from 'vitest';

// ─── Inline P145 clamp logic (RouteAgent.js:855-880 동일 구현) ─────────────────
function computeFirstStopTime(params: {
  arrivalAtMin: number;
  geminiFirstMin: number;
  firstCategory: string;
}): number {
  const { arrivalAtMin, geminiFirstMin, firstCategory } = params;
  const lowerBound = arrivalAtMin + 30;
  const firstIsLodging = String(firstCategory || '').toLowerCase() === 'lodging';
  const upperBound = arrivalAtMin + (firstIsLodging ? 240 : 90);
  return Math.max(lowerBound, Math.min(geminiFirstMin, upperBound));
}

function hhmmToMin(t: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) throw new Error(`bad time: ${t}`);
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

describe('P145 — city-change day currentTime clamp (KTX → first stop)', () => {
  it('A. plan 209de47b 재현: KTX 12:15 + Gemini 17:43 + lodging → 16:15 (cap +240)', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('12:15'),
      geminiFirstMin: hhmmToMin('17:43'),
      firstCategory: 'lodging',
    });
    expect(minToHHMM(t)).toBe('16:15'); // 12:15 + 240min = 16:15
  });

  it('B. activity first stop: KTX 12:15 + Gemini 17:43 + culture → 13:45 (cap +90)', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('12:15'),
      geminiFirstMin: hhmmToMin('17:43'),
      firstCategory: 'culture',
    });
    expect(minToHHMM(t)).toBe('13:45'); // 12:15 + 90min = 13:45
  });

  it('C. within bounds: KTX 12:15 + Gemini 13:30 + lodging → 13:30 (no clamp)', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('12:15'),
      geminiFirstMin: hhmmToMin('13:30'),
      firstCategory: 'lodging',
    });
    expect(minToHHMM(t)).toBe('13:30');
  });

  it('D. too early: KTX 12:15 + Gemini 12:00 → 12:45 (lower bound +30)', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('12:15'),
      geminiFirstMin: hhmmToMin('12:00'),
      firstCategory: 'food',
    });
    expect(minToHHMM(t)).toBe('12:45');
  });

  it('E. exactly at upper bound: KTX 12:15 + Gemini 13:45 + activity → 13:45 (통과)', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('12:15'),
      geminiFirstMin: hhmmToMin('13:45'),
      firstCategory: 'food',
    });
    expect(minToHHMM(t)).toBe('13:45');
  });

  it('F. exactly at upper bound + 1min: KTX 12:15 + Gemini 13:46 + activity → 13:45 (clamp)', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('12:15'),
      geminiFirstMin: hhmmToMin('13:46'),
      firstCategory: 'food',
    });
    expect(minToHHMM(t)).toBe('13:45');
  });

  it('G. KTX evening + lodging: 19:00 + Gemini 21:30 + lodging → 21:30 (within +240)', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('19:00'),
      geminiFirstMin: hhmmToMin('21:30'),
      firstCategory: 'lodging',
    });
    expect(minToHHMM(t)).toBe('21:30');
  });

  it('lodging cap precise: arrival 12:15 + Gemini 16:15 → 16:15 (exactly +240)', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('12:15'),
      geminiFirstMin: hhmmToMin('16:15'),
      firstCategory: 'lodging',
    });
    expect(minToHHMM(t)).toBe('16:15');
  });

  it('lodging cap +1min: arrival 12:15 + Gemini 16:16 → 16:15 (clamp)', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('12:15'),
      geminiFirstMin: hhmmToMin('16:16'),
      firstCategory: 'lodging',
    });
    expect(minToHHMM(t)).toBe('16:15');
  });

  it('case-insensitive category: "LODGING" 도 lodging 분기 진입', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('12:15'),
      geminiFirstMin: hhmmToMin('15:00'),
      firstCategory: 'LODGING',
    });
    expect(minToHHMM(t)).toBe('15:00'); // within +240
  });

  it('undefined category: lower bound 적용 (activity cap +90)', () => {
    const t = computeFirstStopTime({
      arrivalAtMin: hhmmToMin('12:15'),
      geminiFirstMin: hhmmToMin('17:43'),
      firstCategory: '',
    });
    expect(minToHHMM(t)).toBe('13:45'); // activity +90
  });
});

describe('P145 — source-level invariant (RouteAgent.js 실제 구현 검증)', () => {
  it('RouteAgent.js 에 P145 clamp logic 존재', async () => {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(
      'api/_ai_core/agents/RouteAgent.js',
      'utf8',
    );
    // P145 marker + 핵심 변수명 검증
    expect(content).toMatch(/P145/);
    expect(content).toMatch(/firstIsLodging/);
    expect(content).toMatch(/lowerBound\s*=\s*arrivalMin\s*\+\s*30/);
    expect(content).toMatch(/upperBound\s*=\s*arrivalMin\s*\+\s*\(\s*firstIsLodging\s*\?\s*240\s*:\s*90\s*\)/);
    expect(content).toMatch(/Math\.max\(lowerBound,\s*Math\.min\(geminiFirstMin,\s*upperBound\)\)/);
  });
});
