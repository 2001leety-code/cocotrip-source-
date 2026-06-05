/**
 * #tour-end post-RouteAgent cap (2026-06-05) — RouteAgent time-stitch 후 최종 종료 시각 enforce.
 *
 * 배경 (durable lesson): #809/#810 의 expandBlocksToItinerary cutoff 는 block offset 시각(pre-stitch)에
 *   돌아, RouteAgent 가 실제 transit 으로 밀어낸 최종 start_time 을 못 잡았다. prod 검증에서:
 *     - 9f9f37a1(낮 도착): Day1 인사동이 offset 20:00 → 재-stitch 20:15 로 cap(20:00) 초과 잔존.
 *     - f80d7219(야간 도착): Day1 경복궁이 종료시각과 정확히 같은 20:00 으로 잔존.
 *   → cap 은 runRouteEnrichment "후" 최종 시각 기준으로 적용해야 정확 (handlerCore L380 applyTourEndCap).
 *
 * 본 테스트는 그 prod stop 형태(RouteAgent-stitched)를 직접 넣어 applyTourEndCap 동작을 검증.
 */
import { describe, it, expect } from 'vitest';
import { applyTourEndCap } from '../../api/_ai_core/postResponsePipeline.js';

const mk = (stops: unknown[]) => ({ days: [{ day: 1, stops }] });

describe('#tour-end applyTourEndCap — RouteAgent stitch 후 최종 cap', () => {
  it('prod 9f9f37a1 재현: 종료 초과 관광(20:15 인사동) trim, trailing lodging(호텔복귀) 보존', () => {
    const itin = mk([
      { category: 'lodging', start_time: '16:00', name: 'Hotel checkin' },
      { category: 'culture', start_time: '17:00', name: '경복궁' },
      { category: 'food', start_time: '18:58', name: '하남돼지집' },
      { category: 'culture', start_time: '20:15', name: '인사동' },
      { category: 'lodging', start_time: '22:45', name: 'Hotel return' },
    ]);
    applyTourEndCap(itin, '20:00');
    const stops = itin.days[0].stops as Array<{ name: string; category: string }>;
    expect(stops.some((s) => s.name === '인사동'), '20:15 인사동(>=20:00)이 trim 안 됨').toBe(false);
    expect(stops.some((s) => s.name === '하남돼지집'), '18:58(<20:00)은 보존돼야 함').toBe(true);
    expect(stops.some((s) => s.name === 'Hotel return'), '호텔복귀 lodging 보존(bookend)').toBe(true);
    expect(stops[stops.length - 1].category, '마지막 = 호텔복귀').toBe('lodging');
  });

  it('prod f80d7219 재현: 휴식일 — 종료시각과 정확히 같은 관광(20:00 경복궁)도 trim → 호텔만', () => {
    const itin = mk([
      { category: 'lodging', start_time: '19:00', name: 'Hotel checkin' },
      { category: 'culture', start_time: '20:00', name: '경복궁' },
      { category: 'lodging', start_time: '22:30', name: 'Hotel return' },
    ]);
    applyTourEndCap(itin, '20:00');
    const stops = itin.days[0].stops as Array<{ category: string }>;
    expect(stops.some((s) => s.category === 'culture'), '정확-cap(20:00) 관광 잔존').toBe(false);
    expect(stops.every((s) => s.category === 'lodging'), 'Day1 = 호텔만 (휴식)').toBe(true);
  });

  it('정상 day — 모든 관광이 종료 시각 전 → 무변경', () => {
    const itin = mk([
      { category: 'lodging', start_time: '09:00', name: 'H' },
      { category: 'culture', start_time: '11:00', name: 'A' },
      { category: 'food', start_time: '13:00', name: 'B' },
      { category: 'culture', start_time: '17:41', name: 'C' },
    ]);
    applyTourEndCap(itin, '20:00');
    expect((itin.days[0].stops as unknown[]).length, '정상 plan 무영향').toBe(4);
  });

  it('보호 카테고리(travel/airport)는 종료 시각 이후도 보존 (출국일 KTX/공항)', () => {
    const itin = mk([
      { category: 'lodging', start_time: '07:00', name: 'H' },
      { category: 'culture', start_time: '09:00', name: 'A' },
      { category: 'travel', start_time: '21:30', name: 'KTX' },
      { category: 'airport', start_time: '22:00', name: 'PUS' },
    ]);
    applyTourEndCap(itin, '20:00');
    const stops = itin.days[0].stops as Array<{ category: string }>;
    expect(stops.some((s) => s.category === 'travel'), 'travel(이동) 보존').toBe(true);
    expect(stops.some((s) => s.category === 'airport'), 'airport(공항) 보존').toBe(true);
  });

  it('default 21:00 (tour_end_time 미지정/무효) cap 적용', () => {
    const itin = mk([
      { category: 'lodging', start_time: '09:00', name: 'H' },
      { category: 'culture', start_time: '20:30', name: 'A' }, // < 21:00 keep
      { category: 'culture', start_time: '21:30', name: 'B' }, // >= 21:00 trim
    ]);
    applyTourEndCap(itin, undefined as unknown as string);
    const stops = itin.days[0].stops as Array<{ name: string }>;
    expect(stops.some((s) => s.name === 'A'), '20:30 보존(default 21:00 전)').toBe(true);
    expect(stops.some((s) => s.name === 'B'), '21:30 trim(default 21:00 이후)').toBe(false);
  });

  it('다중 day — 각 day 독립 적용 (Day2-5 무영향)', () => {
    const itin = {
      days: [
        { day: 1, stops: [{ category: 'lodging', start_time: '17:00', name: 'H1' }, { category: 'culture', start_time: '20:15', name: 'late' }] },
        { day: 2, stops: [{ category: 'lodging', start_time: '09:00', name: 'H2' }, { category: 'culture', start_time: '17:17', name: 'ok' }] },
      ],
    };
    applyTourEndCap(itin, '20:00');
    expect((itin.days[0].stops as Array<{ name: string }>).some((s) => s.name === 'late'), 'Day1 초과 trim').toBe(false);
    expect((itin.days[1].stops as unknown[]).length, 'Day2 무영향').toBe(2);
  });
});
