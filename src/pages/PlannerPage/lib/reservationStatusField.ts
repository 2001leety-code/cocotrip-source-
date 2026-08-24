/**
 * Canonical `reservation_status` field for every planner request body — quick
 * preview, normal full submit, and revision submit alike (2026-08-24,
 * planner-trust-course, D: reservation payload parity).
 *
 * Always present, raw pass-through: never conditionally omitted (the old
 * `...(values.reservation_status ? { reservation_status: ... } : {})` spread
 * silently dropped the key when a caller regressed to undefined/empty) and
 * never defaulted (a missing/blank value must reach the server as-is so
 * `validateRequiredIntent`'s MISSING_RESERVATION_STATUS can catch it, not be
 * masked by a client-side guess).
 */
import type { PlannerFormValues } from '@/components/PlannerForm';

export function buildReservationStatusField(
  values: Pick<PlannerFormValues, 'reservation_status'>,
): { reservation_status: PlannerFormValues['reservation_status'] } {
  return { reservation_status: values.reservation_status };
}
