/**
 * 2026-08-04 운영 실측(plan `55b2a04e`, legacy, CJU 10:00 출국):
 *
 *   Day2 [lodging 07:00] Jeju Sun Hotel
 *        [airport 07:00] Jeju International Airport
 *
 * 숙소를 나서는 시각과 공항 도착 시각이 **같다** — 손님이 지킬 수 없다(#1225 와 같은 모양).
 * 같은 조건 block_mode(`f6ad61b8`)는 06:38 → 07:00 로 정상이었다. 차이는 숙소 stop 의 출처다:
 * block_mode 는 `selfHealLodgingBookend` 가 나중에 합성하며 `_airport_transit_est_min` 을
 * 쓰지만, legacy 는 Gemini 가 숙소·공항을 둘 다 내놔 bookend 가 손대지 않는다
 * → #1237 이 공항 시각만 당기고 앞의 숙소는 그대로 남았다.
 */
import { describe, it, expect } from 'vitest';
import { applyDepartureDayFlightCap } from '../../api/_ai_core/blockMode.js';
import { applyBackfillsAndTmoney } from '../../api/_ai_core/postResponsePipeline.js';
import { estimateAirportTransitMinFrom, AIRPORT_ARRIVE_BEFORE_MIN } from '../../api/_ai_core/constants.js';

type Stop = { order?: number; category: string; name: string; start_time: string; end_time?: string; stay_min?: number };

const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
};

/** 운영 55b2a04e 출국일 모양 — Gemini 가 숙소·공항을 둘 다 냈다. */
const legacyDepartureDay = (): Stop[] => [
  { order: 1, category: 'lodging', name: 'Jeju Sun Hotel', start_time: '07:00', end_time: '07:00', stay_min: 0 },
  { order: 2, category: 'airport', name: 'Jeju International Airport', start_time: '07:00', end_time: '07:00', stay_min: 0 },
];

describe('출국일 체크아웃 → 공항 이동 시간 확보 (legacy)', () => {
  it('운영 55b2a04e — 숙소 07:00 이 공항 도착보다 이동시간만큼 앞으로 당겨진다', () => {
    const stops = legacyDepartureDay();
    const r = applyDepartureDayFlightCap(stops, '10:00', 'CJU', 'ko', 'jeju');

    const transit = estimateAirportTransitMinFrom('jeju', 'CJU');
    const airportMin = toMin('10:00') - AIRPORT_ARRIVE_BEFORE_MIN;   // 07:00
    expect(toMin(stops[1].start_time)).toBe(airportMin);             // 공항은 그대로 07:00
    expect(toMin(stops[0].start_time)).toBe(airportMin - transit);   // 숙소는 이동시간만큼 앞
    expect(stops[0].end_time).toBe(stops[0].start_time);             // 07:00 잔재 금지
    expect(r.lodgingPulledBack).toBe(true);
  });

  it('숙소 출발 + 이동 ≤ 공항 도착 — 손님이 지킬 수 있는 시각이 된다', () => {
    for (const [city, airport] of [['jeju', 'CJU'], ['busan', 'PUS'], ['seoul', 'ICN_T1'], ['busan', 'ICN_T1']] as const) {
      const stops = legacyDepartureDay();
      applyDepartureDayFlightCap(stops, '20:00', airport, 'ko', city);
      const transit = estimateAirportTransitMinFrom(city, airport);
      expect(toMin(stops[0].start_time) + transit).toBeLessThanOrEqual(toMin(stops[1].start_time));
    }
  });

  it('권역 밖(부산 → 인천공항)은 277분짜리 이동이 반영된다', () => {
    const stops = legacyDepartureDay();
    applyDepartureDayFlightCap(stops, '10:00', 'ICN_T1', 'ko', 'busan');
    // 07:00 − 277분 = 02:23 근처. 최소한 3시간 이상 앞이어야 한다.
    expect(toMin(stops[1].start_time) - toMin(stops[0].start_time)).toBeGreaterThan(180);
  });

  it('공항 stop 이 컷 마감보다 이르면 그 시각을 기준으로 잡는다 (순서 역전 차단)', () => {
    // Gemini 가 20:00 비행기에 공항 07:00 을 냈다 — 컷 마감(17:00)만 보면 통과지만
    // 숙소 07:00 이 공항과 같아진다. 기준은 마감이 아니라 실제 공항 stop 이어야 한다.
    const stops = legacyDepartureDay();
    applyDepartureDayFlightCap(stops, '20:00', 'CJU', 'ko', 'jeju');
    expect(stops[1].start_time).toBe('07:00');                       // 공항은 그대로
    expect(toMin(stops[0].start_time)).toBeLessThan(toMin('07:00')); // 숙소가 앞으로
  });

  it('이미 충분히 이른 체크아웃은 건드리지 않는다 (일찍 나서는 건 문제가 아니다)', () => {
    const stops = legacyDepartureDay();
    stops[0].start_time = '05:00';
    stops[0].end_time = '05:00';
    const r = applyDepartureDayFlightCap(stops, '10:00', 'CJU', 'ko', 'jeju');
    expect(stops[0].start_time).toBe('05:00');
    expect(r.lodgingPulledBack).toBeFalsy();
  });

  it('체크아웃이 자정 이전으로 되감기면 손대지 않는다 (24h wrap 방지)', () => {
    // 03:00 출발 → 공항 00:00, 부산→인천 277분이면 체크아웃이 전날로 넘어간다.
    const stops = legacyDepartureDay();
    stops[0].start_time = '01:00';
    const before = stops[0].start_time;
    applyDepartureDayFlightCap(stops, '03:00', 'ICN_T1', 'ko', 'busan');
    expect(stops[0].start_time).toBe(before);
  });

  it('block_mode 경로(숙소 stop 없음)는 변화 0 — bookend 가 나중에 합성한다', () => {
    const stops: Stop[] = [
      { order: 1, category: 'culture', name: '자갈치시장', start_time: '05:00', stay_min: 30 },
    ];
    const r = applyDepartureDayFlightCap(stops, '20:00', 'PUS', 'ko', 'busan');
    expect(r.lodgingPulledBack).toBeFalsy();
    expect(stops.filter((s) => s.category === 'lodging')).toHaveLength(0);
  });

  it('두 번 불러도 같다 (멱등)', () => {
    const stops = legacyDepartureDay();
    applyDepartureDayFlightCap(stops, '10:00', 'CJU', 'ko', 'jeju');
    const after1 = JSON.parse(JSON.stringify(stops));
    const r2 = applyDepartureDayFlightCap(stops, '10:00', 'CJU', 'ko', 'jeju');
    expect(stops).toEqual(after1);
    expect(r2.lodgingPulledBack).toBeFalsy();
  });
});

describe('배선 — 파이프라인을 지난 legacy 플랜에서도 교정돼 있다', () => {
  it('applyBackfillsAndTmoney 통과 후 숙소가 공항보다 이동시간만큼 앞', () => {
    const itinerary: { days: Array<{ day: number; city: string; stops: Stop[] }> } = {
      days: [
        { day: 1, city: 'Jeju', stops: [{ category: 'lodging', name: 'Jeju Sun Hotel', start_time: '15:55' }] },
        { day: 2, city: 'Jeju', stops: legacyDepartureDay() },
      ],
    };

    applyBackfillsAndTmoney(itinerary, {
      body: { departureTime: '10:00', area: 'jeju' },
      departure_airport: 'CJU',
      language: 'ko',
    });

    const last = itinerary.days[1].stops;
    const lodging = last.find((s) => s.category === 'lodging');
    const airport = last.find((s) => s.category === 'airport' || s.category === 'travel');
    const transit = estimateAirportTransitMinFrom('jeju', 'CJU');
    expect(toMin(String(lodging?.start_time)) + transit).toBeLessThanOrEqual(toMin(String(airport?.start_time)));
    expect(lodging?.start_time).not.toBe(airport?.start_time);
  });
});
