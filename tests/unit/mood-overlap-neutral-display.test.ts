/**
 * MOOD 캘린더 동일 시간대 중립 표시 — 겹침 계산 순수함수 검증.
 *
 * ⚠️ 이것은 "충돌 경고" 기능이 아님 — 운영자 결정(2026-07-02)으로 충돌 감지는 보류
 *    (managerId/vehicleId 스키마 부재. docs/MOOD-CONFLICT-DETECTION-TODO.md).
 *    캘린더의 "동시간대 N건" 중립 표시에만 쓰이는 계산을 잠근다.
 */
import { describe, it, expect } from 'vitest';
import { maxConcurrentCount, parseStartMinutes } from '../../src/lib/moodOverlap';

describe('parseStartMinutes — "HH:MM" 파싱', () => {
  it('정상 케이스', () => {
    expect(parseStartMinutes('10:00')).toBe(600);
    expect(parseStartMinutes('9:30')).toBe(570);
    expect(parseStartMinutes('00:00')).toBe(0);
    expect(parseStartMinutes('23:59')).toBe(23 * 60 + 59);
  });
  it('형식 불량/범위 밖 → null (겹침 계산 제외)', () => {
    expect(parseStartMinutes(undefined)).toBeNull();
    expect(parseStartMinutes('')).toBeNull();
    expect(parseStartMinutes('25:00')).toBeNull();
    expect(parseStartMinutes('10:65')).toBeNull();
    expect(parseStartMinutes('10시')).toBeNull();
    expect(parseStartMinutes(1000 as unknown as string)).toBeNull();
  });
});

describe('maxConcurrentCount — 같은 날 최대 동시간대 건수', () => {
  it('케이스1 겹침: 10:00~13:00 vs 11:00~13:00 → 2', () => {
    expect(maxConcurrentCount([
      { startTime: '10:00', durationHours: 3 },
      { startTime: '11:00', durationHours: 2 },
    ])).toBe(2);
  });

  it('케이스2 비겹침(맞닿음 포함): 10:00~13:00 vs 13:00~15:00 → 1 (반열림 구간)', () => {
    expect(maxConcurrentCount([
      { startTime: '10:00', durationHours: 3 },
      { startTime: '13:00', durationHours: 2 },
    ])).toBe(1);
  });

  it('케이스3 startTime 없음 → 계산 제외', () => {
    // 없는 예약은 제외 — 남은 1건만이라 겹침 없음(1)
    expect(maxConcurrentCount([
      { durationHours: 3 },
      { startTime: '10:00', durationHours: 2 },
    ])).toBe(1);
    // 전부 무효면 0
    expect(maxConcurrentCount([{ durationHours: 3 }, { startTime: '' }])).toBe(0);
    expect(maxConcurrentCount([])).toBe(0);
    expect(maxConcurrentCount(undefined)).toBe(0);
  });

  it('3중 겹침 → 3 (동시간대 3건)', () => {
    expect(maxConcurrentCount([
      { startTime: '10:00', durationHours: 4 },
      { startTime: '11:00', durationHours: 4 },
      { startTime: '12:00', durationHours: 4 },
      { startTime: '17:00', durationHours: 1 },
    ])).toBe(3);
  });

  it('durationHours 0 이하/비수치 → 제외', () => {
    expect(maxConcurrentCount([
      { startTime: '10:00', durationHours: 0 },
      { startTime: '10:00', durationHours: -1 },
      { startTime: '10:00', durationHours: Number.NaN },
      { startTime: '10:00', durationHours: 3 },
    ])).toBe(1);
  });
});
