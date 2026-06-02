/**
 * 공항픽업 가격 SSOT 회귀 가드 (2026-06-02, OPUS 공항픽업 SSOT 이원화 제거).
 *
 * RouteAgent 의 하드코딩 REGION_TO_AIRPORT_TRANSFER_ZONE 을 pricing_spec.json
 * airport_transfer_regions 로 이동 → 운영자가 1곳(pricing_spec)만 수정. airportTransferPriceKRW
 * 는 SSOT(airport_transfer_regions → airport_transfer_prices) 조회. 미매핑 region 은 null(오노출 방지).
 */
import { describe, it, expect } from 'vitest';
import { airportTransferPriceKRW } from '../../api/_ai_core/agents/RouteAgent.js';

describe('airportTransferPriceKRW — SSOT(pricing_spec airport_transfer_regions) 조회', () => {
  it('seoul → seoul-central 가격 (124800)', () => {
    expect(airportTransferPriceKRW('seoul')).toBe(124800);
  });
  it('busan → busan 가격 (660000)', () => {
    expect(airportTransferPriceKRW('busan')).toBe(660000);
  });
  it('gangneung → gangneung-sokcho 가격 (364000)', () => {
    expect(airportTransferPriceKRW('gangneung')).toBe(364000);
  });
  it('area 세분 키(seoul_city) → base 도시(seoul) 폴백', () => {
    expect(airportTransferPriceKRW('seoul_city')).toBe(124800);
  });
  it('미매핑 region(gwangju) → null (가격 오노출 방지)', () => {
    expect(airportTransferPriceKRW('gwangju')).toBeNull();
  });
  it('빈/null region → null', () => {
    expect(airportTransferPriceKRW('')).toBeNull();
    expect(airportTransferPriceKRW(null as never)).toBeNull();
  });
});
