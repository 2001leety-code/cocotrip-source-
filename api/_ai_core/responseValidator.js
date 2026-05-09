/**
 * Response validation + JSON repair helpers.
 * Extracted verbatim from api/ai-planner-full.js L129-169, L877-946.
 *
 * 2026-05-10 (P0-3 SAFETY-CRITICAL): dietary_violation 검사 추가.
 * CLAUDE.md J 항: halal/vegan/vegetarian 위반은 "고객 건강 위험" 등급.
 * validateResponse 가 issues 배열에 critical violation 을 남기면 caller 가
 * hasCriticalDietaryViolation() 으로 감지 → 1회 retry → 그래도 violation 시
 * 사용자에게 명시적 에러 + 환불 권장.
 */
import { sanitizeStopName } from './sanitizeName.js';

/**
 * 모든 stop의 name/display_name 다국어 concat 정리. 사용자 PDF 보고로 발견된
 * 패턴 (e.g. "Pig Co. ... 강남 돼지상회 ... 明洞..." 또는 "/" 구분자)을
 * 사용자 lang 토큰만 남김. validateResponse 호출 전 데이터 변형.
 */
export function sanitizeStops(data, lang = 'ko') {
  const days = (data.itinerary?.days) || data.days || [];
  let cleaned = 0;
  for (const day of days) {
    for (const stop of (day.stops || [])) {
      for (const f of ['name', 'display_name']) {
        const orig = stop[f];
        if (typeof orig === 'string') {
          const fixed = sanitizeStopName(orig, lang);
          if (fixed !== orig) { stop[f] = fixed; cleaned++; }
        }
      }
    }
  }
  if (cleaned > 0) console.log(`[sanitizeStops] cleaned ${cleaned} multilingual concats (lang=${lang})`);
  return data;
}

/**
 * P0-3 (SAFETY-CRITICAL): 사용자가 halal/vegan/vegetarian 입력 시 식이제한 위반 판정.
 * qualityMetrics.js buildDietaryChecker 와 동일 로직 — single source of truth 안 만들고
 * 의도적으로 복제 (qualityMetrics 는 점수용, 여기는 차단용. 임포트 사이클 회피).
 *
 * 보수적 fail-safe: 명시적 halal/vegan tag 가 없거나 conflict 키워드 (pork/beef 등)
 * 가 있으면 violation. 비halal 식당이 halal 사용자 plan 에 들어가는 것 = 건강 위험.
 *
 * 음식 카테고리 만 체크 — non-food stop 은 dietary 와 무관.
 */
function checkDietaryViolation(stop, dietary) {
  if (!Array.isArray(dietary) || dietary.length === 0) return null;
  if (stop.category !== 'food') return null;

  const wantsHalal  = dietary.some((d) => /halal/i.test(d));
  const wantsVegan  = dietary.some((d) => /vegan/i.test(d));
  const wantsVeggie = dietary.some((d) => /vegetarian/i.test(d));

  if (!wantsHalal && !wantsVegan && !wantsVeggie) return null;

  const tags = []
    .concat(stop.dietary_tags || [])
    .concat(stop.dietary || [])
    .concat(stop.tags || [])
    .map((t) => String(t).toLowerCase());
  const hayLow = `${stop.name || ''} ${stop.display_name || ''} ${stop.tip || ''} ${stop.reason || ''}`.toLowerCase();

  if (wantsHalal) {
    const claimsHalal = tags.some((t) => t.includes('halal')) || /halal|할랄/i.test(hayLow);
    const conflicts   = /pork|돼지|삼겹/i.test(hayLow);
    if (!claimsHalal || conflicts) return 'halal';
  }
  if (wantsVegan) {
    const claimsVegan = tags.some((t) => t.includes('vegan')) || /vegan|비건/i.test(hayLow);
    const conflicts   = /beef|chicken|pork|fish|seafood|소고기|돼지|닭|생선|해산물/i.test(hayLow);
    if (!claimsVegan || conflicts) return 'vegan';
  }
  if (wantsVeggie && !wantsVegan) {
    const claimsVeg = tags.some((t) => t.includes('vegetarian') || t.includes('vegan'))
      || /vegetarian|vegan|채식|비건/i.test(hayLow);
    const conflicts = /beef|chicken|pork|소고기|돼지|닭/i.test(hayLow);
    if (!claimsVeg || conflicts) return 'vegetarian';
  }
  return null;
}

/**
 * P0-3: validateResponse 결과에서 critical dietary violation 존재 여부.
 * 사용자가 식이제한 입력했는데 violation 이 있으면 plan 그대로 저장하면 안 됨.
 * Caller (geminiPipeline) 가 1회 retry → 그래도 violation 이면 throw.
 */
export function hasCriticalDietaryViolation(issues) {
  if (!Array.isArray(issues)) return false;
  return issues.some((i) => i && i.type === 'dietary_violation' && i.severity === 'critical');
}

export function validateResponse(data, request, foodIndex) {
  const issues = [];
  const allStops = (data.days || []).flatMap(d => (d.stops || []));
  // P0-3: request.dietary — 호출자가 사용자 식이제한 (Halal/Vegan/...) 전달 시 위반 검사.
  // 누락이면 검사 skip — 기존 caller 호환 (geminiPipeline 만 dietary 전달).
  const dietary = Array.isArray(request?.dietary) ? request.dietary : [];

  for (const stop of allStops) {
    // 주소 형식 — 시/도로 시작하는지
    const stopLabel = stop.name || stop.name_ko || stop.display_name || stop.name_en || '';
    if (stop.address && !/^(서울|부산|제주|인천|경기|강원|충청|전라|경상|울산|대구|대전|광주|세종)/.test(stop.address)) {
      issues.push({ type: 'bad_address_prefix', stop: stopLabel, value: stop.address });
    }
    // food stop 주소에 건물번호(숫자) 없음
    if (stop.category === 'food' && stop.address && !/\d/.test(stop.address)) {
      issues.push({ type: 'address_missing_number', stop: stopLabel });
    }
    // DB 매칭 (food 카테고리만)
    if (stop.category === 'food' && Array.isArray(foodIndex) && foodIndex.length > 0) {
      const inDB = foodIndex.some(r => {
        const dbName = (r.name || '').split('|')[0].trim();
        return dbName === stopLabel || r.nameEn === (stop.display_name || stop.name_en || '');
      });
      if (!inDB) issues.push({ type: 'unverified_restaurant', stop: stopLabel });
    }
    // P0-3 SAFETY-CRITICAL: 식이제한 위반 (halal/vegan/vegetarian)
    // critical severity — caller 가 plan 저장 차단할 수 있도록 표시.
    const dietViolation = checkDietaryViolation(stop, dietary);
    if (dietViolation) {
      issues.push({
        type: 'dietary_violation',
        severity: 'critical',
        stop: stopLabel,
        diet: dietViolation,
        category: stop.category,
      });
    }
    // 언어 혼합 (ko 요청인데 tip이 영어만)
    const tipText = stop.tip || stop.tip_en || '';
    if (request.lang === 'ko' && tipText && /^[A-Za-z0-9\s.,!?'\-:()]+$/.test(tipText)) {
      issues.push({ type: 'language_mismatch', stop: stopLabel, field: 'tip' });
    }
    // 비현실적 stay_min
    if (stop.stay_min != null && (stop.stay_min < 15 || stop.stay_min > 240)) {
      issues.push({ type: 'unrealistic_stay', stop: stopLabel, value: stop.stay_min });
    }

    // 다국어 합친 name/display_name pattern (e.g., "한국어 | English | 中文")
    for (const f of ['name', 'display_name', 'name_ko', 'name_en']) {
      if (typeof stop[f] === 'string' && stop[f].includes(' | ')) {
        issues.push({ type: 'pipe_in_name', stop: stopLabel, field: f, value: stop[f] });
      }
    }

    // reason/tip에 stop.address와 다른 도시 언급 (송도 vs 마포구 같은 hallucination)
    const reasonText = `${stop.reason || ''} ${stop.tip || ''}`;
    if (stop.address && reasonText) {
      const cities = ['송도', '인천', '강남', '홍대', '명동', '이태원', '마포', '종로', '용산', '서초', '부산', '제주', '경주', '대구', '대전', '광주', '울산'];
      const addrCity = cities.find((c) => stop.address.includes(c));
      if (addrCity) {
        const otherCities = cities.filter((c) => c !== addrCity && reasonText.includes(c));
        if (otherCities.length > 0) {
          issues.push({ type: 'wrong_city_in_reason', stop: stopLabel, addrCity, mentioned: otherCities });
        }
      }
    }
  }

  // P0-3: dietary_violation 별도 카운트 — 운영자가 prod log 에서 즉시 식별.
  const dietaryViolations = issues.filter((i) => i.type === 'dietary_violation').length;
  console.log('[RESPONSE_VALIDATION]', JSON.stringify({
    total_stops: allStops.length,
    food_stops: allStops.filter(s => s.category === 'food').length,
    issue_count: issues.length,
    dietary_violations: dietaryViolations,
    dietary_input: dietary,
    issues: issues.slice(0, 20),
  }));
  return issues;
}

/**
 * Repair and parse potentially truncated Gemini JSON output.
 * Returns parsed object or throws Error.
 */
export function repairAndParseJSON(rawText) {
  // Direct parse
  try {
    return JSON.parse(rawText);
  } catch (parseErr1) {
    console.warn('[ai-planner-full] Direct parse failed:', parseErr1.message);
  }

  // Step 1: strip markdown fences
  let cleaned = rawText.replace(/^```(?:json)?|```$/gm, '').trim();
  const first = cleaned.indexOf('{');
  if (first > 0) cleaned = cleaned.slice(first);

  // Step 2: try parsing cleaned text
  try {
    return JSON.parse(cleaned);
  } catch {
    // Step 3: robust truncated JSON recovery
    console.warn('[ai-planner-full] Attempting truncated JSON repair...');
    let repaired = cleaned;

    // Walk backward to find the last "safe" cut point
    let cutIdx = repaired.length;
    for (let i = repaired.length - 1; i > 0; i--) {
      const ch = repaired[i];
      if (ch === '}' || ch === ']') { cutIdx = i + 1; break; }
      if (ch === '"') {
        let bs = 0;
        for (let j = i - 1; j >= 0 && repaired[j] === '\\'; j--) bs++;
        if (bs % 2 === 0) { cutIdx = i + 1; break; } // unescaped quote = valid end
      }
      if (/[0-9]/.test(ch)) { cutIdx = i + 1; break; }
      if (i >= 3 && repaired.slice(i - 3, i + 1) === 'true') { cutIdx = i + 1; break; }
      if (i >= 4 && repaired.slice(i - 4, i + 1) === 'false') { cutIdx = i + 1; break; }
      if (i >= 3 && repaired.slice(i - 3, i + 1) === 'null') { cutIdx = i + 1; break; }
    }
    repaired = repaired.slice(0, cutIdx).replace(/,\s*$/, '');

    // Count and close open brackets/braces
    let openBraces = 0, openBrackets = 0;
    let inStr = false;
    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      if (ch === '\\' && inStr) { i++; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') openBraces++;
      else if (ch === '}') openBraces--;
      else if (ch === '[') openBrackets++;
      else if (ch === ']') openBrackets--;
    }
    for (let i = 0; i < openBrackets; i++) repaired += ']';
    for (let i = 0; i < openBraces; i++) repaired += '}';
    console.log(`[ai-planner-full] Repair: cut at ${cutIdx}/${cleaned.length}, closing ${openBrackets}] + ${openBraces}}`);

    try {
      const result = JSON.parse(repaired);
      console.log('[ai-planner-full] Truncated JSON repaired OK, days:', (result.days || []).length);
      return result;
    } catch (parseErr3) {
      console.error('[ai-planner-full] JSON repair also failed:', parseErr3.message);
      throw new Error('Gemini returned invalid JSON (possibly truncated). Please try again.');
    }
  }
}

/**
 * Clean "대한민국 " prefix from all stop addresses.
 */
export function cleanAddresses(itinerary) {
  for (const day of (itinerary.days || [])) {
    for (const stop of (day.stops || [])) {
      if (stop.address) {
        stop.address = stop.address.replace(/^대한민국\s+/, '').replace(/\bKR\s+/g, '');
      }
    }
  }
}
