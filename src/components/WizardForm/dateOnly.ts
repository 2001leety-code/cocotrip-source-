// Pure yyyy-MM-dd calendar-date helpers — no timezone-dependent `new Date(string)`.
//
// 2026-08-24 (planner-trust-course): `new Date('2026-02-31')` is not an error —
// JS silently rolls it forward to 2026-03-03. `new Date('yyyy-MM-dd')` (no time
// component) also parses as UTC midnight, not local midnight, so in any
// timezone west of UTC (America/Los_Angeles, Honolulu) it renders one calendar
// day EARLIER than the string said. Both bugs are exactly the "date-only
// correctness in every timezone" class this module exists to close: build the
// Date from explicit local Y/M/D components and round-trip it to reject
// anything non-canonical (malformed shape, or a shape-valid-but-nonexistent
// date like Feb 31).
//
// Deliberately separate from full ISO timestamp parsing — a `dateRangeFrom`
// snapshot value is always yyyy-MM-dd (this module), an autosave `ts` is a
// full ISO instant (`new Date(iso)` stays correct — that parse IS timezone-
// aware on purpose).

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parses a strict yyyy-MM-dd string into a LOCAL calendar Date (local
 * midnight) — or null if the string isn't canonical yyyy-MM-dd shape, or
 * doesn't round-trip to a real calendar date (2026-02-31, "banana", "2026-2-5").
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = DATE_ONLY_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  // Round-trip check: Date silently normalizes an out-of-range day/month
  // (Feb 31 -> Mar 3) instead of throwing — reject anything whose components
  // don't survive construction unchanged.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

export function isValidDateOnly(value: string | null | undefined): boolean {
  return parseDateOnly(value) !== null;
}

/** Formats a Date as its LOCAL-calendar yyyy-MM-dd (no UTC conversion, no library). */
export function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "Today" in Asia/Seoul (KST, UTC+9, no DST) as {y, m, d} calendar numbers —
 *  deterministic regardless of the host's local timezone. */
export function kstTodayParts(now: Date = new Date()): { y: number; m: number; d: number } {
  // now.getTime() is an absolute UTC instant regardless of the host's local
  // timezone — adding a fixed 9h and reading UTC fields gives KST's calendar
  // day without ever touching the environment's local offset.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return { y: kst.getUTCFullYear(), m: kst.getUTCMonth() + 1, d: kst.getUTCDate() };
}

/** Today's date in Asia/Seoul as yyyy-MM-dd. */
export function kstTodayISO(now: Date = new Date()): string {
  const { y, m, d } = kstTodayParts(now);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Tomorrow's KST calendar date as a LOCAL Date object (i.e. `new Date(y, m-1,
 * d)` using the browser's own timezone constructor, but with Y/M/D taken from
 * KST — not the browser's — "today"). This is deliberately NOT a UTC+9
 * Date: callers (react-day-picker, `format(d, 'yyyy-MM-dd')`) read LOCAL
 * Y/M/D, so encoding "KST tomorrow" as local components is what makes the
 * displayed calendar day and the serialized startDate agree with KST in every
 * browser timezone — including ones west of UTC (Honolulu, Los Angeles) where
 * "browser-local tomorrow" can differ from "KST tomorrow" by a full day.
 */
export function kstTomorrowLocalDate(now: Date = new Date()): Date {
  const { y, m, d } = kstTodayParts(now);
  // Date normalizes day-of-month overflow (e.g. 31+1 in a 31-day month rolls
  // into the 1st of next month) automatically — no manual month-length math.
  return new Date(y, m - 1, d + 1);
}
