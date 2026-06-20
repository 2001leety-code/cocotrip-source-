/**
 * #7 (2026-06-20): red-eye 출국 B-MEAL ↔ B-EARLY-DEPARTURE 충돌 해소
 *
 * 함정: 출국 < 09:00 (red-eye) 일 때
 *   - B-EARLY-DEPARTURE: 마지막날 stops ≤ 2 (호텔 체크아웃 + 공항) 만 허용 → 초과 시 error.
 *   - B-MEAL (depHour < 11): 조식(food stop) 1건 강제.
 *   동시에 적용하면 조식을 넣으면 stops=3 → B-EARLY-DEPARTURE fail, 빼면 B-MEAL fail.
 *   = "넣어도 빼도 실패" trap (운영자 plan 생성 시 HTTP 500 / retry quota burn).
 *
 * fix: red-eye (depHour < 09) 손님은 새벽 출국으로 조식 먹을 시간이 없으므로 B-MEAL 조식
 *   요구를 면제 (responseValidator.js depHour < 11 분기에 isRedEyeDeparture 가드).
 *   → 체크아웃 + 공항 2 stops 만으로 두 룰 모두 통과.
 *
 * 회귀 시: red-eye 출국 plan 이 food 0건이어도 B-MEAL 조식 누락이 다시 fire → trap 재발.
 */
import { describe, it, expect } from 'vitest';
import { validatePatternStructure } from '../../api/_ai_core/responseValidator.js';

type Stop = { category: string; name: string; start_time: string };
type Day = { day: number; city?: string; stops: Stop[] };
type Itinerary = { days: Day[]; arrival_guide?: unknown; departure_guide?: unknown };

function fullDay(dayNum: number): Day {
  return {
    day: dayNum,
    city: 'Seoul',
    stops: [
      { category: 'lodging', name: '호텔 출발', start_time: '09:00' },
      { category: 'attraction', name: '경복궁', start_time: '10:00' },
      { category: 'food', name: '점심 식당', start_time: '12:30' },
      { category: 'attraction', name: '인사동', start_time: '14:30' },
      { category: 'food', name: '저녁 식당', start_time: '18:30' },
      { category: 'lodging', name: '호텔 복귀', start_time: '21:00' },
    ],
  };
}

/** red-eye 출국일 — 체크아웃 + 공항 2 stops 만 (B-EARLY-DEPARTURE 준수, food 0건). */
function redEyeDepartureDay(dayNum: number): Day {
  return {
    day: dayNum,
    city: 'Seoul',
    stops: [
      { category: 'lodging', name: '호텔 체크아웃', start_time: '04:30' },
      { category: 'travel', name: '인천공항 이동', start_time: '05:00' },
    ],
  };
}

function makePlan(departureDay: Day, departureTime?: string): { itinerary: Itinerary; request: Record<string, string> } {
  return {
    itinerary: {
      days: [fullDay(1), fullDay(2), fullDay(3), fullDay(4), departureDay],
      arrival_guide: { airport: 'ICN' },
      departure_guide: { airport: 'ICN' },
    },
    request: {
      durationDays: '5',
      ...(departureTime ? { departure_time: departureTime } : {}),
    },
  };
}

describe('#7 red-eye (출국 < 09:00) — B-MEAL 조식 면제 (B-EARLY-DEPARTURE 정합)', () => {
  it('출국 07:00 + 체크아웃/공항 2 stops (food 0건) → B-MEAL 조식 누락 안 함 (trap 해소)', () => {
    const { itinerary, request } = makePlan(redEyeDepartureDay(5), '07:00');
    const errors = validatePatternStructure(itinerary, request);
    // 조식 요구가 면제되므로 B-MEAL 조식 누락 error 없음.
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
    // B-EARLY-DEPARTURE 도 2 stops 라 통과 (초과 stops error 없음).
    expect(errors.filter((e) => e.includes('B-EARLY-DEPARTURE') && e.includes('Day 5'))).toEqual([]);
  });

  it('출국 05:00 (극단 red-eye) + food 0건 → 두 룰 모두 통과', () => {
    const { itinerary, request } = makePlan(redEyeDepartureDay(5), '05:00');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
    expect(errors.filter((e) => e.includes('B-EARLY-DEPARTURE') && e.includes('Day 5'))).toEqual([]);
  });

  it('출국 08:59 (red-eye 경계 직전) → 조식 면제', () => {
    const { itinerary, request } = makePlan(redEyeDepartureDay(5), '08:59');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.filter((e) => e.includes('B-MEAL') && e.includes('Day 5'))).toEqual([]);
  });

  it('non-red-eye 경계: 출국 09:00 + food 0건 → B-MEAL 조식 누락 fire (이른 출국 조식 의무 유지)', () => {
    // 09:00 은 red-eye 아님 (depHour=9). 조식 의무 그대로 → trap 아님 (공항 buffer 충분).
    const { itinerary, request } = makePlan(redEyeDepartureDay(5), '09:00');
    const errors = validatePatternStructure(itinerary, request);
    expect(errors.some((e) => e.includes('B-MEAL') && e.includes('Day 5') && e.includes('조식'))).toBe(true);
  });

  it('source invariant: responseValidator.js 에 isRedEyeDeparture 가드 존재', () => {
    const { readFileSync } = require('node:fs');
    const { resolve } = require('node:path');
    const src = readFileSync(resolve(process.cwd(), 'api/_ai_core/responseValidator.js'), 'utf8');
    expect(/isRedEyeDeparture/.test(src)).toBe(true);
    expect(/depHour < 9/.test(src)).toBe(true);
  });
});
