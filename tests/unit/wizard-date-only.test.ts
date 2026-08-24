/**
 * 2026-08-24 (planner-trust-course): `new Date('yyyy-MM-dd')` parses as UTC
 * midnight, not local midnight — in any timezone west of UTC (Honolulu,
 * Los Angeles) that renders as the PREVIOUS local calendar day. It also
 * silently accepts nonexistent calendar dates (`new Date('2026-02-31')` rolls
 * forward to March 3 instead of erroring). `dateOnly.ts` fixes both by
 * building the Date from explicit local Y/M/D components and round-tripping
 * to reject anything non-canonical.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseDateOnly, isValidDateOnly, formatDateOnly,
  kstTodayParts, kstTodayISO, kstTomorrowLocalDate,
} from '../../src/components/WizardForm/dateOnly';

afterEach(() => { vi.useRealTimers(); });

describe('parseDateOnly / isValidDateOnly', () => {
  it('parses a canonical yyyy-MM-dd into a local-midnight Date', () => {
    const d = parseDateOnly('2026-03-15');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(2); // 0-indexed
    expect(d!.getDate()).toBe(15);
    expect(d!.getHours()).toBe(0);
  });

  it('rejects a shape-valid but nonexistent calendar date (Feb 31)', () => {
    expect(parseDateOnly('2026-02-31')).toBeNull();
    expect(isValidDateOnly('2026-02-31')).toBe(false);
  });

  it('rejects garbage input', () => {
    expect(parseDateOnly('banana')).toBeNull();
    expect(parseDateOnly('')).toBeNull();
    expect(parseDateOnly(null)).toBeNull();
    expect(parseDateOnly(undefined)).toBeNull();
  });

  it('rejects non-canonical shapes (missing zero-padding, wrong separators)', () => {
    expect(parseDateOnly('2026-2-5')).toBeNull();
    expect(parseDateOnly('2026/03/15')).toBeNull();
    expect(parseDateOnly('26-03-15')).toBeNull();
    expect(parseDateOnly('2026-03-15T00:00:00Z')).toBeNull();
  });

  it('accepts a real leap day and rejects a non-leap-year Feb 29', () => {
    expect(isValidDateOnly('2024-02-29')).toBe(true); // 2024 is a leap year
    expect(isValidDateOnly('2026-02-29')).toBe(false); // 2026 is not
  });
});

describe('formatDateOnly', () => {
  it('round-trips a parsed date back to the same string', () => {
    for (const s of ['2026-01-01', '2026-12-31', '2026-02-28']) {
      expect(formatDateOnly(parseDateOnly(s)!)).toBe(s);
    }
  });
});

describe('kstTodayParts / kstTodayISO — deterministic across host timezones', () => {
  it('KST is 9h ahead of UTC: 2026-08-24T15:30:00Z is already 2026-08-25 in KST', () => {
    const now = new Date('2026-08-24T15:30:00Z');
    expect(kstTodayParts(now)).toEqual({ y: 2026, m: 8, d: 25 });
    expect(kstTodayISO(now)).toBe('2026-08-25');
  });

  it('just before the KST day boundary is still the earlier day', () => {
    const now = new Date('2026-08-24T14:59:59Z'); // 23:59:59 KST on the 24th
    expect(kstTodayISO(now)).toBe('2026-08-24');
  });
});

describe('kstTomorrowLocalDate — default start day is KST tomorrow, not browser-local tomorrow', () => {
  it('Honolulu (UTC-10): local "today" can already be KST tomorrow, so KST tomorrow is a day further out than browser-local tomorrow', () => {
    // 2026-08-24T15:00:00Z = 2026-08-24 05:00 in Honolulu (browser-local), but
    // 2026-08-25 00:00 in KST — KST has already turned over to the 25th while
    // Honolulu's calendar still reads the 24th.
    process.env.TZ = 'Pacific/Honolulu';
    const now = new Date('2026-08-24T15:00:00Z');
    // Browser-local "tomorrow" (naive `new Date(); +1 day`) would be Aug 25 in
    // Honolulu's own calendar. KST tomorrow is Aug 26 — a full day later.
    const kstTomorrow = kstTomorrowLocalDate(now);
    expect(formatDateOnly(kstTomorrow)).toBe('2026-08-26');
  });

  it('Los Angeles (UTC-7/8): same KST-ahead-of-local-calendar scenario', () => {
    process.env.TZ = 'America/Los_Angeles';
    // 2026-08-24T15:00:00Z = 2026-08-24 08:00 PDT locally, but already
    // 2026-08-25 00:00 KST.
    const now = new Date('2026-08-24T15:00:00Z');
    const kstTomorrow = kstTomorrowLocalDate(now);
    expect(formatDateOnly(kstTomorrow)).toBe('2026-08-26');
  });

  it('KST day-boundary case: a moment just after KST midnight rolls the default forward', () => {
    // 2026-08-24T15:00:01Z = 2026-08-25 00:00:01 KST (just after midnight).
    const justAfter = kstTomorrowLocalDate(new Date('2026-08-24T15:00:01Z'));
    // 2026-08-24T14:59:59Z = 2026-08-24 23:59:59 KST (just before midnight).
    const justBefore = kstTomorrowLocalDate(new Date('2026-08-24T14:59:59Z'));
    expect(formatDateOnly(justAfter)).toBe('2026-08-26');
    expect(formatDateOnly(justBefore)).toBe('2026-08-25');
  });
});
