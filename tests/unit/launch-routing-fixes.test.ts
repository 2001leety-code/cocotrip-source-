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
// @ts-expect-error — RouteAgent.js 는 JS
import { getDayHotelCoord } from '../../api/_ai_core/agents/RouteAgent.js';
// @ts-expect-error — responseValidator.js 는 JS
import { normalizeRegionKey } from '../../api/_ai_core/responseValidator.js';

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

// ── P-launch #1b: 한글 region 키 정규화 (P321 trap — 실제 prod 실패 재현) ──
// 배경: 위 source-grep 만으로는 통과했지만 실 dispatch(plan f9e90c0a)에서 부산 출발이
//   "명동 출발"로 나옴. 원인 = regions=['서울','부산'](한글) → getDayHotelCoord({city:'부산'})
//   가 CITY_CENTER_COORDS 영문 키('busan')와 mismatch → silent 첫 도시(명동) 폴백.
//   normalizeRegionKey('부산')→'busan' 적용이 진짜 fix. 이 슈트는 BUG 재현 + FIX 둘 다 박제.
describe('P-launch #1b — 한글 region 키 정규화 (getDayHotelCoord 행동 검증)', () => {
  const TRIP_HOTEL = { lat: 37.5665, lng: 126.978, label: '명동 신라스테이', source: 'trip' };
  const ctx = (first: string) => ({ isMultiCity: true, recommendedZonesMap: null, tripFirstRegion: first, tripHotel: TRIP_HOTEL });

  it('normalizeRegionKey: 부산→busan, 서울→seoul', () => {
    expect(normalizeRegionKey('부산')).toBe('busan');
    expect(normalizeRegionKey('서울')).toBe('seoul');
  });
  it('BUG 재현 — 한글 city "부산" 직접 조회 시 서울(명동, lat>37)로 잘못 폴백', () => {
    const r = getDayHotelCoord({ city: '부산' }, ctx('서울'));
    expect(r.lat).toBeGreaterThan(37); // 부산(35.x)이어야 하는데 명동(37.5)으로 폴백 = 비행기 놓침 risk
  });
  it('FIX — normalizeRegionKey 적용("busan") 시 부산 center(lat<36) + multi_city_center', () => {
    const key = normalizeRegionKey('부산');
    const r = getDayHotelCoord({ city: key }, ctx(normalizeRegionKey('서울')));
    expect(r.lat).toBeLessThan(36); // 부산 ~35.18
    expect(r.source).toBe('multi_city_center');
  });
  it('source-grep — RouteAgent depLastRegion/depFirstRegion + pipeline _depCity 모두 normalizeRegionKey 경유', () => {
    expect(routeAgentSrc).toMatch(/depLastRegion\s*=\s*depRegions\.length\s*>=\s*2\s*\?\s*normalizeRegionKey/);
    expect(routeAgentSrc).toMatch(/depFirstRegion\s*=\s*depRegions\[0\]\s*\?\s*normalizeRegionKey/);
    expect(pipelineSrc).toMatch(/_depCity\s*=[\s\S]{0,80}normalizeRegionKey/);
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
