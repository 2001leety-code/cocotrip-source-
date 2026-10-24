/**
 * llm-compare 무료 반복 루프 + 공용 입력·판정 (2026-10-24, O7 → 분리).
 *
 * - SCENARIOS        : 비교 시나리오(식이 4종). 정적 — api 모듈을 정적으로 import 하지 않는다(CLI 의 조기 종료가
 *                      api import 전에 끝나야 해서). api 의존은 loadCompareDeps() 가 동적으로 불러온다.
 * - buildScenarioInputs / judgePlanInto : 유료 경로(llm-compare-providers.mjs callOne)와 무료 경로가 같은 것을 쓴다.
 * - runDumpPrompts / runJudgePlan       : 모델 호출 0 · 키 불필요. 결과 객체 + exitCode 를 돌려주고 process.exit 는
 *                      CLI 만 한다(테스트는 in-process 로 부른다 — 오프라인 guard 는 child_process 를 막는다).
 *   둘 다 실행 동안 LLM_COMPARE_OFFLINE=1 (검증기 알림 경로 → 로그만) 을 세우고 끝나면 원래 값으로 돌린다.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateCompareRun, formatOutcome, foodNameCompliance } from './llm-compare-outcome.mjs';

// 2026-10-24 (식이 준수 P4, Astra dietary-adherence r1 E): 식이 4개 시나리오 — 전부 식이.
//   busan-halal-local  = 부산만(PUS→PUS) — 서울 구간 없이 부산 목록만으로 준수하는지
//   seoul-busan-halal  = regions [seoul,busan], ICN 입국(서울)→PUS 출국(부산) — 두 도시 목록 사용
//   seoul-ja           = Vegetarian·일본어 — 원문 이름 복사 vs 쉼표 앞 별칭 구분
//   jeju-vegan         = CJU→CJU 14:00/10:00 — 출국일 조식 부족을 미충족으로 남기는지
// 2026-10-24 (출국 11:00 전 식당 조식 면제): busan-halal-local 은 15:00 출국(조식 또는 점심 경로), seoul-busan-halal·
//   jeju-vegan 은 10:00 유지(면제 + 체크아웃 tip 안내 경로).
// regions·입출국 도시는 요청(shapeRequest)·식당 목록(운영 buildTripFoodContext)·검증기에 같이 들어간다.
export const SCENARIOS = {
  'busan-halal-local': { area: 'busan', regions: ['busan'], durationDays: 3, pax: 4, dietPrefs: ['Halal'], priceRange: 'Moderate', language: 'en', arrivalTime: '14:00', departureTime: '15:00', arrival_airport: 'PUS', departure_airport: 'PUS' },
  'seoul-busan-halal': { area: 'seoul', regions: ['seoul', 'busan'], durationDays: 4, pax: 2, dietPrefs: ['Halal'], priceRange: 'Moderate', language: 'en', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'ICN_T1', departure_airport: 'PUS', arrivalCity: 'seoul', departureCity: 'busan' },
  'seoul-ja':          { area: 'seoul', regions: ['seoul'], durationDays: 3, pax: 2, dietPrefs: ['Vegetarian'], priceRange: 'Moderate', language: 'ja' },
  'jeju-vegan':        { area: 'jeju', regions: ['jeju'], durationDays: 2, pax: 2, dietPrefs: ['Vegan'], priceRange: 'Budget', language: 'en', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'CJU', departure_airport: 'CJU' },
};

const LANG_RE = { ko: /[가-힣]/, en: /[A-Za-z]{3,}/, ja: /[぀-ヿ]/, zh: /[一-鿿]/ };

let depsPromise = null;
/** 운영 모듈(프롬프트·목록·검증기)을 한 번만 동적으로 불러온다. */
export function loadCompareDeps() {
  if (!depsPromise) {
    depsPromise = (async () => {
      const { buildSystemPrompt } = await import('../../api/_ai_core/buildPrompt.js');
      const { buildUserMessage } = await import('../../api/_ai_core/userMessageBuilder.js');
      const { shapeRequest } = await import('../../api/_ai_core/requestShaper.js');
      const { getSpotContext } = await import('../../api/_spots_helper.js');
      const { mealCitiesForTrip, buildTripFoodContext, enforceDietaryCoverage } = await import('../../api/_ai_core/dietaryCoverageGate.js');
      const { findSelectedFoodRow } = await import('../../api/_shared/food-name-match.js');
      const { getAttractionsContext } = await import('../../api/_attractions_helper.js');
      const gp = await import('../../api/_ai_core/geminiPipeline.js');
      const { repairAndParseJSON, validateResponse, validatePatternStructure, hasCriticalDietaryViolation } = await import('../../api/_ai_core/responseValidator.js');
      const { runDuplicateStopGate } = await import('../../api/_ai_core/finalItineraryGate.js');
      const foodIndex = await gp.loadFoodIndex(); // 운영 사전 검사(enforceDietaryCoverage)·판정과 같은 입력
      return {
        buildSystemPrompt, buildUserMessage, shapeRequest, getSpotContext, mealCitiesForTrip, buildTripFoodContext, enforceDietaryCoverage,
        findSelectedFoodRow, getAttractionsContext, gp, repairAndParseJSON, validateResponse, validatePatternStructure,
        hasCriticalDietaryViolation, runDuplicateStopGate, foodIndex,
      };
    })();
  }
  return depsPromise;
}

/** 시나리오 → 운영과 같은 요청 정규화·식사 도시·사전 검사·도시별 목록·프롬프트. 목록이 비면 throw(운영과 같이 생성 전 422). */
export function buildScenarioInputs(key, d) {
  const s = SCENARIOS[key];
  // startDate = 여행 1일차(inclusive); 일정은 startDate 부터 durationDays 일간 (끝날 포함).
  const startDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const body = {
    guestName: 'Compare-Test', pax: s.pax, styles: ['Food', 'Culture'], area: s.area, durationDays: s.durationDays,
    duration: `${s.durationDays}day`, startDate, language: s.language, dietPrefs: s.dietPrefs, priceRange: s.priceRange,
    arrivalTime: s.arrivalTime, departureTime: s.departureTime, arrival_airport: s.arrival_airport, departure_airport: s.departure_airport,
    regions: s.regions, arrival_city: s.arrivalCity, departure_city: s.departureCity,
    vehicle: 'public', mobility: 'walking', email: 'compare@example.com',
  };
  const shaped = d.shapeRequest(body, body.email, false, null);
  const dietaryAll = [...new Set([...(shaped.dietPrefs || []), ...(shaped.dietaryRestrictions || [])])].filter((x) => x && x !== 'None');
  let spotContext = ''; try { spotContext = d.getSpotContext(s.area, 6) || ''; } catch { /* ignore */ }
  // 운영(handlerCore)과 같은 식사 도시 집합·도시별 목록.
  const mealCities = d.mealCitiesForTrip({ regions: shaped.regions, area: shaped.area, arrivalCity: shaped.arrivalCity, departureCity: shaped.departureCity });
  d.enforceDietaryCoverage({ foodIndex: d.foodIndex, regions: shaped.regions, area: shaped.area, dietaryAll, arrivalCity: shaped.arrivalCity, departureCity: shaped.departureCity });
  const foodContext = d.buildTripFoodContext({ cities: mealCities, area: shaped.area, dietaryAll, priceRange: s.priceRange, maxItems: Math.min(40, Math.max(10, s.durationDays * 4)) });
  let attractionsContext = ''; try { attractionsContext = d.getAttractionsContext({ city: s.area, styles: body.styles, language: s.language, maxLocations: 6 }) || ''; } catch { /* ignore */ }
  const userMessage = d.buildUserMessage({ shaped, body, spotContext, foodContext, attractionsContext, mountainContext: '', runningContext: '' });
  return { id: key, s, body, shaped, dietaryAll, mealCities, systemPrompt: d.buildSystemPrompt(s.language), userMessage };
}

export const scenarioLabel = (p) => p.s.area + '-' + p.s.durationDays + 'd-' + p.s.dietPrefs[0] + '-' + p.s.language;

/** 응답 원문 → 판정 필드 (유료 callOne 과 무료 --judge-plan 이 같은 판정기). 펜스·잡음은 repairAndParseJSON 이 처리. */
export function judgePlanInto(row, raw, p, d) {
  row.chars = raw.length;
  const plan = d.repairAndParseJSON(raw);
  row.parsed = !!plan && !plan.__repair_minimal_fallback;
  row.requiredKeys = ['days', 'arrival_guide', 'departure_guide'].filter((k) => !(plan && plan[k]));
  row.days = plan?.days?.length || 0;
  row.daysMatch = row.days === p.s.durationDays;
  row.stopsPerDay = (plan?.days || []).map((x) => (x.stops || []).length);
  row.foodPerDay = (plan?.days || []).map((x) => (x.stops || []).filter((y) => y.category === 'food').length);
  // 도착·출국 시각·공항 = 시나리오 값 그대로(없으면 미전달 → 검증기 기본 규칙). B-MEAL 출국일 규칙이 departureTime 을 본다.
  // regions 는 요청과 같은 값(단일 도시 고정 아님).
  const trip = { arrivalTime: p.s.arrivalTime, departureTime: p.s.departureTime, arrival_airport: p.s.arrival_airport, departure_airport: p.s.departure_airport };
  const regions = p.shaped.regions && p.shaped.regions.length ? p.shaped.regions : [p.s.area];
  row.structureErrors = d.validatePatternStructure(plan, { durationDays: p.s.durationDays, regions, area: p.s.area, ...trip });
  // 필수 끼니 = validatePatternStructure 의 B-MEAL 결과. 검사가 꺼져 있으면(VALIDATOR_BMEAL_ENABLED=false) checked:false → 판정 실패.
  row.mealCoverage = { checked: process.env.VALIDATOR_BMEAL_ENABLED !== 'false', missing: row.structureErrors.filter((e) => /\(B-MEAL/.test(String(e))) };
  const gate = d.runDuplicateStopGate(plan);
  row.duplicateStops = gate.duplicates.length;
  row.duplicateStopNames = gate.duplicates.map((x) => `${x.name}×${x.count}`);
  const issues = d.validateResponse(plan, { dietary: p.dietaryAll, language: p.s.language, area: p.s.area, regions, ...trip }, d.foodIndex);
  row.dietaryCritical = d.hasCriticalDietaryViolation(issues);
  row.dietaryViolations = issues.filter((i) => i && i.type === 'dietary_violation' && i.severity === 'critical').length;
  // 이름 준수(정확 / 별칭으로만 회복 / 못 찾음) — 별칭 회복은 통과지만 원문 복사 실패로 따로 센다.
  row.nameCompliance = foodNameCompliance(plan, d.foodIndex, p.s.area, d.findSelectedFoodRow);
  row.unverifiedRestaurants = issues.filter((i) => i.type === 'unverified_restaurant').length;
  const sample = [plan?.tour_title, ...(plan?.days || []).map((x) => x.theme), ...(plan?.days || []).flatMap((x) => (x.stops || []).map((y) => y.tip))].filter(Boolean).join(' ');
  row.languageOk = LANG_RE[p.s.language].test(sample);
  row.titleSample = String(plan?.tour_title || '').slice(0, 60);
  row.plan = plan;
}

async function offline(fn) {
  const prev = process.env.LLM_COMPARE_OFFLINE;
  process.env.LLM_COMPARE_OFFLINE = '1';
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.LLM_COMPARE_OFFLINE; else process.env.LLM_COMPARE_OFFLINE = prev;
  }
}

const badScenarios = (ids) => !ids.length || ids.some((id) => !Object.prototype.hasOwnProperty.call(SCENARIOS, id)) || new Set(ids).size !== ids.length;

/**
 * 운영과 같은 system prompt·user message(도시별 신뢰 목록 포함)를 파일로 — 서브에이전트가 같은 입력으로 답하게.
 * @returns {Promise<{exitCode: number, files?: string[], manifest?: object, message: string}>}
 */
export function runDumpPrompts({ dir, scenarios = Object.keys(SCENARIOS) }) {
  return offline(async () => {
    if (badScenarios(scenarios)) return { exitCode: 5, message: `[compare] --scenarios 불량. 허용: ${Object.keys(SCENARIOS).join(',')}` };
    const d = await loadCompareDeps();
    mkdirSync(dir, { recursive: true });
    const manifest = { generatedAt: new Date().toISOString(), scenarios: {} };
    const files = [];
    for (const id of scenarios) {
      const p = buildScenarioInputs(id, d);
      writeFileSync(join(dir, `${id}.system.txt`), p.systemPrompt);
      writeFileSync(join(dir, `${id}.user.txt`), p.userMessage);
      files.push(`${id}.system.txt`, `${id}.user.txt`);
      manifest.scenarios[id] = {
        area: p.s.area, regions: p.shaped.regions, mealCities: p.mealCities,
        arrival_airport: p.s.arrival_airport, departure_airport: p.s.departure_airport,
        arrivalTime: p.s.arrivalTime, departureTime: p.s.departureTime, arrivalCity: p.s.arrivalCity, departureCity: p.s.departureCity,
        durationDays: p.s.durationDays, dietary: p.dietaryAll, language: p.s.language,
        systemFile: `${id}.system.txt`, userFile: `${id}.user.txt`,
      };
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    files.push('manifest.json');
    return { exitCode: 0, files, manifest, message: `[compare] dump-prompts: ${scenarios.length} scenarios → ${dir} (model calls 0)` };
  });
}

/**
 * 저장된 플랜(모델 응답 원문 또는 객체 JSON, 마크다운 펜스 허용)을 유료 경로와 같은 판정기로 — 행 1개(provider 'subagent').
 * text 를 주면 file 대신 그 문자열을 채점한다. exitCode: 판정 규칙(0/1), 시나리오 불량 5, 파일 못 읽음 4.
 * @returns {Promise<{exitCode: number, row?: object, outcome?: object, lines: string[]}>}
 */
export function runJudgePlan({ file, text, scenarioId }) {
  return offline(async () => {
    if (!scenarioId || badScenarios([scenarioId])) {
      return { exitCode: 5, lines: [`[compare] --judge-plan 은 --scenario=<id> 하나가 필요합니다. 허용: ${Object.keys(SCENARIOS).join(',')}`] };
    }
    let raw = typeof text === 'string' ? text : null;
    if (raw === null) {
      try { raw = readFileSync(String(file), 'utf8'); } catch (e) {
        return { exitCode: 4, lines: [`[compare] --judge-plan 입력을 읽지 못했습니다: ${e && e.message}`] };
      }
    }
    const d = await loadCompareDeps();
    const p = buildScenarioInputs(scenarioId, d);
    const row = { scenarioId: p.id, scenario: scenarioLabel(p), provider: 'subagent', providerActual: 'subagent', fallback: false, model: 'subagent', usd: 0, usdUnknown: false };
    try { judgePlanInto(row, raw.trim(), p, d); } catch (e) {
      row.error = String(e && e.message || e).slice(0, 300); // 자료형이 깨진 플랜 등 — 판정 실패로 남긴다
    }
    const outcome = evaluateCompareRun({ providers: ['subagent'], expectedScenarios: [scenarioId], results: [row] });
    const { plan, ...summary } = row;
    return { exitCode: outcome.exitCode, row: summary, outcome, lines: [JSON.stringify(summary), formatOutcome(outcome)] };
  });
}
