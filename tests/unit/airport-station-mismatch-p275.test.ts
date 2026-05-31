/**
 * P275 (2026-05-29): ODsay airport station mismatch 측정 + quality_warnings 박제 회귀 차단.
 *
 * P274 (PR #673) 가 우회 fix — input='ICN' echo + postPipeline override + buildPrompt rule.
 * 그러나 진짜 root cause = ODsay 가 T1/T2 좌표 ~260m 인접 → 임의 station 추천.
 *
 * P275 Phase A: _routeAirportHotel 반환에 fromStationName/toStationName 추출 + 호출 site 에서
 *   _verifyAirportStation 으로 input terminal 과 일치 검증 → mismatch 시 quality_warnings 박제.
 * Phase B (별도 cycle): station 좌표 별도 dict + ODsay strict match.
 *
 * 회귀 시: ODsay 가 T1↔T2 swap station 추천해도 측정 안 됨 → sleeper bug 잠복.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('P275 airport station mismatch verify + quality_warnings 박제', () => {
  const srcPath = resolve(__dirname, '../../api/_ai_core/agents/RouteAgent.js');
  const src = readFileSync(srcPath, 'utf8');

  it('_routeAirportHotel — fromStationName / toStationName extract', () => {
    expect(src).toMatch(/fromStationName\s*=\s*firstStep/);
    expect(src).toMatch(/toStationName\s*=\s*lastStep/);
    // return 에 fromStationName, toStationName 포함
    expect(src).toMatch(/return\s+\{[\s\S]{0,800}fromStationName,[\s\S]{0,100}toStationName,/);
  });

  it('_verifyAirportStation 함수 정의 (module-level)', () => {
    expect(src).toMatch(/function\s+_verifyAirportStation\s*\(inputAirportKey,\s*stationName\)/);
    // ICN_T1 / ICN_T2 strict match
    expect(src).toContain("ak === 'ICN_T1'");
    expect(src).toContain("ak === 'ICN_T2'");
    expect(src).toContain('t1_input_t2_station');
    expect(src).toContain('t2_input_t1_station');
  });

  it('arrival side — verify + quality_warnings 박제', () => {
    // P327 (2026-05-31): arrival HERO 가 route → heroRoute(직통 합성 가능) 로 rename.
    // P275 station 가드는 heroRoute.fromStationName 검증 (직통 HERO 는 fromStationName=공항역 → 통과).
    expect(src).toMatch(/_verifyAirportStation\(arrivalAirportKey,\s*heroRoute\.fromStationName\)/);
    expect(src).toContain('arrival_station_terminal_mismatch');
    expect(src).toContain('비행기 놓침 risk');
  });

  it('departure side — verify + quality_warnings 박제', () => {
    expect(src).toMatch(/_verifyAirportStation\(departureAirportKey,\s*route\.toStationName\)/);
    expect(src).toContain('departure_station_terminal_mismatch');
  });

  it('P275 reference + SAFETY-CRITICAL 명시', () => {
    expect(src).toContain('P275');
    expect(src).toContain('SAFETY-CRITICAL');
    // Phase A (측정) — Phase B (자동 fix) 별도 cycle
    expect(src).toContain('Phase A');
    expect(src).toContain('Phase B');
  });
});
