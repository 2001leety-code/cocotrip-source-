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
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';

// PR #462 (Audit X-H3 — 2026-05-16): keys that the cut-and-close repair
// path in repairAndParseJSON may lose when Gemini truncates the response
// (either it cut inside the guide fields after emitting them, OR it cut
// inside days[] before reaching them — declaration-order makes guides
// the most common casualty either way). Pattern validator catches the
// loss via retry trigger, but the silent path burns quota and gives
// operators no visibility into the rate or root cause. `detectDroppedKeys`
// is exported so the unit test can exercise it directly. It returns
// keys missing from `repaired`, partitioned by whether they appeared in
// rawText (= cut path dropped them) vs not (= Gemini never reached them);
// the operator alert message includes both buckets so a regression in
// prompt ordering vs a regression in max-tokens budget can be told apart.
const CRITICAL_TOP_LEVEL_KEYS = ['arrival_guide', 'departure_guide'];

/**
 * Inspect the post-repair object for missing critical top-level keys.
 * Returns the names of any missing keys.
 *
 * Only called on the repair path (cut-and-close success) — when JSON
 * parsed directly we have nothing to flag.
 */
export function detectDroppedKeys(rawText, repaired) {
  if (!repaired || typeof repaired !== 'object') return [];
  const missing = [];
  for (const key of CRITICAL_TOP_LEVEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(repaired, key)) missing.push(key);
  }
  return missing;
}

/**
 * Categorize the missing keys by whether they appeared in the raw text.
 * - emitted: was in raw but lost during the cut (truncation cut after emit)
 * - not_emitted: never appeared in raw (truncation cut before emit OR Gemini skipped)
 */
export function classifyMissingKeys(rawText, missingKeys) {
  const emitted = [];
  const notEmitted = [];
  const safeRaw = typeof rawText === 'string' ? rawText : '';
  for (const key of missingKeys) {
    if (safeRaw.indexOf(`"${key}"`) !== -1) emitted.push(key);
    else notEmitted.push(key);
  }
  return { emitted, notEmitted };
}

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
 * P280 v2 (2026-05-29): dietary coverage depth check — severity='warning' (retry 안 함).
 *
 * 배경 (P280 v1 lesson, PR #680 → revert PR #693):
 *   P280 v1 가 severity='critical' + hasCriticalDietaryViolation retry trigger 로 추가.
 *   그러나 Korea halal 식당 매칭 거의 0 (foodIndex 한계) → Gemini 가 retry 후도 coverage_low →
 *   무한 retry loop → plan stuck (status='streaming' 영원). 사용자 영향 SAFETY-CRITICAL.
 *
 * P280 v2 fix:
 *   - severity='warning' (critical 아님 — retry trigger 안 됨)
 *   - quality_warnings 박제만 (admin panel P121 즉시 노출)
 *   - 사용자 plan 생성 보장 (stuck 차단) + 운영자가 admin panel 에서 발견 + 운영자 manual 정정
 *
 * threshold 50% 유지 (lenient 변경 보류 — warning 박제 빈도 운영자 인식 필요).
 */
function checkDietaryCoverage(allStops, dietary) {
  if (!Array.isArray(dietary) || dietary.length === 0) return null;
  const foodStops = (allStops || []).filter(s => s && s.category === 'food');
  if (foodStops.length === 0) return null;

  const dietPrefs = [];
  if (dietary.some(d => /halal/i.test(String(d)))) dietPrefs.push('halal');
  if (dietary.some(d => /vegan/i.test(String(d)))) dietPrefs.push('vegan');
  if (dietary.some(d => /vegetarian/i.test(String(d))) && !dietPrefs.includes('vegan')) dietPrefs.push('vegetarian');

  if (dietPrefs.length === 0) return null;

  const claimsDiet = (stop, dietName) => {
    const tags = []
      .concat(stop.dietary_tags || [])
      .concat(stop.dietary || [])
      .concat(stop.tags || [])
      .map(t => String(t).toLowerCase());
    const hay = `${stop.name || ''} ${stop.display_name || ''} ${stop.tip || ''} ${stop.reason || ''}`.toLowerCase();
    if (dietName === 'halal') {
      const claims = tags.some(t => t.includes('halal')) || /halal|할랄/i.test(hay);
      const conflicts = /pork|돼지|삼겹/i.test(hay);
      return claims && !conflicts;
    }
    if (dietName === 'vegan') {
      const claims = tags.some(t => t.includes('vegan')) || /vegan|비건/i.test(hay);
      const conflicts = /beef|chicken|pork|fish|seafood|소고기|돼지|닭|생선|해산물/i.test(hay);
      return claims && !conflicts;
    }
    if (dietName === 'vegetarian') {
      const claims = tags.some(t => t.includes('vegetarian') || t.includes('vegan'))
        || /vegetarian|vegan|채식|비건/i.test(hay);
      const conflicts = /beef|chicken|pork|소고기|돼지|닭/i.test(hay);
      return claims && !conflicts;
    }
    return false;
  };

  const COVERAGE_THRESHOLD = 0.5;
  const lowCoverageIssues = [];
  for (const dietName of dietPrefs) {
    const matchCount = foodStops.filter(s => claimsDiet(s, dietName)).length;
    const coverage = matchCount / foodStops.length;
    if (coverage < COVERAGE_THRESHOLD) {
      lowCoverageIssues.push({
        dietary_pref: dietName,
        coverage,
        match_count: matchCount,
        food_stops_count: foodStops.length,
      });
    }
  }
  return lowCoverageIssues.length > 0 ? lowCoverageIssues : null;
}

/**
 * B6 (P310, 2026-05-30): 알레르기 4종 (Nuts/Shellfish/Gluten/Dairy) 텍스트 기반 검출.
 *
 * 배경 (audit B6):
 *   P189 이 allergen DB 필터 (filterByAllergens) 코드는 준비했으나 _food_index.json
 *   allergens 필드가 전 행 false (실측 미수집) → DB 기반 검출 0건. checkDietaryViolation
 *   은 halal/vegan/vegetarian 만 분기 → Nuts/Shellfish/Gluten/Dairy 검사 전무.
 *   견과류 알레르기 손님이 견과 식당 추천받을 위험 (SAFETY-CRITICAL).
 *
 * 설계 (P280 v1 무한 retry 사고 회피 — 핵심):
 *   - severity='warning' 고정. hasCriticalDietaryViolation 에 안 들어감 (retry trigger X).
 *     critical 로 하면 한식 hidden allergen (간장=밀, 비빔밥=잣) false-positive 폭발 →
 *     매 retry 마다 한식 대부분 위반 → P280 v1 보다 광범위한 무한 loop. 절대 금지.
 *   - 명시적 재료명만 검출 (보수적). 광역 조미료 (간장/고추장 단독) 제외 — 거의 모든
 *     한식 = false-positive. 단일 음절 한글 ('게'/'굴'/'면') 제외 — 다른 단어 오검출.
 *   - name/display_name/tip 만 검사 (reason 제외, 보수적).
 *   - admin panel 가시화 우선. critical 승격은 false-positive rate 측정 + DB retrofit 후.
 *
 * 외부 사례 (allergymenu / FSSAI / Big-9) + buildPrompt.js:732-740 한식 hidden allergen
 * 가이드 교차 검증한 키워드 사전.
 */
const ALLERGEN_KEYWORDS = {
  // 견과류 — 강정/약과 (견과 다량 한과) 포함. \bnut\b 로 'donut' 등 오검출 회피.
  nuts: /peanut|almond|walnut|cashew|pistachio|hazelnut|macadamia|pecan|\bnut\b|땅콩|아몬드|호두|캐슈|피스타치오|견과|강정|약과/i,
  // 갑각류/조개 — 단일 음절 제외, 구체 재료명 (게장/대게/게살/생굴/굴구이).
  shellfish: /shrimp|prawn|\bcrab\b|lobster|clam|oyster|mussel|scallop|새우|게장|대게|꽃게|게살|랍스터|조개|생굴|굴구이|홍합|가리비|꼬막/i,
  // 글루텐 — 면/빵/밀 명시. 간장/고추장 (광역 조미료) 제외 (false-positive 회피).
  gluten: /\bwheat\b|noodle|ramen|ramyeon|\bbread\b|pancake|dumpling|냉면|밀면|라면|칼국수|수제비|만두|부침개|파전|밀가루/i,
  // 유제품 — 치즈/크림/우유 명시.
  dairy: /\bmilk\b|butter|cheese|cream|latte|yogurt|우유|버터|치즈|크림|라떼|요거트|빙수|아이스크림/i,
};

const ALLERGEN_PREF_MAP = { Nuts: 'nuts', Shellfish: 'shellfish', Gluten: 'gluten', Dairy: 'dairy' };

// #9 (2026-06-20) SAFETY-CRITICAL: block_mode food stop 에 박는 "사용자 표시" 알레르기 고지.
//   기존 applyBlockModeDietaryWarnings 의 allergen_warning 은 quality_warnings (admin-only) 라
//   손님이 못 봤다. legacy _food_helper.js:352 는 Gemini 에게 per-stop caution 을 tip 에 넣게
//   지시 → 손님이 본다. block_mode 는 Gemini per-stop tip 통제가 없으므로 직접 tip 에 주입한다.
//   4언어 (ko/en/ja/zh) — 손님 언어로. allergen 라벨도 언어별로 번역해 붙인다.
const BLOCKMODE_ALLERGEN_NOTICE = {
  ko: (labels) => `⚠️ 알레르기 안내(${labels}): 이 식당은 알레르겐 검증이 되어 있지 않습니다. 식사 전 식당에 ${labels} 알레르기를 반드시 알리고 재료를 직접 확인하세요.`,
  en: (labels) => `⚠️ Allergy notice (${labels}): this restaurant is not allergen-screened. Before eating, inform the restaurant about your ${labels} allergy and confirm the ingredients yourself.`,
  ja: (labels) => `⚠️ アレルギー注意(${labels}): この店舗はアレルゲン検査がされていません。食事の前に必ず店舗へ${labels}アレルギーを伝え、食材を直接確認してください。`,
  zh: (labels) => `⚠️ 过敏提示(${labels})：本餐厅未经过敏原筛查。用餐前请务必告知餐厅您的${labels}过敏情况，并自行确认食材。`,
};
// allergen 4종 언어별 라벨 (사용자 표시용). 키 = ALLERGEN_PREF_MAP value.
const ALLERGEN_LABELS = {
  nuts: { ko: '견과류', en: 'nuts', ja: 'ナッツ', zh: '坚果' },
  shellfish: { ko: '갑각류·조개', en: 'shellfish', ja: '甲殻類・貝類', zh: '甲壳类·贝类' },
  gluten: { ko: '글루텐', en: 'gluten', ja: 'グルテン', zh: '麸质' },
  dairy: { ko: '유제품', en: 'dairy', ja: '乳製品', zh: '乳制品' },
};
function allergenLabel(allergen, lang) {
  const t = ALLERGEN_LABELS[allergen];
  if (!t) return allergen;
  return t[lang] || t.en;
}

/**
 * food stop 들에서 활성 알레르기 유발 재료 가능성 검출. severity='warning' (retry X).
 * @returns {Array<{stop, allergen}>|null}
 */
function checkAllergenWarnings(allStops, dietary) {
  if (!Array.isArray(dietary) || dietary.length === 0) return null;
  // dietary 에서 알레르기 4종만 추출 (Halal/Vegan 은 checkDietaryViolation 담당).
  const activeAllergens = [];
  for (const d of dietary) {
    const key = ALLERGEN_PREF_MAP[d];
    if (key) activeAllergens.push(key);
  }
  if (activeAllergens.length === 0) return null;

  const foodStops = (allStops || []).filter((s) => s && s.category === 'food');
  if (foodStops.length === 0) return null;

  const warnings = [];
  for (const stop of foodStops) {
    // name/display_name/tip 만 검사 (reason 제외 — 보수적 false-positive 회피).
    const hay = `${stop.name || ''} ${stop.display_name || ''} ${stop.tip || ''}`;
    for (const allergen of activeAllergens) {
      if (ALLERGEN_KEYWORDS[allergen].test(hay)) {
        warnings.push({ stop: stop.name || stop.display_name || '', allergen });
      }
    }
  }
  return warnings.length > 0 ? warnings : null;
}

/**
 * P0-3: validateResponse 결과에서 critical dietary violation 존재 여부.
 * 사용자가 식이제한 입력했는데 violation 이 있으면 plan 그대로 저장하면 안 됨.
 * Caller (geminiPipeline) 가 1회 retry → 그래도 violation 이면 throw.
 *
 * P280 v2 (2026-05-29): dietary_coverage_low 는 severity='warning' (retry 안 함, 박제만).
 * 본 함수 = dietary_violation critical 만 retry trigger. P280 v1 의 retry loop bug 회피.
 */
export function hasCriticalDietaryViolation(issues) {
  if (!Array.isArray(issues)) return false;
  return issues.some((i) => i && i.type === 'dietary_violation' && i.severity === 'critical');
}

/**
 * 2026-05-12: AI 응답 pattern structural guard. validateResponse 는 식이제한/언어/
 * field 만 검증 — Gemini 비결정성으로 발생하는 "broken plan" 패턴은 잡지 못함.
 *
 * 검사 항목 (B-10/B-12/B-13/B-14/B-15 회귀 회피):
 *  - B-10: lodging bookend — stops[0].category='lodging', stops[-1] ∈ {lodging, travel, airport}
 *  - B-12: min 4 stops per day
 *  - B-13: 다도시 plan 도시 전환 day 의 lodging name/address 가 day.city 와 일치
 *          (regions.length >= 2 AND day.city 명시된 경우만 검증)
 *  - B-14: stop start_time < 24:00 (hour overflow 차단)
 *  - B-15: 출국일(마지막 day) 공항 stop / travel|airport category / day-level
 *          return_to_airport|airport_transfer meta 존재
 *
 * Returns: { errors: string[] }
 *
 * caller 가 errors.length > 0 일 때 Gemini 1회 재시도 → 그래도 errors 면 telegram
 * alert + 사용자에게 500 (plan 저장 안 함).
 *
 * @param {object} itinerary  Gemini parsed itinerary ({ days: [...] })
 * @param {object} [request]  request shape — body.regions, body.arrival_airport,
 *                            body.departure_airport, body.durationDays 등
 *                            (request 누락 시 출국 공항/도시 검증 skip — 단도시
 *                            airport 없는 케이스 backward compat).
 */
// city display → 한글 매핑. day.city 가 영문이면 한글 alias 도 매칭 후보.
// 2026-05-12 오후: 5/12 launch day 자율 검증 시스템 첫 작동 — W2 가 prod 에서 B-13
// false positive 감지. CITY_KOR_ALIASES 15→25 도시 확장 + 4-layer fallback 도입.
const CITY_KOR_ALIASES = {
  Seoul: ['서울'],
  Busan: ['부산'],
  Jeju: ['제주'],
  Gangneung: ['강릉'],
  Sokcho: ['속초'],
  Gyeongju: ['경주'],
  Jeonju: ['전주'],
  Incheon: ['인천'],
  Daegu: ['대구'],
  Daejeon: ['대전'],
  Gwangju: ['광주'],
  Ulsan: ['울산'],
  Suwon: ['수원'],
  Chuncheon: ['춘천'],
  Yeosu: ['여수'],
  Yongin: ['용인'],
  Sejong: ['세종'],
  Pohang: ['포항'],
  Andong: ['안동'],
  Tongyeong: ['통영'],
  Ansan: ['안산'],
  Anyang: ['안양'],
  Cheongju: ['청주'],
  Mokpo: ['목포'],
  Cheonan: ['천안'],
};

// P247 (2026-05-27): 한글 도시명 → 영문 PascalCase 역방향 매핑.
// regions 가 한글 ('서울','부산') 로 전달될 때 day.city ('Seoul','Busan' 영문) 와
// 비교하려면 역방향 조회 필요. 예: '서울' → 'Seoul', '부산' → 'Busan'.
// B-REGION-COVERAGE + B-13 L5 hasExplicitOtherCity 둘 다 사용.
const CITY_KOR_TO_ENG = Object.fromEntries(
  Object.entries(CITY_KOR_ALIASES).flatMap(([eng, kors]) =>
    kors.map((kor) => [kor.toLowerCase(), eng.toLowerCase()])
  )
);

/**
 * P247: region 문자열 하나를 lowercase 정규화.
 * 한글 ('서울') → 영문 lowercase ('seoul').
 * 영문/알 수 없는 문자 → 그대로 lowercase.
 * B-REGION-COVERAGE 와 B-13 L5 에서 regions 엔트리와 day.city 비교 시 사용.
 */
export function normalizeRegionKey(r) {
  const low = String(r || '').trim().toLowerCase();
  return CITY_KOR_TO_ENG[low] || low;
}

// 잘 알려진 글로벌 호텔 체인 — 이름만으로는 city 모르지만 well-known 5성급 위치.
// 다도시 plan 에서 Gemini 가 "Lotte L7 Gangnam" / "JW Marriott Dongdaemun" 처럼
// city 토큰 없는 이름만 반환 시 B-13 false positive 방지. lodging name 에
// 이 체인 패턴 포함이면 city 매칭 부족해도 통과 (운영자 단점 = 진짜 mismatch
// 일부 통과 위험. 하지만 false positive 가 훨씬 큰 비용).
const KNOWN_HOTEL_CHAINS = [
  'lotte', 'westin', 'jw marriott', 'marriott', 'hilton', 'sheraton',
  'four seasons', 'park hyatt', 'grand hyatt', 'hyatt', 'shilla', 'shangri-la',
  'intercontinental', 'conrad', 'ritz-carlton', 'mandarin oriental',
  'fairmont', 'banyan tree', 'paradise', 'walkerhill', 'novotel',
  'mercure', 'fraser', 'oakwood', 'somerset', 'ascott',
];

export function validatePatternStructure(itinerary, request = {}) {
  const errors = [];
  if (!itinerary || !Array.isArray(itinerary.days)) {
    errors.push('itinerary.days array missing or not array');
    return errors;
  }

  const days = itinerary.days;
  // 정규화: regions / arrival_airport / departure_airport — snake_case + camelCase 둘 다 수용.
  const regions = Array.isArray(request.regions)
    ? request.regions.filter((r) => typeof r === 'string' && r.trim())
    : (request.region ? [request.region] : []);
  const arrivalAirport  = request.arrival_airport  || request.arrivalAirport  || '';
  const departureAirport = request.departure_airport || request.departureAirport || '';
  const isMultiCity = regions.length >= 2;

  // B-DC (2026-05-13 PR #407): itinerary.days.length === request.durationDays.
  // 사용자 PDF 보고 (Guest-5--2026-05-14): wizard 5일 plan 인데 PDF Day 4 까지만 노출.
  // Gemini 가 마지막 day drop 시 기존 validator (B-12: 각 day ≥4 stops) 가 통과시킴
  // → 4-day plan 이 5-day 결제로 prod 흘러나옴. HARD validation — caller 가
  // 1회 retry → 그래도 mismatch 면 PLAN_VALIDATION_FAILED.
  //
  // 2026-05-13 PR #412 env flag (P40 일환): `VALIDATOR_BDC_ENABLED=false` 시 skip.
  // 운영자 비상 circuit breaker — Gemini 가 일관되게 day count 틀리면 일시 비활성.
  const bdcEnabled = process.env.VALIDATOR_BDC_ENABLED !== 'false';
  const requestedDays = Number(request.durationDays || request.duration_days);
  if (Number.isFinite(requestedDays) && requestedDays > 0 && days.length !== requestedDays) {
    // P285 (2026-05-29): env disabled 여도 log + Telegram alert — silent mode 차단 (Agent 1 audit #3).
    // 운영자 비상 circuit breaker (VALIDATOR_BDC_ENABLED=false) 활성 시에도 mismatch 측정 + admin 노출.
    console.error('[P285 B-DC mismatch]', JSON.stringify({ requestedDays, actualDays: days.length, bdcEnabled }));
    throttledTelegramAlert(
      `🚨 P285 B-DC mismatch: requested=${requestedDays}, actual=${days.length}, env_enabled=${bdcEnabled}`,
    ).catch(() => {});
    if (bdcEnabled) {
      errors.push(
        `Plan: itinerary.days.length=${days.length} ≠ requested durationDays=${requestedDays} (B-DC)`
      );
    }
  }

  // B-REGION-COVERAGE (P158, 2026-05-22): 다도시 plan 에서 각 region 이 최소 1 day 배정.
  // 사용자 신고: regions=["seoul","busan"] 3-day plan 에서 Gemini 가 모든 day=Seoul →
  // 부산 day 0개 → 결제했는데 부산 미방문. 사용자가 명시적으로 선택한 도시는 모두 방문 의무.
  //
  // P247 (2026-05-27): regions 가 한글 ('서울','부산') 로 전달되고 day.city 가 영문 ('Seoul')
  // 일 때 cityHits['서울'] 가 0 으로 남아 false positive. normalizeRegionKey() 로
  // regions + day.city 둘 다 영문 lowercase 정규화 후 비교.
  if (isMultiCity) {
    // 정규화 키 (영문 lowercase) → 원본 region 문자열 (오류 메시지용)
    const normalizedToOriginal = Object.fromEntries(regions.map((r) => [normalizeRegionKey(r), r]));
    const cityHits = Object.fromEntries(Object.keys(normalizedToOriginal).map((k) => [k, 0]));
    for (const d of days) {
      const cityKey = normalizeRegionKey(String(d?.city || '').trim());
      if (cityKey && cityHits[cityKey] !== undefined) cityHits[cityKey]++;
    }
    const missing = Object.entries(cityHits)
      .filter(([, count]) => count === 0)
      .map(([k]) => normalizedToOriginal[k] || k);
    if (missing.length > 0) {
      errors.push(
        `Plan: regions [${missing.join(',')}] have 0 days assigned — 사용자가 선택한 모든 도시는 최소 1 day 배정 필수 (B-REGION-COVERAGE)`
      );
    }
  }

  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const dayNum = d?.day || d?.day_index || (i + 1);
    const stops = Array.isArray(d?.stops) ? d.stops : [];

    // 도착일(첫날)·출국일(마지막날)은 일정이 짧다(늦은 체크인 / 체크아웃+공항).
    const isSingleDayPlan = days.length === 1;
    const isFirstDay = i === 0 && !isSingleDayPlan;
    const isLastDay  = i === days.length - 1 && !isSingleDayPlan;

    // B-12: min stops per day. 빈 day 도 잡힘.
    // 2026-06-22 (Sentry JAVASCRIPT-REACT-3, 103건): 출국일은 체크아웃(lodging)+공항(travel)
    //   2 stop 이 정상인데 4 강제 → 재시도해도 위반 → 500. 도착/출국일 최소 2 로 완화.
    const minStops = (isFirstDay || isLastDay) ? 2 : 4;
    if (stops.length < minStops) {
      errors.push(`Day ${dayNum}: stops.length=${stops.length} < ${minStops} minimum (B-12)`);
    }

    // B-10: lodging bookend — 첫 stop = lodging, 마지막 stop ∈ {lodging, travel, airport}.
    if (stops.length > 0) {
      const first = stops[0];
      if (first?.category !== 'lodging') {
        errors.push(`Day ${dayNum}: stops[0].category="${first?.category}" expected "lodging" (B-10)`);
      }
      const last = stops[stops.length - 1];
      const lastCat = last?.category;
      if (!['lodging', 'travel', 'airport'].includes(lastCat)) {
        errors.push(`Day ${dayNum}: stops[-1].category="${lastCat}" expected lodging|travel|airport (B-10)`);
      }
    }

    // B-13: 다도시 plan 도시 전환 day 의 lodging name/address 가 day.city 와 일치.
    // regions.length >= 2 AND day.city 명시 + 첫 stop = lodging 일 때만 검증.
    // 2026-05-12 오후 강화 (자율 검증 시스템 첫 적용 — W2 prod intermittent fail 진단):
    //   기존 substring 매칭만 = Gemini 가 호텔 이름만 ("Lotte L7 Gangnam") 반환 시
    //   false positive → PLAN_VALIDATION_FAILED status 500. 4-layer fallback:
    //     L1. lodging name/address 에 day.city alias (영문/한글) substring (기존)
    //     L2. day.theme 에 day.city 토큰 (Gemini 가 "Busan Day 1 — 해운대" theme 자주 출력)
    //     L3. day.intercity_transit.to_city 가 day.city 와 일치 (도시 전환 day 명시)
    //     L4. lodging name 이 KNOWN_HOTEL_CHAINS 포함 (well-known chain 은 lenient pass)
    //   L1~L4 positive → PASS. 모두 fail 시 L5 negative check 로 최종 결정.
    // P149 (2026-05-22): 단계적 검증.
    //   Step1 (city-change day only): L1-L4 positive 매칭 — 하나라도 통과 → PASS.
    //   Step2 (모든 day): L5 negative 매칭 — lodging 이 다른 도시를 명시적으로 언급 → ERROR.
    //     lodging 에 도시 참조 없음 → 일반 호텔명 간주 → PASS.
    //   이유: generic hotel 이름 ("비즈니스 호텔", "Paradise Hotel") 은 도시명 미포함 정상.
    //     반면 "해운대 호텔 부산광역시" 가 서울 day 에 박히면 → 실제 mismatch → flag.
    if (isMultiCity && d?.city && stops.length > 0 && stops[0]?.category === 'lodging') {
      const dayCity = String(d.city).trim();
      const korAliases = CITY_KOR_ALIASES[dayCity] || [];
      const lodgingName = String(stops[0].name || stops[0].display_name || '');
      const lodgingAddr = String(stops[0].address || '');
      const dayTheme = String(d.theme || '');
      const intercityToCity = String(d.intercity_transit?.to_city || '');
      const hay = (lodgingName + ' ' + lodgingAddr).toLowerCase();
      const cityLow = dayCity.toLowerCase();
      const isCityChangeThisDay = !!(d?.intercity_transit?.mode);

      // L5 helper: 다른 도시 명시적 언급 여부 (모든 path 에서 공용).
      // CITY_KOR_ALIASES 키는 PascalCase, regions 는 lowercase → normalize.
      //
      // P247 (2026-05-27): regions 가 한글 ('서울','부산') 이고 day.city 가 영문 ('Seoul')
      // 일 때 기존 필터 r.toLowerCase() !== cityLow → '서울' !== 'seoul' = TRUE → 자기 도시가
      // otherCities 에 포함 → hay.includes('서울') = TRUE (서울 주소에 '서울' 포함) →
      // hasExplicitOtherCity = TRUE → **false positive**.
      // Fix: normalizeRegionKey() 로 regions 엔트리를 영문 lowercase 로 정규화한 뒤 dayCity 와 비교.
      const dayCityNorm = normalizeRegionKey(dayCity); // 'Seoul' → 'seoul'
      const otherCities = regions.filter((r) => normalizeRegionKey(r) !== dayCityNorm);
      const hasExplicitOtherCity = otherCities.some((other) => {
        // other 는 한글 또는 영문. 영문 alias + 한글 alias 모두 검사.
        const otherNorm = normalizeRegionKey(other); // 정규화 영문 키
        const otherEngKey = otherNorm.charAt(0).toUpperCase() + otherNorm.slice(1); // PascalCase
        const otherKorKey = other.toLowerCase(); // 원본 한글 lowercase
        const otherAliases = CITY_KOR_ALIASES[otherEngKey] || [];
        return (
          hay.includes(otherNorm) ||                                // 영문 ('busan')
          hay.includes(other.toLowerCase()) ||                      // 원본 그대로 ('부산')
          otherAliases.some((a) => hay.includes(a.toLowerCase()))   // 한글 alias
        );
      });

      if (isCityChangeThisDay) {
        // city-change day: L1-L4 positive 먼저 시도 (명시적 매칭 우선).
        const matchL1 =
          hay.includes(cityLow) ||
          korAliases.some((alias) => lodgingName.includes(alias) || lodgingAddr.includes(alias));
        const themeLow = dayTheme.toLowerCase();
        const matchL2 =
          themeLow.includes(cityLow) ||
          korAliases.some((alias) => dayTheme.includes(alias));
        const matchL3 =
          intercityToCity.toLowerCase() === cityLow ||
          korAliases.some((alias) => intercityToCity.includes(alias));
        const lodgingNameLow = lodgingName.toLowerCase();
        const matchL4 = KNOWN_HOTEL_CHAINS.some((chain) => lodgingNameLow.includes(chain));

        if (!matchL1 && !matchL2 && !matchL3 && !matchL4) {
          // L5 fallback: 도시명 positive 매칭 실패 → negative check.
          // 다른 도시 명시적 언급 있으면 ERROR, 없으면 generic hotel → PASS.
          if (hasExplicitOtherCity) {
            errors.push(
              `Day ${dayNum} (city="${dayCity}"): lodging "${lodgingName}|${lodgingAddr}" 다른 도시 명시적 언급 (B-13)`
            );
          }
        }
      } else {
        // 일반 day (already in city): L5 negative 매칭만.
        if (hasExplicitOtherCity) {
          errors.push(
            `Day ${dayNum} (city="${dayCity}"): lodging "${lodgingName}|${lodgingAddr}" 다른 도시 명시적 언급 (B-13)`
          );
        }
      }
    }

    // B-LCC (PDF-issue-3, 2026-05-14): 다도시 plan 의 day.lodging_city 일관성.
    //   day.lodging_city 가 명시되어 있을 때:
    //     - city-change day (intercity_transit 있음): lodging_city = intercity_transit.to_city
    //     - 일반 day: lodging_city = day.city
    //   사용자 PDF 검토 (2026-05-14): Day 4 lodging context 가 Day 3 이전 city (부산)
    //   잔존 → 모순. Gemini 가 day.lodging_city 채울 때 일관성 강제.
    //   주의: 강제 throw 가 아닌 errors.push (caller 가 retry/throw 결정).
    if (isMultiCity && d?.lodging_city) {
      const lodgingCity = String(d.lodging_city).trim();
      const dayCity = String(d.city || '').trim();
      const intercityTo = String(d.intercity_transit?.to_city || '').trim();
      const lodgingCityLow = lodgingCity.toLowerCase();
      if (d.intercity_transit?.to_city) {
        // city-change day → lodging_city = to_city
        if (intercityTo.toLowerCase() !== lodgingCityLow) {
          errors.push(
            `Day ${dayNum}: city-change day lodging_city="${lodgingCity}" ≠ intercity_transit.to_city="${intercityTo}" (B-LCC)`
          );
        }
      } else if (dayCity) {
        // 일반 day → lodging_city = day.city
        if (dayCity.toLowerCase() !== lodgingCityLow) {
          errors.push(
            `Day ${dayNum}: lodging_city="${lodgingCity}" ≠ day.city="${dayCity}" (B-LCC)`
          );
        }
      }
    }

    // B-14: stop start_time hour < 24. "HH:MM" 형식. 25:00 / 24:30 등 차단.
    for (const s of stops) {
      const t = s?.start_time || '';
      if (typeof t === 'string' && /^(\d{2}):(\d{2})$/.test(t)) {
        const m = t.match(/^(\d{2}):(\d{2})$/);
        const hour = parseInt(m[1], 10);
        const min  = parseInt(m[2], 10);
        if (hour >= 24) {
          errors.push(`Day ${dayNum} stop "${s.name || s.display_name || '?'}": start_time="${t}" >= 24:00 invalid (B-14)`);
        }
        if (min >= 60) {
          errors.push(`Day ${dayNum} stop "${s.name || s.display_name || '?'}": start_time="${t}" minutes >= 60 invalid (B-14)`);
        }
      }
    }

    // B-MEAL (2026-05-13 PR #407 → PR #410 boundary widening → PR #464 X-H6 snack slot):
    // 식사 slot 시간대 검증.
    // 사용자 PDF 보고 (Guest-5--2026-05-14): Day 2 저녁 누락 (hotel return 17:43 종료).
    // buildPrompt.js:541 명시: "1 dedicated lunch + 1 dinner per full day (category: food)".
    // 기존 validator 가 강제 안 함 → Gemini 가 lazy 응답해도 통과.
    //
    // 2026-05-13 PR #410 boundary widening 사유 (P40 메모리 등록):
    //   원본 PR #407 boundary [11,14) + [17,21) 가 너무 좁음 — 사용자 본인 PDF Day 4
    //   lunch 14:16 (Gijang Seafood Kalguksu) 가 14 >= 14 → fail-positive 차단!
    //   이는 실제 정상 plan 인데 validator 가 false-positive 차단 → retry → throw 500 → 환불.
    //
    // 2026-05-16 PR #464 (Audit X-H6) snack slot 추가:
    //   원본 boundary lunch [11,15) + dinner [17,22) — 15:00~16:59 사이 food stop 은
    //   neither lunch nor dinner 로 silent ignore. Gemini 가 사용자에게 "오후 카페/디저트
    //   stop" (e.g. 15:30 Sulbing 빙수, 16:00 Anthracite Coffee) 만 넣으면 lunchCount=0
    //   → 'B-MEAL-LUNCH 누락' false-positive → retry 강제 → Gemini quota burn (PR #461
    //   retryModel 도입 후에도 quota 사용량 ↑).
    //   해결: snack slot [15,17) 명시 카운트, 점심 요구사항은 lunch OR snack 만족하면 통과.
    //   저녁은 그대로 [17,22) 유지 (저녁은 분명한 메인 식사).
    //
    // 2026-05-17 PR (Audit follow-up): breakfast slot 추가.
    //   운영자 본인 plan 생성 검증 시 출국일 Day 4 에서 매번 'B-MEAL' fail 알림 (10분 6건).
    //   원인: 이른 아침 출국편 (예: 09:00 ICN) 시나리오에서 Gemini 가 breakfast(08:00)
    //   + checkout(11:00 lodging) + airport(12:00 travel) 만 출력 → food stop in [11,22) 가
    //   없어 B-MEAL fail → user HTTP 500. real customer 도 동일 패턴 fail 가능.
    //   해결: breakfast slot [06,11) 명시 카운트. 도착/출국일은 "아침/오후/저녁 중 최소 1식"
    //   으로 완화. full day 는 점심/snack + 저녁 유지 (breakfast 는 bonus).
    //
    // 정의:
    //   - 아침 slot: start_time hour ∈ [06, 11) — 06:00~10:59 (early departure / late arrival)
    //   - 점심/오후식사 slot: start_time hour ∈ [11, 17) — 11:00~16:59
    //     (subset: lunch [11,15) + snack [15,17) — 텔레메트리만 분리)
    //   - 저녁 slot: start_time hour ∈ [17, 22) — 17:00~21:59
    //   - first/last day (도착/출국일): 아침 OR 점심/snack OR 저녁 중 최소 1개
    //   - full day (중간 day): 점심/snack + 저녁 둘 다 필수 (아침은 bonus, 강제 X)
    //   - 단일일 plan (days.length === 1): full day 와 동일 처리
    //
    // HARD validation — caller 가 1회 retry. 회귀 슈트 B-MEAL 와 동일 기준.
    //
    // 2026-05-13 PR #412 env flag (P40 일환): `VALIDATOR_BMEAL_ENABLED=false` 시 skip.
    // 운영자 비상 circuit breaker — Gemini 가 일관되게 식사 시간대 못 맞추면 일시 비활성.
    if (process.env.VALIDATOR_BMEAL_ENABLED !== 'false') {
      const foodStops = stops.filter((s) => s?.category === 'food');
      const matchHour = (s, lo, hi) => {
        const t = String(s?.start_time || '');
        const m = t.match(/^(\d{2}):(\d{2})$/);
        if (!m) return false;
        const h = parseInt(m[1], 10);
        return h >= lo && h < hi;
      };
      // PR #467-like (X-H6 follow-up): breakfast slot for early-departure / late-arrival days.
      const breakfastCount = foodStops.filter((s) => matchHour(s, 6, 11)).length;
      const lunchCount = foodStops.filter((s) => matchHour(s, 11, 15)).length;
      // PR #464 (X-H6): explicit snack slot for telemetry + lenient lunch counting.
      const snackCount = foodStops.filter((s) => matchHour(s, 15, 17)).length;
      const dinnerCount = foodStops.filter((s) => matchHour(s, 17, 22)).length;
      // afternoonMealCount satisfies the "afternoon meal" requirement —
      // lunch (11-14:59) OR snack (15-16:59) both pass.
      const afternoonMealCount = lunchCount + snackCount;
      const isSingleDay = days.length === 1;
      const isFirst = i === 0 && !isSingleDay;
      const isLast = i === days.length - 1 && !isSingleDay;

      // 2026-05-13 PR #410 telemetry: B-MEAL hit/miss 통계 prod 디버그용.
      // Vercel function logs 에서 grep '[validator] B-MEAL' 로 검색 가능.
      // PR #464: snackCount + (X-H6 follow-up) breakfastCount 추가 — meal pattern 분석.
      // 2026-05-17 (PR follow-up): foodStops=0 케이스도 unconditional 로그 — Gemini 가
      // 출국일에 lodging/travel 만 출력하는 회귀를 logs 에서 즉시 식별 가능.
      // categories breakdown 도 포함 — food vs lodging vs travel vs attraction 분포 확인.
      const categoryCounts = stops.reduce((acc, s) => {
        const cat = s?.category || 'unknown';
        acc[cat] = (acc[cat] || 0) + 1;
        return acc;
      }, {});
      const categoryStr = Object.entries(categoryCounts).map(([k, v]) => `${k}=${v}`).join(',');
      console.log(
        `[validator] B-MEAL Day ${dayNum}: foodStops=${foodStops.length} breakfast=${breakfastCount} lunch=${lunchCount} snack=${snackCount} dinner=${dinnerCount} ` +
        `isFirst=${isFirst} isLast=${isLast} times=[${foodStops.map((s) => s.start_time || '?').join(',')}] ` +
        `allCategories=[${categoryStr}] totalStops=${stops.length}`
      );

      if (isFirst) {
        // 도착일 — 아침 OR 점심/snack OR 저녁 중 최소 1개 (늦은 도착 시나리오 수용)
        if (breakfastCount === 0 && afternoonMealCount === 0 && dinnerCount === 0) {
          errors.push(
            `Day ${dayNum} (도착일): 아침(06-10시)+오후식사(11-16시)+저녁(17-21시) 모두 누락 (B-MEAL)`
          );
        }
      } else if (isLast) {
        // 출국일 — P137 (2026-05-21): departure_time 기준 3-tier strict 검증
        // plan ba10d29b 회귀: Day 5 출국일 food 0건 → B-MEAL 미감지 누락.
        // departure_time 미제공 시 기존 3-slot 로직 유지 (backward compat).
        const depMin = (() => {
          const raw = request.departure_time || request.departureTime;
          if (!raw) return null;
          const mm = /^(\d{1,2}):(\d{2})$/.exec(String(raw));
          if (!mm) return null;
          const h = parseInt(mm[1], 10);
          const mi = parseInt(mm[2], 10);
          if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
          return h * 60 + mi;
        })();

        if (depMin === null) {
          // departure_time 미제공 — 3개 slot 모두 0이면 에러.
          // 2026-06-22 (Sentry JAVASCRIPT-REACT-3): 공항/이동 stop 이 있으면(=실제 출국일)
          //   이른/red-eye 출국으로 식사할 시간이 없는 정상 케이스 → 식사 면제(500 방지).
          //   공항/이동 흔적 없는 마지막날(=사실상 풀데이 오인)만 식사 요구 유지.
          const hasDepartureStop = stops.some((s) => ['airport', 'travel'].includes(s?.category));
          if (!hasDepartureStop && breakfastCount === 0 && afternoonMealCount === 0 && dinnerCount === 0) {
            errors.push(
              `Day ${dayNum} (출국일): 아침(06-10시)+오후식사(11-16시)+저녁(17-21시) 모두 누락 (B-MEAL)`
            );
          }
        } else {
          const depHour = Math.floor(depMin / 60);
          // #7 (2026-06-20): red-eye (출국 < 09:00) B-MEAL ↔ B-EARLY-DEPARTURE 충돌 해소.
          //   B-EARLY-DEPARTURE 는 red-eye 시 마지막날 stops ≤ 2 (체크아웃 + 공항) 만 허용.
          //   동시에 B-MEAL 이 조식(food stop) 1건을 강제하면 stops=3 → B-EARLY-DEPARTURE fail,
          //   조식 빼면 B-MEAL fail → "넣어도 빼도 실패" trap. red-eye 손님은 새벽 출국으로
          //   조식 먹을 시간 자체가 없으므로 조식 요구를 면제한다 (depHour >= 9 인 이른 출국만 조식 강제).
          const isRedEyeDeparture = depHour < 9;
          if (depHour < 11) {
            // 이른 출국 (09:00-10:59): breakfast slot [06,11) 1건 필수.
            // red-eye (< 09:00) 는 조식 면제 (B-EARLY-DEPARTURE 2-stop 룰과 정합).
            if (breakfastCount === 0 && !isRedEyeDeparture) {
              errors.push(
                `Day ${dayNum} (출국일): departure_time=${request.departure_time || request.departureTime} 이른 출국 — 조식(06-10시) 누락 (B-MEAL, P137)`
              );
            }
          } else if (depHour < 17) {
            // 낮 출국 (11:00-16:59): breakfast OR lunch/snack 최소 1건
            if (breakfastCount === 0 && afternoonMealCount === 0) {
              errors.push(
                `Day ${dayNum} (출국일): departure_time=${request.departure_time || request.departureTime} 낮 출국 — 조식(06-10시)/오후식사(11-16시) 모두 누락 (B-MEAL, P137)`
              );
            }
          } else {
            // 저녁 출국 (>= 17:00): breakfast + lunch/snack 둘 다 의무
            if (breakfastCount === 0 && afternoonMealCount === 0) {
              // 둘 다 없음 — 기본 B-MEAL
              errors.push(
                `Day ${dayNum} (출국일): departure_time=${request.departure_time || request.departureTime} 저녁 출국 — 조식+오후식사 모두 누락 (B-MEAL-DEPARTURE-LATE, P137)`
              );
            } else if (breakfastCount === 0) {
              // 오후식사는 있지만 breakfast 없음
              errors.push(
                `Day ${dayNum} (출국일): departure_time=${request.departure_time || request.departureTime} 저녁 출국 — 조식(06-10시) 누락 (B-MEAL-DEPARTURE-BREAKFAST, P137)`
              );
            } else if (afternoonMealCount === 0) {
              // breakfast는 있지만 오후식사 없음
              errors.push(
                `Day ${dayNum} (출국일): departure_time=${request.departure_time || request.departureTime} 저녁 출국 — 오후식사(11-16시) 누락 (B-MEAL-DEPARTURE-LUNCH, P137)`
              );
            }
          }
        }
      } else {
        // full day (또는 단일일) — 점심/snack + 저녁 둘 다 필수
        if (afternoonMealCount === 0) errors.push(`Day ${dayNum}: 오후식사(11-16시, 점심 또는 snack) food stop 누락 (B-MEAL-LUNCH)`);
        if (dinnerCount === 0) errors.push(`Day ${dayNum}: 저녁(17-21시) food stop 누락 (B-MEAL-DINNER)`);
      }
    }
  }

  // B-16: PDF 사전조건 — arrival_guide.airport OR departure_guide.airport 둘 다 누락 차단.
  // 2026-05-12 자율 검증 시스템 1차 fix:
  //   회귀 슈트 (validate-prod-regression.mjs L500-519) 가 prod 에서 자동 감지 — Gemini
  //   가 prompt "REQUIRED" 절을 무시하고 departure_guide.airport 누락 반환 → PDF 마지막
  //   페이지 빈 페이지. 운영자가 PDF 만들기 전엔 모름.
  //
  //   HARD validation 기준 (plan 저장 차단):
  //     - itinerary.arrival_guide.airport (non-empty) OR
  //     - itinerary.departure_guide.airport (non-empty)
  //     둘 다 누락이면 errors.push → 1회 retry → 그래도 실패면 PLAN_VALIDATION_FAILED.
  //
  //   "둘 중 하나" 기준 사용 이유: arrival_airport="already_in_korea" 시 arrival_guide
  //   skip 가능 (buildPrompt.js L320). 하지만 둘 다 누락 = PDF 양쪽 페이지 모두 빈 칸.
  //   buildPrompt 는 "departure_guide 는 항상 포함" 명시했지만 Gemini 가 무시.
  //   single source of truth = backend validator.
  {
    const ag = itinerary.arrival_guide || {};
    const dg = itinerary.departure_guide || {};
    const arrivalAirportStr = String(ag.airport || '').trim();
    const departureAirportStr = String(dg.airport || '').trim();
    if (!arrivalAirportStr && !departureAirportStr) {
      errors.push(
        'Plan: arrival_guide.airport OR departure_guide.airport 모두 누락 (B-16)'
      );
    }
  }

  // B-15: 출국일 (마지막 day) 공항 stop 또는 travel|airport category 또는 day-level meta 존재.
  // departure_airport 입력 있을 때만 검증 (예: "ALREADY" 또는 미입력은 검증 skip).
  // arrival_airport 만 있는 경우도 출국 = 도착 공항 가정 (ai-planner-full.js L135 와 동일).
  // 회귀 슈트 (scripts/validate-prod-regression.mjs L368-385) 와 동일 기준 통일:
  //  - stop.category ∈ {travel, airport}
  //  - stop name/addr 에 공항 토큰 (공항/airport/ICN/GMP/PUS/CJU/인천/김포/김해/제주/空港/国際線)
  //  - day-level meta (return_to_airport / airport_transfer)
  //  - 마지막 stop 의 transit_to_airport 또는 next_destination='airport'
  const effectiveDepAirport = departureAirport || arrivalAirport;
  if (effectiveDepAirport && effectiveDepAirport !== 'ALREADY' && effectiveDepAirport !== 'already_in_korea' && days.length > 0) {
    const lastDay = days[days.length - 1];
    const lastStops = Array.isArray(lastDay?.stops) ? lastDay.stops : [];
    const airportTokenRe = /공항|airport|空港|国際線|국제선|ICN|GMP|PUS|CJU|인천|김포|김해|제주/i;
    const hasAirportStop = lastStops.some((s) => {
      if (!s) return false;
      if (s.category === 'travel' || s.category === 'airport') return true;
      const name = String(s.name || s.display_name || '');
      const addr = String(s.address || '');
      return airportTokenRe.test(name) || airportTokenRe.test(addr);
    });
    const hasAirportMeta =
      !!(lastDay?.return_to_airport || lastDay?.airport_transfer) ||
      (lastStops.length > 0 &&
        (lastStops[lastStops.length - 1]?.transit_to_airport ||
          lastStops[lastStops.length - 1]?.next_destination === 'airport'));
    if (!hasAirportStop && !hasAirportMeta) {
      const lastDayNum = lastDay?.day || days.length;
      errors.push(
        `Day ${lastDayNum} (출국일): 공항 stop/airport|travel category/return_to_airport meta 모두 누락 (departure_airport=${effectiveDepAirport}) (B-15)`
      );
    }
  }

  // P124 (2026-05-20): B-LATE-ARRIVAL / B-EARLY-DEPARTURE — Day 1/N 의 늦은 도착
  // / 이른 출국 edge case. plan 5aeeecef 회귀: arrival 23:05 인데 Day1 stops 01:10
  // /02:03/02:37 새벽 활동. arrival_time + 9h sleep buffer 강제.
  const parseHHMM = (s) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const mi = parseInt(m[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    return h * 60 + mi;
  };
  const arrivalMin = parseHHMM(request.arrival_time || request.arrivalTime);
  const departureMin = parseHHMM(request.departure_time || request.departureTime);
  // P239 (2026-05-27): tour_start_time 도입 — 운영자 architectural fix.
  // 옛 B-LATE-ARRIVAL (arrival + 9h sleep buffer 룰) 가 새벽 도착 시 다음날 새벽 wrap → P159 cascade.
  // 신 룰 = tour_start_time 기준 (default '09:00') — arrival_time 무관하게 stops[1+] 시각 강제.
  // root cause level 해소: P159 새벽 stops / P136 24h wrap / B-13 false positive 부분 완화.
  const tourStartMin = parseHHMM(request.tour_start_time || request.tourStartTime || '09:00');

  // B-LATE-ARRIVAL: Day 1 검증 — P239 신 룰 (tour_start_time 기준)
  if (arrivalMin !== null) {
    const day1 = days[0];
    const day1Stops = Array.isArray(day1?.stops) ? day1.stops : [];
    const arrivalPlus60 = arrivalMin + 60;
    // P239: 18:00+ 도착 → Day 1 = lodging only 권장 (다음날 tour_start_time 부터 stops).
    // 옛 룰 (arrival + 9h wrap) 은 새벽 wrap → cascade fallback 트리거. 신 룰 = 단순 시각 컷.
    const isLateNightArrival = arrivalMin >= 18 * 60;
    if (isLateNightArrival && day1Stops.length > 2) {
      errors.push(`Day 1: arrival_time=${request.arrival_time || request.arrivalTime} (18:00 이후) → Day 1 = lodging only 권장. 현재 stops=${day1Stops.length} (B-LATE-ARRIVAL P239)`);
    }
    // Day 1 의 lodging 외 카테고리 stops 검증
    for (const stop of day1Stops) {
      if (stop?.category === 'lodging' || stop?.category === 'airport' || stop?.category === 'travel') continue;
      const stopMin = parseHHMM(stop?.start_time);
      if (stopMin === null) continue;
      // P239: stops[1+] 시각이 tour_start_time 이전이면 ERROR.
      // 단 arrival_time+60 > tour_start_time 인 경우 (낮 도착) arrival+60 우선 폴백.
      const effectiveTourStart = Math.max(tourStartMin || 0, arrivalPlus60);
      // stop 가 arrival_time 이후 + effective 시각 이전이면 ERROR. arrival 이전 stop 는 다른 룰.
      if (stopMin >= arrivalMin && stopMin < effectiveTourStart) {
        errors.push(`Day 1 stop "${stop.name || stop.display_name || '?'}" start_time=${stop.start_time} < tour_start_time=${request.tour_start_time || request.tourStartTime || '09:00'} (B-LATE-ARRIVAL P239)`);
      }
      // P286 (2026-05-29): arrival-wrap edge — stop time < arrival 이면서 hour < 5 면 new-day wrap 의심.
      // 이전 코드 = 새벽 체크가 outer if (stopMin >= arrivalMin) 안 → stopMin < arrivalMin 인 wrap stop 누락.
      // Agent 1 audit #5: arrival='23:15' + stop='01:10' = wrap stop → 새벽 활동 미감지 sleeper bug.
      // Fix: 새벽 체크를 outer if 밖으로 move — stopMin < arrivalMin 시에도 (wrap 의심) error 박제.
      const stopHour = Math.floor(stopMin / 60);
      if (stopHour < 5) {
        const wrapHint = stopMin < arrivalMin ? ' — arrival-wrap edge 의심 (P286)' : '';
        errors.push(`Day 1 stop "${stop.name || stop.display_name || '?'}" 새벽 활동 (start_time=${stop.start_time}, hour<5, category=${stop.category}) (B-LATE-ARRIVAL P239)${wrapHint}`);
      }
    }
  }

  // B-EARLY-DEPARTURE: Day N 검증
  if (departureMin !== null && days.length > 0) {
    const lastDayIdx = days.length - 1;
    const dayN = days[lastDayIdx];
    const dayNStops = Array.isArray(dayN?.stops) ? dayN.stops : [];
    const maxActivityMin = departureMin - 3 * 60; // departure - 3h 공항 buffer
    const isRedEye = departureMin < 9 * 60; // 09:00 이전 출국 = 새벽 출국
    if (isRedEye && dayNStops.length > 2) {
      errors.push(`Day ${lastDayIdx + 1} (출국일): departure_time=${request.departure_time || request.departureTime} red-eye → 호텔 체크아웃 + airport 2 stops 만 의무. 현재 stops=${dayNStops.length} (B-EARLY-DEPARTURE)`);
    }
    for (const stop of dayNStops) {
      if (stop?.category === 'lodging' || stop?.category === 'airport' || stop?.category === 'travel') continue;
      const stopMin = parseHHMM(stop?.start_time);
      if (stopMin === null) continue;
      if (stopMin > maxActivityMin && stopMin < departureMin) {
        errors.push(`Day ${lastDayIdx + 1} stop "${stop.name || stop.display_name || '?'}" start_time=${stop.start_time} > departure-3h 공항 buffer (B-EARLY-DEPARTURE)`);
      }
      const stopHour = Math.floor(stopMin / 60);
      if (stopHour < 5 && isRedEye) {
        errors.push(`Day ${lastDayIdx + 1} stop "${stop.name || stop.display_name || '?'}" 출국일 새벽 활동 (hour<5, category=${stop.category}) (B-EARLY-DEPARTURE)`);
      }
    }
  }

  // B-GLOBAL-DAWN (P124-extended, 2026-05-21): 중간 day (Day 2 ~ N-1) 새벽 stops 금지.
  // plan 54805380 회귀: Day 2-4 의 01:57 lodging / 03:06 갈비집 / 04:45 lodging /
  // Day 3 01:36 lodging / Day 4 02:43 lodging. B-LATE-ARRIVAL/B-EARLY-DEPARTURE
  // 는 Day 1/N + arrival/departure_time 입력 있을 때만 fire — 중간 day 는 별도 룰.
  // 중간 day 의 lodging stop 도 [00, 04] 금지 (RouteAgent time stitching wrap 회귀).
  for (let i = 1; i < days.length - 1; i++) {
    const d = days[i];
    const dayNum = d?.day || i + 1;
    const dayStops = Array.isArray(d?.stops) ? d.stops : [];
    for (const stop of dayStops) {
      const stopMin = parseHHMM(stop?.start_time);
      if (stopMin === null) continue;
      const stopHour = Math.floor(stopMin / 60);
      if (stopHour >= 5) continue;
      errors.push(`Day ${dayNum} 중간 day 새벽 stop "${stop.name || stop.display_name || '?'}" (start_time=${stop.start_time}, category=${stop?.category}) — 모든 day 의 00-04시 stop 금지 (B-GLOBAL-DAWN)`);
    }
  }

  return errors;
}

/**
 * 2026-05-12: SOFT quality warnings — plan 저장은 OK, telegram alert 만.
 *
 * 자율 검증 시스템 1차 fix (B-18 다양성):
 *   회귀 슈트가 prod 에서 local_tag 비율 10% 감지 (목표 30%+). hard validation 으로
 *   차단하면 사용자 plan 실패 → 환불. CLAUDE.md J 항 SAFETY-CRITICAL 만 hard 차단.
 *   B-18 같은 quality 룰은 SOFT — plan 저장 + 운영자 알림 만.
 *
 * 계산 룰:
 *   - lodging / travel / airport category stop 은 비율 계산에서 제외 (관광·식사·카페만).
 *   - validLocalTags = ['Local Pick', 'Hidden Gem', 'Bakery Pilgrimage', 'Blue Ribbon']
 *   - 임계값 30% (회귀 슈트와 동일).
 *   - food/attraction stop 총합 < 5 면 검사 skip (작은 plan 통계적 부정확).
 *
 * @returns {Array<{type:string, severity:string, ...}>} warnings (빈 배열이면 정상).
 *          Caller (geminiPipeline) 가 throttledTelegramAlert 로 발송.
 */
export function checkSoftQualityWarnings(itinerary) {
  const warnings = [];
  if (!itinerary || !Array.isArray(itinerary.days)) return warnings;

  const validLocalTags = ['Local Pick', 'Hidden Gem', 'Bakery Pilgrimage', 'Blue Ribbon'];
  const excludedCategories = new Set(['lodging', 'travel', 'airport']);

  let totalEligible = 0;
  let localTagCount = 0;
  for (const day of itinerary.days) {
    for (const stop of (day.stops || [])) {
      const cat = String(stop?.category || '').toLowerCase();
      if (excludedCategories.has(cat)) continue;
      totalEligible++;
      const tag = String(stop?.local_tag || '').trim();
      if (tag && validLocalTags.includes(tag)) localTagCount++;
    }
  }

  // 통계적 유의성 — 5 미만은 비율이 너무 흔들림.
  if (totalEligible < 5) return warnings;

  const ratio = localTagCount / totalEligible;
  if (ratio < 0.30) {
    warnings.push({
      type: 'local_tag_underfill',
      severity: 'low',
      ratio,
      localTagCount,
      totalEligible,
      message: `local_tag 비율 ${(ratio * 100).toFixed(0)}% (${localTagCount}/${totalEligible}) < 30% 목표 (B-18)`,
    });
  }

  return warnings;
}

/**
 * P324 (2026-05-31): block_mode dietary SAFETY — block_mode 는 handlerCore:319 `if(!itinerary)` 가드로
 * runGeminiPipeline(= validateResponse, 유일한 dietary/allergen 검증처)을 우회 → dietary_coverage_low /
 * allergen_warning 0건 → 알레르기(견과/갑각류/글루텐/유제품) 무방비 + 할랄/비건 coverage 미박제.
 * fix: 후처리에서 동일 검증 함수 재사용 (warning-only, P280 retry loop 회피, buildPrompt 변경 0).
 * violation critical-retry 는 제외 — block_mode 3중 게이트(fetch/eligible/placeholder throw)가 식당
 * 매칭 보장하므로 알레르기 가시화가 최우선 gap. legacy 는 validateResponse 가 이미 처리하므로 본 helper 미호출.
 *
 * #9 (2026-06-20) SAFETY-CRITICAL: 위 allergen_warning 은 admin-only (quality_warnings) 라
 *   손님이 못 본다. 알레르기 선택 손님의 block_mode food stop 에 **사용자 표시** 고지
 *   ('inform restaurant about your allergy') 를 tip 에 주입 (legacy _food_helper.js:352 와 동등).
 *   list 가 allergen-screened 가 아니므로 keyword 매칭 stop 만이 아니라 **모든 food stop** 에 박는다
 *   (누락=SAFETY 위반). 4언어 (language) — 손님 언어로.
 *
 * @param {object} itinerary - mutated in-place (quality_warnings push + food stop tip 주입)
 * @param {string[]} dietary - dietaryAll (dietPrefs + allergies 합집합, P298)
 * @param {object} [opts]
 * @param {string} [opts.language] - 손님 언어 (ko/en/ja/zh). 사용자 표시 고지 언어 선택.
 * @returns {number} 박제된 warning 수
 */
export function applyBlockModeDietaryWarnings(itinerary, dietary, opts = {}) {
  if (!itinerary || typeof itinerary !== 'object') return 0;
  if (!Array.isArray(dietary) || dietary.length === 0) return 0;
  const allStops = (itinerary.days || []).flatMap((d) => (d.stops || []));
  const out = [];
  const coverageIssues = checkDietaryCoverage(allStops, dietary) || [];
  for (const ci of coverageIssues) {
    out.push({
      type: 'dietary_coverage_low',
      severity: 'warning',
      dietary_pref: ci.dietary_pref,
      coverage: ci.coverage,
      match_count: ci.match_count,
      food_stops_count: ci.food_stops_count,
      message: `P324(block_mode): ${ci.dietary_pref} coverage ${Math.round(ci.coverage * 100)}% (${ci.match_count}/${ci.food_stops_count} food stops). 운영자 admin 확인 + 사용자 수동 회피 권고.`,
    });
  }
  const allergenWarnings = checkAllergenWarnings(allStops, dietary) || [];
  for (const aw of allergenWarnings) {
    out.push({
      type: 'allergen_warning',
      severity: 'warning',
      stop: aw.stop,
      allergen: aw.allergen,
      message: `P324(block_mode): '${aw.stop}' 에 ${aw.allergen} 알레르기 유발 재료 가능성 — 사용자 확인 권고 (운영자 admin panel).`,
    });
  }

  // #9: 사용자 표시 알레르기 고지 — 손님이 선택한 알레르기 4종 중 활성된 것만 라벨에 표기.
  const activeAllergens = [];
  for (const d of dietary) {
    const key = ALLERGEN_PREF_MAP[d];
    if (key && !activeAllergens.includes(key)) activeAllergens.push(key);
  }
  if (activeAllergens.length > 0) {
    const lang = (opts.language && ['ko', 'en', 'ja', 'zh'].includes(opts.language)) ? opts.language : 'en';
    const labels = activeAllergens.map((a) => allergenLabel(a, lang)).join(', ');
    const noticeFn = BLOCKMODE_ALLERGEN_NOTICE[lang] || BLOCKMODE_ALLERGEN_NOTICE.en;
    const noticeText = noticeFn(labels);
    for (const stop of allStops) {
      if (!stop || stop.category !== 'food') continue;
      const existingTip = typeof stop.tip === 'string' ? stop.tip : '';
      // 멱등성: 재실행/재dispatch 시 중복 주입 방지 (⚠️ 마커 + label 동일 조각 검사).
      if (existingTip.includes(noticeText)) continue;
      stop.tip = existingTip ? `${existingTip}\n\n${noticeText}` : noticeText;
    }
  }

  if (out.length > 0) {
    itinerary.quality_warnings = itinerary.quality_warnings || [];
    itinerary.quality_warnings.push(...out);
  }
  return out.length;
}

export function validateResponse(data, request, foodIndex) {
  const issues = [];
  const allStops = (data.days || []).flatMap(d => (d.stops || []));
  // P0-3: request.dietary — 호출자가 사용자 식이제한 (Halal/Vegan/...) 전달 시 위반 검사.
  // 누락이면 검사 skip — 기존 caller 호환 (geminiPipeline 만 dietary 전달).
  const dietary = Array.isArray(request?.dietary) ? request.dietary : [];

  // P280 v2 (2026-05-29): dietary coverage depth check — severity='warning' (P280 v1 retry loop 회피).
  // food stops 중 dietary-claim ratio < 50% → 'dietary_coverage_low' warning 박제 (admin panel 노출).
  // SAFETY-CRITICAL 부분 보호 — Gemini retry 없이 운영자 가시화.
  const coverageIssues = checkDietaryCoverage(allStops, dietary);
  if (coverageIssues) {
    for (const ci of coverageIssues) {
      issues.push({
        type: 'dietary_coverage_low',
        severity: 'warning',  // P280 v2: critical → warning (retry loop 차단)
        dietary_pref: ci.dietary_pref,
        coverage: ci.coverage,
        match_count: ci.match_count,
        food_stops_count: ci.food_stops_count,
        message: `P280 v2: ${ci.dietary_pref} coverage ${Math.round(ci.coverage * 100)}% (${ci.match_count}/${ci.food_stops_count} food stops). 운영자 admin panel 확인 + 사용자 수동 회피 권고.`,
      });
    }
  }

  // B6 (P310 2026-05-30): 알레르기 4종 (Nuts/Shellfish/Gluten/Dairy) 텍스트 기반 검출.
  // SAFETY-CRITICAL 이지만 severity='warning' (P280 v1 무한 retry 사고 회피). 명시적
  // 재료명만 → admin 가시화 우선. critical 승격은 false-positive rate 측정 + DB retrofit 후.
  const allergenWarnings = checkAllergenWarnings(allStops, dietary);
  if (allergenWarnings) {
    for (const aw of allergenWarnings) {
      issues.push({
        type: 'allergen_warning',
        severity: 'warning',  // 절대 critical 금지 (retry loop 차단)
        stop: aw.stop,
        allergen: aw.allergen,
        message: `B6: '${aw.stop}' 에 ${aw.allergen} 알레르기 유발 재료 가능성 — 사용자 확인 권고 (운영자 admin panel).`,
      });
    }
  }

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

  // R-P246 (2026-05-27): DMZ city-mismatch guard — input=seoul + styles=Dmz 인데
  // 제주/부산 stops 생성 (한림공원/협재해변/해운대 등) 차단.
  // SOFT check only (no retry/throw) — Telegram alert 발사 + issues 로그 기록.
  // DMZ stops MUST be in Seoul/Gyeonggi-do (경기도 파주시). Never Jeju, Busan, etc.
  const reqStyles = Array.isArray(request?.styles) ? request.styles : [];
  if (reqStyles.some((s) => String(s).toLowerCase() === 'dmz')) {
    // 제주/부산 관련 주소 키워드 (읍/리 level 포함).
    const DMZ_CITY_VIOLATION_PATTERNS = [
      '제주특별자치도', '제주시', '서귀포시', '제주도', '제주',
      '부산광역시', '해운대구', '수영구', '부산',
      '속초시', '강릉시', '여수시', '경주시',
    ];
    const dmzViolations = [];
    for (const stop of allStops) {
      // address 기준으로만 city 판단 — name 에 "제주" 포함은 false-positive 가능.
      const addr = String(stop.address || '');
      if (!addr) continue; // 주소 없는 stop 은 skip (block-mode placeholder)
      const matched = DMZ_CITY_VIOLATION_PATTERNS.find((p) => addr.includes(p));
      if (matched) {
        const stopLabel = stop.name || stop.display_name || '';
        dmzViolations.push({
          type: 'dmz_city_mismatch',
          stop: stopLabel,
          address: addr,
          matched_keyword: matched,
        });
        issues.push({
          type: 'dmz_city_mismatch',
          stop: stopLabel,
          matched_keyword: matched,
        });
      }
    }
    if (dmzViolations.length > 0) {
      console.error('[P246 DMZ_CITY_MISMATCH]', JSON.stringify({ count: dmzViolations.length, violations: dmzViolations }));
      // 비동기 alert — throw 막지 않음 (soft validator).
      throttledTelegramAlert(
        `🚨 P246 DMZ_CITY_MISMATCH: styles=Dmz 인데 ${dmzViolations.length}개 stop 이 제주/부산 등 비DMZ 지역.\n` +
        dmzViolations.slice(0, 3).map((v) => `• ${v.stop} @ ${v.address}`).join('\n'),
      ).catch(() => {});
    }
  }

  // R-P248 (2026-05-27): Haenyeo city-mismatch guard — styles=Haenyeo 인데
  // 비제주(서울/부산 등) stops 생성 차단 (P246 follow-up).
  // SOFT check only (no retry/throw) — Telegram alert 발사 + issues 로그 기록.
  // Haenyeo stops MUST be in Jeju (제주도). Never Seoul, Busan, Paju, etc.
  if (reqStyles.some((s) => String(s).toLowerCase() === 'haenyeo')) {
    // 비제주 주소 키워드 — 서울/경기/부산/기타 광역시 level.
    const HAENYEO_CITY_VIOLATION_PATTERNS = [
      '서울특별시', '서울시', '서울',
      '경기도', '파주시', '고양시', '수원시', '성남시', '용인시', '인천광역시',
      '부산광역시', '해운대구', '수영구', '부산',
      '대구광역시', '대구', '광주광역시', '광주',
      '대전광역시', '대전', '울산광역시', '울산',
      '강원도', '속초시', '강릉시', '경주시', '전주시', '여수시',
    ];
    const haenyeoViolations = [];
    for (const stop of allStops) {
      // address 기준으로만 city 판단 — name 에 "해녀" 포함은 false-positive 가능.
      const addr = String(stop.address || '');
      if (!addr) continue; // 주소 없는 stop 은 skip (block-mode placeholder)
      const matched = HAENYEO_CITY_VIOLATION_PATTERNS.find((p) => addr.includes(p));
      if (matched) {
        const stopLabel = stop.name || stop.display_name || '';
        haenyeoViolations.push({
          type: 'haenyeo_city_mismatch',
          stop: stopLabel,
          address: addr,
          matched_keyword: matched,
        });
        issues.push({
          type: 'haenyeo_city_mismatch',
          stop: stopLabel,
          matched_keyword: matched,
        });
      }
    }
    if (haenyeoViolations.length > 0) {
      console.error('[P248 HAENYEO_CITY_MISMATCH]', JSON.stringify({ count: haenyeoViolations.length, violations: haenyeoViolations }));
      // 비동기 alert — throw 막지 않음 (soft validator).
      throttledTelegramAlert(
        `🚨 P248 HAENYEO_CITY_MISMATCH: styles=Haenyeo 인데 ${haenyeoViolations.length}개 stop 이 서울/부산 등 비제주 지역.\n` +
        haenyeoViolations.slice(0, 3).map((v) => `• ${v.stop} @ ${v.address}`).join('\n'),
      ).catch(() => {});
    }
  }

  // R-P282 (2026-05-29): HangangBike city-mismatch guard — styles=HangangBike 인데
  // 비-서울/경기 (제주/부산/속초 등) stops 생성 차단 (P246/P248 follow-up).
  // SOFT check only (no retry/throw) — Telegram alert 발사 + issues 로그 기록.
  // 한강 bike 코스 MUST be in Seoul/경기 (한강 본류). Never Jeju, Busan, etc.
  // Agent 2 deep-search 발견: prod plan `7431b522` (styles=['HangangBike']) 한강/bike 키워드 stop 0/7.
  if (reqStyles.some((s) => String(s).toLowerCase() === 'hangangbike')) {
    // 비-서울/경기 주소 키워드 — 광역시/도 level + 시 level (서울/경기 외).
    const HANGANGBIKE_CITY_VIOLATION_PATTERNS = [
      '부산광역시', '해운대구', '수영구', '부산',
      '대구광역시', '대구', '광주광역시', '광주',
      '대전광역시', '대전', '울산광역시', '울산',
      '제주특별자치도', '제주시', '서귀포시', '제주도', '제주',
      '강원도', '속초시', '강릉시',
      '경주시', '전주시', '여수시',
      '충청남도', '충청북도', '전라남도', '전라북도', '경상남도', '경상북도',
    ];
    const hangangBikeViolations = [];
    for (const stop of allStops) {
      const addr = String(stop.address || '');
      if (!addr) continue;
      const matched = HANGANGBIKE_CITY_VIOLATION_PATTERNS.find((p) => addr.includes(p));
      if (matched) {
        const stopLabel = stop.name || stop.display_name || '';
        hangangBikeViolations.push({
          type: 'hangangbike_city_mismatch',
          stop: stopLabel,
          address: addr,
          matched_keyword: matched,
        });
        issues.push({
          type: 'hangangbike_city_mismatch',
          stop: stopLabel,
          matched_keyword: matched,
        });
      }
    }
    if (hangangBikeViolations.length > 0) {
      console.error('[P282 HANGANGBIKE_CITY_MISMATCH]', JSON.stringify({ count: hangangBikeViolations.length, violations: hangangBikeViolations }));
      throttledTelegramAlert(
        `🚨 P282 HANGANGBIKE_CITY_MISMATCH: styles=HangangBike 인데 ${hangangBikeViolations.length}개 stop 이 서울/경기 외 지역.\n` +
        hangangBikeViolations.slice(0, 3).map((v) => `• ${v.stop} @ ${v.address}`).join('\n'),
      ).catch(() => {});
    }
  }

  // P284 (2026-05-29): hotel_address single-city mismatch — Agent 1 audit #1.
  // B-13 multi-city 만 검증 → single-city plan 미검증 sleeper bug.
  // SOFT validator (warning 박제, retry trigger X — false positive risk, P196 lesson).
  // 호텔 토큰 (≥2자) 하나라도 lodging stop name/address 에 매칭 안 되면 mismatch.
  const reqHotelAddr = String(request?.hotel_address || request?.body?.hotel_address || '').trim();
  const reqRegions = Array.isArray(request?.regions)
    ? request.regions
    : (Array.isArray(request?.body?.regions) ? request.body.regions : []);
  const isMultiCityReq = reqRegions.length >= 2;
  if (reqHotelAddr && reqHotelAddr.length >= 3 && !isMultiCityReq) {
    // 광역 token 제외 — "서울" 같은 city-level token 매칭은 false positive (어느 stop 도 매칭).
    // specific token (동/구/호텔명) 만 사용 → strict 매칭.
    const GENERIC_TOKENS = new Set([
      '서울', '부산', '제주', '인천', '대구', '대전', '광주', '울산',
      '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남',
      '서울특별시', '부산광역시', '제주특별자치도', '인천광역시', '대구광역시',
      '대전광역시', '광주광역시', '울산광역시', '경기도', '강원도',
      '호텔', 'hotel', 'inn', 'hostel', '리조트', 'resort',
    ]);
    const hotelTokens = reqHotelAddr
      .split(/[\s,]+/)
      .filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t.toLowerCase()) && !GENERIC_TOKENS.has(t));
    const lodgingStops = allStops.filter((s) => s && s.category === 'lodging');
    if (hotelTokens.length > 0 && lodgingStops.length > 0) {
      const hotelMismatches = [];
      for (const stop of lodgingStops) {
        const hay = `${stop.name || ''} ${stop.display_name || ''} ${stop.address || ''}`.toLowerCase();
        const matched = hotelTokens.some((t) => hay.includes(t.toLowerCase()));
        if (!matched) {
          hotelMismatches.push({
            stop_name: stop.name || stop.display_name || '?',
            stop_address: stop.address || '',
          });
        }
      }
      if (hotelMismatches.length > 0) {
        issues.push({
          type: 'hotel_address_single_city_mismatch',
          severity: 'medium',
          hotel_address: reqHotelAddr,
          mismatch_count: hotelMismatches.length,
          mismatches: hotelMismatches.slice(0, 3),
          message: `P284: input hotel_address='${reqHotelAddr}' but ${hotelMismatches.length} lodging stops 미매칭 (사용자 시점 호텔 mismatch).`,
        });
        console.warn('[P284 hotel_address_single_city_mismatch]', JSON.stringify({ hotel: reqHotelAddr, mismatches: hotelMismatches.slice(0, 3) }));
      }
    }
  }

  // P282-B (2026-05-29): Jjimjilbang keyword coverage — niche style stop ≥ 1 강제.
  // 전국 분포라 city-mismatch 어려움 — keyword check (찜질방/jjimjilbang/sauna).
  // SOFT (warning 박제, retry trigger X).
  if (reqStyles.some((s) => String(s).toLowerCase() === 'jjimjilbang')) {
    const jjimjilbangMatched = allStops.filter((s) => {
      const hay = `${s.name || ''} ${s.display_name || ''} ${s.tip || ''}`.toLowerCase();
      return /찜질방|jjimjilbang|sauna|spa land/i.test(hay);
    });
    if (jjimjilbangMatched.length === 0) {
      issues.push({
        type: 'jjimjilbang_coverage_zero',
        severity: 'medium',
        message: `P282-B: styles=['Jjimjilbang'] but 0 stops match keyword (찜질방/jjimjilbang/sauna). niche style coverage missing — 사용자가 골랐는데 결과물에 안 보임.`,
      });
      console.warn('[P282-B jjimjilbang_coverage_zero] 0 stops match keyword');
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

    // #6 (2026-06-20): forward pass — index 별 "문자열 내부" 여부 마킹.
    //   backward walk 가 inString 을 추적 안 해서 `"address":"강남구 123` 처럼 문자열
    //   내부 숫자(또는 true/false/null 부분문자열)에서 cut → 열린 따옴표가 닫히지 않은
    //   조각을 JSON.parse 에 넘김 → 수리 실패. 숫자/리터럴 기반 cut 은 "문자열 밖"에서만
    //   유효한 JSON 종료점이다. 구조 토큰(}/]) 과 unescaped quote 는 backward 단독으로도
    //   안전하므로 inString 가드는 숫자/리터럴 cut 에만 적용한다.
    const inStringAt = new Array(repaired.length).fill(false);
    {
      let fwdInStr = false;
      for (let i = 0; i < repaired.length; i++) {
        const ch = repaired[i];
        if (ch === '\\' && fwdInStr) {
          inStringAt[i] = true;
          if (i + 1 < repaired.length) inStringAt[i + 1] = true; // escaped char stays in-string
          i++;
          continue;
        }
        if (ch === '"') {
          // 여는 따옴표는 문자열 시작(밖→안), 닫는 따옴표는 문자열 끝(안→밖).
          // 두 경우 모두 따옴표 자체 위치는 "경계"라 in-string 가드 대상이 아니다.
          fwdInStr = !fwdInStr;
          continue;
        }
        inStringAt[i] = fwdInStr;
      }
    }

    // Walk backward to find the last "safe" cut point
    let cutIdx = repaired.length;
    for (let i = repaired.length - 1; i > 0; i--) {
      const ch = repaired[i];
      if (ch === '}' || ch === ']') { cutIdx = i + 1; break; }
      if (ch === '"') {
        let bs = 0;
        for (let j = i - 1; j >= 0 && repaired[j] === '\\'; j--) bs++;
        // #6 (2026-06-20): unescaped quote 라도 "여는" 따옴표면 cut 하면 안 된다
        //   (`"address":"강남구 123` 의 여는 `"` 에서 cut → 값 미닫힘 dangling). 직전 문자가
        //   문자열 내부(inStringAt[i-1]=true)면 = "닫는" 따옴표 = valid string end → cut OK.
        //   직전이 문자열 밖이면 = "여는" 따옴표 → skip (계속 backward walk).
        if (bs % 2 === 0 && inStringAt[i - 1]) { cutIdx = i + 1; break; }
        continue;
      }
      // 문자열 내부면 숫자/리터럴 cut 발동 금지 (열린 따옴표 미닫힘 방지).
      if (inStringAt[i]) continue;
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

      // PR #462 (X-H3): the cut-and-close path frequently loses
      // top-level critical fields (arrival_guide/departure_guide) —
      // either because Gemini emitted them after `days[]` and the cut
      // chopped inside them, OR because the cut happened inside `days[]`
      // before Gemini ever reached the guides. validatePatternStructure
      // already requires at least one guide → existing retry trigger
      // preserved. The new annotation + admin alert give operators
      // visibility into the rate AND the root cause: classifyMissingKeys
      // tells "lost-after-emit" vs "never-emitted" apart so prompt-order
      // regressions and max-tokens regressions don't blur together.
      const droppedKeys = detectDroppedKeys(rawText, result);
      if (droppedKeys.length > 0) {
        result.__repair_dropped_keys = droppedKeys;
        const droppedKey = droppedKeys.slice().sort().join('+');
        const { emitted, notEmitted } = classifyMissingKeys(rawText, droppedKeys);
        console.warn(
          '[ai-planner-full] Repair lost top-level critical keys: ' + droppedKey +
          ' (lostAfterEmit=' + emitted.join(',') + ', neverEmitted=' + notEmitted.join(',') +
          ', rawLen=' + rawText.length + ', cutAt=' + cutIdx + ', cleanedLen=' + cleaned.length + ')'
        );
        throttledTelegramAlert({
          key: `repair-dropped-guides:${droppedKey}`,
          channel: 'admin',
          severity: 'high',
          message: [
            `⚠️ <b>repairAndParseJSON lost critical top-level keys</b>`,
            ``,
            `<b>missing:</b> ${droppedKey}`,
            `<b>lost-after-emit:</b> ${emitted.join(', ') || '(none)'}`,
            `<b>never-emitted:</b> ${notEmitted.join(', ') || '(none)'}`,
            `<b>raw length:</b> ${rawText.length}`,
            `<b>cut at:</b> ${cutIdx} / ${cleaned.length}`,
            `<b>days[] count after repair:</b> ${(result.days || []).length}`,
            ``,
            `→ pattern validator 가 missing 잡아 retry 트리거 (existing). quota 추가 소모.`,
            `→ <b>lost-after-emit</b> 비율 ↑ → buildPrompt 에서 guides 를 days[] 앞으로 위치 강제 검토.`,
            `→ <b>never-emitted</b> 비율 ↑ → maxOutputTokens 부족 / Gemini stop sequence 회귀 검토.`,
          ].join('\n'),
          context: {
            errorCode: 'repair_dropped_guides',
            reason: droppedKey,
            step: 'repairAndParseJSON',
          },
        }).catch(() => {});
      }
      return result;
    } catch (parseErr3) {
      console.error('[ai-planner-full] JSON repair also failed:', parseErr3.message);
      // P181 phase 2 (2026-05-24): last-resort fallback — days[] regex extract.
      // 운영자 zero-tolerance ("플랜 만들었을때 오류 1도없이"). repair fail 시도
      // 사용자가 minimal plan 받음 (guides 비어도 day-by-day stops 보존).
      // 별도 alert + result.__repair_minimal_fallback flag — downstream awareness.
      const minimal = tryExtractMinimalPlan(rawText);
      if (minimal) {
        console.warn('[planner P181 phase 2] Last-resort minimal plan extracted:', (minimal.days || []).length, 'days');
        throttledTelegramAlert({
          key: 'json-repair-minimal-fallback',
          channel: 'admin',
          severity: 'high',
          message: [
            `⚠️ <b>P181 last-resort minimal plan fallback 발동</b>`,
            ``,
            `<b>days extracted:</b> ${(minimal.days || []).length}`,
            `<b>raw length:</b> ${rawText.length}`,
            ``,
            `→ JSON repair 까지 fail. minimal plan (days[] only) 추출 성공.`,
            `→ user 가 plan 받음 (guides 없을 수 있음). zero-tolerance 보장.`,
            `→ 빈도 ↑ 시 maxOutputTokens 추가 raise (P181 raise) 또는 prompt 추가 strict.`,
          ].join('\n'),
          context: { errorCode: 'minimal_fallback', step: 'repairAndParseJSON' },
        }).catch(() => {});
        minimal.__repair_minimal_fallback = true;
        return minimal;
      }
      throw new Error('Gemini returned invalid JSON (possibly truncated). Please try again.');
    }
  }
}

/**
 * P181 phase 2 (2026-05-24): Last-resort minimal plan extraction.
 *
 * raw Gemini text 에서 `"days":\s*\[...\]` regex extract → days array 만 추출 →
 * minimal valid plan {days: [...]} 반환. parser 가 끝까지 못 가도 days[] 일부라도
 * recovered 되면 user 가 plan 받음 (guides 없을 수 있음).
 *
 * @param {string} rawText
 * @returns {object|null} minimal plan or null if even regex extraction fails
 */
function tryExtractMinimalPlan(rawText) {
  // Conservative regex: capture from `"days":\s*[` to last matching `]`.
  const start = rawText.search(/"days"\s*:\s*\[/);
  if (start < 0) return null;
  const arrStart = rawText.indexOf('[', start);
  if (arrStart < 0) return null;
  // bracket-count walk to find matching `]` (handle nested)
  let depth = 0, inStr = false, end = -1;
  for (let i = arrStart; i < rawText.length; i++) {
    const ch = rawText[i];
    if (ch === '\\' && inStr) { i++; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  // If unmatched at EOF, close brackets up to balance.
  let arrText = end > 0 ? rawText.slice(arrStart, end) : rawText.slice(arrStart);
  if (end < 0) {
    // count open braces inside (heuristic close)
    let openBrace = 0, openBracket = depth;
    inStr = false;
    for (let i = 0; i < arrText.length; i++) {
      const ch = arrText[i];
      if (ch === '\\' && inStr) { i++; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') openBrace++;
      else if (ch === '}') openBrace--;
    }
    // truncate to last `}` or `]` for safety
    const lastClose = Math.max(arrText.lastIndexOf('}'), arrText.lastIndexOf(']'));
    if (lastClose > 0) arrText = arrText.slice(0, lastClose + 1);
    for (let i = 0; i < openBrace; i++) arrText += '}';
    for (let i = 0; i < openBracket; i++) arrText += ']';
  }
  try {
    const days = JSON.parse(arrText);
    if (!Array.isArray(days) || days.length === 0) return null;
    return { days };
  } catch (e) {
    console.warn('[planner P181 phase 2] minimal extract regex parse failed:', e.message);
    return null;
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
