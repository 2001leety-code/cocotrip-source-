/**
 * 예약 날짜 변경 클라이언트 헬퍼 (2026-10-23, 후속 ②b) — BookingDateChangeModal 이 쓴다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** KST 오늘 + days (YYYY-MM-DD) — 서버 api/_shared/calendar-date.js kstDatePlusDays 와 같은 기준. */
export function kstDatePlusDays(days: number, nowMs: number = Date.now()): string {
  return new Date(nowMs + KST_OFFSET_MS + days * DAY_MS).toISOString().slice(0, 10);
}

/** UUID v4 — crypto.randomUUID 가 없는 브라우저는 getRandomValues 로 같은 형식을 만든다. */
export function newRequestId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
