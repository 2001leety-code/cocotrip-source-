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
//
// P151 (2026-05-22) — 추가 false positive: mainCity 단독 (도시 칩 1번 클릭) 으로도
// modal 표시. 사용자 입력 의도: "페이지 닫히거나 인터넷 끊겼을 때만 떠야 하는데
// 작성할때마다 그냥 뜸". 최소 2개 이상의 명시적 행동을 요구하도록 threshold 상향.
// mainCity 단독은 제외 → mainCity + (activities | dateRangeTo | hotel | freeText) 조합만 인정.

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
  // P151: mainCity 단독 (도시 칩 1번 클릭) 은 threshold 미달.
  // mainCity + 추가 명시적 행동 최소 1개 필요.
  const hasCityAndMore = !!(v.mainCity && (
    v.selectedActivities?.length ||
    v.dateRangeTo ||
    v.arrivalTerminal ||
    v.hotelAddress ||
    v.freeText
  ));
  return !!(
    v.reservationStatus ||
    hasCityAndMore ||
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
