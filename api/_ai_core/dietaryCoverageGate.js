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
import { checkDietaryCoverage } from '../_shared/dietary-trust.js';
import { resolveCityCode } from '../_food_helper.js';

const SAFETY_DIETS = ['halal', 'vegan', 'vegetarian'];

/**
 * @throws {Error & {code: 'DIETARY_COVERAGE_UNAVAILABLE', statusCode: 422}}
 */
export function enforceDietaryCoverage({ foodIndex, regions, area, dietaryAll }) {
  const hasSafety = (dietaryAll || []).some((d) => SAFETY_DIETS.includes(String(d).toLowerCase()));
  if (!hasSafety) return;
  const cities = [...new Set(((Array.isArray(regions) && regions.length ? regions : [area]) || [])
    .map((c) => resolveCityCode(c)))];
  const cov = checkDietaryCoverage(foodIndex, cities, dietaryAll);
  if (cov.ok) return;
  const missTxt = cov.missing.map((m) => `${m.city}:${m.diet}`).join(', ');
  console.warn('[ai-planner-full] DIETARY_COVERAGE_UNAVAILABLE —', missTxt);
  const e = new Error(
    'We do not yet have independently verified ' +
    (dietaryAll || []).join('/') + ' restaurants for this destination (' + missTxt + '). ' +
    'To keep you safe we did not generate a plan and nothing was charged against your plan credit. ' +
    'Please contact us via WhatsApp for an operator-verified custom itinerary, or choose Seoul/Busan.'
  );
  e.code = 'DIETARY_COVERAGE_UNAVAILABLE';
  e.statusCode = 422;
  throw e;
}
