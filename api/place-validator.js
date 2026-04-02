/**
 * CocoTripKR — Google Places 장소 검증
 *
 * AI 플래너가 생성한 일정의 장소가 실제 존재하는지 검증
 * 폐업/휴무 감지 시 대체 장소 자동 교체
 *
 * HTTP 엔드포인트: POST /api/place-validator
 * (ai-planner 파이프라인에서 호출 또는 독립 실행)
 *
 * ENV: GOOGLE_PLACES_API_KEY
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── Google Places API 장소 검색 ──────────────────────────────────
async function searchPlace(placeName, address) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { status: 'skipped', reason: 'API key not set' };

  try {
    const query = encodeURIComponent(`${placeName} ${address || 'Seoul Korea'}`);
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&language=ko&key=${apiKey}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();

    if (data.results && data.results.length > 0) {
      const place = data.results[0];
      return {
        status: 'found',
        name: place.name,
        address: place.formatted_address,
        rating: place.rating || null,
        totalRatings: place.user_ratings_total || 0,
        businessStatus: place.business_status || 'UNKNOWN',
        isOpen: place.business_status === 'OPERATIONAL',
        isClosed: place.business_status === 'CLOSED_PERMANENTLY' || place.business_status === 'CLOSED_TEMPORARILY',
        lat: place.geometry?.location?.lat,
        lng: place.geometry?.location?.lng,
        placeId: place.place_id,
      };
    }

    return { status: 'not_found', name: placeName };
  } catch (err) {
    return { status: 'error', name: placeName, error: err.message };
  }
}

// ── AI 대체 장소 추천 ────────────────────────────────────────────
async function suggestAlternative(closedPlace, category, region) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: `You are a Korea travel expert. A tourist attraction is closed.
Suggest ONE alternative that is:
1. In the same area (${region})
2. Same category (${category})
3. Currently open and popular
4. Has good reviews

Output JSON: { "name": "장소명", "nameEn": "English Name", "address": "도로명 주소", "reason": "추천 사유", "category": "${category}" }`
  });

  const result = await model.generateContent(`The place "${closedPlace}" is permanently closed. Suggest an alternative in ${region}, category: ${category}`);
  const text = result.response.text();
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

// ── 일정 전체 검증 ──────────────────────────────────────────────
async function validateItinerary(itinerary) {
  const report = {
    totalPlaces: 0,
    verified: 0,
    closed: 0,
    notFound: 0,
    replaced: 0,
    issues: [],
    validatedItinerary: JSON.parse(JSON.stringify(itinerary)), // deep copy
  };

  for (const day of report.validatedItinerary.itinerary || []) {
    for (let i = 0; i < (day.places || []).length; i++) {
      const place = day.places[i];
      report.totalPlaces++;

      const result = await searchPlace(place.name || place.nameEn, place.address);

      if (result.status === 'found') {
        if (result.isClosed) {
          report.closed++;
          report.issues.push({
            day: day.day,
            place: place.name,
            issue: `폐업/휴무 감지 (${result.businessStatus})`,
            severity: 'critical',
          });

          // AI로 대체 장소 추천
          try {
            const alt = await suggestAlternative(place.name, place.category || 'landmark', '서울');
            if (alt) {
              day.places[i] = {
                ...place,
                name: alt.name,
                nameEn: alt.nameEn,
                address: alt.address,
                replacedFrom: place.name,
                replacementReason: alt.reason,
              };
              report.replaced++;
            }
          } catch {}
        } else {
          report.verified++;
          // 좌표 보강
          if (result.lat && result.lng) {
            place.lat = result.lat;
            place.lng = result.lng;
          }
          if (result.rating) place.googleRating = result.rating;
        }
      } else if (result.status === 'not_found') {
        report.notFound++;
        report.issues.push({
          day: day.day,
          place: place.name,
          issue: 'Google Places에서 미발견',
          severity: 'warning',
        });
      }
    }
  }

  return report;
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────
const originalHandler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS_HEADERS, body: '{"error":"POST only"}' };

  try {
    const body = JSON.parse(event.body || '{}');
    const itinerary = body.itinerary || body;

    if (!itinerary) {
      return { statusCode: 400, headers: CORS_HEADERS, body: '{"error":"itinerary data required"}' };
    }

    console.log('[place-validator] 장소 검증 시작');
    const report = await validateItinerary(itinerary);

    console.log(`[place-validator] 검증 완료: ${report.verified}/${report.totalPlaces} 확인, ${report.closed} 폐업, ${report.replaced} 교체`);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: true,
        summary: {
          total: report.totalPlaces,
          verified: report.verified,
          closed: report.closed,
          notFound: report.notFound,
          replaced: report.replaced,
        },
        issues: report.issues,
        validatedItinerary: report.validatedItinerary,
      }),
    };
  } catch (err) {
    console.error('[place-validator] 오류:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};

// --- Vercel Native Wrapper ---
export default async function vercelHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    return res.status(200).end();
  }

  const event = {
    httpMethod: req.method,
    path: req.url.split('?')[0],
    body: typeof req.body === 'object' ? JSON.stringify(req.body) : (req.body || ''),
    queryStringParameters: req.query || {},
    headers: req.headers || {}
  };
  
  try {
    const result = await originalHandler(event, {});
    
    if (result && result.headers) {
      for (const [key, val] of Object.entries(result.headers)) {
        res.setHeader(key, val);
      }
    }
    if (result && result.statusCode) {
      let finalBody = result.body;
      if (typeof finalBody === 'string') {
        try { finalBody = JSON.parse(finalBody); } catch(e) {}
      }
      return res.status(result.statusCode).json(finalBody);
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
  