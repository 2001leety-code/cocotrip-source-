/**
 * userMessage 조립 (Gemini prompt 두 번째 인자).
 *
 * Extracted from api/ai-planner-full.js L393-555 (P129, 2026-05-21).
 * 순수 string concatenation — 부수효과 없음. spotContext / foodContext 는
 * handlerCore 가 미리 계산해서 인자로 전달.
 *
 * 출력: Gemini user prompt — JSON.stringify(userInput) + spotContext +
 * foodContext + mountainContext (P191) + LODGING ZONE block +
 * MULTI-CITY HOTELS block + MULTI-CITY ENTRY/EXIT block +
 * ACCOMMODATION block + VARIATION/ANGLE block.
 *
 * P191 (2026-05-25): mountainContext — SAFETY-CRITICAL. Trekking/Hallasan
 * 옵션 선택 시 검증 DB 주입 (hallucination 차단, 외국인 등산 사고 예방).
 */
import { buildFoodPrefSnippet } from '../_food_helper.js';

export function buildUserMessage({
  shaped,
  body,
  spotContext,
  foodContext,
  attractionsContext = '',
  mountainContext = '',  // P191: SAFETY-CRITICAL — Trekking/Hallasan 검증 DB
}) {
  const {
    guestName, pax, startDate, durationDays, styles, area, regions, duration,
    vehicle, arrival_airport, departure_airport, arrivalAddress, departureAddress,
    arrivalTime, departureTime, hotel_address, hotelByCity, arrivalCity, departureCity,
    recommendedZone, recommendedZones,
    mobility, luggage, specialRequest, dietPrefs, allergies,
    spiceLevel, bucketDishes, priceRange,
    pace, wantAccom, accomBudget,
  } = shaped;

  const userMessage = JSON.stringify({
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
    hotel_address: hotel_address || undefined,
    // Sprint 2 #5: zone hint passed only when hotel_address absent.
    recommended_zone: !hotel_address && recommendedZone ? recommendedZone : undefined,
    // 2026-05-11 (B-2): 다도시 plan zone hint Record — buildPrompt MULTI-CITY 분기 보완.
    recommended_zones: !hotel_address && Object.keys(recommendedZones).length > 0
      ? recommendedZones
      : undefined,
    mobility,
    // 2026-05-10 (P1): luggage — RouteAgent late-night/heavy-luggage 분기 + Gemini.
    luggage: luggage || undefined,
    special_request: specialRequest || undefined,
    diet_preferences: dietPrefs.length > 0 ? dietPrefs : undefined,
    food_allergies: allergies.length > 0 ? allergies : undefined,
    // 2026-05-10 (P1): 매운맛 / 한국 음식 bucket — 식당 매칭 정확도 개선.
    spice_level: spiceLevel || undefined,
    bucket_dishes: bucketDishes.length > 0 ? bucketDishes : undefined,
    meal_budget: priceRange !== 'Any' ? priceRange : undefined, ...buildFoodPrefSnippet(body),
    pace, // relaxed: 단일 zone / standard: 2 인접 zone / packed: 자유
    variation_seed: Math.floor(Math.random() * 100) + 1,
    want_accommodation: wantAccom || undefined,
    accommodation_budget: wantAccom ? accomBudget : undefined,
  }) + spotContext + foodContext + attractionsContext + mountainContext + buildLodgingZoneBlock({ hotel_address, recommendedZones, area })
    + buildMultiCityHotelBlock(hotelByCity, regions)
    + buildMultiCityEntryExitBlock({ regions, arrivalCity, departureCity })
    + buildAccommodationBlock({ wantAccom, accomBudget })
    + buildVariationAngleBlock();

  return userMessage;
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

[LODGING ZONE PREFERENCE — STRICT]
The user has not booked a hotel and chose "${singleZone}" as their preferred lodging district within ${area}.
This is a HARD anchor — assume they will sleep in or near "${singleZone}" every night.

REQUIREMENTS:
- 80%+ of all stops MUST be within 3km of "${singleZone}" centroid.
- Day 1: first stop MUST be in "${singleZone}" (arrival convenience).
- Day N (last day): last stop MUST be in "${singleZone}" (departure convenience).
- Food stops (lunch/dinner): 90%+ within 3km of "${singleZone}".
- Outside-zone stops: maximum 20% per day, AND only if the spot is genuinely iconic (major palace, must-see landmark, signature experience that cannot be substituted nearby).
- DO NOT scatter stops across multiple distant districts — that defeats the purpose of choosing a base zone.
- If "${singleZone}" lacks options for a category, prefer the closest adjacent neighborhood over a distant one.`;
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
