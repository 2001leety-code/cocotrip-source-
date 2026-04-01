/**
 * Netlify Function: enrichPlan
 * POST /.netlify/functions/enrichPlan
 *
 * 요청 body(JSON) 스키마:
 * {
 *   itinerary:   DayItinerary[]   // generateTravelPlan의 핵심 일정
 *   categories:  string[]
 *   regions:     string[]
 *   startDate:   string
 *   endDate:     string
 *   language:    string           // 'ko' | 'en' | 'ja' | 'zh'
 *   transport:   string
 *   freeText:    string
 *   kpopDetails: string[]
 * }
 *
 * 응답:
 * {
 *   itinerary:     DayItinerary[]   // Naver 좌표 + meals + dailyTips 보강
 *   accommodation: Accommodation
 *   budgetSummary: BudgetSummary
 * }
 *
 * 환경변수:
 *   GEMINI_API_KEY
 *   NAVER_CLIENT_ID
 *   NAVER_CLIENT_SECRET
 */

import axios from 'axios';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(statusCode, data) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

// ── Gemini 보강 스키마 (meals / accommodation / budgetSummary / dailyTips) ──
const ENRICH_SCHEMA = {
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
          day: { type: SchemaType.NUMBER },
          dailyTips: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
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
                naverMapUrl:         { type: SchemaType.STRING },
              },
              required: ['type', 'restaurantName', 'cuisine', 'costPerPerson', 'reservationRequired'],
            },
          },
        },
        required: ['day', 'meals'],
      },
    },
  },
  required: ['accommodation', 'budgetSummary', 'itinerary'],
};

export const handler = async (event) => {
  console.log('[ENV CHECK] NAVER_CLIENT_ID:',
    process.env.NAVER_CLIENT_ID
      ? process.env.NAVER_CLIENT_ID.substring(0, 4) + '...'
      : '❌ 없음'
  );
  console.log('[ENV CHECK] NAVER_CLIENT_SECRET:',
    process.env.NAVER_CLIENT_SECRET
      ? process.env.NAVER_CLIENT_SECRET.substring(0, 4) + '...'
      : '❌ 없음'
  );

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method Not Allowed. Use POST.' });
  }

  let body;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return respond(400, { error: '요청 body가 유효한 JSON이 아닙니다.' });
  }

  const {
    itinerary,
    categories = [],
    regions = [],
    startDate = '',
    endDate = '',
    language = 'en',
    transport = '',
    freeText = '',
    kpopDetails = [],
  } = body;

  if (!Array.isArray(itinerary)) {
    return respond(400, { error: 'itinerary 배열이 필요합니다.' });
  }

  const LANG_MAP = { ko: 'Korean', en: 'English', ja: 'Japanese', zh: 'Chinese' };
  const tipsLanguage = LANG_MAP[language] ?? 'English';

  // ── Naver 인증 헤더 ──
  const naverClientId     = process.env.NAVER_CLIENT_ID;
  const naverClientSecret = process.env.NAVER_CLIENT_SECRET;
  const naverHeaders = (naverClientId && naverClientSecret) ? {
    'X-NCP-APIGW-API-KEY-ID': naverClientId,
    'X-NCP-APIGW-API-KEY':    naverClientSecret,
  } : null;
  console.log('[NAVER HEADERS]', JSON.stringify(naverHeaders));

  // ── Gemini API 키 ──
  const apiKey = process.env.GEMINI_API_KEY;

  // ── Gemini AI 보강 + Naver 좌표 병렬 실행 ──
  const [geminiResult] = await Promise.allSettled([
    apiKey
      ? callGeminiEnrich({ itinerary, categories, regions, startDate, endDate, tipsLanguage, transport, freeText, kpopDetails, apiKey })
      : Promise.resolve(null),
    naverHeaders
      ? Promise.allSettled([
          enrichWithGeocoordinates(itinerary, naverHeaders),
          enrichWithDrivingTimes(itinerary, naverHeaders),
        ])
      : Promise.resolve(null),
  ]);

  // ── Gemini 결과를 itinerary에 병합 ──
  let accommodation = null;
  let budgetSummary = null;

  if (geminiResult.status === 'fulfilled' && geminiResult.value) {
    const ai = geminiResult.value;
    accommodation = ai.accommodation ?? null;
    budgetSummary = ai.budgetSummary ?? null;

    if (Array.isArray(ai.itinerary)) {
      for (const aiDay of ai.itinerary) {
        const target = itinerary.find(d => d.day === aiDay.day);
        if (target) {
          target.meals      = aiDay.meals      ?? [];
          target.dailyTips  = aiDay.dailyTips  ?? [];
        }
      }
    }
  } else if (geminiResult.status === 'rejected') {
    console.error('[enrichPlan] Gemini 오류:', geminiResult.reason?.message ?? geminiResult.reason);
  }

  return respond(200, { itinerary, accommodation, budgetSummary });
};

/**
 * 네이버 Geocoding API — 주소 문자열을 정확한 WGS84 좌표로 변환합니다.
 */
async function enrichWithGeocoordinates(itinerary, naverHeaders) {
  const allPlaces = itinerary.flatMap((day) => day.places);

  await Promise.all(
    allPlaces.map(async (place) => {
      // 1) Naver Geocoding 시도
      if (naverHeaders) {
        try {
          const { data } = await axios.get(
            'https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode',
            { params: { query: place.address }, headers: naverHeaders, timeout: 5000 }
          );
          const first = data?.addresses?.[0];
          if (first) {
            place.coordinates = { lat: parseFloat(first.y), lng: parseFloat(first.x) };
            return;
          }
        } catch (err) {
          console.warn(`[Naver Geocoding] "${place.address}" 실패:`, err?.response?.data ?? err.message);
        }
      }

      // 2) Nominatim (OpenStreetMap) fallback
      // 쿼리 후보: address(특수문자 제거) → name → name(한글만)
      const cleanAddress = (place.address || '').replace(/[@&#%+]/g, ' ').trim();
      const cleanName    = (place.name    || '').replace(/[@&#%+]/g, ' ').trim();
      const queries = [...new Set([cleanAddress, cleanName].filter(Boolean))];

      for (const q of queries) {
        try {
          const { data } = await axios.get(
            'https://nominatim.openstreetmap.org/search',
            {
              params: { q, format: 'json', countrycodes: 'kr', limit: 1, 'accept-language': 'ko' },
              headers: { 'User-Agent': 'cocotrip-planner/1.0' },
              timeout: 5000,
            }
          );
          if (data?.[0]) {
            place.coordinates = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
            // Nominatim display_name에서 한국 주소만 추출 (쉼표 앞 불필요한 부분 제거)
            const parts = (data[0].display_name || '').split(',').map(s => s.trim());
            const krIdx = parts.findIndex(p => p === '대한민국' || p === 'South Korea');
            const addrParts = krIdx > 0 ? parts.slice(0, krIdx).reverse() : parts.slice(0, 4).reverse();
            const verifiedAddress = addrParts.join(' ').trim();
            if (verifiedAddress) place.address = verifiedAddress;
            console.log(`[Nominatim] "${q}" 좌표 획득 → 주소: ${verifiedAddress}`);
            break;
          }
        } catch (err) {
          console.warn(`[Nominatim] "${q}" 실패:`, err.message);
        }
      }
      if (!place.coordinates) {
        console.warn(`[Geocoding] 모든 시도 실패: "${place.name}" — Gemini 추정 좌표 유지`);
      }
    })
  );
}

/**
 * 네이버 Directions 5 API — 장소 간 실제 차량 이동 시간을 채웁니다.
 */
async function enrichWithDrivingTimes(itinerary, naverHeaders) {
  const tasks = [];

  for (const day of itinerary) {
    for (let i = 1; i < day.places.length; i++) {
      const prevPlace = day.places[i - 1];
      const prev = prevPlace.coordinates;
      const curr = day.places[i].coordinates;
      const place = day.places[i];
      const label = `${prevPlace.nameEn} → ${place.nameEn}`;

      // 네이버 지도 경로 URL 생성 (좌표 유무와 관계없이 검색 기반)
      const fromQ = encodeURIComponent(prevPlace.address || prevPlace.name || '');
      const toQ   = encodeURIComponent(place.address || place.name || '');
      place.naverTransitUrl = `https://map.naver.com/v5/directions/-/${fromQ}/-/${toQ}/transit`;
      place.naverDrivingUrl = `https://map.naver.com/v5/directions/-/${fromQ}/-/${toQ}/car`;

      if (!prev?.lat || !prev?.lng || !curr?.lat || !curr?.lng) {
        console.warn(`[Naver Directions] 좌표 없음, 건너뜀: ${label}`);
        place.transitDataError = true;
        continue;
      }

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
            const summary = data?.route?.traoptimal?.[0]?.summary;
            if (summary && typeof summary.duration === 'number') {
              place.travelTimeFromPrev = Math.round(summary.duration / 60000);
              place.travelDistanceKm   = Math.round((summary.distance || 0) / 100) / 10; // km, 1 decimal
              place.transitDataError   = false;
            } else {
              console.warn(`[Naver Directions] 경로 없음: ${label}`);
              place.transitDataError = true;
            }
          })
          .catch((err) => {
            console.warn(`[Naver Directions] ${label} 실패:`, err?.response?.data ?? err.message);
            place.transitDataError = true;
          })
      );
    }
  }

  await Promise.allSettled(tasks);
}

/**
 * Gemini AI — 식당 / 숙소 / 예산 / 데일리팁 생성
 */
async function callGeminiEnrich({ itinerary, categories, regions, startDate, endDate, tipsLanguage, transport, freeText, kpopDetails, apiKey }) {
  const totalDays = itinerary.length;
  const dayNumbers = itinerary.map(d => d.day).join(', ');

  const itinerarySummary = itinerary.map(day =>
    `Day ${day.day} (${day.date}): ${day.places.map(p => `${p.name}(${p.nameEn})`).join(', ')}`
  ).join('\n');

  const freeTextLine = freeText ? `\nSpecial requests: ${freeText}` : '';
  const kpopLine     = kpopDetails.length > 0 ? `\nK-pop interests: ${kpopDetails.join(', ')}` : '';
  const transportLine = transport ? `\nTransport: ${transport}` : '';

  const prompt = `You are a Korean travel expert. Based on the itinerary below, generate supplementary travel information.

Trip details:
- Categories: ${categories.join(', ')}
- Regions: ${regions.join(', ')}
- Dates: ${startDate} to ${endDate} (${totalDays} days)${freeTextLine}${kpopLine}${transportLine}

Core itinerary:
${itinerarySummary}

Requirements:
1. Recommend 3 meals per day (breakfast, lunch, dinner) with real Korean restaurants near each day's places. For EVERY meal include "naverMapUrl" in format: https://map.naver.com/v5/search/[restaurant+name+URL-encoded].
2. Include 2-3 practical "dailyTips" per day in ${tipsLanguage}.
3. Recommend ONE accommodation for the whole trip near the most visited area. Write "reason" in ${tipsLanguage}.
4. Provide a realistic budget summary in KRW for 1 person for all ${totalDays} days.
5. The itinerary array MUST have exactly ${totalDays} entries with day numbers: ${dayNumbers}.
6. Write meal "tip" and "dailyTips" in ${tipsLanguage}.`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema:   ENRICH_SCHEMA,
      temperature:      0.7,
      thinkingConfig:   { thinkingBudget: 0 },
    },
  });

  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}
