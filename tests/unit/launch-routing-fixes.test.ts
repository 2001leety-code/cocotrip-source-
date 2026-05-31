/**
 * P-launch (2026-05-31): 오픈 전 라우팅 fix 2종 회귀.
 * #1 멀티시티 departure 가 마지막 도시 호텔에서 출발 (부산 끝 → "부산 출발", "명동" X = 비행기 risk).
 * #2 AREX 직통 합성 실패 시 (a) ≤2.5km 도보 fallback + (b) recommended_option 강등(라벨↔데이터 모순 제거).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — planPersister.js 는 JS
import { selfHealDepartureGuide } from '../../api/_ai_core/planPersister.js';

const ROOT = resolve(__dirname, '../..');
const routeAgentSrc = readFileSync(resolve(ROOT, 'api/_ai_core/agents/RouteAgent.js'), 'utf8');
const pipelineSrc = readFileSync(resolve(ROOT, 'api/_ai_core/postResponsePipeline.js'), 'utf8');

describe('P-launch #1 — selfHealDepartureGuide 마지막 도시 호텔 라벨', () => {
  it('departureHotelLabel(해운대) 있으면 latest_leave_hotel 이 그것 사용, "명동" 아님', () => {
    const itin: Record<string, { latest_leave_hotel?: string }> = { departure_guide: {} };
    selfHealDepartureGuide(itin, 'ICN_T2', { hotel_address: '명동 신라스테이', departureHotelLabel: '해운대 시그니엘' });
    const txt = String(itin.departure_guide.latest_leave_hotel || '');
    expect(txt).toContain('해운대 시그니엘');
    expect(txt).not.toContain('명동');
  });
  it('단도시(departureHotelLabel 없음) → hotel_address 사용 (기존 동작 유지)', () => {
    const itin: Record<string, { latest_leave_hotel?: string }> = { departure_guide: {} };
    selfHealDepartureGuide(itin, 'ICN_T2', { hotel_address: '명동 신라스테이' });
    expect(String(itin.departure_guide.latest_leave_hotel || '')).toContain('명동 신라스테이');
  });
});

describe('P-launch #1 — RouteAgent departure origin = 마지막 도시 (source-grep)', () => {
  it('regions[마지막]에서 출발도시 도출 + getDayHotelCoord 재사용', () => {
    expect(routeAgentSrc).toMatch(/depLastRegion\s*=\s*depRegions\.length\s*>=\s*2/);
    expect(routeAgentSrc).toMatch(/getDayHotelCoord\(\s*\{\s*city:\s*depLastRegion\s*\}/);
    expect(routeAgentSrc).toMatch(/!isSameAsFirstCity\(depLastRegion,\s*depFirstRegion\)/);
  });
  it('_resolveHotelOrFallback 가 depHotelLat/depHotelLng 사용 (첫 도시 hotelLat 직접 아님)', () => {
    expect(routeAgentSrc).toMatch(/hotelLat:\s*depHotelLat/);
    expect(routeAgentSrc).toMatch(/region:\s*departureCity\s*\|\|\s*region/);
  });
  it('postResponsePipeline 가 departureHotelLabel 을 body.hotelByCity[마지막도시]로 전달', () => {
    expect(pipelineSrc).toMatch(/body\?\.hotelByCity\?\.\[_depCity\]/);
    expect(pipelineSrc).toMatch(/departureHotelLabel:\s*_departureHotelLabel/);
  });
});

describe('P-launch #2 — AREX 직통 합성 실패 시 라벨 강등 (source-grep)', () => {
  it('express 못 만들면 effectiveRec 를 public_transit 으로 강등', () => {
    expect(routeAgentSrc).toMatch(/effectiveRec\s*=\s*\{[\s\S]{0,80}key:\s*'public_transit'/);
  });
  it('write 가 recommended_option: effectiveRec (rec 직접 아님)', () => {
    expect(routeAgentSrc).toMatch(/recommended_option:\s*effectiveRec/);
    expect(routeAgentSrc).not.toMatch(/recommended_option:\s*rec\b/);
  });
  it('walk fallback: 도보권(≤2.5km) last-mile 합성 + source walk_synth', () => {
    expect(routeAgentSrc).toMatch(/kmFromSeoulStn\s*<=\s*2\.5/);
    expect(routeAgentSrc).toMatch(/source:\s*'walk_synth'/);
  });
});
