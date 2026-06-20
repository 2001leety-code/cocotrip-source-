/**
 * [#5 MED] calculateTmoney — 도착/출발 last-mile 대중교통 요금 반영.
 *
 * 기존 버그: arrivalTransitCost 가 RouteAgent 가 저장하지 않는 경로
 *   (arrival_guide.steps[].transport_to_hotel.arex_all_stop.price_krw) 를 읽어 항상 0,
 *   departureTransitCost 도 departure_guide.to_airport.cost_krw (미존재) → 항상 0.
 *   → 인천 AREX·부산 김해 공항↔호텔 요금이 T-money 충전 권장액에서 통째로 빠졌다.
 * fix: 실제 RouteAgent 저장 필드 arrival_guide.route_to_hotel.est_fare_krw /
 *   departure_guide.route_to_airport.est_fare_krw 에서 읽는다.
 *   t_money_recommended_load = ceil(rawTotal × 1.1 / 5000) × 5000.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import { calculateTmoney } from '../../api/_ai_core/planPersister.js';

describe('[#5] calculateTmoney 도착/출발 요금', () => {
  it('arrival route_to_hotel + departure route_to_airport est_fare_krw 합산 (AREX 등)', () => {
    const itinerary = {
      days: [],
      arrival_guide: { route_to_hotel: { est_fare_krw: 4150 } }, // 인천공항 AREX 일반
      departure_guide: { route_to_airport: { est_fare_krw: 4150 } },
    } as any;
    calculateTmoney(itinerary);
    // raw = 0(시내) + 4150 + 4150 = 8300 → ×1.1 = 9130 → ceil/5000 → 10000
    expect(itinerary.t_money_recommended_load).toBe(10000);
  });

  it('시내 ODsay/Gemini 요금 + 도착/출발 요금 모두 합산', () => {
    const itinerary = {
      days: [
        {
          stops: [
            { travelFromPrev: { transitOptions: { publicTransit: { fare: 1500 } } } },
            { transit_from_prev: { est_fare_krw: 1400 } },
          ],
        },
      ],
      arrival_guide: { route_to_hotel: { est_fare_krw: 4150 } },
      departure_guide: { route_to_airport: { est_fare_krw: 4150 } },
    } as any;
    calculateTmoney(itinerary);
    // raw = 1500 + 1400 + 4150 + 4150 = 11200 → ×1.1 = 12320 → ceil/5000 → 15000
    expect(itinerary.t_money_recommended_load).toBe(15000);
  });

  it('route_to_hotel._failed (ODsay 실패, est_fare_krw 없음) → 도착 요금 0 으로 안전 처리', () => {
    const itinerary = {
      days: [],
      arrival_guide: { route_to_hotel: { _failed: true, method: 'unknown' } },
      departure_guide: { route_to_airport: { est_fare_krw: 4150 } },
    } as any;
    calculateTmoney(itinerary);
    // raw = 0 + 0(failed) + 4150 = 4150 → ×1.1 = 4565 → ceil/5000 → 5000
    expect(itinerary.t_money_recommended_load).toBe(5000);
  });

  it('arrival/departure_guide 자체 부재 → 시내 요금만 반영 (크래시 없음)', () => {
    const itinerary = {
      days: [
        { stops: [{ travelFromPrev: { transitOptions: { publicTransit: { fare: 2000 } } } }] },
      ],
    } as any;
    calculateTmoney(itinerary);
    // raw = 2000 → ×1.1 = 2200 → ceil/5000 → 5000
    expect(itinerary.t_money_recommended_load).toBe(5000);
  });

  it('구 버그 경로(arex_all_stop.price_krw / to_airport.cost_krw)는 더 이상 읽지 않음', () => {
    const itinerary = {
      days: [],
      // 구 경로에만 값을 둠 — 이제 무시되어야 함
      arrival_guide: {
        steps: [{ transport_to_hotel: { arex_all_stop: { price_krw: 99999 } } }],
        route_to_hotel: { est_fare_krw: 4150 },
      },
      departure_guide: {
        to_airport: { cost_krw: 88888 },
        route_to_airport: { est_fare_krw: 4150 },
      },
    } as any;
    calculateTmoney(itinerary);
    // 구 경로(99999/88888) 무시, 신 경로(4150+4150=8300)만 → ×1.1=9130 → 10000
    expect(itinerary.t_money_recommended_load).toBe(10000);
  });
});
