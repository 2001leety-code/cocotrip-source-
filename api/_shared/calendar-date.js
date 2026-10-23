/**
 * 달력 날짜(YYYY-MM-DD) 공용 헬퍼 (2026-10-23, 후속 ②b).
 *
 * ②a 의 booking-manage-token.js 내부 `tourDateEndKstMs` 를 그대로 옮겼다(동작 불변) —
 * 날짜 변경(modifyBooking)도 같은 "실제 달력 날짜" 기준을 써야 토큰 발급과 어긋나지 않는다.
 * 투어 날짜는 항상 KST 달력 기준이다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function parts(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, mo, d };
}

/** 실제 달력 날짜(YYYY-MM-DD, Date 왕복 일치)인가. `2026-02-30`·`2026/11/01` 은 false. */
export function isCalendarDate(dateStr) {
  return parts(dateStr) !== null;
}

/** 실제 달력 날짜(YYYY-MM-DD, Date 왕복 일치)만 허용. 그 날 KST 23:59 의 epoch ms, 무효면 null. */
export function tourDateEndKstMs(tourDate) {
  const p = parts(tourDate);
  if (!p) return null;
  // KST 23:59 = UTC 14:59 같은 날
  return Date.UTC(p.y, p.mo - 1, p.d, 23, 59, 0) - KST_OFFSET_MS;
}

/** nowMs 시점의 KST 달력 날짜 + days 일 (YYYY-MM-DD). */
export function kstDatePlusDays(nowMs, days = 0) {
  return new Date(Number(nowMs) + KST_OFFSET_MS + days * DAY_MS).toISOString().slice(0, 10);
}
