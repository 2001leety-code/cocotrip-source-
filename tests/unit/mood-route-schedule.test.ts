import { describe, expect, it } from 'vitest';

import {
  createMoodRouteSchedule,
  formatMoodRouteScheduleStopSummary,
  formatMoodRouteScheduleText,
  formatMoodRouteWait,
  getMoodRouteElapsedMinutes,
  getMoodRouteWaitMinutes,
  MOOD_ROUTE_SCHEDULE_MAX_SPAN_MINUTES,
  normalizeMoodRouteSchedule,
  normalizeMoodRouteTime,
  parseMoodRouteScheduleText,
  setMoodRouteStopWaitMinutes,
  validateMoodRouteSchedule,
  type MoodRouteScheduleStop,
} from '../../src/lib/moodRouteSchedule';

describe('MOOD 경로 일정 순수 로직', () => {
  it('시각을 HH:mm으로 정규화하고 잘못된 시각은 비운다', () => {
    expect(normalizeMoodRouteTime('9:05')).toBe('09:05');
    expect(normalizeMoodRouteTime('23:59')).toBe('23:59');
    expect(normalizeMoodRouteTime('24:00')).toBeNull();
    expect(normalizeMoodRouteTime('09:60')).toBeNull();
  });

  it('경로 개수에 맞춰 만들고 첫 출발은 예약 시작 시각을 SSOT로 삼는다', () => {
    expect(createMoodRouteSchedule(3, '09:30')).toEqual([
      { arrivalTime: null, pickupTime: '09:30' },
      { arrivalTime: null, pickupTime: null },
      { arrivalTime: null, pickupTime: null },
    ]);

    expect(normalizeMoodRouteSchedule([
      { arrivalTime: '08:00', pickupTime: '08:30' },
      { arrivalTime: '10:00', pickupTime: '12:00' },
      { arrivalTime: '13:00', pickupTime: '14:00' },
    ], 3, '09:30')).toEqual([
      { arrivalTime: null, pickupTime: '09:30' },
      { arrivalTime: '10:00', pickupTime: '12:00' },
      { arrivalTime: '13:00', pickupTime: null },
    ]);
  });

  it('빈 시각은 허용하되 길이·형식·출발/도착 역할과 시작 시각 불일치를 찾는다', () => {
    const valid = validateMoodRouteSchedule([
      { arrivalTime: null, pickupTime: '09:30' },
      { arrivalTime: null, pickupTime: null },
      { arrivalTime: '14:00', pickupTime: null },
    ], 3, '09:30');
    expect(valid).toEqual({ valid: true, issues: [] });

    const invalid = validateMoodRouteSchedule([
      { arrivalTime: '08:00', pickupTime: '09:00' },
      { arrivalTime: '25:00', pickupTime: null },
      { arrivalTime: '14:00', pickupTime: '15:00' },
    ], 3, '09:30');
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.field)).toEqual([
      'arrivalTime',
      'arrivalTime',
      'pickupTime',
      'pickupTime',
    ]);
  });

  it('자정을 한 번 넘기는 대기시간과 빠른 대기 선택을 계산한다', () => {
    expect(getMoodRouteElapsedMinutes('23:40', '00:20')).toBe(40);
    expect(getMoodRouteWaitMinutes({ arrivalTime: '22:30', pickupTime: '01:00' })).toBe(150);
    expect(formatMoodRouteWait(150)).toBe('2시간 30분');
    expect(formatMoodRouteWait(120)).toBe('2시간');
    expect(formatMoodRouteWait(30)).toBe('30분');
    expect(setMoodRouteStopWaitMinutes({ arrivalTime: '23:30', pickupTime: null }, 120)).toEqual({
      arrivalTime: '23:30',
      pickupTime: '01:30',
    });
  });

  it('전체 일정에서 자정은 한 번만 넘을 수 있다', () => {
    const oneMidnight = validateMoodRouteSchedule([
      { arrivalTime: null, pickupTime: '22:00' },
      { arrivalTime: '23:30', pickupTime: '01:00' },
      { arrivalTime: '02:00', pickupTime: null },
    ], 3, '22:00');
    expect(oneMidnight.valid).toBe(true);

    const twoMidnights = validateMoodRouteSchedule([
      { arrivalTime: null, pickupTime: '22:00' },
      { arrivalTime: '23:30', pickupTime: '01:00' },
      { arrivalTime: '00:30', pickupTime: null },
    ], 3, '22:00');
    expect(twoMidnights.valid).toBe(false);
    expect(twoMidnights.issues.at(-1)?.message).toContain('자정은 한 번만');
  });

  it('첫 시각부터 마지막 시각까지 15시간은 허용하고 15시간 초과는 거부한다', () => {
    expect(MOOD_ROUTE_SCHEDULE_MAX_SPAN_MINUTES).toBe(900);
    const boundary = validateMoodRouteSchedule([
      { arrivalTime: null, pickupTime: '20:00' },
      { arrivalTime: '23:00', pickupTime: '01:00' },
      { arrivalTime: '11:00', pickupTime: null },
    ], 3, '20:00');
    expect(boundary.valid).toBe(true);

    const overBoundary = validateMoodRouteSchedule([
      { arrivalTime: null, pickupTime: '20:00' },
      { arrivalTime: '23:00', pickupTime: '01:00' },
      { arrivalTime: '11:01', pickupTime: null },
    ], 3, '20:00');
    expect(overBoundary.valid).toBe(false);
    expect(overBoundary.issues.at(-1)).toMatchObject({
      field: 'schedule',
      message: '전체 일정은 첫 출발부터 마지막 시각까지 15시간 이내여야 합니다.',
    });

    const silentLongReverse = validateMoodRouteSchedule([
      { arrivalTime: null, pickupTime: '14:00' },
      { arrivalTime: '10:30', pickupTime: null },
    ], 2, '14:00');
    expect(silentLongReverse.valid).toBe(false);
  });

  it('역할별로 한 줄 요약을 만든다', () => {
    expect(formatMoodRouteScheduleStopSummary({ arrivalTime: null, pickupTime: '09:00' }, 0, 3)).toBe('출발 09:00');
    expect(formatMoodRouteScheduleStopSummary({ arrivalTime: '09:40', pickupTime: '11:40' }, 1, 3)).toBe('도착 09:40 · 재출발 11:40 · 대기 2시간');
    expect(formatMoodRouteScheduleStopSummary({ arrivalTime: '12:20', pickupTime: null }, 2, 3)).toBe('도착 12:20');
  });
});

describe('MOOD 전체 일정 복사·붙여넣기', () => {
  const addresses = [
    '서울특별시 강남구 도산대로 1',
    '서울 종로구 평창길 133',
    '서울특별시 송파구 올림픽로 300',
  ];
  const routeSchedule: MoodRouteScheduleStop[] = [
    { arrivalTime: null, pickupTime: '09:00' },
    { arrivalTime: '09:40', pickupTime: '11:40' },
    { arrivalTime: '12:20', pickupTime: null },
  ];

  it('각 구간의 전체 주소·출발·도착·대기·재출발을 모바일 일반 텍스트로 만든다', () => {
    const text = formatMoodRouteScheduleText({
      date: '2026-08-20',
      addresses,
      routeSchedule,
      startTime: '09:00',
    });

    expect(text).toBe([
      '[2026년 8월 20일 차량 전체 일정]',
      '',
      '1. 서울특별시 강남구 도산대로 1 → 서울 종로구 평창길 133',
      '출발 09:00 / 도착 09:40',
      '대기 2시간',
      '재출발(픽업) 11:40',
      '',
      '2. 서울 종로구 평창길 133 → 서울특별시 송파구 올림픽로 300',
      '출발 11:40 / 도착 12:20',
    ].join('\n'));
  });

  it('자체 생성한 전체 일정은 주소와 모든 시각을 손실 없이 다시 복원한다', () => {
    const text = formatMoodRouteScheduleText({
      date: '2026-08-20',
      addresses,
      routeSchedule,
      startTime: '09:00',
    });
    const parsed = parseMoodRouteScheduleText(text);

    expect(parsed).toEqual({
      ok: true,
      date: '2026-08-20',
      startTime: '09:00',
      addresses,
      routeSchedule,
      errors: [],
    });
  });

  it('자정 이후 시각을 다음 날로 표시하고 그대로 다시 붙여넣을 수 있다', () => {
    const overnightSchedule: MoodRouteScheduleStop[] = [
      { arrivalTime: null, pickupTime: '23:00' },
      { arrivalTime: '23:50', pickupTime: '00:30' },
      { arrivalTime: '01:20', pickupTime: null },
    ];
    const text = formatMoodRouteScheduleText({
      date: '2026-08-20',
      addresses,
      routeSchedule: overnightSchedule,
      startTime: '23:00',
    });

    expect(text).toContain('출발 23:00 / 도착 23:50');
    expect(text).toContain('재출발(픽업) 다음 날 00:30');
    expect(text).toContain('출발 다음 날 00:30 / 도착 다음 날 01:20');
    expect(parseMoodRouteScheduleText(text)).toEqual({
      ok: true,
      date: '2026-08-20',
      startTime: '23:00',
      addresses,
      routeSchedule: overnightSchedule,
      errors: [],
    });
  });

  it('명시한 다음 날을 절대 시각으로 검사해 15시간 우회를 막는다', () => {
    const exactBoundary = parseMoodRouteScheduleText([
      '[2026년 8월 20일 차량 전체 일정]',
      '',
      '1. 서울역 → 서울시청',
      '출발 09:00 / 도착 다음 날 00:00',
    ].join('\n'));
    expect(exactBoundary.ok).toBe(true);

    const oneMinuteOver = parseMoodRouteScheduleText([
      '[2026년 8월 20일 차량 전체 일정]',
      '',
      '1. 서울역 → 서울시청',
      '출발 09:00 / 도착 다음 날 00:01',
    ].join('\n'));
    expect(oneMinuteOver.ok).toBe(false);
    expect(oneMinuteOver.errors).toContain('전체 일정은 첫 출발부터 마지막 시각까지 15시간 이내여야 합니다.');

    const nextDayWithoutClockRollover = parseMoodRouteScheduleText([
      '[2026년 8월 20일 차량 전체 일정]',
      '',
      '1. 서울역 → 서울시청',
      '출발 09:00 / 도착 다음 날 10:00',
    ].join('\n'));
    expect(nextDayWithoutClockRollover.ok).toBe(false);
    expect(nextDayWithoutClockRollover.errors).toContain('전체 일정은 첫 출발부터 마지막 시각까지 15시간 이내여야 합니다.');
  });

  it('MOOD 공유 전문 안에 일정 블록이 있어도 해당 블록만 복원한다', () => {
    const scheduleText = formatMoodRouteScheduleText({ addresses, routeSchedule, startTime: '09:00' });
    const parsed = parseMoodRouteScheduleText([
      '[MOOD 이동 예상 안내]',
      '예약번호: M-1',
      '',
      scheduleText,
      '',
      '예약 예상 비용',
      '- 예상 합계: 100,000원',
    ].join('\n'));

    expect(parsed.ok).toBe(true);
    expect(parsed.date).toBeNull();
    expect(parsed.addresses).toEqual(addresses);
    expect(parsed.routeSchedule).toEqual(routeSchedule);
  });

  it('구간 주소가 이어지지 않으면 붙여넣기 성공으로 처리하지 않는다', () => {
    const parsed = parseMoodRouteScheduleText([
      '[차량 전체 일정]',
      '',
      '1. 서울역 → 성수동',
      '출발 09:00 / 도착 10:00',
      '재출발(픽업) 11:00',
      '',
      '2. 잠실 → 인천공항',
      '출발 11:00 / 도착 12:00',
    ].join('\n'));

    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toContain('2번 출발 주소가 앞 구간 도착 주소와 다릅니다.');
  });
});
