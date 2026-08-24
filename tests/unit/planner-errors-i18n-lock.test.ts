/**
 * Error localization lock test (2026-08-24 planner-trust-course issue #5)
 * Ensures all PlannerErrorCode values have localized entries in all 4 locales (ko/en/ja/zh)
 */
import { describe, it, expect } from 'vitest';
import type { PlannerErrorCode } from '../../src/pages/PlannerPage/hooks/usePlannerHandlers';
import en from '../../src/i18n/locales/en.json';
import ko from '../../src/i18n/locales/ko.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';

// Extract all PlannerErrorCode values from the type. This is the source of truth.
const ERROR_CODES: PlannerErrorCode[] = [
  'GEMINI_TIMEOUT',
  'GEMINI_ERROR',
  'MISSING_DESTINATION',
  'INVALID_DURATION',
  'INVALID_PAX',
  'MISSING_AIRPORT',
  'UNSUPPORTED_CITY',
  'CITY_DATA_UNAVAILABLE',
  'DIETARY_PREVIEW_UNAVAILABLE',
  'PREFERENCE_DATA_UNAVAILABLE',
  'RATE_PROTECTION_DEGRADED',
  'INVALID_REQUEST',
  'CITY_MISMATCH',
  'MISSING_RESERVATION_STATUS',
  'INVALID_RESERVATION_STATUS',
  'MISSING_ARRIVAL_TIME',
  'PAYMENT_REQUIRED',
  'PAYMENT_INCOMPLETE',
  'PAYMENT_UNDER_REVIEW',
  'PAYMENT_VERIFY_FAILED',
  'PAYMENT_VERIFY_UNAVAILABLE',
  'PAYMENT_REVIEW_CHECK_UNAVAILABLE',
  'ORDER_PROVENANCE_MISSING',
  'ORDER_PRODUCT_MISMATCH',
  'ORDER_PROVENANCE_INVALID',
  'PAYMENT_PENDING_SETTLEMENT',
  'PAYMENT_NOT_CAPTURED',
  'PLAN_GENERATION_IN_PROGRESS',
  'PLAN_ISSUANCE_CHECK_UNAVAILABLE',
  'PLAN_ISSUANCE_NEEDS_REVIEW',
  'DUPLICATE_ORDER',
  'REVISION_EXHAUSTED',
  'FORBIDDEN',
  'INTERNAL_ERROR',
  'NETWORK_ERROR',
  'ABORT_TIMEOUT',
  'INVALID_RESPONSE',
  'MISSING_FORM',
  'NO_PLAN_URL',
  'UNKNOWN_ERROR',
];

describe('Error localization lock — all 4 locales complete', () => {
  const enErrors = en.planner?.errors || {};
  const koErrors = ko.planner?.errors || {};
  const jaErrors = ja.planner?.errors || {};
  const zhErrors = zh.planner?.errors || {};

  it('English locale has all error codes with non-empty entries', () => {
    for (const code of ERROR_CODES) {
      expect(enErrors[code as keyof typeof enErrors], `en.planner.errors.${code}`).toBeDefined();
      expect(enErrors[code as keyof typeof enErrors], `en.planner.errors.${code} must not be empty`).toBeTruthy();
      expect(typeof enErrors[code as keyof typeof enErrors]).toBe('string');
    }
  });

  it('Korean locale has all error codes with non-empty entries', () => {
    for (const code of ERROR_CODES) {
      expect(koErrors[code as keyof typeof koErrors], `ko.planner.errors.${code}`).toBeDefined();
      expect(koErrors[code as keyof typeof koErrors], `ko.planner.errors.${code} must not be empty`).toBeTruthy();
      expect(typeof koErrors[code as keyof typeof koErrors]).toBe('string');
    }
  });

  it('Japanese locale has all error codes with non-empty entries', () => {
    for (const code of ERROR_CODES) {
      expect(jaErrors[code as keyof typeof jaErrors], `ja.planner.errors.${code}`).toBeDefined();
      expect(jaErrors[code as keyof typeof jaErrors], `ja.planner.errors.${code} must not be empty`).toBeTruthy();
      expect(typeof jaErrors[code as keyof typeof jaErrors]).toBe('string');
    }
  });

  it('Chinese locale has all error codes with non-empty entries', () => {
    for (const code of ERROR_CODES) {
      expect(zhErrors[code as keyof typeof zhErrors], `zh.planner.errors.${code}`).toBeDefined();
      expect(zhErrors[code as keyof typeof zhErrors], `zh.planner.errors.${code} must not be empty`).toBeTruthy();
      expect(typeof zhErrors[code as keyof typeof zhErrors]).toBe('string');
    }
  });

  it('no extra error codes exist in any locale (no stale keys)', () => {
    const allCodes = new Set(ERROR_CODES);
    for (const key of Object.keys(enErrors)) {
      expect(allCodes.has(key as PlannerErrorCode), `en has unexpected error code: ${key}`).toBe(true);
    }
    for (const key of Object.keys(koErrors)) {
      expect(allCodes.has(key as PlannerErrorCode), `ko has unexpected error code: ${key}`).toBe(true);
    }
    for (const key of Object.keys(jaErrors)) {
      expect(allCodes.has(key as PlannerErrorCode), `ja has unexpected error code: ${key}`).toBe(true);
    }
    for (const key of Object.keys(zhErrors)) {
      expect(allCodes.has(key as PlannerErrorCode), `zh has unexpected error code: ${key}`).toBe(true);
    }
  });
});
