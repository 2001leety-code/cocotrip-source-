#!/usr/bin/env node
/**
 * LLM 공급자 비교 하네스 (2026-10-13, Gemini → Claude 전환 4단계 b).
 * 같은 플래너 입력 N개를 두 공급자(gemini / claude)로 **실호출**해 결과를 나란히 평가한다.
 *
 * ⚠️ 유료. 반드시 `--confirm-cost` 를 붙여야 호출한다. 사전 추정 비용이 --max-usd(기본 5) 를 넘으면 중단.
 *
 * 사용:
 *   node --env-file=<GEMINI 키 있는 .env> --env-file=.env.local scripts/llm-compare-providers.mjs --confirm-cost
 *   옵션: --providers=gemini,claude  --scenarios=busan-halal-local,jeju-vegan  --max-usd=5  --out=<json 경로>
 *   --scenarios (2026-10-24, 전부 식이): busan-halal-local(Halal, PUS→PUS) · seoul-busan-halal(Halal, ICN 서울→PUS 부산) ·
 *     seoul-ja(Vegetarian, ja) · jeju-vegan(Vegan, CJU→CJU 14:00/10:00)
 *   판정 요약에 안전 집계(정확 이름 / 별칭으로만 회복 / 이름 못 찾음 / 식이 위반 / 필수끼니 누락)를 따로 낸다.
 *   무료 반복 루프(2026-10-24, 모델 호출 0 · 키·--confirm-cost 불필요):
 *     --dump-prompts=<dir> [--scenarios=…]  운영과 같은 system/user 프롬프트 → <dir>/<id>.system.txt·.user.txt + manifest.json
 *     --judge-plan=<plan.json> --scenario=<id>  저장된 플랜(원문·펜스 허용)을 같은 판정기로 → 행 1개(provider 'subagent') + 종료 코드
 *
 * 평가 항목(계획서 4-b): JSON 파싱 · 필수 키(days/arrival_guide/departure_guide) · 일수 일치 · 구조(B-10/12/14/15,
 *   도착·출국 시각·공항 반영 B-MEAL 포함) · 필수 끼니(mealCoverage) · 종단 중복 게이트(duplicateStops) ·
 *   식이 critical 0 · 언어(ko/en/ja/zh) · 실제 공급자(providerActual — 폴백이면 실패) · 길이(chars) · 토큰/비용/소요시간.
 *
 * 종료 코드 (2026-10-17): 0 = 모든 행 통과 · 1 = 한 공급자라도 실패(호출 에러·구조 오류·폴백 포함) 또는
 *   행/시나리오 누락·중복 · 2 = --confirm-cost 없음 · 3 = 사전 추정 비용이 --max-usd 초과(호출 전) 또는
 *   실제 누적 비용이 --max-usd 초과(매 호출 전 + 최종 저장 전 검사, 결과 JSON 은 저장 — budgetStop·maxUsd 기록.
 *   예외로 비용 불명인 행은 호출 전 예약 비용 usdReserved 로 합산하고 판정 실패) 또는 비용 불명 행 발생
 *   (예외, 또는 mock 아닌 응답의 사용량 누락 — budgetStop.reason='unknown_cost', 남은 호출 0회) ·
 *   4 = --evaluate 입력 파일 불량 · 5 = --scenarios 에 모르는/중복 ID (호출 전 중단).
 *   산출물에 expectedScenarios(실행한 시나리오 ID 목록)와 행별 scenarioId 를 기록한다.
 *   실패해도 결과 JSON 은 먼저 저장한다. 판정 = scripts/integration/llm-compare-outcome.mjs.
 *   --evaluate=<결과 json> : 호출 0회, 저장된 결과만 다시 판정해 같은 종료 코드를 낸다.
 * ⚠️ 누적 상한은 **호출 사이**에서만 검사한다 — 진행 중인 호출 1건(최대 출력 토큰분)만큼은 넘을 수 있다.
 */
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { evaluateCompareRun, formatOutcome, budgetStop, finalizeCompareRun, runCompareCalls, costFieldsFromUsage, foodNameCompliance, OUTCOME_EXIT } from './integration/llm-compare-outcome.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
if (args.evaluate) {
  let saved;
  try { saved = JSON.parse(readFileSync(String(args.evaluate), 'utf8')); } catch (e) {
    console.error(`[compare] --evaluate 입력을 읽지 못했습니다: ${e && e.message}`);
    process.exit(4);
  }
  const outcome = evaluateCompareRun(saved);
  console.log(formatOutcome(outcome));
  process.exit(outcome.exitCode);
}
// 2026-10-24 (O7): 무료 반복 루프 — --dump-prompts(운영과 같은 프롬프트 저장) / --judge-plan(저장된 플랜 판정).
//   둘 다 모델 호출 0 · 키 불필요라 --confirm-cost 를 요구하지 않는다. 유료 경로는 그대로.
const FREE_MODE = Boolean(args['dump-prompts'] || args['judge-plan']);
if (!FREE_MODE && !args['confirm-cost']) {
  console.error('유료 호출입니다. 비용 확인 후 --confirm-cost 를 붙여 다시 실행하세요.');
  process.exit(2);
}
const PROVIDERS = String(args.providers || 'gemini,claude').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_USD = Number(args['max-usd'] || 5);
const FUTURE = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

// 2026-10-24 (식이 준수 P4, Astra dietary-adherence r1 E): 식이 4개 시나리오 — 전부 식이.
//   busan-halal-local  = 부산만(PUS→PUS) — 서울 구간 없이 부산 목록만으로 준수하는지
//   seoul-busan-halal  = regions [seoul,busan], ICN 입국(서울)→PUS 출국(부산) — 두 도시 목록 사용
//   seoul-ja           = Vegetarian·일본어 — 원문 이름 복사 vs 쉼표 앞 별칭 구분
//   jeju-vegan         = CJU→CJU 14:00/10:00 — 출국일 조식 부족을 미충족으로 남기는지
// regions·입출국 도시는 요청(shapeRequest)·식당 목록(운영 buildTripFoodContext)·검증기에 같이 들어간다.
const ALL = {
  'busan-halal-local': { area: 'busan', regions: ['busan'], durationDays: 3, pax: 4, dietPrefs: ['Halal'], priceRange: 'Moderate', language: 'en', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'PUS', departure_airport: 'PUS' },
  'seoul-busan-halal': { area: 'seoul', regions: ['seoul', 'busan'], durationDays: 4, pax: 2, dietPrefs: ['Halal'], priceRange: 'Moderate', language: 'en', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'ICN_T1', departure_airport: 'PUS', arrivalCity: 'seoul', departureCity: 'busan' },
  'seoul-ja':          { area: 'seoul', regions: ['seoul'], durationDays: 3, pax: 2, dietPrefs: ['Vegetarian'], priceRange: 'Moderate', language: 'ja' },
  'jeju-vegan':        { area: 'jeju', regions: ['jeju'], durationDays: 2, pax: 2, dietPrefs: ['Vegan'], priceRange: 'Budget', language: 'en', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'CJU', departure_airport: 'CJU' },
};
// 시나리오 ID = ALL 키. 모르는 ID 를 조용히 버리면 "요청한 시나리오 통째 누락"이 통과로 보인다 → 호출 전 중단.
// --judge-plan 은 --scenario=<id> 한 개.
const REQUESTED = String((args['judge-plan'] ? args.scenario : args.scenarios) || (args['judge-plan'] ? '' : Object.keys(ALL).join(',')))
  .split(',').map((s) => s.trim()).filter(Boolean);
const UNKNOWN = REQUESTED.filter((k) => !Object.prototype.hasOwnProperty.call(ALL, k));
const SCEN = [...new Set(REQUESTED)];
if (!SCEN.length || UNKNOWN.length || SCEN.length !== REQUESTED.length) {
  console.error(`[compare] --scenarios 불량 (unknown=${UNKNOWN.join(',') || '-'} duplicate=${SCEN.length !== REQUESTED.length} empty=${!SCEN.length}). 허용: ${Object.keys(ALL).join(',')}`);
  process.exit(5);
}

const { buildSystemPrompt } = await import('../api/_ai_core/buildPrompt.js');
const { buildUserMessage } = await import('../api/_ai_core/userMessageBuilder.js');
const { shapeRequest } = await import('../api/_ai_core/requestShaper.js');
const { getSpotContext } = await import('../api/_spots_helper.js');
const { mealCitiesForTrip, buildTripFoodContext, enforceDietaryCoverage } = await import('../api/_ai_core/dietaryCoverageGate.js');
const { findSelectedFoodRow } = await import('../api/_shared/food-name-match.js');
const { getAttractionsContext } = await import('../api/_attractions_helper.js');
const gp = await import('../api/_ai_core/geminiPipeline.js');
const { repairAndParseJSON, validateResponse, validatePatternStructure, hasCriticalDietaryViolation } = await import('../api/_ai_core/responseValidator.js');
const { runDuplicateStopGate } = await import('../api/_ai_core/finalItineraryGate.js');
const { runWithLlmContext, resolveLlmModel } = await import('../api/_shared/llm/index.js');
const { estimateGeminiCostUsd } = await import('../api/_shared/apiPricing.js');

const GATE_FOOD_INDEX = await gp.loadFoodIndex(); // 운영 사전 검사(enforceDietaryCoverage)와 같은 입력
const LANG_RE = { ko: /[가-힣]/, en: /[A-Za-z]{3,}/, ja: /[぀-ヿ]/, zh: /[一-鿿]/ };

function buildInputs(key) {
  const s = ALL[key];
  const body = {
    guestName: 'Compare-Test', pax: s.pax, styles: ['Food', 'Culture'], area: s.area, durationDays: s.durationDays,
    duration: `${s.durationDays}day`, startDate: FUTURE, language: s.language, dietPrefs: s.dietPrefs, priceRange: s.priceRange,
    arrivalTime: s.arrivalTime, departureTime: s.departureTime, arrival_airport: s.arrival_airport, departure_airport: s.departure_airport,
    regions: s.regions, arrival_city: s.arrivalCity, departure_city: s.departureCity,
    vehicle: 'public', mobility: 'walking', email: 'compare@example.com',
  };
  const shaped = shapeRequest(body, body.email, false, null);
  const dietaryAll = [...new Set([...(shaped.dietPrefs || []), ...(shaped.dietaryRestrictions || [])])].filter((d) => d && d !== 'None');
  let spotContext = ''; try { spotContext = getSpotContext(s.area, 6) || ''; } catch { /* ignore */ }
  // 운영(handlerCore)과 같은 식사 도시 집합·도시별 목록 — 목록이 비면 여기서 throw(운영과 같이 생성 전 422).
  const mealCities = mealCitiesForTrip({ regions: shaped.regions, area: shaped.area, arrivalCity: shaped.arrivalCity, departureCity: shaped.departureCity });
  enforceDietaryCoverage({ foodIndex: GATE_FOOD_INDEX, regions: shaped.regions, area: shaped.area, dietaryAll, arrivalCity: shaped.arrivalCity, departureCity: shaped.departureCity });
  const foodContext = buildTripFoodContext({ cities: mealCities, area: shaped.area, dietaryAll, priceRange: s.priceRange, maxItems: Math.min(40, Math.max(10, s.durationDays * 4)) });
  let attractionsContext = ''; try { attractionsContext = getAttractionsContext({ city: s.area, styles: body.styles, language: s.language, maxLocations: 6 }) || ''; } catch { /* ignore */ }
  const userMessage = buildUserMessage({ shaped, body, spotContext, foodContext, attractionsContext, mountainContext: '', runningContext: '' });
  return { id: key, s, body, shaped, dietaryAll, mealCities, systemPrompt: buildSystemPrompt(s.language), userMessage };
}

const scenarioLabel = (p) => p.s.area + '-' + p.s.durationDays + 'd-' + p.s.dietPrefs[0] + '-' + p.s.language;

// 응답 원문 → 판정 필드 (유료 callOne 과 무료 --judge-plan 이 같은 판정기를 쓴다). 펜스·잡음은 repairAndParseJSON 이 처리.
async function judgePlanInto(row, raw, p) {
  row.chars = raw.length;
  const plan = repairAndParseJSON(raw);
  row.parsed = !!plan && !plan.__repair_minimal_fallback;
  row.requiredKeys = ['days', 'arrival_guide', 'departure_guide'].filter((k) => !(plan && plan[k]));
  row.days = plan?.days?.length || 0;
  row.daysMatch = row.days === p.s.durationDays;
  row.stopsPerDay = (plan?.days || []).map((d) => (d.stops || []).length);
  row.foodPerDay = (plan?.days || []).map((d) => (d.stops || []).filter((x) => x.category === 'food').length);
  // 도착·출국 시각·공항 = 시나리오 값 그대로(없으면 미전달 → 검증기 기본 규칙). B-MEAL 출국일 규칙이 departureTime 을 본다.
  // regions 는 요청과 같은 값(단일 도시 고정 아님).
  const trip = { arrivalTime: p.s.arrivalTime, departureTime: p.s.departureTime, arrival_airport: p.s.arrival_airport, departure_airport: p.s.departure_airport };
  const regions = p.shaped.regions && p.shaped.regions.length ? p.shaped.regions : [p.s.area];
  row.structureErrors = validatePatternStructure(plan, { durationDays: p.s.durationDays, regions, area: p.s.area, ...trip });
  // 필수 끼니 = validatePatternStructure 의 B-MEAL 결과. 검사가 꺼져 있으면(VALIDATOR_BMEAL_ENABLED=false) checked:false → 판정 실패.
  row.mealCoverage = { checked: process.env.VALIDATOR_BMEAL_ENABLED !== 'false', missing: row.structureErrors.filter((e) => /\(B-MEAL/.test(String(e))) };
  const gate = runDuplicateStopGate(plan);
  row.duplicateStops = gate.duplicates.length;
  row.duplicateStopNames = gate.duplicates.map((d) => `${d.name}×${d.count}`);
  const foodIndex = await gp.loadFoodIndex();
  const issues = validateResponse(plan, { dietary: p.dietaryAll, language: p.s.language, area: p.s.area, regions, ...trip }, foodIndex);
  row.dietaryCritical = hasCriticalDietaryViolation(issues);
  row.dietaryViolations = issues.filter((i) => i && i.type === 'dietary_violation' && i.severity === 'critical').length;
  // 이름 준수(정확 / 별칭으로만 회복 / 못 찾음) — 별칭 회복은 통과지만 원문 복사 실패로 따로 센다.
  row.nameCompliance = foodNameCompliance(plan, foodIndex, p.s.area, findSelectedFoodRow);
  row.unverifiedRestaurants = issues.filter((i) => i.type === 'unverified_restaurant').length;
  const sample = [plan?.tour_title, ...(plan?.days || []).map((d) => d.theme), ...(plan?.days || []).flatMap((d) => (d.stops || []).map((x) => x.tip))].filter(Boolean).join(' ');
  row.languageOk = LANG_RE[p.s.language].test(sample);
  row.titleSample = String(plan?.tour_title || '').slice(0, 60);
  row.plan = plan;
}

// ── 무료 모드 (O7) — 모델 호출 0 ───────────────────────────────────────────
if (args['dump-prompts']) {
  // 운영과 같은 system prompt·user message(도시별 신뢰 목록 포함)를 파일로 — 서브에이전트가 같은 입력으로 답하게.
  const dir = String(args['dump-prompts']);
  mkdirSync(dir, { recursive: true });
  const manifest = { generatedAt: new Date().toISOString(), scenarios: {} };
  for (const id of SCEN) {
    const p = buildInputs(id);
    writeFileSync(join(dir, `${id}.system.txt`), p.systemPrompt);
    writeFileSync(join(dir, `${id}.user.txt`), p.userMessage);
    manifest.scenarios[id] = {
      area: p.s.area, regions: p.shaped.regions, mealCities: p.mealCities,
      arrival_airport: p.s.arrival_airport, departure_airport: p.s.departure_airport,
      arrivalTime: p.s.arrivalTime, departureTime: p.s.departureTime, arrivalCity: p.s.arrivalCity, departureCity: p.s.departureCity,
      durationDays: p.s.durationDays, dietary: p.dietaryAll, language: p.s.language,
      systemFile: `${id}.system.txt`, userFile: `${id}.user.txt`,
    };
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`[compare] dump-prompts: ${SCEN.length} scenarios → ${dir} (model calls 0)`);
  process.exit(0);
}
if (args['judge-plan']) {
  // 저장된 플랜(모델 응답 원문 또는 객체 JSON, 마크다운 펜스 허용)을 유료 경로와 같은 판정기로 — 행 1개(provider 'subagent').
  if (SCEN.length !== 1) {
    console.error(`[compare] --judge-plan 은 --scenario=<id> 하나가 필요합니다. 허용: ${Object.keys(ALL).join(',')}`);
    process.exit(5);
  }
  let raw;
  try { raw = readFileSync(String(args['judge-plan']), 'utf8').trim(); } catch (e) {
    console.error(`[compare] --judge-plan 입력을 읽지 못했습니다: ${e && e.message}`);
    process.exit(4);
  }
  const p = buildInputs(SCEN[0]);
  const row = { scenarioId: p.id, scenario: scenarioLabel(p), provider: 'subagent', providerActual: 'subagent', fallback: false, model: 'subagent', usd: 0, usdUnknown: false };
  try { await judgePlanInto(row, raw, p); } catch (e) {
    row.error = String(e && e.message || e).slice(0, 300); // 자료형이 깨진 플랜 등 — 판정 실패로 남긴다
  }
  const outcome = evaluateCompareRun({ providers: ['subagent'], expectedScenarios: SCEN, results: [row] });
  const { plan, ...summary } = row;
  console.log(JSON.stringify(summary));
  console.log(formatOutcome(outcome));
  process.exit(outcome.exitCode);
}


// 호출 1건 추정 비용 (입력 chars/4 ≈ 토큰, 출력 8K 토큰 가정) — 사전 추정과 행별 예약(usdReserved)이 같은 공식.
// ponytail: 출력 8K 는 상한이 아니라 가정치 — 최대 출력까지 막으려면 모델별 maxOutputTokens 로 바꿀 것.
const estimateCallUsd = (p, model) => estimateGeminiCostUsd(model, { total: Math.ceil((p.systemPrompt.length + p.userMessage.length) / 4), cached: 0, output: 8000 });
let est = 0;
const prepared = SCEN.map(buildInputs);
for (const p of prepared) for (const prov of PROVIDERS) {
  const model = await runWithLlmContext({ provider: prov }, async () => resolveLlmModel('main'));
  est += estimateCallUsd(p, model);
}
console.log(`[compare] scenarios=${SCEN.length} providers=${PROVIDERS.join(',')} 사전 추정 비용 ≈ $${est.toFixed(3)} (상한 $${MAX_USD})`);
if (est > MAX_USD) { console.error('추정 비용이 상한을 넘습니다. 중단.'); process.exit(3); }

// 호출 1건 → 행. 던지지 않는다(예외는 row.error / 비용 불명). 루프·중단 규칙 = runCompareCalls.
async function callOne(p, prov) {
  // scenarioId = 판정 키(ALL 키), scenario = 표시 라벨(기존 산출물 호환).
  const row = { scenarioId: p.id, scenario: scenarioLabel(p), provider: prov };
  try {
    await runWithLlmContext({ provider: prov }, async () => {
      row.model = resolveLlmModel('main');
      const model = gp.buildModel(process.env.GEMINI_API_KEY || 'managed-by-llm-adapter', undefined, {});
      // 호출 직전 보수적 예약 — 예외(타임아웃·연결 끊김)로 실측이 없으면 이 값이 누적에 남는다(0 아님).
      row.usdReserved = +estimateCallUsd(p, row.model).toFixed(4);
      const t0 = performance.now();
      const result = await gp.withTimeout((signal) => model.generateContent({
        contents: [{ role: 'user', parts: [{ text: p.userMessage }] }],
        systemInstruction: { role: 'system', parts: [{ text: p.systemPrompt }] },
      }, { signal }), 240_000, `compare-${prov}`);
      row.ms = Math.round(performance.now() - t0);
      // 어댑터 getter = 첫 호출 뒤 실제 사용 공급자·모델. Claude 초기화 실패 → Gemini 폴백이면 이 행은 비교 오염 → 실패.
      row.providerActual = model.provider;
      row.modelActual = model.modelId;
      row.fallback = row.providerActual !== prov;
      row.finishReason = gp.extractFinishReason(result);
      // 단가 = apiPricing 표(gemini·claude 공용, 미등록 모델은 보수적 기본값) — 실제 모델 기준.
      // 사용량 누락(비 mock)은 $0 확정이 아니라 비용 불명 → runCompareCalls 가 즉시 중단.
      Object.assign(row, costFieldsFromUsage({ providerActual: row.providerActual, modelActual: row.modelActual, usageMetadata: result.response && result.response.usageMetadata, price: estimateGeminiCostUsd }));
      await judgePlanInto(row, gp.extractTextFromResponse(result.response).trim(), p);
    });
  } catch (e) {
    row.error = String(e && e.message || e).slice(0, 300);
    // 실측 전 예외 = 과금 여부 불명 → 판정 실패(cost_unknown), 누적엔 usdReserved 유지. 실측 뒤 예외면 usd 그대로.
    if (typeof row.usd !== 'number') { row.usd = null; row.usdUnknown = true; }
  }
  const { plan, ...summary } = row;
  console.log(JSON.stringify(summary));
  return row;
}

const { results, stopped } = await runCompareCalls({ prepared, providers: PROVIDERS, maxUsd: MAX_USD, callOne });

const out = String(args.out || `scripts/plan-local/outputs/llm-compare-${Date.now()}.json`);
mkdirSync(dirname(out), { recursive: true });
// 마지막 행까지 더한 합을 저장 전에 다시 검사 — 마지막 호출에서 넘어도 exit 3.
const final = finalizeCompareRun({ providers: PROVIDERS, expectedScenarios: SCEN, results, maxUsd: MAX_USD, stopped });
const outcome = final.outcome;
if (final.budgetStop) {
  const b = final.budgetStop;
  console.error(b.reason === 'unknown_cost'
    ? `[compare] ${b.provider} ${b.scenarioId}: 비용 불명(예외 또는 사용량 누락) — 남은 호출 중단, 누적(예약 포함) $${b.spentUsd} (exit ${OUTCOME_EXIT.budget}).`
    : `[compare] 누적 비용(예약 포함) $${b.spentUsd} > 상한 $${MAX_USD} — 중단 (exit ${OUTCOME_EXIT.budget}).`);
}
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), providers: PROVIDERS, expectedScenarios: SCEN, maxUsd: MAX_USD, results, budgetStop: final.budgetStop, outcome }, null, 2));
const spent = budgetStop(results, MAX_USD).spentUsd;
console.log(`\n[compare] 실호출 ${results.filter((r) => !r.error).length}/${results.length} · 누적 비용(불명 행은 예약치) ≈ $${spent.toFixed(4)} · 비용 불명 ${results.filter((r) => r.usdUnknown).length}건 · 저장 ${out}`);
console.log(formatOutcome(outcome));
// 어떤 공급자든 실패하면 0 이 아닌 코드(누적 상한 중단 = 3) — 결과 파일은 위에서 이미 저장됨.
process.exitCode = outcome.exitCode;
