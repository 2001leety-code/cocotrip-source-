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
 * P0-3: validateResponse 결과에서 critical dietary violation 존재 여부.
 * 사용자가 식이제한 입력했는데 violation 이 있으면 plan 그대로 저장하면 안 됨.
 * Caller (geminiPipeline) 가 1회 retry → 그래도 violation 이면 throw.
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
  if (bdcEnabled && Number.isFinite(requestedDays) && requestedDays > 0 && days.length !== requestedDays) {
    errors.push(
      `Plan: itinerary.days.length=${days.length} ≠ requested durationDays=${requestedDays} (B-DC)`
    );
  }

  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const dayNum = d?.day || d?.day_index || (i + 1);
    const stops = Array.isArray(d?.stops) ? d.stops : [];

    // B-12: min stops per day. 빈 day 도 잡힘.
    if (stops.length < 4) {
      errors.push(`Day ${dayNum}: stops.length=${stops.length} < 4 minimum (B-12)`);
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
    //   L1~L4 중 하나 만족이면 PASS. 모두 fail 시만 errors.push.
    if (isMultiCity && d?.city && stops.length > 0 && stops[0]?.category === 'lodging') {
      const dayCity = String(d.city).trim();
      const korAliases = CITY_KOR_ALIASES[dayCity] || [];
      const lodgingName = String(stops[0].name || stops[0].display_name || '');
      const lodgingAddr = String(stops[0].address || '');
      const dayTheme = String(d.theme || '');
      const intercityToCity = String(d.intercity_transit?.to_city || '');
      const hay = (lodgingName + ' ' + lodgingAddr).toLowerCase();
      const cityLow = dayCity.toLowerCase();

      // L1: lodging name/address 매칭 (기존)
      const matchL1 =
        hay.includes(cityLow) ||
        korAliases.some((alias) => lodgingName.includes(alias) || lodgingAddr.includes(alias));

      // L2: day.theme 매칭
      const themeLow = dayTheme.toLowerCase();
      const matchL2 =
        themeLow.includes(cityLow) ||
        korAliases.some((alias) => dayTheme.includes(alias));

      // L3: intercity_transit.to_city 매칭 (도시 전환 day 명시 케이스)
      const matchL3 =
        intercityToCity.toLowerCase() === cityLow ||
        korAliases.some((alias) => intercityToCity.includes(alias));

      // L4: well-known hotel chain (lenient — name 만 lowercase 토큰 매칭)
      const lodgingNameLow = lodgingName.toLowerCase();
      const matchL4 = KNOWN_HOTEL_CHAINS.some((chain) => lodgingNameLow.includes(chain));

      if (!matchL1 && !matchL2 && !matchL3 && !matchL4) {
        errors.push(
          `Day ${dayNum} (city="${dayCity}"): lodging "${lodgingName}|${lodgingAddr}" + theme "${dayTheme}" + intercity_to "${intercityToCity}" 모두 도시명/체인 미포함 (B-13)`
        );
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
          // departure_time 미제공 — 기존 로직: 3개 slot 모두 0이면 에러
          if (breakfastCount === 0 && afternoonMealCount === 0 && dinnerCount === 0) {
            errors.push(
              `Day ${dayNum} (출국일): 아침(06-10시)+오후식사(11-16시)+저녁(17-21시) 모두 누락 (B-MEAL)`
            );
          }
        } else {
          const depHour = Math.floor(depMin / 60);
          if (depHour < 11) {
            // 이른 출국 (< 11:00): breakfast slot [06,11) 1건 필수
            if (breakfastCount === 0) {
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

  // B-LATE-ARRIVAL: Day 1 검증
  if (arrivalMin !== null) {
    const day1 = days[0];
    const day1Stops = Array.isArray(day1?.stops) ? day1.stops : [];
    const minActivityMin = arrivalMin + 9 * 60; // arrival + 1h transit + 8h sleep
    const wrapToNextDay = minActivityMin >= 24 * 60;
    if (wrapToNextDay && day1Stops.length > 2) {
      errors.push(`Day 1: arrival_time=${request.arrival_time || request.arrivalTime} + 9h sleep buffer = 다음날 새벽 → Day 1 = lodging 2 stops 만 의무. 현재 stops=${day1Stops.length} (B-LATE-ARRIVAL)`);
    }
    // Day 1 의 lodging 외 카테고리 stops 검증
    for (const stop of day1Stops) {
      if (stop?.category === 'lodging' || stop?.category === 'airport' || stop?.category === 'travel') continue;
      const stopMin = parseHHMM(stop?.start_time);
      if (stopMin === null) continue;
      // Day 1 same-day 활동 stops (arrival 이후, 다음날 새벽 wrap 안 한 경우)
      if (!wrapToNextDay && stopMin >= arrivalMin && stopMin < minActivityMin) {
        errors.push(`Day 1 stop "${stop.name || stop.display_name || '?'}" start_time=${stop.start_time} < arrival+9h sleep buffer (B-LATE-ARRIVAL)`);
      }
      // 새벽 활동 (hour < 5) 일반 stops 금지 (단 lodging 도착 stop 만 허용)
      const stopHour = Math.floor(stopMin / 60);
      if (stopHour < 5) {
        errors.push(`Day 1 stop "${stop.name || stop.display_name || '?'}" 새벽 활동 (start_time=${stop.start_time}, hour<5, category=${stop.category}) (B-LATE-ARRIVAL)`);
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
