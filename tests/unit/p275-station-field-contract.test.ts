/**
 * P275 역명 필드 계약 가드 (2026-06-12 예약/배차 버그헌트).
 *
 * 버그: RouteAgent _routeAirportHotel 이 역명을 firstStep.startName/fromName/start (미존재 필드)로
 * 읽어 fromStationName/toStationName 이 항상 null → _verifyAirportStation(L446 !stationName→match)이
 * 절대 발화 안 함 = 터미널 불일치(비행기 놓침) 가드 死. parseSubPath(_odsay_helper)는 from/to 를 emit.
 * 이 테스트는 producer(parseSubPath)↔consumer(RouteAgent) 필드명 계약을 박제 — 어느 쪽이 drift 하면 발화.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const odsaySrc = readFileSync(resolve(process.cwd(), 'api/_odsay_helper.js'), 'utf8');
const routeSrc = readFileSync(resolve(process.cwd(), 'api/_ai_core/agents/RouteAgent.js'), 'utf8');

describe('P275 station-name 필드 계약 (parseSubPath ↔ RouteAgent)', () => {
  it('parseSubPath 가 from/to 필드를 emit (producer)', () => {
    expect(odsaySrc).toMatch(/from:\s*sub\.startName/);
    expect(odsaySrc).toMatch(/to:\s*sub\.endName/);
  });
  it('RouteAgent 역명 추출이 firstStep.from / lastStep.to 를 읽음 (consumer, 감지 死 회귀 방지)', () => {
    expect(routeSrc).toMatch(/firstStep\.from\b/);
    expect(routeSrc).toMatch(/lastStep\.to\b/);
  });
});
