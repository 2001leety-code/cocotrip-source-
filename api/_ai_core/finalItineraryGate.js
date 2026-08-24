/**
 * finalItineraryGate — 마지막 mutation 이후 **단 하나의** 종단(fail-closed) 식이/식사 검증
 * (2026-08-24 planner-trust).
 *
 * 배경 — 검증은 여러 번 도는데 **마지막에 도는 게 없었다.** validateResponse 이후에도 일정이
 * 계속 바뀐다:
 *   1. dietary retry            → 재검증 O
 *   2. pattern retry            → **plan 전체를 새로 받아놓고 validatePatternStructure 만 재검증**
 *                                 → 식이 위반 plan 이 식이 검증을 통과한 plan 을 밀어내고 저장됨
 *   3. sync Pass 3 (enrich)     → pattern retry 안에서 다시 도는데 이후 식이 재검증 없음
 *   4. applyDBMatcher           → food stop 이름·태그 치환 (검증 이후)
 *   5. block_mode expand        → validateResponse 자체를 안 탐 (handlerCore `if(!itinerary)`)
 *   6. routeEnrich/backfill/추천 → stop 치환·trim (검증 이후)
 *   7. background Pass 3        → Firestore 를 **무검증으로 덮어씀**
 *
 * 그래서 "각 경로의 마지막 mutation 뒤" 에 이 게이트 하나를 둔다. 경고 주입으로 때우지 않는다 —
 * critical 은 저장·응답을 막는다 (.claude/rules/dietary-safety.md "완화 금지 / silent drop 금지").
 *
 * 식이 요구가 없는 손님에겐 완전 no-op (기존 동작 byte-identical).
 */
import { validateResponse, hasCriticalDietaryViolation } from './responseValidator.js';
import { findDuplicateStops } from './qualityMetrics.js';

export const FINAL_GATE_DIETARY_CODE = 'DIETARY_VIOLATION';
export const FINAL_GATE_MEAL_CODE = 'DIETARY_MEAL_COVERAGE_FAILED';
export const FINAL_GATE_DUPLICATE_CODE = 'DUPLICATE_STOP_VIOLATION';

const SAFETY_DIETS = ['halal', 'vegan', 'vegetarian'];

/** 위치/이동만 담당하는 stop — 관광 "활동" 으로 세지 않는다. */
function isProtectedCategory(cat) {
  return cat === 'lodging' || cat === 'airport' || cat === 'travel';
}

/** 요청에 halal/vegan/vegetarian 이 하나라도 있는가 (그 외 취향은 이 게이트 대상 아님). */
export function hasSafetyDiet(dietary) {
  return (Array.isArray(dietary) ? dietary : [])
    .some((d) => SAFETY_DIETS.some((s) => new RegExp(s, 'i').test(String(d || ''))));
}

/**
 * "정상 하루" 인데 식사 stop 이 0개인 day 검출 (2026-08-24, 제주 vegan 6-stop 0-food 실측 재현).
 *
 * 진짜 도착/출국 transit-only 반나절을 벌주지 않으려고 **기존 stop/day 메타만** 쓴다:
 *   - 활동 stop = category 가 lodging/airport/travel/food 가 아닌 stop (관광·체험).
 *   - 활동 stop 이 MIN_ACTIVITY_STOPS 미만 = 이동/휴식 위주의 부분 day → 면제.
 *     (공항 stop·return_to_airport 메타가 붙은 도착·출국일이 정확히 이 모양이다.)
 *   - 활동 stop 이 그 이상인데 food 가 0 = 하루 종일 돌아다니는데 식이 손님에게 먹을 곳이
 *     한 곳도 없다 = 저장 금지.
 *
 * 결정론적이다 — 식당을 지어내거나 인증을 추정하지 않는다. 판정만 한다.
 *
 * @param {object} itinerary
 * @param {string[]} dietary
 * @returns {Array<{day: number, activity_stops: number, food_stops: number, message: string}>}
 */
const MIN_ACTIVITY_STOPS = 3;
export function checkZeroFoodDays(itinerary, dietary) {
  if (!hasSafetyDiet(dietary)) return [];
  const days = Array.isArray(itinerary && itinerary.days) ? itinerary.days : [];
  const failures = [];
  days.forEach((day, idx) => {
    const stops = Array.isArray(day && day.stops) ? day.stops : [];
    const foodStops = stops.filter((s) => s && s.category === 'food').length;
    if (foodStops > 0) return;
    const activityStops = stops.filter((s) => s && !isProtectedCategory(s.category) && s.category !== 'food').length;
    if (activityStops < MIN_ACTIVITY_STOPS) return; // 도착/출국·휴식 등 부분 day → 면제
    const dayNum = Number(day && day.day) || (idx + 1);
    failures.push({
      day: dayNum,
      activity_stops: activityStops,
      food_stops: 0,
      message: `Day ${dayNum}: 관광 stop ${activityStops}개인 정상 day 인데 식사 stop 0개 (${(dietary || []).join('/')} 손님)`,
    });
  });
  return failures;
}

/**
 * 종단 검증 — 이 함수가 각 경로의 **마지막 mutation 뒤** 정확히 한 번 돈다.
 *
 * @param {object} itinerary
 * @param {{language?: string, dietary?: string[], styles?: string[], foodIndex?: Array}} ctx
 * @returns {{ok: boolean, code: string|null, issues: Array, violations: Array, zeroFoodDays: Array}}
 */
export function runFinalItineraryValidation(itinerary, ctx = {}) {
  const dietary = Array.isArray(ctx.dietary) ? ctx.dietary : [];
  const empty = { ok: true, code: null, issues: [], violations: [], zeroFoodDays: [] };
  if (!itinerary || typeof itinerary !== 'object') return empty;
  if (!hasSafetyDiet(dietary)) return empty; // 식이 요구 없음 → no-op

  const issues = validateResponse(
    itinerary,
    { lang: ctx.language, dietary, styles: ctx.styles },
    ctx.foodIndex,
  );
  const violations = issues.filter((i) => i && i.type === 'dietary_violation' && i.severity === 'critical');
  const zeroFoodDays = checkZeroFoodDays(itinerary, dietary);

  if (hasCriticalDietaryViolation(issues)) {
    return { ok: false, code: FINAL_GATE_DIETARY_CODE, issues, violations, zeroFoodDays };
  }
  if (zeroFoodDays.length > 0) {
    return { ok: false, code: FINAL_GATE_MEAL_CODE, issues, violations, zeroFoodDays };
  }
  return { ok: true, code: null, issues, violations, zeroFoodDays };
}

/**
 * 종단 중복 게이트 — 식이 요구 유무와 무관하게 **항상** 돈다(2026-08-24).
 * 손님이 알아채는 진짜 중복(관광지·식당 재등장)은 식이 손님만의 문제가 아니다.
 * qualityMetrics.findDuplicateStops 를 그대로 써서 duplicate_stops 점수 지표와
 * 같은 분류(호텔/숙소 예외)를 공유한다 — 별도 판정 로직을 두지 않는다.
 *
 * @param {object} itinerary
 * @returns {{ok: boolean, code: string|null, duplicates: Array<{name: string, count: number}>}}
 */
export function runDuplicateStopGate(itinerary) {
  if (!itinerary || typeof itinerary !== 'object') return { ok: true, code: null, duplicates: [] };
  const duplicates = findDuplicateStops(itinerary);
  if (duplicates.length > 0) {
    return { ok: false, code: FINAL_GATE_DUPLICATE_CODE, duplicates };
  }
  return { ok: true, code: null, duplicates: [] };
}

/** 중복 게이트 실패 → 손님에게 낼 에러. @param {string} stage */
export function buildDuplicateGateError(result, stage) {
  const names = (result.duplicates || []).map((d) => `${d.name}×${d.count}`).join(', ');
  const e = new Error(
    `Duplicate stops found in your itinerary (${names}). To keep quality, we did not save this plan. Please try again or contact support.`
  );
  e.code = result.code;
  e.statusCode = 422;
  e.stage = stage;
  e.details = (result.duplicates || []).slice(0, 5);
  return e;
}

/**
 * 종단 중복 검증 + 실패 시 throw. 저장·응답 직전에 쓴다 — 식이 게이트와 동일 지점.
 * @throws {Error & {code: string, statusCode: 422}}
 */
export function assertNoDuplicateStops(itinerary, stage = 'unknown') {
  const result = runDuplicateStopGate(itinerary);
  if (result.ok) return result;
  console.error(`[finalGate] ${stage} FAILED (${result.code}):`, JSON.stringify(result.duplicates.slice(0, 5)));
  throw buildDuplicateGateError(result, stage);
}

/**
 * 종단 검증 실패를 손님에게 낼 수 있는 에러로. 경고 주입으로 대체하지 않는다.
 *
 * @param {{code: string, violations: Array, zeroFoodDays: Array}} result
 * @param {string[]} dietary
 * @param {string} stage — 'legacy' | '3pass' | 'block_mode' | 'post_response' | 'pass3_background'
 */
export function buildFinalGateError(result, dietary, stage) {
  const diets = (Array.isArray(dietary) ? dietary : []).join(', ');
  const e = result.code === FINAL_GATE_MEAL_CODE
    ? new Error(
        `We could not place a safe meal on every full day of your itinerary (${diets}). ` +
        'To keep you safe we did not save this plan. Please try again or contact support.'
      )
    : new Error(
        `AI failed to respect your dietary requirements (${diets}). ` +
        'Please try again or contact support.'
      );
  e.code = result.code;
  e.statusCode = 422;
  e.stage = stage;
  e.details = result.code === FINAL_GATE_MEAL_CODE
    ? result.zeroFoodDays.slice(0, 5).map((f) => f.message)
    : result.violations.slice(0, 5).map((v) => `${v.diet}:${v.stop}`);
  return e;
}

/**
 * 종단 검증 + 실패 시 throw. 저장·응답 직전에 쓴다.
 * @throws {Error & {code: string, statusCode: 422}}
 */
export function assertFinalItineraryValid(itinerary, ctx = {}, stage = 'unknown') {
  const result = runFinalItineraryValidation(itinerary, ctx);
  if (result.ok) return result;
  console.error(
    `[finalGate] ${stage} FAILED (${result.code}):`,
    JSON.stringify({
      violations: result.violations.slice(0, 5),
      zeroFoodDays: result.zeroFoodDays.slice(0, 5),
    }),
  );
  throw buildFinalGateError(result, ctx.dietary, stage);
}
