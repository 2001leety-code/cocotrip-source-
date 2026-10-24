/**
 * dietaryCoverageGate — dietary 사전 커버리지 게이트 (2026-07-11 운영자 지시 3단계-C).
 *
 * 요청 도시에 "검증된"(unverified 제외 — docs/DIETARY-DATA-AUDIT-2026-07-11.md)
 * halal/vegan/vegetarian 후보가 0이면 Gemini 호출 전에 명확한 코드로 종료.
 * 이름 지어내기·일반식당 완화 금지 (CLAUDE.md J).
 *
 * 사용권 미소비 보장 (2026-07-15 갱신): 이 게이트는 Gemini 호출 전에 종료하므로 plan 이 저장되지
 * 않는다. 그 상태에서 결제/쿠폰이 소모되지 않도록 handlerCore catch 가 planPersisted=false 일 때
 *   - PayPal 유료: releasePlanIssuance 로 발급권 해제(ISSUING + 같은 attemptId 일 때만)
 *     → 같은 결제로 재시도 가능. 상세 = _shared/plan-issuance.js
 *   - AI 무료쿠폰: restoreAiPlanCoupon 롤백
 * ⚠️ 옛 주석 "PayPal plan_issued_orders 마킹은 plan 저장 후" 는 **폐기된 설계**다. 그 지연 마킹이
 *    비원자 read-then-pass 라 동시 요청 둘이 모두 통과할 수 있었다 → 게이트 원자 선점 + 해제로 대체.
 */
import { dietaryEvidenceFor } from '../_shared/dietary-trust.js';
import { isRowCityConsistent } from '../_shared/food-row-provenance.js';
import { resolveCityCode, getFoodContext } from '../_food_helper.js';
import { resolveUiCityKey } from '../_shared/cityResolver.js';

const SAFETY_DIETS = ['halal', 'vegan', 'vegetarian'];
const CANONICAL_DIET = { halal: 'Halal', vegan: 'Vegan', vegetarian: 'Vegetarian' };

export const hasSafetyDiet = (dietaryAll) => (dietaryAll || []).some((d) => SAFETY_DIETS.includes(String(d).toLowerCase()));
/** 요청된 안전 식이(소문자, 중복 제거). */
const safetyDietsOf = (dietaryAll) => [...new Set((dietaryAll || []).map((d) => String(d).toLowerCase()).filter((d) => SAFETY_DIETS.includes(d)))];

// 식이 요청의 도시 키 — 위자드는 번역 도시명(ソウル·首尔·서울…)을 regions 로 보낸다 → UI 도시 SSOT(resolveUiCityKey,
// ko/en/ja/zh 별칭)로 정규화. 별칭에 없는 도시는 소문자 원문 그대로(서울로 바꾸지 않는다 — 아래 검사가 차단).
// 공용 목록 resolver(resolveCityCode)가 다른 도시로 묶는 도시(인천·수원 → seoul)는 그 도시 목록을 만들 수 없으므로
// 사전 검사와 목록 주입 모두 차단한다(listUnavailable).
function mealCityCode(token) {
  const t = String(token || '').toLowerCase().trim();
  return resolveUiCityKey(t) || t;
}
const listUnavailable = (city) => resolveCityCode(city) !== city;

/**
 * 2026-10-24 (식이 준수 P1): 이 여행에서 **식사하는 도시** 집합 — 사전 커버리지 검사와 식당 목록 주입이 같은 집합을 쓴다.
 * = regions(없으면 area) + 명시된 입국·출국 도시. 공항 코드만으로 도시를 추가하지 않는다(ICN 도착 ≠ 서울 식사).
 * 빈 값은 건너뛴다(resolveCityCode('') 는 seoul 폴백이라 그대로 넣으면 서울이 끼어든다). 인천·수원 등은 서울로 바꾸지 않는다.
 * @returns {string[]} _food_index city 코드, 입력 순서 유지·중복 제거
 */
export function mealCitiesForTrip({ regions, area, arrivalCity, departureCity }) {
  const base = Array.isArray(regions) && regions.length ? regions : [area];
  const named = [...base, arrivalCity, departureCity].filter((c) => typeof c === 'string' && c.trim());
  return [...new Set(named.map((c) => mealCityCode(c)))];
}

/**
 * 2026-10-24 (r1): 도시마다 **요청 식이 전부를 한 행이 동시에** 만족하는 trusted 후보가 1곳 이상이어야 통과
 * (예: Halal+Vegan 서울 — 각각은 있어도 교집합 0 이면 차단). 판정 SSOT = dietaryEvidenceFor(신뢰 등급·vegan⊇vegetarian).
 * @throws {Error & {code: 'DIETARY_COVERAGE_UNAVAILABLE', statusCode: 422}}
 */
export function enforceDietaryCoverage({ foodIndex, regions, area, dietaryAll, arrivalCity, departureCity }) {
  const diets = safetyDietsOf(dietaryAll);
  if (diets.length === 0) return;
  const cities = mealCitiesForTrip({ regions, area, arrivalCity, departureCity });
  const missing = cities.filter((city) => listUnavailable(city) || !(foodIndex || []).some((r) => r && r.city === city
    && isRowCityConsistent(r) && diets.every((d) => dietaryEvidenceFor(r, d))));
  if (missing.length === 0) return;
  throw coverageUnavailableError(dietaryAll, missing.map((c) => `${c}:${diets.join('+')}`).join(', '));
}

/** 식이 값 표기 정규화 — 'halal' 도 'Halal' 로(목록 함수가 대소문자를 구분해 소문자면 일반 목록이 됐다). */
export function canonicalDietPrefs(dietaryAll) {
  return (Array.isArray(dietaryAll) ? dietaryAll : []).map((d) => CANONICAL_DIET[String(d).toLowerCase()] || d);
}

/**
 * 2026-10-24 (식이 준수 P1): 식사 도시마다 식당 목록을 만든다. 식이 요청에서 어느 도시든 목록이 비거나 만들다
 * 실패하면 **모델 호출 전에** DIETARY_COVERAGE_UNAVAILABLE(422) — 목록 없는 도시는 모델이 지어내게 된다.
 * 비식이 요청은 기존 단일 도시 주입 그대로(첫 도시 = area 와 같은 결과), 실패는 빈 문자열.
 * @param {{cities: string[], area: string, dietaryAll: string[], priceRange: string, maxItems: number, getContext?: Function}} a
 * @returns {string}
 */
export function buildTripFoodContext({ cities, area, dietaryAll, priceRange, maxItems, getContext = getFoodContext }) {
  if (!hasSafetyDiet(dietaryAll)) {
    try { return getContext(area, dietaryAll, priceRange, maxItems) || ''; } catch (err) {
      console.warn('[ai-planner-full] getFoodContext failed:', err && err.message);
      return '';
    }
  }
  const prefs = canonicalDietPrefs(dietaryAll);
  const parts = [];
  const empty = [];
  for (const city of cities) {
    // 목록 함수는 도시를 다시 resolve 한다 — 다른 도시 목록(예: incheon → seoul)이 될 도시는 목록 없음으로 차단.
    if (listUnavailable(city)) { empty.push(city); continue; }
    let ctx = '';
    try { ctx = getContext(city, prefs, priceRange, maxItems) || ''; } catch (err) {
      console.warn('[ai-planner-full] getFoodContext failed for', city, err && err.message);
    }
    if (ctx) parts.push(ctx); else empty.push(city);
  }
  if (empty.length) {
    const diets = safetyDietsOf(dietaryAll);
    throw coverageUnavailableError(dietaryAll, empty.map((c) => `${c}:${diets.join('+')}`).join(', '));
  }
  return parts.join('');
}

function coverageUnavailableError(dietaryAll, missTxt) {
  console.warn('[ai-planner-full] DIETARY_COVERAGE_UNAVAILABLE —', missTxt);
  const e = new Error(
    'We do not yet have independently verified ' +
    (dietaryAll || []).join('/') + ' restaurants for this destination (' + missTxt + '). ' +
    'To keep you safe we did not generate a plan and nothing was charged against your plan credit. ' +
    'Please contact us via WhatsApp for an operator-verified custom itinerary, or choose Seoul/Busan.'
  );
  e.code = 'DIETARY_COVERAGE_UNAVAILABLE';
  e.statusCode = 422;
  e.details = missTxt; // 도시:식이 목록 (예: "seoul:halal")
  return e;
}
