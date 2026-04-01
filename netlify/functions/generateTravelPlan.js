/**
 * Netlify Function: generateTravelPlan
 * POST /.netlify/functions/generateTravelPlan
 *
 * 요청 body(JSON) 스키마:
 * {
 *   categories: string[]   // ['K-pop','K-food','K-culture','K-beauty'] 중 다중 선택
 *   regions:    string[]   // ['서울','부산','제주', ...] 중 다중 선택
 *   startDate:  string     // 'YYYY-MM-DD'
 *   endDate:    string     // 'YYYY-MM-DD'
 * }
 *
 * 환경변수:
 *   GEMINI_API_KEY          - Google AI Studio에서 발급
 *   NAVER_CLIENT_ID         - 네이버 지도 Geocoding + Directions 5 API
 *   NAVER_CLIENT_SECRET     - 네이버 지도 Geocoding + Directions 5 API
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const VALID_CATEGORIES = ['K-pop', 'K-food', 'K-culture', 'K-beauty', 'nature', 'skiing', 'shopping', 'heritage'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// ── Gemini 응답 JSON 스키마 정의 (핵심 일정만 — 경량) ─────────────────
// meals / accommodation / budgetSummary / dailyTips 는 enrichPlan 에서 처리
const CORE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    itinerary: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          day:  { type: SchemaType.NUMBER },
          date: { type: SchemaType.STRING },
          places: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                order:               { type: SchemaType.NUMBER },
                name:                { type: SchemaType.STRING },
                nameEn:              { type: SchemaType.STRING },
                category:            { type: SchemaType.STRING },
                address:             { type: SchemaType.STRING },
                coordinates: {
                  type: SchemaType.OBJECT,
                  properties: {
                    lat: { type: SchemaType.NUMBER },
                    lng: { type: SchemaType.NUMBER },
                  },
                  required: ['lat', 'lng'],
                },
                duration:            { type: SchemaType.STRING },
                admissionFee:        { type: SchemaType.STRING },
                tips:                { type: SchemaType.STRING },
                rainyAlternative:    { type: SchemaType.STRING },
                openingHours:        { type: SchemaType.STRING },
                closedDays:          { type: SchemaType.STRING },
                naverMapUrl:         { type: SchemaType.STRING },
                reservationRequired: { type: SchemaType.STRING },
                cashOnly:            { type: SchemaType.STRING },
                crowdedTimes:        { type: SchemaType.STRING },
                transportToNext: {
                  type: SchemaType.OBJECT,
                  properties: {
                    method:              { type: SchemaType.STRING },
                    detail:              { type: SchemaType.STRING },
                    durationMin:         { type: SchemaType.NUMBER },
                    costKRW:             { type: SchemaType.STRING },
                    fatigueComment:      { type: SchemaType.STRING },
                    charterRecommended:  { type: SchemaType.STRING },
                    charterReason:       { type: SchemaType.STRING },
                    charterCostEstimate: { type: SchemaType.STRING },
                  },
                  required: ['method', 'detail', 'durationMin', 'costKRW'],
                },
              },
              required: ['order', 'name', 'nameEn', 'category', 'address', 'coordinates', 'tips'],
            },
          },
        },
        required: ['day', 'date', 'places'],
      },
    },
  },
  required: ['itinerary'],
};

export const handler = async (event) => {
  // ── Preflight (CORS) ─────────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method Not Allowed. Use POST.' });
  }

  // ── 1. 입력값 파싱 및 유효성 검사 ───────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return respond(400, { error: '요청 body가 유효한 JSON이 아닙니다.' });
  }

  const { categories, regions, startDate, endDate, language = 'en', freeText = '', kpopDetails = [], transport = '', preset = '' } = body;
  const LANG_MAP = { ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese' };
  const tipsLanguage = LANG_MAP[language] ?? 'English';

  if (!Array.isArray(categories) || categories.length === 0)
    return respond(400, { error: 'categories는 1개 이상 선택해야 합니다.' });

  const invalidCat = categories.find((c) => !VALID_CATEGORIES.includes(c));
  if (invalidCat)
    return respond(400, { error: `유효하지 않은 카테고리: ${invalidCat}` });

  if (!Array.isArray(regions) || regions.length === 0)
    return respond(400, { error: 'regions는 1개 이상 선택해야 합니다.' });

  if (!startDate || !endDate || isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate)))
    return respond(400, { error: 'startDate, endDate는 YYYY-MM-DD 형식이어야 합니다.' });

  if (new Date(startDate) > new Date(endDate))
    return respond(400, { error: 'startDate는 endDate보다 이전이어야 합니다.' });

  // ── 2. Gemini API 초기화 ─────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return respond(500, { error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' });
  }

  const totalDays = Math.round(
    (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)
  ) + 1;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: buildSystemPrompt(tipsLanguage),
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: CORE_SCHEMA,
      temperature: 0.7,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  // ── 3. 사용자 프롬프트 구성 및 Gemini 호출 ──────────────────────────
  const userPrompt = buildUserPrompt({ categories, regions, startDate, endDate, totalDays, tipsLanguage, freeText, kpopDetails, transport, preset });

  let aiResult;
  try {
    const result = await model.generateContent(userPrompt);
    aiResult = JSON.parse(result.response.text());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[generateTravelPlan] Gemini API 오류:', detail);
    return respond(502, {
      error: `AI 오류: ${detail}`,
    });
  }

  // ── 4. 최종 응답 ────────────────────────────────────────────────────
  const month = new Date().getMonth() + 1;
  let currentSeason = 'spring';
  if (month >= 6 && month <= 8) currentSeason = 'summer';
  else if (month >= 9 && month <= 11) currentSeason = 'autumn';
  else if (month === 12 || month <= 2) currentSeason = 'winter';

  return respond(200, {
    meta: {
      categories,
      regions,
      startDate,
      endDate,
      generatedAt: new Date().toISOString(),
    },
    itinerary: aiResult.itinerary,
    currentSeason,
    enriched: false,
  });
};

// ── 헬퍼 함수 ────────────────────────────────────────────────────────────

function respond(statusCode, data) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

/**
 * 시스템 프롬프트 — Gemini를 전문 한국 여행 플래너 역할로 고정합니다.
 * JSON 스키마를 명시하여 형식 이탈을 방지합니다.
 */
function buildSystemPrompt(tipsLanguage = 'English') {
  return `You are an expert Korean travel planner specializing in curated itineraries for foreign tourists visiting South Korea.

Your role:
- Design day-by-day travel itineraries tailored to the user's chosen K-culture categories and regions.
- Select 3 to 5 places per day, ordered by optimal visit sequence (geography + opening hours).
- Each place must match at least one of the user's selected categories.
- Prioritize well-known, tourist-accessible locations with accurate Korean addresses and GPS coordinates.
- For each place, suggest realistic transport to the NEXT place in the day's itinerary.

Output rules (strictly enforced):
- Respond ONLY with valid JSON matching the provided schema. No markdown, no prose, no explanation.
- Do NOT include meals, accommodation, budget, or daily tips — those are handled separately.

Place fields:
- "name": Korean name (e.g. "경복궁")
- "nameEn": English name (e.g. "Gyeongbokgung Palace")
- "category": One of exactly ["K-pop", "K-food", "K-culture", "K-beauty", "nature", "skiing", "shopping", "heritage"]
- "address": Full Korean road address (도로명주소)
- "coordinates.lat/lng": Accurate WGS84 decimal degree coordinates
- "duration": Recommended visit duration (e.g. "1–2 hours")
- "admissionFee": Entry fee in KRW or "Free" (e.g. "₩3,000" or "Free")
- "tips": 1–2 sentence practical visitor tip in ${tipsLanguage}
- "rainyAlternative": Indoor alternative suggestion for rainy days in ${tipsLanguage}
- "openingHours": Opening hours string (e.g. "09:00–18:00", "24 hours") — provide for every place
- "closedDays": Closed day(s) (e.g. "Mondays", "None", "Last Tuesday of month") — provide for every place
- "naverMapUrl": URL string in format "https://map.naver.com/v5/search/[English name URL-encoded]"
- "reservationRequired": "yes", "recommended", or "no"
- "cashOnly": "yes" or "no"
- "crowdedTimes": When the place is most crowded (e.g. "Weekends 11:00–14:00") — optional
- "transportToNext": Transport info to next place (omit for last place of each day)
  - "method": one of ["bus","subway","taxi","walk","charter"]
  - "detail": brief description (e.g. "Subway Line 3, 12 min")
  - "durationMin": travel time in minutes
  - "costKRW": cost string (e.g. "₩1,500" or "Free")
  - "fatigueComment": optional note about comfort/luggage (in ${tipsLanguage})
  - "charterRecommended": "yes" or "no"
  - "charterReason": why charter is recommended (if yes, in ${tipsLanguage})
  - "charterCostEstimate": estimated charter cost (if yes)

CocoTrip vehicle options (use when recommending charter transport):
- Staria Van: up to 8 passengers, no guide required, private small group
- Sprinter/Spinner Van: 9~15 passengers, professional guide included (₩300,000/day)
- Charter Bus: 16+ passengers, professional guide included, custom quote needed
When group size exceeds 8, automatically recommend appropriate vehicle.`;
}

/**
 * 사용자 프롬프트 — 카테고리, 지역, 날짜를 Gemini에 전달합니다.
 */
function buildUserPrompt({ categories, regions, startDate, endDate, totalDays, tipsLanguage = 'English', freeText = '', kpopDetails = [], transport = '', preset = '' }) {
  const freeTextLine = freeText
    ? `\nUser's specific requests: "${freeText}" → Prioritize these preferences when selecting places and activities.`
    : '';
  const kpopLine = kpopDetails.length > 0
    ? `\nK-pop specific interests: ${kpopDetails.join(', ')} → Include spots or activities that match these interests.`
    : '';
  const springBlossomsLine = preset === 'spring_blossoms'
    ? `\n\nCRITICAL: The user clicked the Spring Cherry Blossom package. You MUST explicitly include at least one of the following in the itinerary: 'Jinhae Gunhangje (진해 군항제)', 'Yeouido Cherry Blossom Festival (여의도 벚꽃축제)', or 'Gyeongju Daereungwon (경주 대릉원)'. Adjust placement to fit the user's selected travel dates and regions. Cherry blossom spots must appear as named places in the itinerary.`
    : '';
  const transportLine = transport === 'staria'
    ? `\nTransport preference: The traveler has booked a STARIA VAN (private charter, up to 8 passengers). Prioritize multi-region routes, suggest charterRecommended="yes" for most inter-place transport, and note that inter-city travel is comfortable.`
    : transport === 'sprinter'
    ? `\nTransport preference: The traveler has booked a SPRINTER VAN (9-15 passengers) with professional guide service included (\u20a9300,000/day). Suggest charterRecommended="yes" for inter-place transport.`
    : transport === 'bus'
    ? `\nTransport preference: The traveler has booked a CHARTER BUS (16+ passengers) with professional guide service included (\u20a9300,000/day). Suggest charterRecommended="yes" for all transport legs.`
    : transport === 'charter'
    ? `\nTransport preference: The traveler prefers CHARTER vehicle. Prioritize multi-region routes, suggest charterRecommended="yes" for most inter-place transport, and note that inter-city travel is comfortable.`
    : transport === 'public'
    ? `\nTransport preference: The traveler prefers PUBLIC TRANSPORT. Prioritize subway/bus-accessible locations, avoid remote spots that require taxis, and set charterRecommended="no" unless truly necessary.`
    : '';

  return `Create a ${totalDays}-day travel itinerary for South Korea with the following requirements:

- Travel categories (interests): ${categories.join(', ')}
- Regions to visit: ${regions.join(', ')}
- Start date: ${startDate}
- End date: ${endDate}${freeTextLine}${kpopLine}${transportLine}${springBlossomsLine}

Requirements:
1. Generate exactly ${totalDays} day entries. Each day must have 3–5 places.
2. Spread places across the selected regions if multiple regions are chosen.
3. Ensure the itinerary flows logically (nearby places grouped on the same day).
4. For each place (except the last of each day), include "transportToNext" with realistic public transport or taxi details.
5. Include "duration" and "admissionFee" for every place.
6. Include "rainyAlternative" — a nearby indoor option for bad weather.
7. Include "openingHours", "closedDays", "naverMapUrl", "reservationRequired", "cashOnly" for EVERY place.
8. Write all "tips", "rainyAlternative", "fatigueComment", "charterReason" values in ${tipsLanguage}.
9. Do NOT generate meals, accommodation, budget summaries, or daily tips — those will be added separately.`;
}

