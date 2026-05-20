/**
 * P113 (2026-05-20) regression slot — intercity_transit.recommended_depart
 * time stitching after Phase 2.4 lodging_to_station enrichment.
 *
 * Source bug (plan 4792076e): stop1=Myeongdong Hotel 12:25 (checkout) +
 * intercity_transit.recommended_depart=09:00 (Gemini 출력) → 모순. 사용자 입장:
 * "호텔 12:25 출발인데 KTX 09:00 어떻게 타나?" 혼란.
 *
 * Fix: Phase 2.4 가 lodging_to_station 채우면 recommended_depart 를
 * stop1.start_time + lodging_to_station.est_min 으로 override + arrival_at
 * 동시 stitching (depart + KTX duration).
 *
 * Source-level regression assert (의도된 stitching 코드 패턴 보존).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_AGENT = readFileSync(
  join(__dirname, '../../api/_ai_core/agents/RouteAgent.js'),
  'utf8',
);

describe('RouteAgent — P113 intercity time stitching', () => {
  it('stitch block guarded by lodging_to_station + stop1.start_time presence', () => {
    // Phase 2.4 가 lodging_to_station 채웠을 때만 발화 — silent fail 시 Gemini
    // 의 recommended_depart 그대로 보존 (안전 default).
    expect(ROUTE_AGENT).toMatch(/it\.lodging_to_station\s*&&\s*Number\.isFinite\(it\.lodging_to_station\.est_min\)/);
    expect(ROUTE_AGENT).toMatch(/places\[0\]\.start_time/);
  });

  it('recommended_depart override only when newDepartMin computable', () => {
    // stop1.start_time invalid 면 stitch X (안전 default).
    expect(ROUTE_AGENT).toMatch(/Number\.isFinite\(stop1Min\)/);
    expect(ROUTE_AGENT).toMatch(/it\.recommended_depart\s*=\s*formattedDepart/);
  });

  it('arrival_at stitching uses intercity_transit.est_min (KTX duration)', () => {
    expect(ROUTE_AGENT).toMatch(/it\.arrival_at\s*=\s*formattedArrival/);
    expect(ROUTE_AGENT).toMatch(/newDepartMin\s*\+\s*Number\(it\.est_min\)/);
  });

  it('logs old → new recommended_depart for prod audit', () => {
    expect(ROUTE_AGENT).toMatch(/intercity recommended_depart.*→.*stitched stop1=/);
  });

  it('only runs when isCityChangeDay block (inside Phase 2.4 scope)', () => {
    // P113 stitching 은 Phase 2.4 block 안에 있어야 함 (city-change day only).
    // 단도시 plan 은 intercity_transit 자체 없으므로 무영향.
    const phase24Start = ROUTE_AGENT.indexOf('if (isCityChangeDay && dayPlan.intercity_transit)');
    expect(phase24Start).toBeGreaterThan(0);
    const stitchStart = ROUTE_AGENT.indexOf('intercity recommended_depart');
    expect(stitchStart).toBeGreaterThan(phase24Start);
    // stitch 가 hotelTransit (line 1033+) 보다 위에 있어야 함 (Phase 2.4 안).
    const hotelTransitStart = ROUTE_AGENT.indexOf('let hotelTransit = null;');
    expect(stitchStart).toBeLessThan(hotelTransitStart);
  });
});
