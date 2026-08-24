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
  dietaryRestrictions?: string[];
  bucketDishes?: string[];
  dateRangeTo?: string | null;
  arrivalTerminal?: string;
  hotelAddress?: string;
  arrivalTime?: string;
  departureTime?: string;
  /** P239 (2026-05-27): tourStartTime autosave content. default '09:00' 단독 입력은
   *  meaningful content 아님 (resume modal 트리거 X — 다른 시그널 1개 이상과 함께일 때만). */
  tourStartTime?: string;
  /** #tour-end (2026-06-05): tourEndTime autosave content. default '21:00'. */
  tourEndTime?: string;
  paxInput?: string;
  /** PR-D (2026-06-01): 페이지가 입력 도중 비정상 teardown(새로고침/탭닫힘)될 때
   *  pagehide 리스너가 동기 기록하는 "사고 이탈" 마커. resume modal 의 좁힌 트리거가
   *  "정상 이탈 vs 사고 이탈" 을 구분하는 데 사용 (VITE_FEATURE_RESUME_DIRTY_EXIT='true' 일 때만).
   *  meaningful content 판정에는 포함되지 않음 (사용자 입력 시그널이 아니라 라이프사이클 신호). */
  dirtyExit?: boolean;
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
    v.dietaryRestrictions?.length ||
    v.dateRangeTo ||
    v.arrivalTerminal ||
    v.hotelAddress ||
    v.arrivalTime ||
    v.departureTime ||
    v.bucketDishes?.length ||
    (!!v.paxInput && v.paxInput !== PAX_INPUT_DEFAULT)
  );
}

// PR-D (2026-06-01): resume modal 과노출 완화 — "의미있는 시그널 ≥2개" 게이트.
//
// 배경: 기존 hasMeaningfulWizardContent 는 단일 시그널(도시+칩 1개, 날짜 종료일만 등)
// 로도 통과 → resume modal 이 여전히 자주 뜸. 운영자 의도는 "정말 중단됐을 때만".
// 임계값을 ≥2 로 올려 "잠깐 둘러보다 만진 1개" 노이즈를 더 걸러냄.
//
// SAFETY 예외: 식이제한(dietPrefs) / 종교적·윤리적 식이제한(dietaryRestrictions) 는 단독이어도 통과.
// 고객 건강 직결 데이터라 "halal 1개만 골라둔" 상태를 잃게 만들면 안 됨 (J 등급).
//
// 이 함수는 VITE_FEATURE_RESUME_DIRTY_EXIT='true' 일 때의 좁힌 트리거에서만 쓰임.
// 플래그 OFF 경로는 위 hasMeaningfulWizardContent (단일 시그널) 를 그대로 사용 →
// 기존 prod 동작 byte-identical 보장.
export function countMeaningfulWizardSignals(v: PlannerSnapshotContentShape | null | undefined): number {
  if (!v) return 0;
  let n = 0;
  if (v.reservationStatus) n++;
  if (v.mainCity) n++;
  if (v.selectedActivities?.length) n++;
  if (v.freeText) n++;
  if (v.dietPrefs?.length) n++;
  if (v.dietaryRestrictions?.length) n++;
  if (v.dateRangeTo) n++;
  if (v.arrivalTerminal) n++;
  if (v.hotelAddress) n++;
  if (v.arrivalTime) n++;
  if (v.departureTime) n++;
  if (v.bucketDishes?.length) n++;
  if (!!v.paxInput && v.paxInput !== PAX_INPUT_DEFAULT) n++;
  return n;
}

export function hasMeaningfulWizardContentStrict(v: PlannerSnapshotContentShape | null | undefined): boolean {
  if (!v) return false;
  // SAFETY: 식이제한은 단독이어도 의미있는 콘텐츠 (건강/종교 데이터 — 잃으면 안 됨).
  if (v.dietPrefs?.length || v.dietaryRestrictions?.length) return true;
  // 그 외에는 명시적 사용자 시그널 ≥2개 요구 (과노출 완화).
  return countMeaningfulWizardSignals(v) >= 2;
}
