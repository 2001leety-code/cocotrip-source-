/**
 * 2026-10-26 (운영자 승인): 도착 휴식일·출국 조식 면제 규칙의 **순수 값 SSOT** — 브라우저 안전(의존 0).
 * api/_ai_core/constants.js 가 그대로 re-export 한다(서버 판정 arrivalRestDayInfo 는 공항 이동표가 필요해 서버에 남는다).
 * 위자드 힌트는 이 값만 쓴다 — 준비 시각(입국·공항 이동) 규칙은 프론트에서 추정하지 않는다(놓치는 건 허용, 틀린 단정 금지).
 */
export const REST_DAY_LATE_ARRIVAL_MIN = 18 * 60; // B-LATE-ARRIVAL 과 같은 기준
export const REST_DAY_TOUR_END_MARGIN_MIN = 60;   // 정책 여유값(실측 아님) — 운영자 승인 값
export const DEFAULT_TOUR_END_MIN = 21 * 60;
export const EARLY_DEPARTURE_NO_BREAKFAST_MIN = 11 * 60; // 출국 11:00 전 = 식당 조식 면제(B-MEAL P137 · 조식 안내)

/** 엄격 HH:MM(00:00~23:59, 앞 5자). 아니면 null. */
export function strictHHMMToMin(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim().slice(0, 5));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? h * 60 + mi : null;
}

/**
 * 생성 전 확실한 경우만 — 2일 여행 + 도착 ≥ 18:00(휴식일) + 출국 < 11:00(조식 면제) → 식사 장소가 일정에 거의 없다.
 * 시각이 엄격 HH:MM 이 아니거나 3일 이상이면 false(중간날에는 점심·저녁이 들어간다).
 */
export function isLikelyNoMealTrip({ durationDays, arrivalTime, departureTime } = {}) {
  if (Number(durationDays) !== 2) return false;
  const arr = strictHHMMToMin(arrivalTime);
  const dep = strictHHMMToMin(departureTime);
  return arr !== null && dep !== null && arr >= REST_DAY_LATE_ARRIVAL_MIN && dep < EARLY_DEPARTURE_NO_BREAKFAST_MIN;
}
