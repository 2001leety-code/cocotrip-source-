// 2026-08-24 (planner-trust-course, F): single source of truth for "can the
// traveler move forward" — previously WizardForm's live `unlockedStep` calc,
// `handleGenerate`'s pre-submit revalidation, and `applyResumeSnapshot`'s
// restored-step clamp each carried their own copy of the same formula. Three
// copies means a rule added to one (e.g. this file's KST date/pax checks) can
// silently miss the other two. Pure and side-effect-free — safe to unit test
// with an injected clock.
import type { ReservationStatus } from './WizardStep0Reservation';
import { isValidDateOnly, kstTodayISO } from './dateOnly';

export { kstTodayISO } from './dateOnly';

export interface WizardGateInput {
  reservationStatus: ReservationStatus | null;
  arrivalAirport: string;
  arrivalTime: string;
  mainCity: string;
  selectedActivities: string[];
  startDate: string; // yyyy-MM-dd
  endDate: string;   // yyyy-MM-dd
  /** Raw parsed pax — NaN for empty/non-numeric input. No `|| 2` fallback upstream. */
  pax: number;
  /** Paid revisions may regenerate an itinerary whose dates are already past/current —
   *  bypasses ONLY the "start >= tomorrow" rule. Malformed dates/end>=start still required. */
  isRevision?: boolean;
  /** Injectable "today" in KST (yyyy-MM-dd) — omit in production (uses the real clock). */
  nowKstDate?: string;
}

export interface WizardGateResult {
  canStep0: boolean;
  canStep1: boolean;
  canStep3: boolean;
  unlockedStep: number;
}

export function computeWizardGate(input: WizardGateInput): WizardGateResult {
  const {
    reservationStatus, arrivalAirport, arrivalTime, mainCity, selectedActivities,
    startDate, endDate, pax, isRevision, nowKstDate,
  } = input;

  const canStep0 = reservationStatus !== null && (
    !(reservationStatus === 'flight' || reservationStatus === 'flight_hotel')
    || (!!arrivalAirport && !!arrivalTime)
  );

  const canStep1 = mainCity !== '' && selectedActivities.length > 0;

  const paxValid = Number.isFinite(pax) && Number.isInteger(pax) && pax >= 1;
  // 2026-08-24 (planner-trust-course): lexicographic `endDate >= startDate` alone
  // passes shape-valid-but-nonexistent strings ("2026-02-31") straight through —
  // only safe to compare lexicographically once BOTH sides are confirmed real
  // canonical yyyy-MM-dd calendar dates (isValidDateOnly round-trips through a
  // real Date, catching Feb 31 / "banana" / non-zero-padded shapes alike).
  const datesWellFormed = isValidDateOnly(startDate) && isValidDateOnly(endDate) && endDate >= startDate;
  const today = nowKstDate || kstTodayISO();
  // New purchases must start tomorrow or later (KST calendar day). Paid
  // revisions regenerate an itinerary that may already be underway or past —
  // that rule doesn't apply to them.
  const startsInTime = isRevision ? true : startDate > today;
  const canStep3 = datesWellFormed && startsInTime && paxValid && arrivalAirport !== '';

  let unlockedStep = 0;
  if (canStep0) unlockedStep = 1;
  if (unlockedStep >= 1 && canStep1) unlockedStep = 3;
  if (unlockedStep >= 3 && canStep3) unlockedStep = 4;

  return { canStep0, canStep1, canStep3, unlockedStep };
}
