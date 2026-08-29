import { describe, expect, it } from 'vitest';
import {
  getMoodBookingBlockStatus,
  getMoodBookingDateRestriction,
  isMoodBookingChangeBlocked,
  moodKstDateISO,
  parseMoodBookingAvailability,
} from '../../src/lib/moodBookingAvailability';

describe('MOOD 예약 차단 설정', () => {
  it('설정을 생략하거나 손상시키면 과거 날짜 규칙을 되살리지 않고 신규 예약을 잠근다', () => {
    expect(getMoodBookingBlockStatus('2026-09-10', '18:00')).toMatchObject({
      blocked: true,
      availabilityReady: false,
      rule: null,
    });
    expect(getMoodBookingDateRestriction('2026-09-10')).toBeNull();
  });

  it('한국 날짜는 실행 환경 시간대와 관계없이 자정 경계가 일정하다', () => {
    expect(moodKstDateISO(new Date('2026-09-15T14:59:59.000Z'))).toBe('2026-09-15');
    expect(moodKstDateISO(new Date('2026-09-15T15:00:00.000Z'))).toBe('2026-09-16');
  });

  it('서버 설정의 종일·시각 차단을 같은 판정기로 적용한다', () => {
    const availability = parseMoodBookingAvailability({
      schemaVersion: 1,
      revision: 4,
      rules: [
        { id: 'holiday', enabled: true, startDate: '2026-10-03', endDate: '2026-10-03', weekdays: [6], mode: 'full_day', startTime: null, reason: '휴무' },
        { id: 'evening', enabled: true, startDate: '2026-10-01', endDate: '2026-10-31', weekdays: [1], mode: 'starts_from', startTime: '17:30', reason: '저녁 운영' },
      ],
    });

    expect(availability).not.toBeNull();
    expect(getMoodBookingBlockStatus('2026-10-03', '09:00', availability).rule?.id).toBe('holiday');
    expect(getMoodBookingBlockStatus('2026-10-05', '17:29', availability).blocked).toBe(false);
    expect(getMoodBookingBlockStatus('2026-10-05', '17:30', availability).rule?.id).toBe('evening');
    expect(getMoodBookingDateRestriction('2026-10-03', availability)?.fullDay).toBe(true);
  });

  it('이틀 차단은 시작일과 종료일을 모두 포함하고 다음 날부터 해제한다', () => {
    const availability = parseMoodBookingAvailability({
      schemaVersion: 1,
      revision: 5,
      rules: [{
        id: 'two-day-break',
        enabled: true,
        startDate: '2026-10-01',
        endDate: '2026-10-02',
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        mode: 'full_day',
        startTime: null,
        reason: '이틀 휴무',
      }],
    });

    expect(getMoodBookingBlockStatus('2026-10-01', '09:00', availability).blocked).toBe(true);
    expect(getMoodBookingBlockStatus('2026-10-02', '09:00', availability).blocked).toBe(true);
    expect(getMoodBookingBlockStatus('2026-10-03', '09:00', availability).blocked).toBe(false);
  });

  it('구문서의 exceptions 누락은 빈 목록으로 읽고 손상 예외는 전체 설정을 거부한다', () => {
    const legacy = parseMoodBookingAvailability({
      schemaVersion: 1,
      revision: 6,
      rules: [{ id: 'legacy-rule', enabled: true, startDate: '2026-09-01', endDate: '2026-09-30', weekdays: [0, 1, 2, 3, 4, 5, 6], mode: 'full_day', startTime: null, reason: '운영 휴무' }],
    });
    expect(legacy?.exceptions).toEqual([]);

    expect(parseMoodBookingAvailability({
      ...legacy,
      exceptions: [{ id: 'bad-open', enabled: true, startDate: '2026-09-03', endDate: '2026-09-03', ruleIds: ['unknown-rule'], reason: '임시 운영' }],
    })).toBeNull();
  });

  it('하루만 열면 그날만 예약 가능하고 앞뒤 날짜는 계속 차단한다', () => {
    const availability = parseMoodBookingAvailability({
      schemaVersion: 1,
      revision: 7,
      rules: [{ id: 'september-block', enabled: true, startDate: '2026-09-01', endDate: '2026-09-30', weekdays: [0, 1, 2, 3, 4, 5, 6], mode: 'full_day', startTime: null, reason: '9월 차단' }],
      exceptions: [{ id: 'open-one-day', enabled: true, startDate: '2026-09-04', endDate: '2026-09-04', ruleIds: ['september-block'], reason: '4일만 운영' }],
    });

    expect(getMoodBookingBlockStatus('2026-09-03', '10:00', availability).blocked).toBe(true);
    expect(getMoodBookingBlockStatus('2026-09-04', '10:00', availability).blocked).toBe(false);
    expect(getMoodBookingBlockStatus('2026-09-05', '10:00', availability).blocked).toBe(true);
  });

  it('3일~5일 기간 열기는 양끝을 포함해 세 날짜 모두 즉시 연다', () => {
    const availability = parseMoodBookingAvailability({
      schemaVersion: 1,
      revision: 8,
      rules: [{ id: 'september-block', enabled: true, startDate: '2026-09-01', endDate: '2026-09-30', weekdays: [0, 1, 2, 3, 4, 5, 6], mode: 'full_day', startTime: null, reason: '9월 차단' }],
      exceptions: [{ id: 'open-three-days', enabled: true, startDate: '2026-09-03', endDate: '2026-09-05', ruleIds: ['september-block'], reason: '3일간 운영' }],
    });

    for (const date of ['2026-09-03', '2026-09-04', '2026-09-05']) {
      expect(getMoodBookingBlockStatus(date, '10:00', availability).blocked, date).toBe(false);
      expect(getMoodBookingDateRestriction(date, availability), date).toBeNull();
    }
    expect(getMoodBookingBlockStatus('2026-09-02', '10:00', availability).blocked).toBe(true);
    expect(getMoodBookingBlockStatus('2026-09-06', '10:00', availability).blocked).toBe(true);
  });

  it('열어 둔 날짜는 이후 겹치는 규칙이 추가돼도 다시 차단되지 않는다', () => {
    const availability = parseMoodBookingAvailability({
      schemaVersion: 1,
      revision: 9,
      rules: [
        { id: 'first-block', enabled: true, startDate: '2026-09-01', endDate: '2026-09-30', weekdays: [0, 1, 2, 3, 4, 5, 6], mode: 'full_day', startTime: null, reason: '첫 규칙' },
        { id: 'later-block', enabled: true, startDate: '2026-09-04', endDate: '2026-09-04', weekdays: [5], mode: 'full_day', startTime: null, reason: '나중에 추가된 규칙' },
      ],
      exceptions: [{ id: 'open-first-only', enabled: true, startDate: '2026-09-04', endDate: '2026-09-04', ruleIds: ['first-block'], reason: '첫 규칙만 해제' }],
    });

    const status = getMoodBookingBlockStatus('2026-09-04', '10:00', availability);
    expect(status).toMatchObject({ blocked: false, availabilityReady: true, rule: null });
    expect(getMoodBookingDateRestriction('2026-09-04', availability)).toBeNull();
  });

  it('누락·손상 설정은 신규 예약과 기존 예약 변경을 모두 잠근다', () => {
    expect(parseMoodBookingAvailability({ schemaVersion: 1, revision: 0, rules: [{ id: 'bad' }] })).toBeNull();
    const validRule = { id: 'valid-rule', enabled: true, startDate: '2026-10-01', endDate: '2026-10-01', weekdays: [4], mode: 'full_day', startTime: null, reason: '휴무' };
    expect(parseMoodBookingAvailability({ schemaVersion: 1, revision: 0, rules: [{ ...validRule, id: 'invalid id' }] })).toBeNull();
    expect(parseMoodBookingAvailability({ schemaVersion: 1, revision: 0, rules: Array.from({ length: 51 }, (_, index) => ({ ...validRule, id: `rule-${index}` })) })).toBeNull();
    expect(getMoodBookingBlockStatus('2026-09-10', '10:00', null)).toMatchObject({ blocked: true, availabilityReady: false });
    expect(isMoodBookingChangeBlocked('2026-09-10', '10:00', '2026-09-10', '10:00', null)).toBe(true);
    expect(isMoodBookingChangeBlocked('2026-09-10', '10:00', '2026-09-10', '10:01', null)).toBe(true);
  });
});
