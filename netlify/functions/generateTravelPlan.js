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
import axios from 'axios';

const VALID_CATEGORIES = ['K-pop', 'K-food', 'K-culture', 'K-beauty', 'nature', 'skiing', 'shopping', 'heritage'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// ── Gemini 응답 JSON 스키마 정의 ───────────────────────────────────────
// SchemaType으로 구조를 선언하면 Gemini가 이 형식 외의 출력을 하지 않습니다.
const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    accommodation: {
      type: SchemaType.OBJECT,
      properties: {
        name:       { type: SchemaType.STRING },
        area:       { type: SchemaType.STRING },
        reason:     { type: SchemaType.STRING },
        priceRange: { type: SchemaType.STRING },
        address:    { type: SchemaType.STRING },
      },
      required: ['name', 'area', 'reason', 'priceRange', 'address'],
    },
    budgetSummary: {
      type: SchemaType.OBJECT,
      properties: {
        transport:     { type: SchemaType.STRING },
        food:          { type: SchemaType.STRING },
        admission:     { type: SchemaType.STRING },
        accommodation: { type: SchemaType.STRING },
        total:         { type: SchemaType.STRING },
      },
      required: ['transport', 'food', 'admission', 'accommodation', 'total'],
    },
    itinerary: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          day:  { type: SchemaType.NUMBER },
          date: { type: SchemaType.STRING },
          dailyTips: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
          },
          places: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                order:        { type: SchemaType.NUMBER },
                name:         { type: SchemaType.STRING },
                nameEn:       { type: SchemaType.STRING },
                category:     { type: SchemaType.STRING },
                address:      { type: SchemaType.STRING },
                coordinates: {
                  type: SchemaType.OBJECT,
                  properties: {
                    lat: { type: SchemaType.NUMBER },
                    lng: { type: SchemaType.NUMBER },
                  },
                  required: ['lat', 'lng'],
                },
                duration:         { type: SchemaType.STRING },
                admissionFee:     { type: SchemaType.STRING },
                tips:             { type: SchemaType.STRING },
                rainyAlternative:        { type: SchemaType.STRING },
                openingHours:            { type: SchemaType.STRING },
                closedDays:              { type: SchemaType.STRING },
                naverMapUrl:             { type: SchemaType.STRING },
                reservationRequired:     { type: SchemaType.STRING },
                cashOnly:                { type: SchemaType.STRING },
                crowdedTimes:            { type: SchemaType.STRING },
                transportToNext: {
                  type: SchemaType.OBJECT,
                  properties: {
                    method:               { type: SchemaType.STRING },
                    detail:               { type: SchemaType.STRING },
                    durationMin:          { type: SchemaType.NUMBER },
                    costKRW:              { type: SchemaType.STRING },
                    fatigueComment:       { type: SchemaType.STRING },
                    charterRecommended:   { type: SchemaType.STRING },
                    charterReason:        { type: SchemaType.STRING },
                    charterCostEstimate:  { type: SchemaType.STRING },
                  },
                  required: ['method', 'detail', 'durationMin', 'costKRW'],
                },
              },
              required: ['order', 'name', 'nameEn', 'category', 'address', 'coordinates', 'tips'],
            },
          },
          meals: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                type:                { type: SchemaType.STRING },
                restaurantName:      { type: SchemaType.STRING },
                cuisine:             { type: SchemaType.STRING },
                costPerPerson:       { type: SchemaType.STRING },
                reservationRequired: { type: SchemaType.STRING },
                waitTime:            { type: SchemaType.STRING },
                address:             { type: SchemaType.STRING },
                tip:                 { type: SchemaType.STRING },
              },
              required: ['type', 'restaurantName', 'cuisine', 'costPerPerson', 'reservationRequired'],
            },
          },
        },
        required: ['day', 'date', 'places', 'meals'],
      },
    },
  },
  required: ['accommodation', 'budgetSummary', 'itinerary'],
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

  const { categories, regions, startDate, endDate, language = 'en', freeText = '', kpopDetails = [], transport = '' } = body;
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
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.7,
    },
  });

  // ── 3. 사용자 프롬프트 구성 및 Gemini 호출 ──────────────────────────
  const userPrompt = buildUserPrompt({ categories, regions, startDate, endDate, totalDays, tipsLanguage, freeText, kpopDetails, transport });

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

  // ── 4. 네이버 지도 API — Geocoding → Directions 5 순서로 처리 ────────
  const naverClientId = process.env.NAVER_CLIENT_ID;
  const naverClientSecret = process.env.NAVER_CLIENT_SECRET;

  if (naverClientId && naverClientSecret) {
    const naverHeaders = {
      'X-NCP-APIGW-API-KEY-ID': naverClientId,
      'X-NCP-APIGW-API-KEY':    naverClientSecret,
    };

    // Step 4-A/B: Geocoding + Directions — 5초 초과 시 AI 결과만 반환
    await Promise.race([
      Promise.all([
        enrichWithGeocoordinates(aiResult.itinerary, naverHeaders),
        enrichWithDrivingTimes(aiResult.itinerary, naverHeaders),
      ]),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  }

  // ── 5. 최종 응답 ────────────────────────────────────────────────────
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
    accommodation: aiResult.accommodation,
    budgetSummary: aiResult.budgetSummary,
    itinerary: aiResult.itinerary,
    currentSeason,
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
- Recommend a single best-value accommodation for the trip.
- Provide realistic budget estimates in KRW (Korean Won).
- For each place, suggest realistic transport to the NEXT place in the day's itinerary.
- For each day, include 2–3 practical daily tips and meal recommendations (breakfast, lunch, dinner).

Output rules (strictly enforced):
- Respond ONLY with valid JSON matching the provided schema. No markdown, no prose, no explanation.

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

Meal fields (3 per day: breakfast, lunch, dinner):
- "type": "breakfast" | "lunch" | "dinner"
- "restaurantName": restaurant name in Korean
- "cuisine": cuisine type in ${tipsLanguage}
- "costPerPerson": cost string (e.g. "₩8,000–12,000")
- "reservationRequired": "yes" or "no"
- "waitTime": expected wait time (e.g. "20–30 min") — optional
- "address": Korean address — optional
- "tip": 1-sentence dining tip in ${tipsLanguage} — optional

Accommodation fields (1 for the whole trip):
- "name": hotel/guesthouse name
- "area": neighborhood (e.g. "명동", "홍대")
- "reason": why recommended in ${tipsLanguage}
- "priceRange": per night cost (e.g. "₩80,000–120,000/night")
- "address": Korean address

Budget summary (total for all days, 1 person):
- "transport", "food", "admission", "accommodation", "total": all as KRW strings`;
}

/**
 * 사용자 프롬프트 — 카테고리, 지역, 날짜를 Gemini에 전달합니다.
 */
function buildUserPrompt({ categories, regions, startDate, endDate, totalDays, tipsLanguage = 'English', freeText = '', kpopDetails = [], transport = '' }) {
  const freeTextLine = freeText
    ? `\nUser's specific requests: "${freeText}" → Prioritize these preferences when selecting places and activities.`
    : '';
  const kpopLine = kpopDetails.length > 0
    ? `\nK-pop specific interests: ${kpopDetails.join(', ')} → Include spots or activities that match these interests.`
    : '';
  const transportLine = transport === 'charter'
    ? `\nTransport preference: The traveler prefers CHARTER vehicle. Prioritize multi-region routes, suggest charterRecommended="yes" for most inter-place transport, and note that inter-city travel is comfortable.`
    : transport === 'public'
    ? `\nTransport preference: The traveler prefers PUBLIC TRANSPORT. Prioritize subway/bus-accessible locations, avoid remote spots that require taxis, and set charterRecommended="no" unless truly necessary.`
    : '';

  return `Create a ${totalDays}-day travel itinerary for South Korea with the following requirements:

- Travel categories (interests): ${categories.join(', ')}
- Regions to visit: ${regions.join(', ')}
- Start date: ${startDate}
- End date: ${endDate}${freeTextLine}${kpopLine}${transportLine}

Requirements:
1. Generate exactly ${totalDays} day entries. Each day must have 3–5 places.
2. Spread places across the selected regions if multiple regions are chosen.
3. Ensure the itinerary flows logically (nearby places grouped on the same day).
4. For each place (except the last of each day), include "transportToNext" with realistic public transport or taxi details.
5. Include "duration" and "admissionFee" for every place.
6. Include "rainyAlternative" — a nearby indoor option for bad weather.
7. Include "openingHours", "closedDays", "naverMapUrl", "reservationRequired", "cashOnly" for EVERY place.
8. Include 3 meal recommendations per day (breakfast, lunch, dinner) with real restaurant names.
9. Include 2–3 "dailyTips" per day (practical advice for that day's activities).
10. Recommend one accommodation for the whole trip near the most visited area.
11. Provide a realistic budget summary in KRW for 1 person covering all ${totalDays} days.
12. Write all "tips", "rainyAlternative", "fatigueComment", "charterReason", "reason", and meal "tip" values in ${tipsLanguage}.`;
}

/**
 * [Step 4-A] 네이버 Geocoding API — 주소 문자열을 정확한 WGS84 좌표로 변환합니다.
 *
 * - Gemini가 추정한 coordinates를 실제 측량 기반 좌표로 덮어씁니다.
 * - Geocoding 실패 시 Gemini 추정값을 유지합니다 (graceful fallback).
 */
async function enrichWithGeocoordinates(itinerary, naverHeaders) {
  const allPlaces = itinerary.flatMap((day) => day.places);

  await Promise.all(
    allPlaces.map(async (place) => {
      try {
        const { data } = await axios.get(
          'https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode',
          {
            params: { query: place.address },
            headers: naverHeaders,
            timeout: 5000,
          }
        );
        const first = data?.addresses?.[0];
        if (first) {
          place.coordinates = {
            lat: parseFloat(first.y),
            lng: parseFloat(first.x),
          };
        } else {
          console.warn(`[Naver Geocoding] 결과 없음: "${place.address}" — Gemini 추정 좌표 유지`);
        }
      } catch (err) {
        console.warn(
          `[Naver Geocoding] "${place.address}" 변환 실패:`,
          err?.response?.data ?? err.message
        );
      }
    })
  );
}

/**
 * [Step 4-B] 네이버 Directions 5 API — 장소 간 실제 차량 이동 시간을 채웁니다.
 *
 * - Geocoding으로 보정된 좌표를 사용합니다.
 * - 하루 일정의 첫 번째 장소는 travelTimeFromPrev = 0 유지.
 * - API 호출 실패 시 Gemini 추정값을 보존합니다 (graceful fallback).
 */
async function enrichWithDrivingTimes(itinerary, naverHeaders) {
  const tasks = [];

  for (const day of itinerary) {
    for (let i = 1; i < day.places.length; i++) {
      const prev = day.places[i - 1].coordinates;
      const curr = day.places[i].coordinates;
      const place = day.places[i];
      const label = `${day.places[i - 1].nameEn} → ${place.nameEn}`;

      tasks.push(
        axios
          .get('https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving', {
            params: {
              start:  `${prev.lng},${prev.lat}`,
              goal:   `${curr.lng},${curr.lat}`,
              option: 'traoptimal',
            },
            headers: naverHeaders,
            timeout: 4000,
          })
          .then(({ data }) => {
            const durationMs = data?.route?.traoptimal?.[0]?.summary?.duration;
            if (typeof durationMs === 'number') {
              place.travelTimeFromPrev = Math.round(durationMs / 60000);
            } else {
              console.warn(`[Naver Directions] 경로 없음: ${label}`);
            }
          })
          .catch((err) => {
            console.warn(`[Naver Directions] ${label} 실패:`, err?.response?.data ?? err.message);
          })
      );
    }
  }

  await Promise.allSettled(tasks);
}
