/**
 * P323 (2026-05-31): departure_guide 6필드 self-heal (block_mode 1/7 emit).
 *
 * 버그 (prod plan b3ade000): block_mode 는 Gemini itinerary 미생성 → departure_guide 가
 *   airport(+route_to_airport)만 있고 recommended_departure_time/latest_leave_hotel/
 *   luggage_storage/tax_refund/last_minute_shopping 누락 → 프론트 DepartureGuide.tsx
 *   카드 안 보임. arrival 은 selfHealArrivalGuide 대칭 있어 채워짐 = 비대칭.
 *
 * fix: selfHealDepartureGuide (arrival 대칭) — frontend 렌더 shape 기준 6필드 합성.
 *   route_to_airport (RouteAgent) 보존. Gemini prompt 변경 0.
 *
 * 회귀 시: block_mode plan 의 출국 안내 부가 카드(짐보관/세금환급/막판쇼핑) 영구 누락.
 */
import { describe, it, expect } from 'vitest';
import { selfHealDepartureGuide } from '../../api/_ai_core/planPersister.js';

describe('[P323] selfHealDepartureGuide', () => {
  it('departure_guide 6필드 누락(block_mode 1/7) → frontend shape 합성', () => {
    const itin = { departure_guide: { airport: 'ICN T2' } };
    const healed = selfHealDepartureGuide(itin, 'ICN T2', { hotel_address: '명동 신라스테이' });
    expect(healed).toBe(true);
    const dg = itin.departure_guide;
    expect(dg.airport).toBe('ICN T2');
    expect(dg.recommended_departure_time).toBeTruthy();
    expect(dg.latest_leave_hotel).toContain('명동 신라스테이'); // ctx personalize
    // frontend DepartureGuide.tsx 렌더 shape: luggage_storage.{available,location}
    expect(dg.luggage_storage.available).toBe(true);
    expect(dg.luggage_storage.location).toBeTruthy();
    // frontend shape: tax_refund.{location,threshold_krw}
    expect(dg.tax_refund.location).toBeTruthy();
    expect(dg.tax_refund.threshold_krw).toBe(30000);
    expect(dg.last_minute_shopping).toBeTruthy();
    expect(dg._self_healed).toBe(true);
  });

  it('route_to_airport (RouteAgent attach) 보존', () => {
    const itin = { departure_guide: { airport: 'ICN T2', route_to_airport: { method: 'AREX', duration_min: 51 } } };
    selfHealDepartureGuide(itin, 'ICN T2', {});
    expect(itin.departure_guide.route_to_airport).toEqual({ method: 'AREX', duration_min: 51 });
  });

  it('이미 6필드 풍부(legacy Gemini 응답) → no-op (덮어쓰기 0)', () => {
    const itin = {
      departure_guide: {
        airport: 'ICN T2',
        recommended_departure_time: '3 hours before flight',
        tax_refund: { location: 'legacy kiosk', threshold_krw: 30000 },
      },
    };
    const healed = selfHealDepartureGuide(itin, 'ICN T2', {});
    expect(healed).toBe(false);
    expect(itin.departure_guide.tax_refund.location).toBe('legacy kiosk'); // 보존
  });

  it('departure_guide 자체 없을 때도 합성 (airport=input)', () => {
    const itin = {};
    const healed = selfHealDepartureGuide(itin, 'PUS', { recommendedZone: '해운대' });
    expect(healed).toBe(true);
    expect(itin.departure_guide.airport).toBe('PUS');
    expect(itin.departure_guide.latest_leave_hotel).toContain('해운대');
  });

  it('ALREADY / 빈 airport → no-op', () => {
    expect(selfHealDepartureGuide({ departure_guide: { airport: 'X' } }, 'ALREADY', {})).toBe(false);
    expect(selfHealDepartureGuide({}, '', {})).toBe(false);
  });
});
