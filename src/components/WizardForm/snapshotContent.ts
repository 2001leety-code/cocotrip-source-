// Helper: decide whether an autosaved planner wizard snapshot represents
// real user input vs default-state noise.
//
// P126 (2026-05-21) — User complaint: ResumeWizardModal triggers even
// when the user only briefly opened the planner page without filling
// anything. Root cause: WizardForm initializes `dateRange.from = tomorrow`
// on mount (so the calendar isn't empty), and useWizardPersistence debounces
// a snapshot 500ms later. The next visit's hasContent check counted
// `dateRangeFrom` as a real signal — false positive.
//
// Fix: only count fields that require explicit user action. dateRangeFrom is
// excluded; dateRangeTo (the end date — user must pick it) still counts.
// paxInput must differ from its default '2' to count as user signal.

export interface PlannerSnapshotContentShape {
  reservationStatus?: string | null;
  mainCity?: string;
  selectedActivities?: string[];
  freeText?: string;
  dietPrefs?: string[];
  allergies?: string[];
  bucketDishes?: string[];
  dateRangeTo?: string | null;
  arrivalTerminal?: string;
  hotelAddress?: string;
  arrivalTime?: string;
  departureTime?: string;
  paxInput?: string;
}

export const PAX_INPUT_DEFAULT = '2';

export function hasMeaningfulWizardContent(v: PlannerSnapshotContentShape | null | undefined): boolean {
  if (!v) return false;
  return !!(
    v.reservationStatus ||
    v.mainCity ||
    v.selectedActivities?.length ||
    v.freeText ||
    v.dietPrefs?.length ||
    v.allergies?.length ||
    v.dateRangeTo ||
    v.arrivalTerminal ||
    v.hotelAddress ||
    v.arrivalTime ||
    v.departureTime ||
    v.bucketDishes?.length ||
    (!!v.paxInput && v.paxInput !== PAX_INPUT_DEFAULT)
  );
}
