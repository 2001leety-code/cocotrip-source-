/**
 * MOOD 임시 예약 제한 정책의 서버 정본.
 *
 * 입력 날짜는 한국 달력의 YYYY-MM-DD 값이다. 서버가 어느 시간대에서 실행되더라도
 * 요일이 바뀌지 않도록 달력 날짜를 UTC 날짜로만 변환해 요일을 계산한다.
 */
export const MOOD_EVENING_BLACKOUT_ERROR = 'MOOD_EVENING_BOOKING_UNAVAILABLE';
export const MOOD_EVENING_BLACKOUT_REASON = '2026년 8월 15일~9월 15일 목·금·토 18:00 이후 예약 불가';

export const MOOD_EVENING_BLACKOUT_POLICY = Object.freeze({
  startDate: '2026-08-15',
  endDate: '2026-09-15',
  startTime: '18:00',
  weekdays: Object.freeze([4, 5, 6]), // 목요일, 금요일, 토요일
});

const AVAILABLE = Object.freeze({ ok: true });
const UNAVAILABLE = Object.freeze({
  ok: false,
  error: MOOD_EVENING_BLACKOUT_ERROR,
  reason: MOOD_EVENING_BLACKOUT_REASON,
});

function calendarWeekday(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year
    || value.getUTCMonth() !== month - 1
    || value.getUTCDate() !== day
  ) {
    return null;
  }
  return value.getUTCDay();
}

export function isValidMoodBookingDate(date) {
  return calendarWeekday(date) !== null;
}

/**
 * @param {string} date 한국 달력 기준 YYYY-MM-DD
 * @param {string} startTime HH:mm
 * @returns {{ok: true} | {ok: false, error: string, reason: string}}
 */
export function checkMoodBookingAvailability(date, startTime) {
  const weekday = calendarWeekday(date);
  if (weekday === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(startTime || ''))) {
    return AVAILABLE;
  }

  const policy = MOOD_EVENING_BLACKOUT_POLICY;
  const inDateRange = date >= policy.startDate && date <= policy.endDate;
  const blockedWeekday = policy.weekdays.includes(weekday);
  const blockedStartTime = startTime >= policy.startTime;

  return inDateRange && blockedWeekday && blockedStartTime ? UNAVAILABLE : AVAILABLE;
}

/**
 * 기존 차단 시간대 예약은 날짜와 시작 시각을 그대로 둔 채 다른 내용만 고칠 수 있다.
 * 새 차단 시간대로 옮기거나 기존 차단 예약의 날짜/시각을 바꾸는 요청은 막는다.
 */
export function checkMoodBookingChangeAvailability(
  existingDate,
  existingStartTime,
  requestedDate,
  requestedStartTime,
) {
  const requested = checkMoodBookingAvailability(requestedDate, requestedStartTime);
  if (requested.ok) return requested;
  return existingDate === requestedDate && existingStartTime === requestedStartTime
    ? AVAILABLE
    : requested;
}
