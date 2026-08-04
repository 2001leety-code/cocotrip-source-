/**
 * 잠금 (2026-08-04) — 도착일 공항 이동 거리 보정.
 *
 * #1228 은 **출국일 컷 한 곳에만** 거리 보정을 배선했다. 도착일 5개 표면
 * (block_mode 단도시·다도시, buildPrompt 에 주는 값, RouteAgent 바닥, validator 거부 기준)은
 * 전부 도시를 모르는 표를 써서 **인천 도착 + 첫날 부산을 90분**으로 봤다(실제 4시간 이상).
 * 손님은 아직 이동 중인데 일정이 시작된다 — #1229 가 고친 것과 같은 결함이 도착일 쪽에
 * 그대로 남아 있었다.
 *
 * 🔴 여기서 가장 중요한 잠금은 마지막 describe 다 — **프롬프트에 주는 값과 validator 의
 *   거부 기준이 같은 값이어야 한다.** 한쪽만 보정하면 Gemini 가 맞춘 값을 validator 가
 *   거부해 재시도 2연속 실패 → 손님 PLAN_VALIDATION_FAILED 500 이 된다.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module
import {
  arrivalReadyHHMM, arrivalReadyMinutes, estimateAirportTransitMinFrom, estimateAirportTransitMin,
} from '../../api/_ai_core/constants.js';
// @ts-expect-error — JS module
import { expandBlocksToItinerary, expandBlocksToItineraryMultiCity } from '../../api/_ai_core/blockMode.js';
// @ts-expect-error — JS module
import { validatePatternStructure } from '../../api/_ai_core/responseValidator.js';

const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : -1;
};

/**
 * 실데이터 모양 블록 — stops[0] 은 **명소**다(lodging 아님).
 * 실제 src/data/zone_courses/*.json 128개 중 stops[0] 이 lodging 인 것은 0개이고,
 * 숙소 bookend 는 planPersister 가 나중에 합성한다. 픽스처가 반대면 결함이 통과한다.
 */
const makeBlocks = (city: string) => [{
  id: 'B1', city, zone: 'Test', theme: 'Test', intensity: 'standard',
  stops: [0, 120, 240].map((off, i) => ({
    order: i + 1, name: `Spot ${i + 1}`, category: 'culture',
    start_time_offset_min: off, stay_min: 60,
  })),
}];

describe('공항 이동 거리 보정 — 계산', () => {
  it('같은 권역은 값이 그대로다 (회귀 0)', () => {
    expect(estimateAirportTransitMinFrom('seoul', 'ICN_T1')).toBe(estimateAirportTransitMin('ICN_T1'));
    expect(estimateAirportTransitMinFrom('busan', 'PUS')).toBe(estimateAirportTransitMin('PUS'));
    expect(estimateAirportTransitMinFrom('jeju', 'CJU')).toBe(estimateAirportTransitMin('CJU'));
  });

  it('권역 밖이면 보수적으로 올라간다 — 부산에서 인천공항', () => {
    const min = estimateAirportTransitMinFrom('busan', 'ICN_T1');
    expect(min, '부산→인천을 표값 90분으로 보면 안 된다').toBeGreaterThan(180);
    expect(min).toBeGreaterThan(estimateAirportTransitMin('ICN_T1'));
  });

  it('모르는 도시 / 도시 미전달이면 종전 값 그대로 (조용히 낙관적으로 안 바뀐다)', () => {
    expect(estimateAirportTransitMinFrom('atlantis', 'ICN_T1')).toBe(estimateAirportTransitMin('ICN_T1'));
    expect(estimateAirportTransitMinFrom(undefined, 'ICN_T1')).toBe(estimateAirportTransitMin('ICN_T1'));
  });

  it('도시 인자 없는 옛 호출은 값이 안 변한다 (기존 호출부 회귀 0)', () => {
    expect(arrivalReadyHHMM('14:00', 'ICN_T1')).toBe('17:00');
    expect(arrivalReadyHHMM('14:00', 'CJU')).toBe('15:55');
    expect(arrivalReadyHHMM('14:00', 'PUS')).toBe('16:25');
    expect(arrivalReadyHHMM('14:00', 'ZZZ')).toBe('16:40');
  });

  it('도시를 주면 도착 가능 시각이 그만큼 늦어진다', () => {
    expect(arrivalReadyHHMM('14:00', 'ICN_T1', 'seoul')).toBe('17:00');   // 같은 권역 = 변화 0
    expect(toMin(arrivalReadyHHMM('14:00', 'ICN_T1', 'busan'))).toBeGreaterThanOrEqual(toMin('20:00'));
  });
});

describe('block_mode — Day 1 시작 시각', () => {
  const userInput = (city: string) => ({
    area: city, durationDays: 1, language: 'en',
    arrival_time: '14:00', arrival_airport: 'ICN_T1',
    tour_start_time: '09:00', tour_end_time: '23:00',
  });
  const firstActivity = (itin: { days: { stops: { start_time: string; category: string }[] }[] }) =>
    itin.days[0].stops.find((s) => s.category !== 'lodging')?.start_time;

  it('단도시 서울 — 17:00 그대로 (회귀 0)', () => {
    const itin = expandBlocksToItinerary(
      { day_selections: [{ day: 1, block_id: 'B1', tweak_notes: '' }], language: 'en' },
      makeBlocks('seoul'), userInput('seoul'),
    );
    expect(firstActivity(itin)).toBe('17:00');
  });

  it('단도시 부산 + 인천 도착 — 이동이 반영돼 20:00 이후', () => {
    const itin = expandBlocksToItinerary(
      { day_selections: [{ day: 1, block_id: 'B1', tweak_notes: '' }], language: 'en' },
      makeBlocks('busan'), userInput('busan'),
    );
    expect(toMin(firstActivity(itin) as string), '인천 도착인데 부산 일정이 17:00 에 시작하면 손님은 이동 중이다')
      .toBeGreaterThanOrEqual(toMin('20:00'));
  });

  it('다도시 — Day 1 도시가 plan area 와 달라도 그 도시 기준으로 계산한다', () => {
    const itin = expandBlocksToItineraryMultiCity(
      { day_selections: [{ day: 1, city: 'busan', block_id: 'B1', tweak_notes: '' }], language: 'en' },
      [{ city: 'busan', blocks: makeBlocks('busan') }],
      { ...userInput('seoul'), regions: ['seoul', 'busan'] },   // area 는 seoul, Day 1 은 busan
    );
    expect(toMin(firstActivity(itin) as string)).toBeGreaterThanOrEqual(toMin('20:00'));
  });
});

// 🔴 이 describe 가 이 PR 의 핵심이다. 두 값이 갈리면 손님이 500 을 받는다.
describe('프롬프트 기준과 검증 기준이 같은 값이다', () => {
  const REQ = (city: string) => ({
    regions: [city],
    arrival_time: '14:00', arrival_airport: 'ICN_T1',
    departure_time: '21:00', departure_airport: 'ICN_T1',
    tour_start_time: '09:00',
  });
  const plan = (city: string, day1ActivityAt: string) => ({
    days: [
      {
        day: 1, city, stops: [
          { name: '숙소', category: 'lodging', start_time: '13:00', stay_min: 0 },
          { name: '첫 장소', category: 'culture', start_time: day1ActivityAt, stay_min: 90 },
        ],
      },
      {
        day: 2, city, stops: [
          { name: '숙소', category: 'lodging', start_time: '09:00', stay_min: 0 },
          { name: '둘째 장소', category: 'culture', start_time: '10:00', stay_min: 60 },
          { name: '인천공항', category: 'airport', start_time: '16:00', stay_min: 0, next_destination: 'airport' },
        ],
      },
    ],
  });
  const lateArrivalErrors = (city: string, t: string): string[] =>
    validatePatternStructure(plan(city, t), REQ(city)).filter((e: string) => e.includes('B-LATE-ARRIVAL'));

  it('서울은 17:00 부터 통과 (회귀 0)', () => {
    expect(lateArrivalErrors('seoul', '16:30')).toHaveLength(1);
    expect(lateArrivalErrors('seoul', '17:00')).toHaveLength(0);
  });

  it('부산은 17:00 을 거부한다 — 손님이 아직 이동 중이다', () => {
    expect(lateArrivalErrors('busan', '17:00'), '거리 보정 전이면 여기서 통과해 버린다').toHaveLength(1);
  });

  it('validator 가 거부하는 시각이 프롬프트에 준 arrival_ready_time 과 정확히 같다', () => {
    for (const city of ['seoul', 'busan', 'jeju']) {
      const ready = arrivalReadyHHMM('14:00', 'ICN_T1', city) as string;
      // 프롬프트가 "이 시각부터" 라고 알려준 그 시각은 반드시 통과해야 한다.
      expect(lateArrivalErrors(city, ready), `${city}: 프롬프트가 준 ${ready} 를 validator 가 거부한다`).toHaveLength(0);
      // 1분 전은 거부돼야 한다 — 기준이 실제로 그 값이라는 뜻.
      const oneMinBefore = arrivalReadyMinutes('14:00', 'ICN_T1', city) - 1;
      const hh = String(Math.floor((oneMinBefore % 1440) / 60)).padStart(2, '0');
      const mm = String(oneMinBefore % 60).padStart(2, '0');
      expect(lateArrivalErrors(city, `${hh}:${mm}`), `${city}: 기준 1분 전이 통과한다`).toHaveLength(1);
    }
  });
});
