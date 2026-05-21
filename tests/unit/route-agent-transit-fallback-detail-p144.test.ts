/**
 * P144-continued (2026-05-22) — RouteAgent ODsay null fallback transit_from_prev
 * step_by_step enrichment.
 *
 * Source bug (사용자 신고 2026-05-22):
 *   Day 2 마지막 "차량 17분 → Hotel in Myeongdong (Undeci…)" 단순 표시 — 거리,
 *   권장 수단, 야간 라벨 부재. 사용자 시점: "복귀 경로 안 나옴".
 *
 * Root cause:
 *   RouteAgent.js:1255-1271 의 ODsay 실패 분기에서 step_by_step = geminiTransit
 *   .step_by_step || [] — Gemini 가 안 채우면 빈 배열. TransitArrow 가 빈 배열
 *   이면 method + duration + fare 만 표시.
 *
 * Fix:
 *   step_by_step 비어있을 때 stub 텍스트 생성 (거리/시간/택시 추정/야간 라벨).
 *   - 좌표 있는 케이스 (Naver fallback): 거리 + 택시 추정 + 야간 라벨 (옵션).
 *   - 좌표 없는 케이스 (isBlindFallback): stub 생성 X (거리 정보 부재).
 *   - Gemini step_by_step 있으면 그대로 보존 (override X).
 *   - _late_night flag + distance_km 필드 inject.
 *
 * Test scenarios:
 *   A. ODsay null + 좌표 있음 + step_by_step 빈 배열 → 3-4 stub 텍스트 생성.
 *   B. isBlindFallback=true → stub 생성 X (거리 정보 부재 → 신뢰 X).
 *   C. Gemini step_by_step 있음 → 그대로 보존 (override X).
 *   D. 야간 (start_time >= 22:00) → 야간 stub 추가.
 *   E. 야간 (start_time < 05:00) → 야간 stub 추가.
 *   F. 주간 (15:00) → 야간 stub 없음.
 *   G. distance_km 필드 inject (transit.distanceKm 유효시).
 *   H. _late_night flag inject (start_time 22:30 시).
 *   I. distanceKm undefined → "단거리" 라벨 사용.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Inline replica of P144-continued enrichment logic ─────────────────────────
// RouteAgent.js:1255-1310 동일 구현. 외부 의존성 없는 pure function 형태로.
function buildFallbackTransit(params: {
  geminiTransit?: {
    method?: string;
    step_by_step?: string[];
    est_min?: number;
    est_fare_krw?: number;
    instruction_en?: string;
  };
  realTransitMin: number;
  transit: { drivingMin?: number; distanceKm?: number };
  isBlindFallback: boolean;
  placeStartTime?: string;
}): {
  method: string;
  step_by_step: string[];
  est_min: number;
  source: string;
  distance_km?: number;
  _blind_fallback?: boolean;
  _late_night?: boolean;
} {
  const { geminiTransit = {}, realTransitMin, transit, isBlindFallback, placeStartTime } = params;
  const fallbackMethod = geminiTransit.method || 'car';
  const fallbackMin = transit.drivingMin || geminiTransit.est_min || realTransitMin;
  const distKm = transit.distanceKm;

  const startHHMM = String(placeStartTime || '');
  const startHourMatch = /^(\d{1,2}):/.exec(startHHMM);
  const startHour = startHourMatch ? parseInt(startHourMatch[1], 10) : null;
  const isLateNight = startHour !== null && (startHour >= 22 || startHour < 5);

  let enrichedSteps: string[] = Array.isArray(geminiTransit.step_by_step) && geminiTransit.step_by_step.length > 0
    ? geminiTransit.step_by_step
    : [];

  if (enrichedSteps.length === 0 && !isBlindFallback) {
    const taxiFareKrw = (transit.drivingMin || fallbackMin) * 200 + 4800;
    const distStr = (typeof distKm === 'number' && Number.isFinite(distKm))
      ? `약 ${distKm.toFixed(1)}km`
      : '단거리';
    enrichedSteps = [
      `이동 거리: ${distStr}`,
      `예상 시간: 약 ${fallbackMin}분 (차량 기준)`,
      `택시 추정: 약 ${Math.round(taxiFareKrw / 100) * 100}원 — 카카오T / Uber 권장`,
    ];
    if (isLateNight) {
      enrichedSteps.push('야간 시간대 — 지하철·버스 막차 종료 가능. 택시·카카오T 안전');
    }
  }

  return {
    method: fallbackMethod,
    step_by_step: enrichedSteps,
    est_min: fallbackMin,
    source: isBlindFallback ? 'blind_25_no_coords' : 'naver_fallback',
    ...(typeof distKm === 'number' && Number.isFinite(distKm) ? { distance_km: distKm } : {}),
    ...(isBlindFallback ? { _blind_fallback: true } : {}),
    ...(isLateNight ? { _late_night: true } : {}),
  };
}

describe('P144-continued — ODsay null fallback step_by_step enrichment', () => {
  it('A. ODsay null + 좌표 있음 + 빈 step_by_step → 3 stub 텍스트', () => {
    const out = buildFallbackTransit({
      realTransitMin: 17,
      transit: { drivingMin: 17, distanceKm: 4.2 },
      isBlindFallback: false,
      placeStartTime: '20:03',
    });
    expect(out.step_by_step).toHaveLength(3);
    expect(out.step_by_step[0]).toMatch(/이동 거리: 약 4\.2km/);
    expect(out.step_by_step[1]).toMatch(/예상 시간: 약 17분/);
    expect(out.step_by_step[2]).toMatch(/택시 추정.*카카오T/);
  });

  it('B. isBlindFallback=true → stub 생성 X (빈 배열)', () => {
    const out = buildFallbackTransit({
      realTransitMin: 25,
      transit: {},
      isBlindFallback: true,
      placeStartTime: '20:03',
    });
    expect(out.step_by_step).toEqual([]);
    expect(out._blind_fallback).toBe(true);
    expect(out.source).toBe('blind_25_no_coords');
  });

  it('C. Gemini step_by_step 있음 → 그대로 보존 (override X)', () => {
    const out = buildFallbackTransit({
      geminiTransit: { step_by_step: ['Gemini 원본 step 1', 'Gemini 원본 step 2'] },
      realTransitMin: 17,
      transit: { drivingMin: 17, distanceKm: 4.2 },
      isBlindFallback: false,
      placeStartTime: '20:03',
    });
    expect(out.step_by_step).toEqual(['Gemini 원본 step 1', 'Gemini 원본 step 2']);
  });

  it('D. 야간 22:30 → 야간 stub 추가 (4번째 항목)', () => {
    const out = buildFallbackTransit({
      realTransitMin: 17,
      transit: { drivingMin: 17, distanceKm: 4.2 },
      isBlindFallback: false,
      placeStartTime: '22:30',
    });
    expect(out.step_by_step).toHaveLength(4);
    expect(out.step_by_step[3]).toMatch(/야간 시간대.*막차 종료/);
    expect(out._late_night).toBe(true);
  });

  it('E. 야간 03:00 (이른 새벽) → 야간 stub 추가', () => {
    const out = buildFallbackTransit({
      realTransitMin: 25,
      transit: { distanceKm: 5.0 },
      isBlindFallback: false,
      placeStartTime: '03:00',
    });
    expect(out.step_by_step).toHaveLength(4);
    expect(out._late_night).toBe(true);
  });

  it('F. 주간 15:00 → 야간 stub 없음 (3 항목)', () => {
    const out = buildFallbackTransit({
      realTransitMin: 17,
      transit: { drivingMin: 17, distanceKm: 4.2 },
      isBlindFallback: false,
      placeStartTime: '15:00',
    });
    expect(out.step_by_step).toHaveLength(3);
    expect(out._late_night).toBeUndefined();
  });

  it('G. distance_km 필드 inject (transit.distanceKm 유효시)', () => {
    const out = buildFallbackTransit({
      realTransitMin: 17,
      transit: { distanceKm: 4.2 },
      isBlindFallback: false,
      placeStartTime: '14:00',
    });
    expect(out.distance_km).toBe(4.2);
  });

  it('H. _late_night flag inject (start_time 22:30)', () => {
    const out = buildFallbackTransit({
      realTransitMin: 17,
      transit: { distanceKm: 4.2 },
      isBlindFallback: false,
      placeStartTime: '22:30',
    });
    expect(out._late_night).toBe(true);
  });

  it('I. distanceKm undefined → "단거리" 라벨 사용', () => {
    const out = buildFallbackTransit({
      realTransitMin: 10,
      transit: {},
      isBlindFallback: false,
      placeStartTime: '14:00',
    });
    expect(out.step_by_step[0]).toMatch(/이동 거리: 단거리/);
  });

  it('J. 19:59 → 야간 X (경계값)', () => {
    const out = buildFallbackTransit({
      realTransitMin: 17,
      transit: { distanceKm: 4.2 },
      isBlindFallback: false,
      placeStartTime: '19:59',
    });
    expect(out._late_night).toBeUndefined();
  });

  it('K. 22:00 → 야간 (경계값 inclusive)', () => {
    const out = buildFallbackTransit({
      realTransitMin: 17,
      transit: { distanceKm: 4.2 },
      isBlindFallback: false,
      placeStartTime: '22:00',
    });
    expect(out._late_night).toBe(true);
  });

  it('L. 04:59 → 야간 (경계값 < 5)', () => {
    const out = buildFallbackTransit({
      realTransitMin: 25,
      transit: { distanceKm: 5.0 },
      isBlindFallback: false,
      placeStartTime: '04:59',
    });
    expect(out._late_night).toBe(true);
  });

  it('M. 05:00 → 야간 X (경계값)', () => {
    const out = buildFallbackTransit({
      realTransitMin: 25,
      transit: { distanceKm: 5.0 },
      isBlindFallback: false,
      placeStartTime: '05:00',
    });
    expect(out._late_night).toBeUndefined();
  });
});

describe('P144-continued — source-level invariant (RouteAgent.js)', () => {
  const ROUTE_AGENT = readFileSync(
    resolve(process.cwd(), 'api/_ai_core/agents/RouteAgent.js'),
    'utf8',
  );

  it('P144-continued marker 존재', () => {
    expect(ROUTE_AGENT).toMatch(/P144-continued/);
  });

  it('enrichedSteps 변수 + isLateNight 분기 존재', () => {
    expect(ROUTE_AGENT).toMatch(/let enrichedSteps/);
    expect(ROUTE_AGENT).toMatch(/const isLateNight/);
    expect(ROUTE_AGENT).toMatch(/startHour\s*>=\s*22\s*\|\|\s*startHour\s*<\s*5/);
  });

  it('카카오T 권장 텍스트 + 막차 종료 알림 inject', () => {
    expect(ROUTE_AGENT).toMatch(/카카오T/);
    expect(ROUTE_AGENT).toMatch(/막차 종료/);
  });

  it('distance_km 필드 + _late_night flag inject 패턴 존재', () => {
    expect(ROUTE_AGENT).toMatch(/distance_km:\s*distKm/);
    expect(ROUTE_AGENT).toMatch(/_late_night:\s*true/);
  });
});
