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
 *
 * 평가 항목(계획서 4-b): JSON 파싱 · 필수 키(days/arrival_guide/departure_guide) · 일수 일치 · 구조(B-10/12/14/15) ·
 *   식이 critical 0 · 언어(ko/en/ja/zh) · 길이(chars) · 토큰/비용/소요시간.
 */
import { performance } from 'node:perf_hooks';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
if (!args['confirm-cost']) {
  console.error('유료 호출입니다. 비용 확인 후 --confirm-cost 를 붙여 다시 실행하세요.');
  process.exit(2);
}
const PROVIDERS = String(args.providers || 'gemini,claude').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_USD = Number(args['max-usd'] || 5);
const FUTURE = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

const ALL = {
  'seoul-meat':  { area: 'seoul', durationDays: 2, pax: 2, dietPrefs: ['Meat'],       priceRange: 'Moderate', language: 'ko', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1' },
  'busan-halal': { area: 'busan', durationDays: 3, pax: 4, dietPrefs: ['Halal'],      priceRange: 'Moderate', language: 'en', arrivalTime: '14:00', departureTime: '10:00', arrival_airport: 'ICN_T1', departure_airport: 'ICN_T1' },
  'jeju-vegan':  { area: 'jeju',  durationDays: 2, pax: 2, dietPrefs: ['Vegan'],      priceRange: 'Budget',   language: 'en', arrivalTime: '14:00', departureTime: '10:00' },
  'seoul-ja':    { area: 'seoul', durationDays: 3, pax: 2, dietPrefs: ['Vegetarian'], priceRange: 'Moderate', language: 'ja' },
  'seoul-zh':    { area: 'seoul', durationDays: 1, pax: 3, dietPrefs: ['Meat'],       priceRange: 'Premium',  language: 'zh' },
};
const SCEN = String(args.scenarios || Object.keys(ALL).join(',')).split(',').map((s) => s.trim()).filter((k) => ALL[k]);

const { buildSystemPrompt } = await import('../api/_ai_core/buildPrompt.js');
const { buildUserMessage } = await import('../api/_ai_core/userMessageBuilder.js');
const { shapeRequest } = await import('../api/_ai_core/requestShaper.js');
const { getSpotContext } = await import('../api/_spots_helper.js');
const { getFoodContext } = await import('../api/_food_helper.js');
const { getAttractionsContext } = await import('../api/_attractions_helper.js');
const gp = await import('../api/_ai_core/geminiPipeline.js');
const { repairAndParseJSON, validateResponse, validatePatternStructure, hasCriticalDietaryViolation } = await import('../api/_ai_core/responseValidator.js');
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
  return { s, body, shaped, dietaryAll, systemPrompt: buildSystemPrompt(s.language), userMessage };
}

// 사전 비용 추정 (입력 chars/4 ≈ 토큰, 출력 8K 토큰 가정)
let est = 0;
const prepared = SCEN.map(buildInputs);
for (const p of prepared) for (const prov of PROVIDERS) {
  const model = await runWithLlmContext({ provider: prov }, async () => resolveLlmModel('main'));
  const inTok = Math.ceil((p.systemPrompt.length + p.userMessage.length) / 4);
  est += estimateGeminiCostUsd(model, { total: inTok, cached: 0, output: 8000 });
}
console.log(`[compare] scenarios=${SCEN.length} providers=${PROVIDERS.join(',')} 사전 추정 비용 ≈ $${est.toFixed(3)} (상한 $${MAX_USD})`);
if (est > MAX_USD) { console.error('추정 비용이 상한을 넘습니다. 중단.'); process.exit(3); }

const results = [];
for (const p of prepared) {
  for (const prov of PROVIDERS) {
    const row = { scenario: p.s.area + '-' + p.s.durationDays + 'd-' + p.s.dietPrefs[0] + '-' + p.s.language, provider: prov };
    try {
      await runWithLlmContext({ provider: prov }, async () => {
        row.model = resolveLlmModel('main');
        const model = gp.buildModel(process.env.GEMINI_API_KEY || 'managed-by-llm-adapter', undefined, {});
        const t0 = performance.now();
        const result = await gp.withTimeout((signal) => model.generateContent({
          contents: [{ role: 'user', parts: [{ text: p.userMessage }] }],
          systemInstruction: { role: 'system', parts: [{ text: p.systemPrompt }] },
        }, { signal }), 240_000, `compare-${prov}`);
        row.ms = Math.round(performance.now() - t0);
        row.finishReason = gp.extractFinishReason(result);
        const cm = gp.extractCacheMetadata(result.response);
        row.tokens = cm; row.usd = +estimateGeminiCostUsd(row.model, cm).toFixed(4);
        const raw = gp.extractTextFromResponse(result.response).trim();
        row.chars = raw.length;
        const plan = repairAndParseJSON(raw);
        row.parsed = !!plan && !plan.__repair_minimal_fallback;
        row.requiredKeys = ['days', 'arrival_guide', 'departure_guide'].filter((k) => !(plan && plan[k]));
        row.days = plan?.days?.length || 0;
        row.daysMatch = row.days === p.s.durationDays;
        row.stopsPerDay = (plan?.days || []).map((d) => (d.stops || []).length);
        row.foodPerDay = (plan?.days || []).map((d) => (d.stops || []).filter((x) => x.category === 'food').length);
        row.structureErrors = validatePatternStructure(plan, { durationDays: p.s.durationDays, regions: [p.s.area], area: p.s.area, arrival_airport: p.s.arrival_airport, departure_airport: p.s.departure_airport });
        const issues = validateResponse(plan, { dietary: p.dietaryAll, language: p.s.language, area: p.s.area, regions: [p.s.area] }, await gp.loadFoodIndex());
        row.dietaryCritical = hasCriticalDietaryViolation(issues);
        row.unverifiedRestaurants = issues.filter((i) => i.type === 'unverified_restaurant').length;
        const sample = [plan?.tour_title, ...(plan?.days || []).map((d) => d.theme), ...(plan?.days || []).flatMap((d) => (d.stops || []).map((x) => x.tip))].filter(Boolean).join(' ');
        row.languageOk = LANG_RE[p.s.language].test(sample);
        row.titleSample = String(plan?.tour_title || '').slice(0, 60);
        row.plan = plan;
      });
    } catch (e) {
      row.error = String(e && e.message || e).slice(0, 300);
    }
    const { plan, ...summary } = row;
    console.log(JSON.stringify(summary));
    results.push(row);
  }
}

const out = String(args.out || `scripts/plan-local/outputs/llm-compare-${Date.now()}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), providers: PROVIDERS, results }, null, 2));
const spent = results.reduce((a, r) => a + (r.usd || 0), 0);
console.log(`\n[compare] 실호출 ${results.filter((r) => !r.error).length}/${results.length} · 실비용 ≈ $${spent.toFixed(4)} · 저장 ${out}`);
