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

// 2026-10-26 B6-1 r2: 결제된 주문의 생성 실패 문구 — 결제 전 거부 키('결제는 진행되지 않았어요')와 분리된 PAID_* 키.
const PAID_ERROR_KEY: Record<string, string> = {
  DIETARY_COVERAGE_UNAVAILABLE: 'PAID_DIETARY_COVERAGE_UNAVAILABLE',
  PREPAY_INPUT_MISMATCH: 'PAID_PREPAY_INPUT_MISMATCH',
  PREPAY_INPUT_MISSING: 'PAID_PREPAY_INPUT_INVALID',
  PREPAY_INPUT_INVALID: 'PAID_PREPAY_INPUT_INVALID',
  PREPAY_CITIES_MISSING: 'PAID_PREPAY_INPUT_INVALID',
  PREPAY_DIETARY_MISSING: 'PAID_PREPAY_INPUT_INVALID',
  PREPAY_DATES_MISSING: 'PAID_PREPAY_INPUT_INVALID',
  PLANNER_INPUT_CONFLICT: 'PAID_PREPAY_INPUT_INVALID',
};

/**
 * 결제된 주문(paypalOrderId)으로 생성이 실패했을 때. 결제 전 거부 문구를 쓰는 코드는 PAID_* 로 바꾸고, 사전에 없는
 * 코드는 '이미 결제됨 · 다시 결제하지 마세요' 일반 문구(PAID_GENERATION_FAILED)로 — 서버 영어/한국어 details 로 새지 않게.
 */
export function resolvePaidOrderErrorMessage(
  code: PlannerErrorCode | null | undefined,
  errorsDict: PlannerErrorDict | undefined,
): string {
  const paidKey = code ? PAID_ERROR_KEY[code] : undefined;
  if (paidKey && errorsDict?.[paidKey]) return errorsDict[paidKey] as string;
  if (code && errorsDict?.[code]) return errorsDict[code] as string;
  return (errorsDict?.PAID_GENERATION_FAILED as string) || 'This order is already paid — please do not pay again. Please contact us.';
}
