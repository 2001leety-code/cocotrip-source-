import type { PlannerErrorCode } from './usePlannerHandlers';

type PlannerErrorDict = Record<string, string | undefined>;

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
  if (code && errorsDict && errorsDict[code]) return errorsDict[code] as string;
  if (details && details.trim()) return details;
  return (errorsDict?.UNKNOWN_ERROR as string) || 'Something went wrong. Please try again.';
}
