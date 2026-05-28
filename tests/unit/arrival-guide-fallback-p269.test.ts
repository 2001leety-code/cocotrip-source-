/**
 * P269 (2026-05-28): arrival_guide.route_to_hotel 4-fallback chain.
 *
 * 배경: 5/28 P266 결과물 검증 cycle → 5/5 plan 의 arrival_guide keys 가
 * `_self_healed, airport, steps` 만 — `route_to_hotel` 누락. departure 측은
 * `_resolveHotelOrFallback` 4-fallback chain (hotel 좌표 → arrival_guide.address →
 * zone anchor → 도시 중심) + _failed 마커 적용 — arrival 측만 누락.
 *
 * P269 fix:
 *   - RouteAgent.js arrival 측 if 분기를 departure 패턴과 동일하게 변경:
 *     1. arrivalAirportKey + AIRPORT_COORDS + rawItinerary.arrival_guide 만 check
 *     2. _resolveHotelOrFallback 호출 (4-fallback chain)
 *     3. arrFromCoord 있으면 route + fallback_origin/label/anchor
 *     4. arrFromCoord 없거나 ODsay 실패 시 _failed 마커
 *
 * 회귀 시: hotel_address='' 시 arrival_guide.route_to_hotel 누락 → 사용자
 *         도착 후 호텔 가는 경로 불명 → 외국인 VIP 신고 (운영자 의도 위반).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

describe('P269 arrival_guide.route_to_hotel 4-fallback chain', () => {
  const routeAgentSrc = readFileSync(
    resolve(ROOT, 'api/_ai_core/agents/RouteAgent.js'),
    'utf8',
  );

  it('arrival 측: _resolveHotelOrFallback 호출 (departure 패턴 동일)', () => {
    // arrival_guide 분기 안에 arrFromCoord 변수 + _resolveHotelOrFallback 호출
    expect(routeAgentSrc).toMatch(/arrFromCoord/);
    expect(routeAgentSrc).toMatch(
      /const\s*\{\s*coord:\s*arrFromCoord[^}]*\}\s*=\s*await\s+this\._resolveHotelOrFallback/s,
    );
  });

  it('arrival 측: hotelLat/Lng 둘 다 있어야 한다는 strict if 제거', () => {
    // 변경 전: `if (hotelLat && hotelLng && arrivalAirportKey && AIRPORT_COORDS[arrivalAirportKey])`
    // 변경 후: `if (arrivalAirportKey && AIRPORT_COORDS[arrivalAirportKey] && rawItinerary.arrival_guide)`
    expect(routeAgentSrc).toMatch(
      /if\s*\(\s*arrivalAirportKey\s*&&\s*AIRPORT_COORDS\[\s*arrivalAirportKey\s*\]\s*&&\s*rawItinerary\.arrival_guide\s*\)/,
    );
  });

  it('arrival 측: _failed 마커 fallback (ODsay 실패 + no coord 케이스)', () => {
    // ODsay 실패 시 _failed=true + fallbackReason='odsay_unavailable'
    expect(routeAgentSrc).toMatch(/_odsay_failed:\s*true[^}]*fallbackReason:\s*['"]odsay_unavailable['"]/s);
    // no coord 시 _failed=true + fallbackReason='no_destination_coord'
    expect(routeAgentSrc).toMatch(/fallbackReason:\s*['"]no_destination_coord['"]/);
  });

  it('arrival 측: anchor_source 가 fallback chain 결과 반영', () => {
    // anchor_source 가 arrFromSource (hotel/arrival_guide/zone_anchor/city_center) 분기
    expect(routeAgentSrc).toMatch(
      /anchor_source:\s*arrFromSource\s*===\s*['"]hotel['"]\s*\?\s*\(?anchorSource/,
    );
  });

  it('P269 주석 + 운영자 의도 명시', () => {
    expect(routeAgentSrc).toMatch(
      /P269[^\n]*4-fallback chain|P269[^\n]*fallback chain 적용/,
    );
    expect(routeAgentSrc).toMatch(
      /도착 후 호텔 경로 무조건 표시|hotel_address=''/,
    );
  });
});
