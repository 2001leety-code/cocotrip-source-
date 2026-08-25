import { describe, expect, it } from 'vitest';
import {
  MOOD_ROUTE_SCHEDULE_MAX_SPAN_MINUTES,
  MOOD_ROUTE_SCHEDULE_MAX_STOPS,
  normalizeMoodRouteSchedule,
} from '../../api/_shared/mood-route-schedule.js';

const validSchedule = [
  { arrivalTime: null, pickupTime: '09:00' },
  { arrivalTime: '10:00', pickupTime: '12:00' },
  { arrivalTime: '13:00', pickupTime: null },
];

describe('MOOD 경로 일정 백엔드 계약', () => {
  it('일정 필드가 없는 기존 예약을 허용한다', () => {
    expect(normalizeMoodRouteSchedule(undefined, 3, '09:00')).toEqual({
      ok: true,
      provided: false,
      value: null,
    });
  });

  it('경로 지점 수와 같은 일정을 화이트리스트 모양으로 정규화한다', () => {
    const result = normalizeMoodRouteSchedule([
      { arrivalTime: null, pickupTime: '09:00', ignored: '저장 금지' },
      { arrivalTime: ' 10:00 ', pickupTime: '12:00' },
      { arrivalTime: '13:00', pickupTime: null },
    ], 3, '09:00');

    expect(result).toEqual({ ok: true, provided: true, value: validSchedule });
  });

  it('첫 출발은 예약 시작시각과 같고, 첫 도착·마지막 재출발은 비어야 한다', () => {
    const cases = [
      [{ ...validSchedule[0], arrivalTime: '08:50' }, validSchedule[1], validSchedule[2]],
      [{ ...validSchedule[0], pickupTime: '09:10' }, validSchedule[1], validSchedule[2]],
      [validSchedule[0], validSchedule[1], { ...validSchedule[2], pickupTime: '14:00' }],
    ];

    for (const schedule of cases) {
      expect(normalizeMoodRouteSchedule(schedule, 3, '09:00')).toMatchObject({
        ok: false,
        error: 'INVALID_ROUTE_SCHEDULE',
      });
    }
  });

  it('잘못된 길이·시각·항목 형식과 7개 초과 경로를 거부한다', () => {
    expect(normalizeMoodRouteSchedule(validSchedule.slice(0, 2), 3, '09:00')).toMatchObject({ ok: false });
    expect(normalizeMoodRouteSchedule([
      { arrivalTime: null, pickupTime: '09:00' },
      { arrivalTime: '10:99', pickupTime: null },
    ], 2, '09:00')).toMatchObject({ ok: false });
    expect(normalizeMoodRouteSchedule([null, validSchedule[2]], 2, '09:00')).toMatchObject({ ok: false });
    expect(normalizeMoodRouteSchedule([], MOOD_ROUTE_SCHEDULE_MAX_STOPS + 1, '09:00')).toMatchObject({ ok: false });
  });

  it('자정을 한 번 넘는 일정은 허용하고 두 번 되감기는 일정은 거부한다', () => {
    const overnight = [
      { arrivalTime: null, pickupTime: '23:00' },
      { arrivalTime: '23:50', pickupTime: '00:30' },
      { arrivalTime: '01:20', pickupTime: null },
    ];
    expect(normalizeMoodRouteSchedule(overnight, 3, '23:00')).toMatchObject({ ok: true });

    const twice = [
      { arrivalTime: null, pickupTime: '23:00' },
      { arrivalTime: '00:30', pickupTime: '23:30' },
      { arrivalTime: '00:10', pickupTime: null },
    ];
    expect(normalizeMoodRouteSchedule(twice, 3, '23:00')).toMatchObject({
      ok: false,
      error: 'INVALID_ROUTE_SCHEDULE',
    });
  });

  it('전체 15시간 경계는 허용하고 초과·긴 역전은 명확히 거부한다', () => {
    expect(MOOD_ROUTE_SCHEDULE_MAX_SPAN_MINUTES).toBe(900);
    const boundary = [
      { arrivalTime: null, pickupTime: '20:00' },
      { arrivalTime: '23:00', pickupTime: '01:00' },
      { arrivalTime: '11:00', pickupTime: null },
    ];
    expect(normalizeMoodRouteSchedule(boundary, 3, '20:00')).toMatchObject({ ok: true });

    const overBoundary = [
      { arrivalTime: null, pickupTime: '20:00' },
      { arrivalTime: '23:00', pickupTime: '01:00' },
      { arrivalTime: '11:01', pickupTime: null },
    ];
    expect(normalizeMoodRouteSchedule(overBoundary, 3, '20:00')).toEqual({
      ok: false,
      error: 'INVALID_ROUTE_SCHEDULE_SPAN',
    });

    expect(normalizeMoodRouteSchedule([
      { arrivalTime: null, pickupTime: '14:00' },
      { arrivalTime: '10:30', pickupTime: null },
    ], 2, '14:00')).toEqual({
      ok: false,
      error: 'INVALID_ROUTE_SCHEDULE_SPAN',
    });
  });

  it('일정이 없는 경로는 빈 배열로만 표현한다', () => {
    expect(normalizeMoodRouteSchedule([], 0, '09:00')).toEqual({
      ok: true,
      provided: true,
      value: [],
    });
  });
});
