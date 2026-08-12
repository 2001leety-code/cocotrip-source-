import { describe, expect, it } from 'vitest';
import {
  MOOD_EVENING_BLACKOUT_NOTICE,
  isMoodEveningBlackoutDate,
  isMoodEveningBookingBlocked,
  moodKstDateISO,
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
});
