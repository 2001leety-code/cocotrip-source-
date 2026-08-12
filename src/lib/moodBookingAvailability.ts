/**
 * MOOD 임시 저녁 예약 제한 — 화면과 서버가 같은 규칙을 쓰기 위한 프론트 미러.
 *
 * 2026-08-15~2026-09-15(양 끝 포함) 중 목·금·토는
 * 시작 시각이 18:00 이상인 예약을 받지 않는다. 17:59까지 시작하는 예약은 허용한다.
 */
export const MOOD_EVENING_BLACKOUT_NOTICE = '8월 15일~9월 15일 목·금·토는 오후 6시 이후 시작 예약 불가';

const BLACKOUT_START_DATE = '2026-08-15';
const BLACKOUT_END_DATE = '2026-09-15';
const NOTICE_START_DATE = '2026-08-12';
const BLACKOUT_START_MINUTES = 18 * 60;
const BLACKOUT_WEEKDAYS = new Set([4, 5, 6]); // 목·금·토 (UTC 기준)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function isoWeekday(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;

  return parsed.getUTCDay();
}

function timeMinutes(startTime: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(startTime);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 캘린더에서 '오후 6시 이후 제한일' 표시가 필요한 날짜인지 반환한다. */
export function isMoodEveningBlackoutDate(date: string): boolean {
  if (date < BLACKOUT_START_DATE || date > BLACKOUT_END_DATE) return false;
  const weekday = isoWeekday(date);
  return weekday !== null && BLACKOUT_WEEKDAYS.has(weekday);
}

/** 해당 날짜·시각 조합으로 새 예약/변경을 막아야 하는지 반환한다. */
export function isMoodEveningBookingBlocked(date: string, startTime: string): boolean {
  if (!isMoodEveningBlackoutDate(date)) return false;
  const minutes = timeMinutes(startTime);
  return minutes !== null && minutes >= BLACKOUT_START_MINUTES;
}

/** 실행 환경의 시간대와 무관한 한국 오늘 날짜를 반환한다. */
export function moodKstDateISO(now = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 고정 공지를 보여 줄 기간인지 반환한다. 정책 종료 다음 날부터 자동으로 숨긴다. */
export function shouldShowMoodEveningBlackoutNotice(date: string): boolean {
  return isoWeekday(date) !== null && date >= NOTICE_START_DATE && date <= BLACKOUT_END_DATE;
}
