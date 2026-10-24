#!/usr/bin/env node
/**
 * LLM 공급자 비교 하네스 (2026-10-13, Gemini → Claude 전환 4단계 b).
 * 같은 플래너 입력 N개를 두 공급자(gemini / claude)로 **실호출**해 결과를 나란히 평가한다.
 *
 * ⚠️ 유료. 반드시 `--confirm-cost` 를 붙여야 호출한다. 사전 추정 비용이 --max-usd(기본 5) 를 넘으면 중단.
 *
 * 사용:
 *   node --env-file=<GEMINI 키 있는 .env> --env-file=.env.local scripts/llm-compare-providers.mjs --confirm-cost
 *   옵션: --providers=gemini,claude  --scenarios=seoul-meat,jeju-vegan  --max-usd=5  --out=<json 경로>
 *   --scenarios (식이 여부): seoul-meat(비식이) · busan-halal(식이 Halal) · jeju-vegan(식이 Vegan) ·
 *     seoul-ja(식이 Vegetarian) · seoul-zh(비식이)
 *
 * 평가 항목(계획서 4-b): JSON 파싱 · 필수 키(days/arrival_guide/departure_guide) · 일수 일치 · 구조(B-10/12/14/15,
 *   도착·출국 시각·공항 반영 B-MEAL 포함) · 필수 끼니(mealCoverage) · 종단 중복 게이트(duplicateStops) ·
 *   식이 critical 0 · 언어(ko/en/ja/zh) · 실제 공급자(providerActual — 폴백이면 실패) · 길이(chars) · 토큰/비용/소요시간.
 *
 * 종료 코드 (2026-10-17): 0 = 모든 행 통과 · 1 = 한 공급자라도 실패(호출 에러·구조 오류·폴백 포함) 또는
 *   행/시나리오 누락·중복 · 2 = --confirm-cost 없음 · 3 = 사전 추정 비용이 --max-usd 초과(호출 전) 또는
 *   실제 누적 비용이 --max-usd 초과(매 호출 전 + 최종 저장 전 검사, 결과 JSON 은 저장 — budgetStop·maxUsd 기록.
 *   예외로 비용 불명인 행은 호출 전 예약 비용 usdReserved 로 합산하고 판정 실패) ·
 *   4 = --evaluate 입력 파일 불량 · 5 = --scenarios 에 모르는/중복 ID (호출 전 중단).
 *   산출물에 expectedScenarios(실행한 시나리오 ID 목록)와 행별 scenarioId 를 기록한다.
 *   실패해도 결과 JSON 은 먼저 저장한다. 판정 = scripts/integration/llm-compare-outcome.mjs.
 *   --evaluate=<결과 json> : 호출 0회, 저장된 결과만 다시 판정해 같은 종료 코드를 낸다.
 * ⚠️ 누적 상한은 **호출 사이**에서만 검사한다 — 진행 중인 호출 1건(최대 출력 토큰분)만큼은 넘을 수 있다.
 */
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { evaluateCompareRun, formatOutcome, budgetStop, finalizeCompareRun, OUTCOME_EXIT } from './integration/llm-compare-outcome.mjs';

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
if (!args['confirm-cost']) {
  console.error('유료 호출입니다. 비용 확인 후 --confirm-cost 를 붙여 다시 실행하세요.');
  process.exit(2);
}
const PROVIDERS = String(args.providers || 'gemini,claude').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_USD = Number(args['max-usd'] || 5);
const FUTURE = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

// 식이 여부: seoul-meat·seoul-zh = 비식이 / busan-halal·jeju-vegan·seoul-ja(Vegetarian) = 식이.
const ALL = {
  'seoul-meat':  { area: 'seoul', durationDays: 2, pax: 2, dietPrefs: ['Meat'],       priceRange: 'Moderate', language: 'ko', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1' },
  'busan-halal': { area: 'busan', durationDays: 3, pax: 4, dietPrefs: ['Halal'],      priceRange: 'Moderate', language: 'en', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1' },
  'jeju-vegan':  { area: 'jeju',  durationDays: 2, pax: 2, dietPrefs: ['Vegan'],      priceRange: 'Budget',   language: 'en', arrivalTime: '14:00', departureTime: '10:00' },
  'seoul-ja':    { area: 'seoul', durationDays: 3, pax: 2, dietPrefs: ['Vegetarian'], priceRange: 'Moderate', language: 'ja' },
  'seoul-zh':    { area: 'seoul', durationDays: 1, pax: 3, dietPrefs: ['Meat'],       priceRange: 'Premium',  language: 'zh' },
};
// 시나리오 ID = ALL 키. 모르는 ID 를 조용히 버리면 "요청한 시나리오 통째 누락"이 통과로 보인다 → 호출 전 중단.
const REQUESTED = String(args.scenarios || Object.keys(ALL).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
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
const { getFoodContext } = await import('../api/_food_helper.js');
const { getAttractionsContext } = await import('../api/_attractions_helper.js');
const gp = await import('../api/_ai_core/geminiPipeline.js');
const { repairAndParseJSON, validateResponse, validatePatternStructure, hasCriticalDietaryViolation } = await import('../api/_ai_core/responseValidator.js');
const { runDuplicateStopGate } = await import('../api/_ai_core/finalItineraryGate.js');
const { runWithLlmContext, resolveLlmModel } = await import('../api/_shared/llm/index.js');
const { estimateGeminiCostUsd } = await import('../api/_shared/apiPricing.js');

const LANG_RE = { ko: /[가-힣]/, en: /[A-Za-z]{3,}/, ja: /[぀-ヿ]/, zh: /[一-鿿]/ };

function buildInputs(key) {
  const s = ALL[key];
  const body = {
    guestName: 'Compare-Test', pax: s.pax, styles: ['Food', 'Culture'], area: s.area, durationDays: s.durationDays,
    duration: `${s.durationDays}day`, startDate: FUTURE, language: s.language, dietPrefs: s.dietPrefs, priceRange: s.priceRange,
    arrivalTime: s.arrivalTime, departureTime: s.departureTime, arrival_airport: s.arrival_airport, departure_airport: s.departure_airport,
    vehicle: 'public', mobility: 'walking', email: 'compare@example.com',
  };
  const shaped = shapeRequest(body, body.email, false, null);
  const dietaryAll = [...new Set([...(shaped.dietPrefs || []), ...(shaped.dietaryRestrictions || [])])].filter((d) => d && d !== 'None');
  let spotContext = ''; try { spotContext = getSpotContext(s.area, 6) || ''; } catch { /* ignore */ }
  let foodContext = ''; try { foodContext = getFoodContext(s.area, dietaryAll, s.priceRange, Math.min(40, Math.max(10, s.durationDays * 4))) || ''; } catch { /* ignore */ }
  let attractionsContext = ''; try { attractionsContext = getAttractionsContext({ city: s.area, styles: body.styles, language: s.language, maxLocations: 6 }) || ''; } catch { /* ignore */ }
  const userMessage = buildUserMessage({ shaped, body, spotContext, foodContext, attractionsContext, mountainContext: '', runningContext: '' });
  return { id: key, s, body, shaped, dietaryAll, systemPrompt: buildSystemPrompt(s.language), userMessage };
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

const results = [];
let stopped = null; // 실제 누적 비용 상한 초과 — 다음 호출 전에 중단
for (const p of prepared) {
  for (const prov of PROVIDERS) {
    const budget = budgetStop(results, MAX_USD);
    if (budget.stop) { stopped = budget; break; }
    // scenarioId = 판정 키(ALL 키), scenario = 표시 라벨(기존 산출물 호환).
    const row = { scenarioId: p.id, scenario: p.s.area + '-' + p.s.durationDays + 'd-' + p.s.dietPrefs[0] + '-' + p.s.language, provider: prov };
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
        const cm = gp.extractCacheMetadata(result.response);
        // 단가 = apiPricing 표(gemini·claude 공용, 미등록 모델은 보수적 기본값) — 실제 모델 기준.
        row.tokens = cm; row.usd = +estimateGeminiCostUsd(row.modelActual, cm).toFixed(4);
        const raw = gp.extractTextFromResponse(result.response).trim();
        row.chars = raw.length;
        const plan = repairAndParseJSON(raw);
        row.parsed = !!plan && !plan.__repair_minimal_fallback;
        row.requiredKeys = ['days', 'arrival_guide', 'departure_guide'].filter((k) => !(plan && plan[k]));
        row.days = plan?.days?.length || 0;
        row.daysMatch = row.days === p.s.durationDays;
        row.stopsPerDay = (plan?.days || []).map((d) => (d.stops || []).length);
        row.foodPerDay = (plan?.days || []).map((d) => (d.stops || []).filter((x) => x.category === 'food').length);
        // 도착·출국 시각·공항 = 시나리오 값 그대로(없으면 미전달 → 검증기 기본 규칙). B-MEAL 출국일 규칙이 departureTime 을 본다.
        const trip = { arrivalTime: p.s.arrivalTime, departureTime: p.s.departureTime, arrival_airport: p.s.arrival_airport, departure_airport: p.s.departure_airport };
        row.structureErrors = validatePatternStructure(plan, { durationDays: p.s.durationDays, regions: [p.s.area], area: p.s.area, ...trip });
        // 필수 끼니 = validatePatternStructure 의 B-MEAL 결과. 검사가 꺼져 있으면(VALIDATOR_BMEAL_ENABLED=false) checked:false → 판정 실패.
        row.mealCoverage = { checked: process.env.VALIDATOR_BMEAL_ENABLED !== 'false', missing: row.structureErrors.filter((e) => /\(B-MEAL/.test(String(e))) };
        const gate = runDuplicateStopGate(plan);
        row.duplicateStops = gate.duplicates.length;
        row.duplicateStopNames = gate.duplicates.map((d) => `${d.name}×${d.count}`);
        const issues = validateResponse(plan, { dietary: p.dietaryAll, language: p.s.language, area: p.s.area, regions: [p.s.area], ...trip }, await gp.loadFoodIndex());
        row.dietaryCritical = hasCriticalDietaryViolation(issues);
        row.unverifiedRestaurants = issues.filter((i) => i.type === 'unverified_restaurant').length;
        const sample = [plan?.tour_title, ...(plan?.days || []).map((d) => d.theme), ...(plan?.days || []).flatMap((d) => (d.stops || []).map((x) => x.tip))].filter(Boolean).join(' ');
        row.languageOk = LANG_RE[p.s.language].test(sample);
        row.titleSample = String(plan?.tour_title || '').slice(0, 60);
        row.plan = plan;
      });
    } catch (e) {
      row.error = String(e && e.message || e).slice(0, 300);
      // 실측 전 예외 = 과금 여부 불명 → 판정 실패(cost_unknown), 누적엔 usdReserved 유지. 실측 뒤 예외면 usd 그대로.
      if (typeof row.usd !== 'number') { row.usd = null; row.usdUnknown = true; }
    }
    const { plan, ...summary } = row;
    console.log(JSON.stringify(summary));
    results.push(row);
  }
  if (stopped) break;
}

const out = String(args.out || `scripts/plan-local/outputs/llm-compare-${Date.now()}.json`);
mkdirSync(dirname(out), { recursive: true });
// 마지막 행까지 더한 합을 저장 전에 다시 검사 — 마지막 호출에서 넘어도 exit 3.
const final = finalizeCompareRun({ providers: PROVIDERS, expectedScenarios: SCEN, results, maxUsd: MAX_USD, stopped });
const outcome = final.outcome;
if (final.budgetStop) console.error(`[compare] 누적 비용(예약 포함) $${final.budgetStop.spentUsd} > 상한 $${MAX_USD} — 중단 (exit ${OUTCOME_EXIT.budget}).`);
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), providers: PROVIDERS, expectedScenarios: SCEN, maxUsd: MAX_USD, results, budgetStop: final.budgetStop, outcome }, null, 2));
const spent = budgetStop(results, MAX_USD).spentUsd;
console.log(`\n[compare] 실호출 ${results.filter((r) => !r.error).length}/${results.length} · 누적 비용(불명 행은 예약치) ≈ $${spent.toFixed(4)} · 비용 불명 ${results.filter((r) => r.usdUnknown).length}건 · 저장 ${out}`);
console.log(formatOutcome(outcome));
// 어떤 공급자든 실패하면 0 이 아닌 코드(누적 상한 중단 = 3) — 결과 파일은 위에서 이미 저장됨.
process.exitCode = outcome.exitCode;
