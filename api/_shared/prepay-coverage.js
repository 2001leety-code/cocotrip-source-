/**
 * 2026-10-26 B6 1단계 — AI 플래너 결제 전 식이 커버리지 서버 확인(Astra 설계 (a), 운영자 승인 "남은것들도 진행").
 *
 * 문제: 식이 커버리지 게이트(dietaryCoverageGate.enforceDietaryCoverage)는 ai-planner-full 의 **결제 뒤**라,
 *   유료 손님이 결제한 다음 422(자동 환불 아님)를 받았다. 무료 미리보기는 입국/첫 도시 하나만 검사해 못 막았다
 *   (예: 서울+인천 할랄 → 미리보기 통과, 결제 후 422).
 *
 * 계약:
 *   - createPaypalOrder(ai_planner_full)는 플래너 입력을 **서버가 다시 정규화**(requestShaper·plannerIntentV1 규칙 재사용)
 *     → 같은 게이트로 검사 → 실패면 PayPal 주문을 만들지 않는다(422). 통과면 정규 입력·버전·지문·검사 시각을 주문
 *     snapshot 에 저장한다(클라 입력을 그대로 신뢰하지 않는다).
 *   - capturePaypalOrder 는 **새 capture POST 직전** 저장 입력으로 재검사(주문 후 자료 변경 대비).
 *   - ai-planner-full 은 쿠폰 소비·수정 차감·발급권 선점 **전에** 커버리지와 지문(요청 == snapshot)을 확인한다.
 *
 * 순수(입력 → 값) + 주입 가능한 foodIndex. Firestore·PayPal·LLM 호출 없음.
 */
import { createHash } from 'crypto';
import { shapeRequest } from '../_ai_core/requestShaper.js';
import { mealCitiesForTrip, mealCityCode, enforceDietaryCoverage } from '../_ai_core/dietaryCoverageGate.js';
import { checkStartDateTooSoon } from '../_ai_core/validateStartDate.js';

export const PREPAY_INPUT_VERSION = 1;
const SAFETY_DIETS = new Set(['halal', 'vegan', 'vegetarian']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 결제 전 검사 대상 상품 — ai-planner-policy.isAiPlannerFullProduct 와 같은 규칙(정확히 ai_planner_full, 하이픈 허용). */
export function isPrepayCheckedProduct(productType) {
  return typeof productType === 'string' && productType.toLowerCase().replace(/-/g, '_') === 'ai_planner_full';
}

/** 400/409/422 류 거부 — { status, code, message, details? } */
export function prepayRejection(status, code, message, details) {
  return { ok: false, status, code, message, ...(details ? { details } : {}) };
}

const safetyDiets = (list) => [...new Set((Array.isArray(list) ? list : [])
  .map((d) => String(d || '').trim().toLowerCase()).filter((d) => SAFETY_DIETS.has(d)))].sort();
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * 플래너 입력 → 서버 정규 커버리지 입력. 새 주문에서 필드 누락·잘못된 값·유효 도시 0·flat/v1 충돌은 거부한다.
 *   도시: requestShaper(regions/region/area/destination 별칭) → mealCitiesForTrip(ko/en/ja/zh 도시명, 명시 입·출국 도시)
 *   식이: dietPrefs ∪ dietaryRestrictions(옛 allergies 별칭은 requestShaper 규칙 그대로) 중 안전 식이만, 소문자 정렬.
 *   날짜: startDate(또는 date) YYYY-MM-DD + durationDays 정수 ≥1 — 명시 필수(기본값 '오늘' 금지: 지문이 날짜마다 바뀐다).
 *   날짜 범위 규칙: startDate 는 여행 첫날(inclusive), 마지막 날 = startDate + durationDays − 1(inclusive) — endDate(exclusive) 는 쓰지 않는다.
 *   requireFutureStart: 돈이 움직이기 전(주문 생성·QR 안내) 에만 — 출발일 > KST 오늘(생성 단계 checkStartDateTooSoon 과 같은 함수).
 *     결제 뒤 대조(paymentGate)에는 쓰지 않는다 — 결제된 주문을 날짜 경과로 막지 않는다.
 * @param {unknown} raw  위자드 값(서버가 다시 정규화) 또는 ai-planner-full 요청 body
 * @param {{requireFutureStart?: boolean}} [opts]
 * @returns {{ok: true, input: object} | ReturnType<typeof prepayRejection>}
 */
export function normalizePrepayInput(raw, { requireFutureStart = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return prepayRejection(400, 'PREPAY_INPUT_MISSING', 'Planner input is required for this order');
  }
  const hasCity = (Array.isArray(raw.regions) && raw.regions.some(hasText)) || hasText(raw.region) || hasText(raw.area) || hasText(raw.destination);
  if (!hasCity) return prepayRejection(400, 'PREPAY_CITIES_MISSING', 'Planner input has no destination city');
  if (!Array.isArray(raw.dietaryRestrictions) && !Array.isArray(raw.allergies)) {
    // 누락 ≠ "제한 없음"(dietary-safety.md) — 새 주문은 명시 배열(빈 배열 허용)을 요구한다.
    return prepayRejection(400, 'PREPAY_DIETARY_MISSING', 'Planner input must state dietary restrictions (empty list for none)');
  }
  // 날짜 원천 하나 — requestShaper·checkStartDateTooSoon 과 같은 우선순위(date → startDate). 둘 다 있고 다르면 거부(r3):
  //   검사한 날짜와 저장·지문·생성에 쓰이는 날짜가 갈라지는 우회를 막는다.
  if (hasText(raw.date) && hasText(raw.startDate) && raw.date.trim() !== raw.startDate.trim()) {
    return prepayRejection(400, 'PLANNER_INPUT_CONFLICT', 'Planner start date disagrees between request fields', `date=${raw.date} startDate=${raw.startDate}`);
  }
  const startDate = hasText(raw.date) ? raw.date.trim() : (hasText(raw.startDate) ? raw.startDate.trim() : '');
  const durationDays = Number(raw.durationDays);
  if (!DATE_RE.test(startDate) || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30) {
    return prepayRejection(400, 'PREPAY_DATES_MISSING', 'Planner input must include startDate (YYYY-MM-DD) and durationDays');
  }
  const tooSoon = requireFutureStart ? startDateTooSoon(startDate) : null;
  if (tooSoon) {
    return prepayRejection(400, 'PLANNER_DATE_TOO_SOON', 'Start date must be tomorrow or later', `Requested: ${tooSoon.reqStartDate}, today KST: ${tooSoon.todayKST}`);
  }
  let shaped;
  try {
    shaped = shapeRequest({ ...raw, date: startDate, startDate, durationDays }, null, false, null);
  } catch (err) {
    return prepayRejection(400, 'PREPAY_INPUT_INVALID', 'Planner input is invalid', String(err && (err.code || err.message) || 'invalid'));
  }
  const cities = mealCitiesForTrip({ regions: shaped.regions, area: shaped.area, arrivalCity: shaped.arrivalCity, departureCity: shaped.departureCity });
  if (cities.length === 0) return prepayRejection(400, 'PREPAY_CITIES_MISSING', 'Planner input has no destination city');
  const diets = safetyDiets([...(shaped.dietPrefs || []), ...(shaped.dietaryRestrictions || [])]);

  // flat 입력과 planner_intent_v1 이 다른 도시·식이를 들고 오면 거부 — 검사·지문·생성이 서로 다른 값을 보게 된다.
  if (raw.planner_intent_v1 && typeof raw.planner_intent_v1 === 'object') {
    const intent = shaped.plannerIntent || {};
    if (Array.isArray(intent.cityKeys) && intent.cityKeys.length) {
      const v1Cities = mealCitiesForTrip({ regions: intent.cityKeys, area: shaped.area, arrivalCity: intent.arrivalCityKey, departureCity: intent.departureCityKey });
      if (!sameSet(v1Cities, cities)) {
        return prepayRejection(400, 'PLANNER_INPUT_CONFLICT', 'Planner cities disagree between request fields', `flat=${cities.join(',')} v1=${v1Cities.join(',')}`);
      }
    }
    const v1Diets = safetyDiets([...(intent.foodStyles || []), ...(intent.dietaryRestrictions || [])]);
    if (!sameSet(v1Diets, diets)) {
      return prepayRejection(400, 'PLANNER_INPUT_CONFLICT', 'Planner dietary needs disagree between request fields', `flat=${diets.join('+') || 'none'} v1=${v1Diets.join('+') || 'none'}`);
    }
  }
  const cityKey = (c) => (hasText(c) ? mealCityCode(c) : '');
  return {
    ok: true,
    input: {
      version: PREPAY_INPUT_VERSION, cities, diets, startDate: shaped.startDate, durationDays: Number(shaped.durationDays),
      arrivalCity: cityKey(shaped.arrivalCity), departureCity: cityKey(shaped.departureCity),
      area: String(shaped.area || '').trim().toLowerCase(),
      // 지문 밖 — '결제한 조건으로 다시 만들기' 가 위자드 도시 이름·순서(regions)와 여행 도시 키(regionCities, 입·출국
      //   도시 제외)를 그대로 되살리는 데만 쓴다.
      regions: (shaped.regions || []).map((r) => String(r).trim()),
      regionCities: mealCitiesForTrip({ regions: shaped.regions, area: shaped.area }),
    },
  };
}

/** 주문 생성·QR 안내 공통: 정규화(출발일 > KST 오늘 포함) + 커버리지. 돈이 움직이기 전 거부 = 재시도 안전. */
export function checkPlannerOrderInput(raw, foodIndex) {
  const normalized = normalizePrepayInput(raw, { requireFutureStart: true });
  if (!normalized.ok) return normalized;
  const coverage = checkPrepayCoverage(normalized.input, foodIndex);
  return coverage.ok ? normalized : coverage;
}

/** 출발일 규칙 — 생성 단계(handlerCore)와 같은 함수. null = 통과. */
export function startDateTooSoon(startDate) {
  return checkStartDateTooSoon({ startDate }, false);
}

/**
 * 정규 입력의 서버 지문 — 키 순서 고정 JSON 의 sha256. 도시는 정렬·중복 제거 집합(위자드 순서가 바뀌어도 같은 여행),
 * 입·출국 도시 키·area 키·식이(정렬)·날짜·일수는 고정 항목. regions(표시용 이름)는 넣지 않는다.
 */
export function prepayFingerprint(input) {
  const stable = JSON.stringify({
    version: input.version, cities: [...new Set(input.cities)].sort(),
    arrivalCity: input.arrivalCity || '', departureCity: input.departureCity || '', area: input.area || '',
    diets: [...input.diets].sort(), startDate: input.startDate, durationDays: input.durationDays,
  });
  return `sha256:${createHash('sha256').update(stable).digest('hex')}`;
}

/** 결제 주문에 고정된 입력 요약(409 응답·복구 UI) — 버전 필드 제외, 값 그대로. */
export function prepayInputSummary(input) {
  if (!input || typeof input !== 'object') return null;
  const summary = { ...input };
  delete summary.version;
  return summary;
}

/**
 * 커버리지 판정 — 생성 단계와 같은 게이트(enforceDietaryCoverage — 신뢰 등급 SSOT dietaryEvidenceFor). 기준 완화 없음.
 * @returns {{ok: true} | ReturnType<typeof prepayRejection>}
 */
export function checkPrepayCoverage(input, foodIndex) {
  try {
    enforceDietaryCoverage({ foodIndex, regions: input.cities, area: input.cities[0], dietaryAll: input.diets, arrivalCity: '', departureCity: '' });
    return { ok: true };
  } catch (err) {
    if (err && err.code === 'DIETARY_COVERAGE_UNAVAILABLE') {
      return prepayRejection(422, 'DIETARY_COVERAGE_UNAVAILABLE', err.message, err.details);
    }
    throw err;
  }
}

/** 실제 식당 DB(생성 단계와 같은 로더). 테스트는 foodIndex 를 직접 넘긴다. */
export async function loadPrepayFoodIndex() {
  const { loadFoodIndex } = await import('../_ai_core/geminiPipeline.js');
  return loadFoodIndex();
}

/** 주문 snapshot 에 저장할 필드(정규 입력 자체·버전·서버 지문·검사 시각·자료 크기). */
export function prepaySnapshotFields(input, foodIndex, nowIso = new Date().toISOString()) {
  return {
    prepayInput: input,
    prepayInputVersion: PREPAY_INPUT_VERSION,
    prepayFingerprint: prepayFingerprint(input),
    prepayCoverageCheckedAt: nowIso,
    prepayFoodIndexRows: Array.isArray(foodIndex) ? foodIndex.length : 0,
  };
}
