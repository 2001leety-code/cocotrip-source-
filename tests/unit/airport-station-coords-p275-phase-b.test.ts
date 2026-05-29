/**
 * P275 Phase B (2026-05-29): AIRPORT_STATION_COORDS 자동 fix 회귀 차단.
 *
 * P275 Phase A (PR #677) 가 측정만 — quality_warnings 박제 (admin panel 노출).
 * Phase B 가 진짜 root cause fix — AIRPORT_COORDS (공항 lobby) 대신 STATION_COORDS (subway station)
 * 사용 → ODsay 가 strict station match → mismatch 0건 자동 fix.
 *
 * 좌표 source (ko.wikipedia 공식 infobox):
 *   - ICN_T1 station: 37.4475, 126.4528 (인천공항1터미널역)
 *   - ICN_T2 station: 37.4677, 126.4341 (인천공항2터미널역) — T1↔T2 station ~2.6km 떨어짐
 *   - GMP station: 37.5625, 126.8008 (김포공항역)
 *   - PUS station: 35.1667, 128.9514 (공항역 부산김해경전철)
 *
 * 회귀 시: AIRPORT_COORDS (lobby) 사용 회귀 → T1↔T2 ~260m 인접 → ODsay 임의 station = 비행기 놓침.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AIRPORT_COORDS, AIRPORT_STATION_COORDS } from '../../api/_ai_core/constants.js';

describe('P275 Phase B — AIRPORT_STATION_COORDS 자동 fix (ODsay strict match)', () => {
  const routeAgentPath = resolve(__dirname, '../../api/_ai_core/agents/RouteAgent.js');
  const routeAgentSrc = readFileSync(routeAgentPath, 'utf8');

  // ── constants.js — AIRPORT_STATION_COORDS export ─────────────────────────────

  it('AIRPORT_STATION_COORDS export — ICN_T1 / ICN_T2 / ICN / GMP / PUS 정의', () => {
    expect(AIRPORT_STATION_COORDS).toBeDefined();
    expect(AIRPORT_STATION_COORDS.ICN_T1).toBeDefined();
    expect(AIRPORT_STATION_COORDS.ICN_T2).toBeDefined();
    expect(AIRPORT_STATION_COORDS.ICN).toBeDefined();
    expect(AIRPORT_STATION_COORDS.GMP).toBeDefined();
    expect(AIRPORT_STATION_COORDS.PUS).toBeDefined();
  });

  it('ICN_T1 station 좌표 = 37.4475, 126.4528 (인천공항1터미널역)', () => {
    expect(AIRPORT_STATION_COORDS.ICN_T1.lat).toBeCloseTo(37.4475, 3);
    expect(AIRPORT_STATION_COORDS.ICN_T1.lng).toBeCloseTo(126.4528, 3);
    expect(AIRPORT_STATION_COORDS.ICN_T1.station_name).toContain('인천공항1터미널');
  });

  it('ICN_T2 station 좌표 = 37.4677, 126.4341 (인천공항2터미널역)', () => {
    expect(AIRPORT_STATION_COORDS.ICN_T2.lat).toBeCloseTo(37.4677, 3);
    expect(AIRPORT_STATION_COORDS.ICN_T2.lng).toBeCloseTo(126.4341, 3);
    expect(AIRPORT_STATION_COORDS.ICN_T2.station_name).toContain('인천공항2터미널');
  });

  it('T1 station ↔ T2 station 좌표 차이 ≥ 2km (strict match 보장)', () => {
    // T1↔T2 station 가 ~2.6km 떨어짐 (공항 동서 별개). 좌표 lat 차이 ~0.02, lng 차이 ~0.02.
    const latDiff = Math.abs(AIRPORT_STATION_COORDS.ICN_T1.lat - AIRPORT_STATION_COORDS.ICN_T2.lat);
    const lngDiff = Math.abs(AIRPORT_STATION_COORDS.ICN_T1.lng - AIRPORT_STATION_COORDS.ICN_T2.lng);
    // 대각선 거리 ≈ sqrt(latDiff^2 + lngDiff^2) * 111km (1° ≈ 111km)
    const distKm = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111;
    expect(distKm).toBeGreaterThan(2);
  });

  it('ICN generic = T1 alias (terminal 미지정 input fallback)', () => {
    expect(AIRPORT_STATION_COORDS.ICN.lat).toBe(AIRPORT_STATION_COORDS.ICN_T1.lat);
    expect(AIRPORT_STATION_COORDS.ICN.lng).toBe(AIRPORT_STATION_COORDS.ICN_T1.lng);
  });

  it('CJU / TAE / MWX / YNY = STATION_COORDS undefined (지하철 없음, AIRPORT_COORDS fallback)', () => {
    expect(AIRPORT_STATION_COORDS.CJU).toBeUndefined();
    expect(AIRPORT_STATION_COORDS.TAE).toBeUndefined();
    expect(AIRPORT_STATION_COORDS.MWX).toBeUndefined();
    expect(AIRPORT_STATION_COORDS.YNY).toBeUndefined();
    // AIRPORT_COORDS 는 그대로 정의 (fallback 보장)
    expect(AIRPORT_COORDS.CJU).toBeDefined();
    expect(AIRPORT_COORDS.TAE).toBeDefined();
  });

  // ── RouteAgent.js — STATION_COORDS 우선 사용 ──────────────────────────────────

  it('RouteAgent — AIRPORT_STATION_COORDS import 추가', () => {
    expect(routeAgentSrc).toMatch(/import\s*\{[^}]*AIRPORT_STATION_COORDS[^}]*\}\s*from\s*["']\.\.\/constants\.js["']/);
  });

  it('RouteAgent — arrival 호출 site 가 STATION_COORDS 우선 + AIRPORT_COORDS fallback', () => {
    expect(routeAgentSrc).toMatch(/AIRPORT_STATION_COORDS\[arrivalAirportKey\]\s*\|\|\s*AIRPORT_COORDS\[arrivalAirportKey\]/);
  });

  it('RouteAgent — departure 호출 site 가 STATION_COORDS 우선 + AIRPORT_COORDS fallback', () => {
    expect(routeAgentSrc).toMatch(/AIRPORT_STATION_COORDS\[departureAirportKey\]\s*\|\|\s*AIRPORT_COORDS\[departureAirportKey\]/);
  });

  it('P275 Phase B reference + SAFETY-CRITICAL 명시', () => {
    expect(routeAgentSrc).toContain('P275 Phase B');
    expect(routeAgentSrc).toContain('SAFETY-CRITICAL');
    expect(routeAgentSrc).toContain('696b273d');  // 사용자 신고 plan
  });
});
