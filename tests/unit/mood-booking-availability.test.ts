import { describe, expect, it } from 'vitest';
import {
  MOOD_EVENING_BLACKOUT_NOTICE,
  getMoodBookingBlockStatus,
  getMoodBookingDateRestriction,
  isMoodEveningBlackoutDate,
  isMoodEveningBookingBlocked,
  isMoodBookingChangeBlocked,
  moodKstDateISO,
  parseMoodBookingAvailability,
  shouldShowMoodEveningBlackoutNotice,
} from '../../src/lib/moodBookingAvailability';

describe('MOOD 임시 저녁 예약 제한', () => {
  it('안내 문구가 기간·요일·기준 시각을 한 번에 설명한다', () => {
    expect(MOOD_EVENING_BLACKOUT_NOTICE).toBe('8월 15일~9월 15일 목·금·토는 오후 6시 이후 시작 예약 불가');
  });

  it('기간 안 목·금·토 13일만 캘린더 제한일로 표시한다', () => {
    const expected = [
      '2026-08-15',
      '2026-08-20', '2026-08-21', '2026-08-22',
      '2026-08-27', '2026-08-28', '2026-08-29',
      '2026-09-03', '2026-09-04', '2026-09-05',
      '2026-09-10', '2026-09-11', '2026-09-12',
    ];

    for (const date of expected) expect(isMoodEveningBlackoutDate(date), date).toBe(true);
    for (const date of ['2026-08-14', '2026-08-16', '2026-08-19', '2026-09-13', '2026-09-15', '2026-09-16']) {
      expect(isMoodEveningBlackoutDate(date), date).toBe(false);
    }
  });

  it('제한일도 17:59 시작은 허용하고 18:00부터 차단한다', () => {
    expect(isMoodEveningBookingBlocked('2026-09-10', '17:59')).toBe(false);
    expect(isMoodEveningBookingBlocked('2026-09-10', '18:00')).toBe(true);
    expect(isMoodEveningBookingBlocked('2026-09-10', '23:59')).toBe(true);
  });

  it('사진 속 9월 1일·2일·5일 일정은 실제 시작 시각 기준으로 예약 가능하다', () => {
    expect(isMoodEveningBookingBlocked('2026-09-01', '14:00')).toBe(false);
    expect(isMoodEveningBookingBlocked('2026-09-02', '14:00')).toBe(false);
    expect(isMoodEveningBookingBlocked('2026-09-05', '14:20')).toBe(false);
    expect(isMoodEveningBookingBlocked('2026-09-05', '18:00')).toBe(true);
  });

  it('제한 요일 밖 또는 잘못된 날짜·시각은 이 임시 규칙으로 차단하지 않는다', () => {
    expect(isMoodEveningBookingBlocked('2026-09-09', '18:00')).toBe(false);
    expect(isMoodEveningBookingBlocked('2026-02-30', '18:00')).toBe(false);
    expect(isMoodEveningBookingBlocked('2026-09-10', '24:00')).toBe(false);
    expect(isMoodEveningBookingBlocked('not-a-date', '18:00')).toBe(false);
  });

  it('고정 공지는 사전 안내일부터 종료일까지 보이고 9월 16일에 자동으로 사라진다', () => {
    expect(shouldShowMoodEveningBlackoutNotice('2026-08-11')).toBe(false);
    expect(shouldShowMoodEveningBlackoutNotice('2026-08-12')).toBe(true);
    expect(shouldShowMoodEveningBlackoutNotice('2026-09-15')).toBe(true);
    expect(shouldShowMoodEveningBlackoutNotice('2026-09-16')).toBe(false);
    expect(shouldShowMoodEveningBlackoutNotice('not-a-date')).toBe(false);
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

  it('누락·손상 설정은 신규 예약을 막되 정확히 같은 확정 날짜·시각은 유지한다', () => {
    expect(parseMoodBookingAvailability({ schemaVersion: 1, revision: 0, rules: [{ id: 'bad' }] })).toBeNull();
    const validRule = { id: 'valid-rule', enabled: true, startDate: '2026-10-01', endDate: '2026-10-01', weekdays: [4], mode: 'full_day', startTime: null, reason: '휴무' };
    expect(parseMoodBookingAvailability({ schemaVersion: 1, revision: 0, rules: [{ ...validRule, id: 'invalid id' }] })).toBeNull();
    expect(parseMoodBookingAvailability({ schemaVersion: 1, revision: 0, rules: Array.from({ length: 51 }, (_, index) => ({ ...validRule, id: `rule-${index}` })) })).toBeNull();
    expect(getMoodBookingBlockStatus('2026-09-10', '10:00', null)).toMatchObject({ blocked: true, availabilityReady: false });
    expect(isMoodBookingChangeBlocked('2026-09-10', '10:00', '2026-09-10', '10:00', null)).toBe(false);
    expect(isMoodBookingChangeBlocked('2026-09-10', '10:00', '2026-09-10', '10:01', null)).toBe(true);
  });
});
