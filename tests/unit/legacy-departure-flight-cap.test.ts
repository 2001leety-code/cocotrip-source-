/**
 * #1227 후속 (2026-08-04): 출국일 항공 컷이 legacy(Gemini) 경로에 배선돼 있지 않았다.
 *
 * 운영 실측 — departure_time 이 들어간 legacy plan **2/2 가 이륙 30분 전 공항 도착**:
 *   358e84c9  출국 10:00 ICN → Day3 [lodging 06:30] [airport 09:31]
 *   6ee989d2  출국 10:00 ICN → Day4 [lodging 06:30] [travel  09:35]
 * 프롬프트(P124 "NEVER: stop start_time > departure_time - 180min")는 지켜지지 않았고,
 * validator 의 departure_time 규칙은 식사 누락(B-MEAL)뿐이라 아무도 못 잡았다.
 *
 * 잠금 두 겹:
 *   1) 함수 — 이미 있는 공항 stop 이 늦으면 시각을 당긴다(옛 코드는 "있으면 그대로 둔다").
 *   2) 배선 — applyBackfillsAndTmoney(두 경로 합류 지점)가 마지막 day 에 컷을 건다.
 *      함수만 고치고 배선을 빼면 운영에서는 그대로 깨진다.
 */
import { describe, it, expect } from 'vitest';
import { applyDepartureDayFlightCap } from '../../api/_ai_core/blockMode.js';
import { applyBackfillsAndTmoney } from '../../api/_ai_core/postResponsePipeline.js';

type Stop = {
  order: number;
  category: string;
  name: string;
  start_time: string;
  end_time?: string;
  stay_min: number;
  _airport_transit_est_min?: number;
};
type Day = { day: number; date: string; city: string; stops: Stop[] };

/** 운영 legacy plan 358e84c9 출국일 모양 — stops[0] 이 lodging, 그 뒤 공항 stop. */
const legacyDepartureDay = (): Day => ({
  day: 3,
  date: '2026-08-18',
  city: 'Seoul',
  stops: [
    { order: 1, category: 'lodging', name: '롯데호텔 서울', start_time: '06:30', end_time: '06:30', stay_min: 0 },
    { order: 2, category: 'airport', name: '인천국제공항 T1', start_time: '09:31', end_time: '09:31', stay_min: 0 },
  ],
});

describe('#1227 후속 — 출국일 항공 컷 (legacy 경로)', () => {
  it('늦은 공항 stop 을 출발 −180분으로 당긴다 (09:31 → 07:00)', () => {
    const day = legacyDepartureDay();
    const r = applyDepartureDayFlightCap(day.stops, '10:00', 'ICN_T1', 'ko', 'seoul');

    const airport = day.stops.find((s) => s.category === 'airport');
    expect(airport?.start_time).toBe('07:00');
    expect(airport?.end_time).toBe('07:00');     // end_time 도 같이 — 09:31 잔재 금지
    expect(r.airportStopRetimed).toBe(true);
    expect(r.airportStopAdded).toBe(false);      // 있는 걸 새로 만들지 않는다
  });

  it("category 'travel' 로 온 공항 stop 도 같이 당긴다 (plan 6ee989d2)", () => {
    const stops = [
      { order: 1, category: 'lodging', name: 'Grand Hyatt Seoul', start_time: '06:30', stay_min: 0 },
      { order: 2, category: 'travel', name: '인천국제공항 T1', start_time: '09:35', stay_min: 0 },
    ];
    applyDepartureDayFlightCap(stops, '10:00', 'ICN_T1', 'ko', 'seoul');
    expect(stops[1].start_time).toBe('07:00');
  });

  it('이미 마감 안이면 시각을 건드리지 않는다 (Gemini 값 존중)', () => {
    const stops = [
      { order: 1, category: 'lodging', name: 'X', start_time: '05:00', stay_min: 0 },
      { order: 2, category: 'airport', name: '인천국제공항 T1', start_time: '06:10', stay_min: 0 },
    ];
    const r = applyDepartureDayFlightCap(stops, '10:00', 'ICN_T1', 'ko', 'seoul');
    expect(stops[1].start_time).toBe('06:10');
    expect(r.airportStopRetimed).toBeFalsy();
  });

  it('숙소 bookend 가 나중에 합성돼도 체크아웃이 뒤집히지 않게 이동 추정을 남긴다 (#1231 구멍)', () => {
    const day = legacyDepartureDay();
    applyDepartureDayFlightCap(day.stops, '10:00', 'ICN_T1', 'ko', 'busan');
    const airport = day.stops.find((s) => s.category === 'airport') as Record<string, number>;
    // 부산 → 인천공항은 권역 밖 = 직선거리 보정(#1228). 표(90분)보다 훨씬 커야 한다.
    expect(airport._airport_transit_est_min).toBeGreaterThan(200);
  });

  it('두 번 불러도 안전하다 (block_mode 는 expand 에서 이미 적용됨)', () => {
    const day = legacyDepartureDay();
    applyDepartureDayFlightCap(day.stops, '10:00', 'ICN_T1', 'ko', 'seoul');
    const after1 = JSON.parse(JSON.stringify(day.stops));
    const r2 = applyDepartureDayFlightCap(day.stops, '10:00', 'ICN_T1', 'ko', 'seoul');
    expect(day.stops).toEqual(after1);
    expect(r2.airportStopRetimed).toBeFalsy();
    expect(r2.trimmed).toBe(0);
  });

  it('출발 시각을 모르면 아무것도 안 한다', () => {
    const day = legacyDepartureDay();
    const snapshot = JSON.parse(JSON.stringify(day.stops));
    applyDepartureDayFlightCap(day.stops, '', 'ICN_T1', 'ko', 'seoul');
    expect(day.stops).toEqual(snapshot);
  });
});

describe('#1227 후속 — 배선 (applyBackfillsAndTmoney = legacy·block_mode 합류 지점)', () => {
  it('마지막 day 의 늦은 공항 stop 이 파이프라인을 지나면 교정돼 있다', () => {
    const itinerary: { days: Day[] } = {
      days: [
        {
          day: 1,
          date: '2026-08-16',
          city: 'Seoul',
          stops: [
            { order: 1, category: 'lodging', name: '롯데호텔 서울', start_time: '15:00', stay_min: 0 },
            { order: 2, category: 'food', name: '비빔밥', start_time: '17:34', stay_min: 60 },
            { order: 3, category: 'lodging', name: '롯데호텔 서울', start_time: '20:36', stay_min: 0 },
          ],
        },
        legacyDepartureDay(),
      ],
    };

    applyBackfillsAndTmoney(itinerary, {
      body: { departureTime: '10:00', area: 'seoul' },
      departure_airport: 'ICN_T1',
      language: 'ko',
    });

    const last = itinerary.days[itinerary.days.length - 1];
    const airport = last.stops.find((s) => s.category === 'airport' || s.category === 'travel');
    expect(airport?.start_time).toBe('07:00');
    // 도착일(첫 day)은 건드리지 않는다 — 컷은 마지막 day 전용.
    expect(itinerary.days[0].stops[0].start_time).toBe('15:00');
  });

  it("raw body 가 'HH:mm:ss' / snake_case 로 와도 컷이 조용히 skip 되지 않는다", () => {
    const itinerary: { days: Day[] } = { days: [legacyDepartureDay()] };
    applyBackfillsAndTmoney(itinerary, {
      body: { departure_time: '10:00:00', area: 'seoul' },
      departure_airport: 'ICN_T1',
      language: 'ko',
    });
    const airport = itinerary.days[0].stops.find((s) => s.category === 'airport');
    expect(airport?.start_time).toBe('07:00');
  });
});
