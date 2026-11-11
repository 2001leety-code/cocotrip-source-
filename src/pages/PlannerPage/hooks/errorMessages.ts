import type { PlannerErrorCode } from './usePlannerHandlers';

type PlannerErrorDict = Record<string, string | undefined>;

const PREPAY_ERROR_KEY: Record<string, string> = {
  DIETARY_COVERAGE_UNAVAILABLE: 'DIETARY_COVERAGE_UNAVAILABLE',
  PREPAY_INPUT_MISSING: 'PREPAY_INPUT_MISSING',
  PREPAY_INPUT_MISMATCH: 'PREPAY_INPUT_MISMATCH',
  PREPAY_INPUT_INVALID: 'PREPAY_INPUT_INVALID',
  PREPAY_CITIES_MISSING: 'PREPAY_INPUT_INVALID',
  PREPAY_DIETARY_MISSING: 'PREPAY_INPUT_INVALID',
  PREPAY_DATES_MISSING: 'PREPAY_INPUT_INVALID',
  PLANNER_INPUT_CONFLICT: 'PREPAY_INPUT_INVALID',
  PLANNER_DATE_TOO_SOON: 'PREPAY_DATE_TOO_SOON',
};

/** Use only before payment; generation errors must not claim that no payment occurred. */
export function resolvePrepayErrorMessage(code: string | undefined, errorsDict: PlannerErrorDict | undefined): string | null {
  const key = code ? PREPAY_ERROR_KEY[code] : undefined;
  return key ? errorsDict?.[key] || null : null;
}

/**
 * Resolves a planner error code to a user-facing message from the i18n dict.
 * Falls back to the raw details string if the dict lacks an entry.
 * Keys live under `planner.errors.<code>` in each locale file.
 */
export function resolveErrorMessage(
  code: PlannerErrorCode | null | undefined,
  details: string | null | undefined,
  errorsDict: PlannerErrorDict | undefined,
): string {
  const key = code ? PREPAY_ERROR_KEY[code] || code : undefined;
  if (key && errorsDict?.[key]) return errorsDict[key] as string;
  if (details && details.trim()) return details;
  return (errorsDict?.UNKNOWN_ERROR as string) || 'Something went wrong. Please try again.';
}
