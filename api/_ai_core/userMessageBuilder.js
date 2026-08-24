/**
 * userMessage 조립 (Gemini prompt 두 번째 인자).
 *
 * Extracted from api/ai-planner-full.js L393-555 (P129, 2026-05-21).
 * 순수 string concatenation — 부수효과 없음. spotContext / foodContext 는
 * handlerCore 가 미리 계산해서 인자로 전달.
 *
 * P273 (2026-05-29): cache-friendly 순서 — STATIC PREFIX → SEMI-STATIC MIDDLE → DYNAMIC SUFFIX → RANDOM TAIL.
 *   이전: JSON.stringify(userInput) 가 prefix (매 요청 unique) → Gemini implicit cache 0% hit.
 *   현재: spotContext+foodContext+... (도시+styles+diet 별 same) 가 prefix → 동일 city/styles/diet 요청 시 cache prefix match → 90% 할인 활성.
 *   ※ P195 baseline prod 측정 (plan 696b273d) = cacheHitRate 0% root cause = prompt prefix 결정성 부족.
 *   ※ Gemini 2.5 implicit caching = prefix exact match 필요 (2025-10 Logan Kilpatrick: 75% → 90% 상향).
 *
 * 출력 순서 (P273):
 *   1. STATIC PREFIX: spotContext + foodContext + attractionsContext + mountainContext + runningContext
 *      + activityContext (P241) + hotelContext (P241)
 *   2. SEMI-STATIC MIDDLE: LODGING ZONE block + MULTI-CITY HOTELS block + MULTI-CITY ENTRY/EXIT block
 *      + ACCOMMODATION block
 *   3. DYNAMIC SUFFIX: JSON.stringify(userInput) — guest_name/date/styles/special_request 등 user-unique
 *   4. RANDOM TAIL: variation_angle block (Math.random, cache miss 의도)
 *
 * P191 (2026-05-25): mountainContext — SAFETY-CRITICAL. Trekking/Hallasan
 * 옵션 선택 시 검증 DB 주입 (hallucination 차단, 외국인 등산 사고 예방).
 * P237 (2026-05-27): runningContext — Running/HangangRun 옵션 선택 시
 * 검증 코스 16개 주입 (코스명·거리 hallucination 차단).
 * P241 (2026-05-27): activityContext — Kbeauty/DMZ/Haenyeo/Jjimjilbang/HangangBike
 * 옵션 선택 시 검증 DB 주입 (userMessageBuilder 내부에서 lazy 계산).
 * P241 (2026-05-27): hotelContext — hotel_address 비어있을 때 외국인 친화 호텔 추천 DB 주입.
 * handlerCore.js 는 미변경 — userMessageBuilder 가 shaped 에서 styles/area/language 직접 읽음.
 */
import { buildFoodPrefSnippet } from '../_food_helper.js';
import { getActivityContextForPrompt } from '../_activity_helper.js'; // P241
import { getHotelContextForPrompt } from '../_hotel_helper.js';       // P241

// 도착일 "투어 시작 가능" 시각 — block_mode 와 **같은 계산**을 쓴다(constants 단일 원천).
import { arrivalReadyHHMM } from './constants.js';
// 도시 키 정규화(한글 '부산' → 'busan'). responseValidator 는 constants·헬퍼만 import 하므로 순환 없음.
import { normalizeRegionKey } from './responseValidator.js';

// P241: Kbeauty/DMZ/Haenyeo/Jjimjilbang/HangangBike
const P241_ACTIVITY_STYLES = new Set(['Kbeauty', 'Dmz', 'Haenyeo', 'Jjimjilbang', 'HangangBike']);

export function buildUserMessage({
  shaped,
  body,
  spotContext,
  foodContext,
  attractionsContext = '',
  mountainContext = '',  // P191: SAFETY-CRITICAL — Trekking/Hallasan 검증 DB
  runningContext = '',   // P237: Running/HangangRun 코스 16개 검증 DB
}) {
  const {
    guestName, pax, startDate, durationDays, styles, area, regions, duration,
    vehicle, arrival_airport, departure_airport, arrivalAddress, departureAddress,
    arrivalTime, departureTime,
    // P239 (2026-05-27): tourStartTime — Gemini userInput JSON 에 tour_start_time inject.
    // buildPrompt 의 TOUR START TIME 섹션이 본 값 기준으로 Day1 stops 시각 계산.
    // default '09:00' (requestShaper 보장) — 옛 client 호환.
    tourStartTime,
    // #tour-end (2026-06-05): tourEndTime — Gemini userInput JSON 에 tour_end_time inject (매일 종료 cap).
    tourEndTime,
    hotel_address, hotelByCity, arrivalCity, departureCity,
    recommendedZone, recommendedZones,
    mobility, luggage, specialRequest, dietPrefs, dietaryRestrictions,
    spiceLevel, bucketDishes, priceRange,
    pace, wantAccom, accomBudget, language,
    companions, // UIUX P3 (2026-07-13): 동행 유형 — userInput JSON 소프트 힌트
    // planner-intent-v1 (2026-08-24): 예약 현황. buildPrompt 의 reservation_status
    // 분기가 이 값을 기대하는데 requestShaper 가 아예 안 뽑아서 항상 undefined 였다.
    reservationStatus,
  } = shaped;

  // 버그헌트 #5 (halal) — SAFETY-CRITICAL (CLAUDE.md J / dietary-safety.md).
  // WizardForm DIETARY_RESTRICTION_KEYS(data.tsx) 는 Halal/Vegan/Vegetarian/None 만 담는다
  // (알레르겐 개념 제거, 2026-08-24 allergy removal 로 필드명도 dietaryRestrictions 로 개명).
  // buildSystemPrompt 의 가장 구체적 식이 지시(buildPrompt.js `### Diet preferences:`)는
  // Gemini userMessage 의 `diet_preferences` 키 포함 여부에 게이트된다 — dietaryRestrictions
  // 배열에만 있으면 첫 응답에 미발화 위험 → diet_preferences 에도 합쳐 노출한다.
  // 레거시 클라이언트/저장된 세션이 옛 알레르겐 값(Nuts/Shellfish/Gluten/Dairy)을 여전히
  // 보내더라도(requestShaper 의 legacy `allergies` alias 경유) 아래 필터가
  // halal/vegan/vegetarian 이외는 버리므로 안전 무시된다.
  const safeDietPrefs = Array.isArray(dietPrefs) ? dietPrefs : [];
  const safeDietaryRestrictions = Array.isArray(dietaryRestrictions) ? dietaryRestrictions : [];
  const dietGatedFromDietaryRestrictions = safeDietaryRestrictions.filter(
    (a) => /^(halal|vegan|vegetarian)$/i.test(String(a || '')),
  );
  // 중복 무해 — Set 으로 정규화. dietPrefs 가 우선 순서 유지.
  const dietPreferencesForPrompt = [...new Set([...safeDietPrefs, ...dietGatedFromDietaryRestrictions])];

  // P273 (2026-05-29): cache-friendly 순서 재배치.
  // STATIC PREFIX (1) → SEMI-STATIC MIDDLE (2) → DYNAMIC SUFFIX (3) → RANDOM TAIL (4).
  // Gemini implicit cache hit (90% 할인) trigger 위해 동일 city/language/styles/diet 요청의
  // prefix 가 byte-level identical 가져야 함. 이전: JSON.stringify(userInput) 가 prefix → 0% hit.

  // (1) STATIC PREFIX — 도시+styles+diet+language 별 동일 (cache key 후보)
  const staticPrefix =
    spotContext +
    foodContext +
    attractionsContext +
    mountainContext +
    runningContext +
    buildP241ActivityContext(styles, area, language) +
    buildP241HotelContext(area, hotel_address, language);

  // (2) SEMI-STATIC MIDDLE — 호텔/도시 의존 (partial cache)
  const semiStaticMiddle =
    buildLodgingZoneBlock({ hotel_address, recommendedZones, area }) +
    buildMultiCityHotelBlock(hotelByCity, regions) +
    buildMultiCityEntryExitBlock({ regions, arrivalCity, departureCity }) +
    buildAccommodationBlock({ wantAccom, accomBudget });

  // (3) DYNAMIC SUFFIX — 사용자 입력 JSON (매 요청 unique)
  const userInputJson = JSON.stringify({
    guest_name: guestName,
    guest_count: pax,
    date: startDate,
    duration_days: durationDays,
    styles,
    area,
    // 2026-05-10 (P0-1): regions array — 다도시 plan 시 buildPrompt MULTI-CITY
    // HANDLING 섹션 (regions.length>=2) 트리거 + Gemini 가 city 별 분배 가능.
    regions,
    duration,
    vehicle,
    arrival_airport: arrival_airport || undefined,
    departure_airport: departure_airport || undefined,
    arrival_address: arrivalAddress || undefined,
    departure_address: departureAddress || undefined,
    // 2026-05-10 (P1): 도착/출발 시각 — Gemini 가 첫/마지막 day 일정 시각 분기.
    arrival_time: arrivalTime || undefined,
    departure_time: departureTime || undefined,
    // 🔴 2026-08-03: 손님이 실제로 공항을 벗어나 권역에 도착하는 시각.
    //   = 도착 + 입국수속(90분) + 공항→권역 이동(공항별). block_mode 는 2026-06-05 부터
    //   이 값을 썼는데 **buildPrompt 는 Gemini 에게 '도착 + 60분' 을 가르치고 있었다** —
    //   같은 여행에 두 개의 현실이 있었다. 실측(ICN 14:00 도착): 실제 17:00 인데
    //   legacy 플랜 첫 활동이 16:15~16:26, 즉 손님이 아직 공항에 있는 시각이었다.
    //   여기서 계산해 넘겨 Gemini 가 산수를 하지 않게 한다(모델 계산은 틀린다).
    //   🔴 2026-08-04: Day 1 도시도 넘긴다. 공항 이동 표는 **공항 권역 안** 값이라
    //   인천 도착 + 첫날 부산을 90분으로 봤다(실제 4시간+). 여기서 맞는 값을 줘야
    //   buildPrompt 의 "저녁 도착이면 Day 1 = 숙소만" 규칙이 제대로 발동하고,
    //   validator 와 기준이 같아져 재시도 자체가 안 생긴다.
    arrival_ready_time: arrivalReadyHHMM(
      arrivalTime,
      arrival_airport,
      normalizeRegionKey(arrivalCity || '')
        || normalizeRegionKey((Array.isArray(regions) && regions[0]) || area || ''),
    ) || undefined,
    // P239 (2026-05-27): tour_start_time — 운영자 architectural fix.
    // arrival_time 무관하게 Day1 stops 시작 시각 고정 (default '09:00').
    // 새벽 도착 시 호텔만 transit + tour_start_time 부터 stops 작성.
    // buildPrompt 의 ARRIVAL DAY HANDLING 섹션이 본 값으로 stops[1+] start_time 계산.
    tour_start_time: tourStartTime || '09:00',
    // #tour-end (2026-06-05): 매일 관광 종료 시각 cap (default '21:00'). buildPrompt TOUR END TIME 섹션이 사용.
    tour_end_time: tourEndTime || '21:00',
    hotel_address: hotel_address || undefined,
    // Sprint 2 #5: zone hint passed only when hotel_address absent.
    recommended_zone: !hotel_address && recommendedZone ? recommendedZone : undefined,
    // 2026-05-11 (B-2): 다도시 plan zone hint Record — buildPrompt MULTI-CITY 분기 보완.
    recommended_zones: !hotel_address && Object.keys(recommendedZones).length > 0
      ? recommendedZones
      : undefined,
    mobility,
    // planner-intent-v1 (2026-08-24): 예약 현황 — 미전달(옛 client)이면 키 자체를 빼서
    // "예약 상태 미상" 을 유지한다. 'nothing' 으로 채우면 "아무것도 예약 안 함" 이라는
    // 없는 사실을 프롬프트에 박아 넣게 된다(항공권 있는 손님에게 항공권 광고 문구).
    reservation_status: reservationStatus || undefined,
    // 2026-05-10 (P1): luggage — RouteAgent late-night/heavy-luggage 분기 + Gemini.
    luggage: luggage || undefined,
    special_request: specialRequest || undefined,
    // 버그헌트 #5: Halal/Vegan/Vegetarian(dietaryRestrictions 경유) 을 합친 배열 — buildPrompt
    // `### Diet preferences:` 게이트가 첫 응답서 발화하게 한다.
    diet_preferences: dietPreferencesForPrompt.length > 0 ? dietPreferencesForPrompt : undefined,
    // 2026-05-10 (P1): 매운맛 / 한국 음식 bucket — 식당 매칭 정확도 개선.
    spice_level: spiceLevel || undefined,
    // UIUX P3 (2026-07-13): 동행 유형 — family=아이 동반 페이스·couple=분위기 등 소프트 힌트 (JSON 필드만, 캐시 안전)
    travel_party: companions || undefined,
    bucket_dishes: bucketDishes.length > 0 ? bucketDishes : undefined,
    meal_budget: priceRange !== 'Any' ? priceRange : undefined, ...buildFoodPrefSnippet(body),
    pace, // relaxed: 단일 zone / standard: 2 인접 zone / packed: 자유
    variation_seed: Math.floor(Math.random() * 100) + 1,
    want_accommodation: wantAccom || undefined,
    accommodation_budget: wantAccom ? accomBudget : undefined,
  });

  // (4) RANDOM TAIL — Gemini 응답 다양성. cache 영향 X (suffix 변동만, prefix hit 유지).
  const variationTail = buildVariationAngleBlock();

  return staticPrefix + semiStaticMiddle + userInputJson + variationTail;
}

// ── P241: Activity + Hotel context builders ──────────────────────────────────

/**
 * P241: Kbeauty/DMZ/Haenyeo/Jjimjilbang/HangangBike style 선택 시 검증 DB 주입.
 * userMessageBuilder 내부에서 lazy 계산 (handlerCore 미변경).
 */
function buildP241ActivityContext(styles, city, language = 'en') {
  try {
    const s = Array.isArray(styles) ? styles : [];
    if (!s.some(st => P241_ACTIVITY_STYLES.has(st))) return '';
    return getActivityContextForPrompt({ styles: s, city, language, maxItemsPerStyle: 3 }) || '';
  } catch (e) {
    console.warn('[userMessageBuilder] P241 activityContext failed:', e.message);
    return '';
  }
}

/**
 * P241: hotel_address 비어있을 때 외국인 친화 호텔 추천 DB 주입.
 * Gemini hallucination (없는 호텔 생성) 방지 용도. 강제 아님 — 추천 데이터.
 */
function buildP241HotelContext(city, hotelAddress, language = 'en') {
  try {
    if (hotelAddress) return ''; // hotel_address 있으면 skip
    return getHotelContextForPrompt({ city, language, maxItems: 3 }) || '';
  } catch (e) {
    console.warn('[userMessageBuilder] P241 hotelContext failed:', e.message);
    return '';
  }
}

function buildLodgingZoneBlock({ hotel_address, recommendedZones, area }) {
  // 2026-05-11 (B-2 fix): 다도시 plan zone-per-city prompt 분기.
  // recommended_zones 가 2개 이상 도시 zone 갖고 있으면 도시별 LODGING ZONE
  // anchor 모두 강제. 단일 도시이거나 zones 1개 = 기존 single-zone 분기.
  if (hotel_address) return '';
  const zoneEntries = Object.entries(recommendedZones).filter(([, z]) => !!z);
  if (zoneEntries.length === 0) return '';

  if (zoneEntries.length === 1) {
    const [, singleZone] = zoneEntries[0];
    return `

[LODGING ZONE PREFERENCE — STRICT (P283 강화 2026-05-29)]
The user has not booked a hotel and chose "${singleZone}" as their preferred lodging district within ${area}.
This is a HARD anchor — assume they will sleep in or near "${singleZone}" every night.

REQUIREMENTS:
- 80%+ of all stops MUST be within 3km of "${singleZone}" centroid.
- **EVERY day from Day 1 to Day N**: stops[0] (first) AND stops[last] (last) MUST be within 3km of "${singleZone}" (hub-and-spoke from lodging) — NOT only Day 1 first / Day N last.
- Day 1: first stop in "${singleZone}" (arrival convenience).
- Day N (last day): last stop in "${singleZone}" (departure convenience).
- **Day 2 ~ Day N-1 (middle days)**: first AND last stops also within 3km of "${singleZone}" — 사용자가 매일 zone 호텔에서 출발하고 복귀 (HUB-AND-SPOKE pattern, 운영자 의도).
- Food stops (lunch/dinner): 90%+ within 3km of "${singleZone}".
- Outside-zone stops: maximum 20% per day, AND only if the spot is genuinely iconic (major palace, must-see landmark, signature experience that cannot be substituted nearby).
- DO NOT scatter stops across multiple distant districts — that defeats the purpose of choosing a base zone.
- If "${singleZone}" lacks options for a category, prefer the closest adjacent neighborhood over a distant one.

**🔴 P283 BAD 예시 (회귀 차단, Agent 2 deep-search 4/4 plans 영향)**:
- input \`recommended_zone="myeongdong"\` (명동) → Day 1 stops 모두 명동 매칭 (Day 1 100%) + Day 2 stops 모두 강남구 (Day 2 0% 매칭) = **사용자 매일 명동↔강남 1시간 왕복** = 추천 zone 무력화 ❌
- 사용자 신고: "명동에 묵으라고 추천했는데 매일 강남까지 1시간씩 가야해서 시간 낭비"

**🟢 P283 GOOD 예시**:
- input \`recommended_zone="myeongdong"\` → 모든 Day stops[0] AND stops[last] 가 명동 / 중구 (~3km) 내 + 80%+ stops 명동 zone 매칭 ✓`;
  }

  // 다도시: 도시별 zone anchor. 도시 변경 day 마다 그 도시 zone 중심 5km 반경.
  const cityZoneLines = zoneEntries
    .map(([city, zone]) => `- In ${city.charAt(0).toUpperCase() + city.slice(1)}, hub stops around "${zone}" — selected by user. Day blocks for this city: 80%+ stops within 3km of "${zone}" centroid, first + last stop within "${zone}".`)
    .join('\n');
  return `

[MULTI-CITY LODGING ZONE PREFERENCE — STRICT]
The user has not booked hotels. For each city they selected, they chose a preferred lodging district:

${cityZoneLines}

REQUIREMENTS:
- Each Day's "city" field determines which zone anchor applies.
- 80%+ of stops on a given day MUST be within 3km of THAT city's chosen zone.
- First stop of each city-block MUST be in that city's zone (arrival/transit convenience).
- Last stop of each city-block MUST be in that city's zone (rest/sleep convenience).
- Food stops (lunch/dinner): 90%+ within 3km of the day's city zone.
- DO NOT scatter stops across cities mid-day. Inter-city travel only at start of a new city-block via intercity_transit (see MULTI-CITY HANDLING).
- If a city's zone lacks options for a category, prefer the closest adjacent neighborhood within the SAME city — never cross-city.`;
}

const CITY_LODGING_MAP = {
  seoul:     { kr: '서울', en: 'Seoul',     examples: '명동 호텔 / 홍대 호텔 / 강남 호텔 / 이태원 호텔' },
  busan:     { kr: '부산', en: 'Busan',     examples: '해운대 호텔 / 광안리 호텔 / 서면 호텔 / 남포동 호텔' },
  jeju:      { kr: '제주', en: 'Jeju',      examples: '중문 호텔 / 노형 호텔 / 제주시청 호텔 / 성산 호텔' },
  gyeongju:  { kr: '경주', en: 'Gyeongju',  examples: '보문 호텔 / 황남동 호텔 / 대릉원 호텔' },
  jeonju:    { kr: '전주', en: 'Jeonju',    examples: '한옥마을 호텔 / 객사 호텔' },
  gangneung: { kr: '강릉', en: 'Gangneung', examples: '경포 호텔 / 강릉역 호텔' },
  sokcho:    { kr: '속초', en: 'Sokcho',    examples: '속초해변 호텔 / 설악산 호텔' },
};

function buildMultiCityHotelBlock(hotelByCity, regions) {
  // P123 (2026-05-20): 다도시 plan 의 도시별 호텔 명시 — wizard Step2
  // hotelByCity Record forward. plan 209de47b 회귀 (부산 day 에 명동 호텔
  // 박힘) 의 진짜 fix. Gemini 가 day.city 별 호텔 매칭 강제.
  const isMultiCity = Array.isArray(regions) && regions.length >= 2;
  const hbcEntries = Object.entries(hotelByCity).filter(([, v]) => v && v.trim());
  if (hbcEntries.length === 0) {
    if (!isMultiCity) return '';
    // No hotel info for multi-city plan — inject per-city placeholder rules.
    // Without this Gemini reuses Seoul placeholder for ALL days (B-13, P122).
    const cityLines = regions.map(cityKey => {
      const info = CITY_LODGING_MAP[cityKey.toLowerCase()];
      if (!info) {
        const cap = cityKey.charAt(0).toUpperCase() + cityKey.slice(1);
        return `- ${cap}: lodging name/address MUST contain "${cap}"`;
      }
      return `- ${info.en}: lodging name/address MUST contain "${info.kr}" or "${info.en}". Good examples: ${info.examples}.`;
    }).join('\n');
    return `

[MULTI-CITY HOTELS — NO HOTELS PROVIDED (B-13/P122)]
The user did NOT book hotels. Generate city-appropriate lodging placeholders PER CITY:

${cityLines}

CRITICAL:
- NEVER put a Seoul-area hotel name (e.g., "명동 호텔") on a day whose city="Busan". B-13 REJECTS.
- Each day's stops[0] and stops[last] lodging name/address MUST match that day's "city" field.
- GOOD: day.city="Busan" → stops[0].name="해운대 호텔", address="부산광역시 해운대구..."
- BAD:  day.city="Busan" → stops[0].name="명동 호텔", address="서울특별시 중구..." (WRONG)`;
  }
  const cityHotelLines = hbcEntries
    .map(([city, hotel]) => `- ${city.charAt(0).toUpperCase() + city.slice(1)}: "${hotel}"`)
    .join('\n');
  return `

[MULTI-CITY HOTELS BY CITY — STRICT (P123, 2026-05-20)]
The user provided different hotels for each city:

${cityHotelLines}

REQUIREMENTS:
- For each Day's stops[0] (first lodging) and stops[last] (last lodging):
  - Use the hotel that matches THAT day's "city" field (case-insensitive lookup).
  - stops[0].name and stops[0].address MUST match that day's city.
  - NEVER use a hotel from a different city than day.city.
- BAD: regions=["seoul","busan"], Day 4 city="Busan", stops[0].address="서울 명동 ..." ← cross-city wrong, 사용자 짐 못 옮김.
- GOOD: Day 4 city="Busan", stops[0].address starts with "부산" / "Busan" (from the list above).
- B-13 validator (백엔드) rejects + retries lodging name/address mismatched with day.city.`;
}

function buildMultiCityEntryExitBlock({ regions, arrivalCity, departureCity }) {
  // P125 (2026-05-21): 사용자 명시적 입국/출국 도시. Wizard cycle UI 로
  // arrival_city / departure_city 받으면 Day 1.city = arrival_city,
  // Day N.city = departure_city 강제. 다도시 plan 만 의미 있음. 단도시 (둘 다 같음)
  // 또는 미입력 → 빈 string (기존 MULTI-CITY HANDLING city ordering rule 폴백).
  const isMultiCity = Array.isArray(regions) && regions.length >= 2;
  if (!isMultiCity) return '';
  if (!arrivalCity && !departureCity) return '';
  if (arrivalCity && departureCity && arrivalCity === departureCity) return '';
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  return `

[MULTI-CITY ENTRY/EXIT — STRICT (P125, 2026-05-21)]
The user explicitly designated their entry / exit cities via the Wizard arrival/departure cycle:

${arrivalCity ? `- arrival_city = "${cap(arrivalCity)}" → Day 1's "city" field MUST be "${cap(arrivalCity)}".` : '- arrival_city not specified — use existing city ordering rule (arrival_airport proximity).'}
${departureCity ? `- departure_city = "${cap(departureCity)}" → Day N (last day) "city" field MUST be "${cap(departureCity)}".` : '- departure_city not specified — use existing city ordering rule (departure_airport proximity).'}

REQUIREMENTS:
- The day ordering must satisfy BOTH constraints (e.g., regions=["seoul","busan"], arrival_city="busan", departure_city="seoul" → Day 1=Busan ... Day N=Seoul).
- intercity_transit.from_city must reflect the previous day's city; intercity_transit.to_city must reflect the next day's city.
- airport_code mapping (Day 1 arrival + Day N departure):
  - Seoul → ICN (default) or GMP
  - Busan → PUS
  - Jeju → CJU
- BAD: User wanted Busan-arrival → Seoul-departure plan, but Day 1.city="Seoul" — wrong entry direction.`;
}

function buildAccommodationBlock({ wantAccom, accomBudget }) {
  if (!wantAccom) return '';
  return `

[ACCOMMODATION REQUEST]
The user wants hotel recommendations. Budget level: ${accomBudget}.
Add an "accommodation" object to the JSON with:
- "name": hotel name
- "area": neighborhood
- "price_range": estimated nightly rate in KRW
- "why": 1-sentence reason this hotel fits the itinerary
- "booking_tip": practical booking advice
Pick a REAL hotel that exists near the main activity zone.`;
}

function buildVariationAngleBlock() {
  const angles = [
    'Focus on hidden local gems and residential neighborhood charm',
    'Emphasize street food and market culture — let food drive the route',
    'Start from an unusual neighborhood most tourists miss',
    'Prioritize Instagram-worthy spots and aesthetic cafes',
    'Build the day around walking — compact zones, minimal transit',
    'Mix old Seoul heritage with trendy new-generation spots',
    'Focus on artisan shops, indie bookstores, and creative spaces',
    'Emphasize nature within the city — parks, trails, river walks',
    'Night-life oriented — evening markets, han river, rooftop views',
    'Cultural deep-dive — museums, galleries, traditional experiences',
  ];
  const angle = angles[Math.floor(Math.random() * angles.length)];
  const seed = Math.floor(Math.random() * 1000);
  return `\n\n[VARIATION SEED: ${seed}] [ANGLE: ${angle}]\nCreate a UNIQUE, personally-curated itinerary. This is a paid premium plan — make it feel special, not generic.`;
}
