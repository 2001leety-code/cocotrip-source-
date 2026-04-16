/**
 * Vercel API Route: AI Planner Full v2
 * POST /api/ai-planner-full
 *
 * Gemini 2.5 Flash → RouteAgent → T-money 계산 → Firestore 저장 (blocking)
 * → planId + planUrl 응답 → 알림 이메일 (non-blocking)
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
// nodemailer is dynamically imported inside sendNotificationEmail
import { getSpotContext } from './_spots_helper.js';
import { getFoodContext } from './_food_helper.js';
import { RouteAgent } from './_ai_core/agents/RouteAgent.js';
import { randomUUID } from 'crypto';
import { Buffer } from 'buffer';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, FieldValue } from 'firebase-admin/firestore';
import { sendMessage, sendErrorAlert } from './_telegram.js';

export const maxDuration = 300;
export const config = { runtime: 'nodejs' };

// ── 환경변수 trim — Naver API 헤더 오류 방지 (개행/공백 제거) ──────────
['NAVER_CLIENT_ID','NAVER_CLIENT_SECRET','NCP_CLIENT_ID','NCP_CLIENT_SECRET'].forEach(k => {
  if (process.env[k]) process.env[k] = process.env[k].trim();
});

// ── firebase-admin 초기화 ─────────────────────────────────────────────────
let adminDb = null;
try {
  const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();

  // 키 정리: Vercel 환경변수에서 발생하는 모든 문제를 극복하기 위해
  // PEM base64 본문을 추출 → 공백/개행/오염문자 전부 제거 → 재구성
  let rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
    .replace(/^\uFEFF/, '')           // BOM 제거
    .replace(/^["']|["']$/g, '')      // 앞뒤 따옴표 제거
    .replace(/\\n/g, '\n')            // 이스케이프된 \n → 줄바꿈
    .trim();

  let privateKey = '';
  const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
  if (pemMatch) {
    // base64 본문만 추출 → 공백/개행 전부 제거 → 64자씩 줄바꿈 재구성
    const base64Clean = pemMatch[1].replace(/\s+/g, '');
    const lines = base64Clean.match(/.{1,64}/g) || [];
    privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
  } else {
    privateKey = rawKey; // fallback — 원본 그대로
  }

  console.log('[ai-planner-full] Key diagnostics:', {
    projectId: projectId ? projectId.substring(0, 10) + '...' : 'MISSING',
    clientEmail: clientEmail ? clientEmail.substring(0, 15) + '...' : 'MISSING',
    rawKeyLength: rawKey.length,
    cleanKeyLength: privateKey.length,
    startsOK: privateKey.startsWith('-----BEGIN'),
    endsOK: privateKey.trim().endsWith('-----END PRIVATE KEY-----'),
    pemExtracted: !!pemMatch,
  });

  if (projectId && clientEmail && privateKey) {
    const adminApp = getApps().length ? getApps()[0] : initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    adminDb = getAdminFirestore(adminApp);
    adminDb.settings({ ignoreUndefinedProperties: true });
    console.log('[ai-planner-full] firebase-admin initialized OK');
  } else {
    console.warn('[ai-planner-full] firebase-admin keys missing — Firestore disabled');
  }
} catch (e) {
  console.error('[ai-planner-full] firebase-admin init failed:', e.message);
  console.error('[ai-planner-full] → Vercel 대시보드에서 FIREBASE_PRIVATE_KEY를 재입력하세요');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── 공항 주소 매핑 ─────────────────────────────────────────────────────────
const AIRPORT_ADDRESSES = {
  ICN_T1: '인천광역시 중구 공항로272번길 43 (제1여객터미널)',
  ICN_T2: '인천광역시 중구 제2터미널대로 (제2여객터미널)',
  ICN: '인천광역시 중구 공항로272번길 43 (인천국제공항)',
  GMP: '서울특별시 강서구 하늘길 77',
  PUS: '부산광역시 강서구 공항진입로 108',
  CJU: '제주특별자치도 제주시 공항로 2',
  TAE: '대구광역시 동구 공항로 221',
  KWJ: '광주광역시 광산구 상무대로 420',
  MWX: '전라남도 무안군 망운면 공항로 970-260',
  YNY: '강원특별자치도 양양군 손양면 공항로 201',
  ALREADY: null,
};

const AIRPORT_NAMES = {
  ICN_T1: 'Incheon Airport Terminal 1',
  ICN_T2: 'Incheon Airport Terminal 2',
  GMP: 'Gimpo Airport',
  PUS: 'Gimhae Airport (Busan)',
  CJU: 'Jeju Airport',
  TAE: 'Daegu Airport',
  KWJ: 'Gwangju Airport',
  MWX: 'Muan Airport',
  YNY: 'Yangyang Airport',
  ALREADY: null,
};

// ── 계측 함수 (Phase 1 — 기능 변경 없음, 측정만) ──────────────────────────
function logPromptMetrics(prompt, ctx) {
  try {
    const chars = prompt.length;
    const estTokens = Math.ceil(chars / 3);
    console.log('[PROMPT_METRICS]', JSON.stringify({
      chars,
      estTokens,
      injectedRestaurants: ctx.injectedRestaurants ?? 0,
      city: ctx.city,
      days: ctx.days,
      diet: ctx.diet,
      lang: ctx.lang,
      timestamp: new Date().toISOString(),
    }));
  } catch { /* metrics should never break the flow */ }
}

function validateResponse(data, request, foodIndex) {
  const issues = [];
  const allStops = (data.days || []).flatMap(d => (d.stops || []));

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
    // 언어 혼합 (ko 요청인데 tip이 영어만)
    const tipText = stop.tip || stop.tip_en || '';
    if (request.lang === 'ko' && tipText && /^[A-Za-z0-9\s.,!?'\-:()]+$/.test(tipText)) {
      issues.push({ type: 'language_mismatch', stop: stopLabel, field: 'tip' });
    }
    // 비현실적 stay_min
    if (stop.stay_min != null && (stop.stay_min < 15 || stop.stay_min > 240)) {
      issues.push({ type: 'unrealistic_stay', stop: stopLabel, value: stop.stay_min });
    }
  }

  console.log('[RESPONSE_VALIDATION]', JSON.stringify({
    total_stops: allStops.length,
    food_stops: allStops.filter(s => s.category === 'food').length,
    issue_count: issues.length,
    issues: issues.slice(0, 20),
  }));
  return issues;
}

// ── Rich System Prompt ──────────────────────────────────────────────────
const LANG_INSTRUCTION = {
  en: `Write ALL narrative text fields in English.
Field-by-field rules:
- "name" → ALWAYS Korean (e.g. 경복궁) — used for Korean map API, never translate
- "display_name" → English (e.g. Gyeongbokgung Palace) — shown to user
- "tip", tour_title, theme → English
- address → Korean road address (for geocoding)
- recommended_items.name → user language (English)
NEVER mix languages within a single string value.`,
  ko: `모든 사용자 대면 텍스트를 자연스러운 한국어로 작성하세요.
필드별 규칙:
- "name" → 반드시 한국어 장소명 (예: 경복궁) — 네이버맵 검색용
- "display_name" → 한국어 (예: 경복궁)
- "tip", tour_title, theme → 한국어
- address → 한국어 도로명 주소
- recommended_items.name → 한국어 (예: 삼계탕)
- 번역투 금지. 자연스럽고 친근한 톤 사용.`,
  ja: `すべてのテキストフィールドを自然な日本語で記述してください。
- "name" → 常に韓国語 (ネイバーマップ検索用)
- "display_name" → 日本語
- "tip" → 日本語
- address → 韓国語の道路名住所`,
  zh: `请用自然流畅的中文填写所有文本字段。
- "name" → 始终韩文 (用于韩国地图搜索)
- "display_name" → 中文
- "tip" → 中文
- address → 韩文道路名地址`,
};

function buildSystemPrompt(language = 'en') {
  const langNote = LANG_INSTRUCTION[language] || LANG_INSTRUCTION.en;
  return `You are CocoTrip AI, Korea's #1 private tour planner (cocotripkr.com).
Create a REAL, actionable itinerary with precise times, entry fees, meal recommendations, and budget breakdowns.

## LANGUAGE — ABSOLUTE RULE (최우선 규칙)
${langNote}
The output language must match the user's language setting. Do NOT mix languages in the same field.

## OUTPUT FORMAT — STRICT JSON ONLY
No markdown. No code blocks. No explanation. Pure JSON only.

{
  "tour_title": "Personalized title (e.g. Sarah's K-Pop & Gangnam Food Adventure)",
  "vehicle": "staria_8 | sprinter | large_bus",
  "base_price_krw": 330000,

  "arrival_guide": {
    "airport": "ICN T1 | ICN T2 | GMP",
    "steps": [
      {
        "step": 1, "title": "Immigration & Baggage",
        "description": "Detailed walkthrough for first-time Korea visitors",
        "est_min": 35
      },
      {
        "step": 2, "title": "Get Connected (SIM / Wi-Fi)",
        "description": "Where to buy and which option is best",
        "est_min": 10,
        "options": [
          {"name": "Physical SIM (KT)", "price_krw": 33000, "note": "5-day unlimited data"},
          {"name": "Portable Wi-Fi", "price_krw": 5500, "note": "per day rental"},
          {"name": "eSIM (Klook)", "price_krw": 15000, "note": "pre-purchase recommended"}
        ]
      },
      {
        "step": 3, "title": "Get a T-money Card",
        "description": "Buy at CU/GS25 convenience store (₩4,000). Load amount will be calculated by server.",
        "est_min": 5,
        "t_money_card_cost_krw": 4000,
        "t_money_recommended_load_krw": 0
      },
      {
        "step": 4, "title": "Currency & Payment Tips",
        "description": "ATM locations, card acceptance, cash tips",
        "est_min": 5,
        "recommended_cash_krw": 50000
      },
      {
        "step": 5, "title": "Get to Your Hotel",
        "description": "Best transport option based on group size",
        "est_min": 0,
        "transport_to_hotel": {
          "arex_express": {"price_krw": 9500, "duration_min": 43, "instruction": ""},
          "arex_all_stop": {"price_krw": 4150, "duration_min": 66, "instruction": ""},
          "limousine_bus": {"price_krw": 17000, "duration_min": 70, "instruction": ""},
          "taxi": {"est_price_krw": 75000, "duration_min": 60, "instruction": ""}
        },
        "recommendation": "Based on group size and luggage"
      }
    ]
  },

  "days": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "theme": "Day theme in English",
      "stops": [
        {
          "order": 1,
          "start_time": "09:30",
          "name": "경복궁",
          "display_name": "Gyeongbokgung Palace",
          "category": "culture",
          "address": "서울특별시 종로구 사직로 161",
          "stay_min": 90,
          "entry_fee_krw": 3000,
          "entry_fee_note": "Free with hanbok",
          "reservation_required": false,
          "tip": "Practical first-timer tip (1-2 sentences)",
          "recommended_items": [
            {"name": "Hanbok rental", "price_krw": 20000, "note": "Includes free palace entry"}
          ]
        },
        {
          "order": 2,
          "start_time": "12:00",
          "name": "토속촌",
          "display_name": "Tosokchon Samgyetang",
          "category": "food",
          "address": "서울특별시 종로구 자하문로5길 5",
          "stay_min": 60,
          "entry_fee_krw": 0,
          "reservation_required": true,
          "reservation_phone": "02-737-7444",
          "tip": "Order the original samgyetang (₩17,000). Cash preferred.",
          "recommended_items": [
            {"name": "삼계탕", "price_krw": 17000, "note": "Signature dish"},
            {"name": "파전", "price_krw": 15000, "note": "To share"},
            {"name": "동동주", "price_krw": 10000, "note": "Traditional rice wine"}
          ]
        }
      ]
    }
  ],

  "departure_guide": {
    "airport": "ICN T1",
    "recommended_departure_time": "3 hours before flight",
    "latest_leave_hotel": "HH:MM",
    "luggage_storage": {
      "available": true,
      "location": "Specific location",
      "price_krw": 5000,
      "options": [
        {"name": "Subway coin locker", "price_krw": 1000, "note": "per 2hrs"},
        {"name": "Seoul Station storage", "price_krw": 5000, "note": "full day"}
      ]
    },
    "to_airport": {
      "method": "AREX Express",
      "instruction": "Detailed transit instruction",
      "cost_krw": 11000,
      "duration_min": 43
    },
    "tax_refund": {
      "threshold_krw": 30000,
      "location": "Near check-in counter H, Tax Refund kiosk",
      "note": "Before check-in. Passport + original receipts required."
    },
    "last_minute_shopping": "Duty-free shopping tips"
  },

  "daily_budget_summary": [
    {
      "day": 1,
      "transport_krw": 0,
      "entry_fees_krw": 0,
      "meals_krw": 0,
      "activities_krw": 0,
      "shopping_estimate_krw": 0,
      "total_krw": 0
    }
  ]
}

## ROUTE & TIME RULES
- stops: 5-7 per full day (09:00-20:30), 3-4 per half day
- start_time: realistic — include 12:00-13:30 lunch, 18:30-20:00 dinner
- stay_min: honest (palace 90, restaurant 60, market 75, museum 120, cafe 40)
- entry_fee_krw: 0 if free, real KRW otherwise
- DO NOT generate transit_from_prev — transit is generated by our backend RouteAgent via ODsay API. You only decide WHICH stops and in WHAT ORDER.
- recommended_items: 3-5 items with REAL KRW prices
  - Food: specific dish name + price (e.g. 삼계탕 ₩17,000)
  - Market: what to buy + budget
- address: Korean road address (도로명 주소). If 100% sure, include it. If NOT sure, OMIT entirely — backend resolves it.
- tip: 1-2 sentences, practical advice in THE USER'S LANGUAGE
- arrival_guide: SKIP if arrival_airport is "already_in_korea"
- t_money_recommended_load_krw: always 0 (server calculates)
- daily_budget_summary: transport estimates are filled by server, just estimate 0 for transport
- accessibility_note: required when mobility is "limited"

## ROUTE OPTIMIZATION — CRITICAL
- Group stops by geographic zone. NEVER zigzag across the city.
  - Seoul zones: Jongno/Gwanghwamun → Yongsan/Itaewon → Gangnam/COEX → Hongdae/Mapo → Myeongdong/Jung-gu → Seongsu/Gwangjin → Bukchon/Samcheong-dong → Euljiro/Dongdaemun
  - Busan zones: Haeundae/Songjeong → Gwangalli/Suyeong → Seomyeon/Bujeon → Nampo-dong/BIFF → Gamcheon/Songdo → Gijang/Haedong Yonggungsa
  - Plan each half-day within 1-2 adjacent zones maximum.
  - BAD: Hongdae → Gangnam → Yongsan (zigzag across city)
  - GOOD: Hongdae → Yeonnam-dong → Hapjeong (same zone, walkable)
- If the user specifies must-visit places in special_request, BUILD the route AROUND those places.
  - Place them first, then fill gaps with nearby attractions.
  - Example: user wants "HYBE" (Yongsan) → plan Yongsan/Itaewon zone that day.
- Transit between consecutive stops should be under 30 minutes.
- First stop of Day 1 should be near the hotel or arrival point.

## DIVERSITY — CRITICAL (THIS IS A PAID $9.90 PLAN — MAKE IT SPECIAL)
- NEVER repeat the same itinerary. Each plan must feel personally curated and unique.
- The variation_seed in the user message determines your creative angle. Use it to pick a DIFFERENT starting neighborhood, route direction, and restaurant mix each time.
- Mix 60% well-known highlights + 40% hidden gems (local favorites, Instagram spots, residential area cafes, artisan shops, neighborhood parks).
- Rotate restaurants: NEVER default to the same 3-4 famous spots. Use different DB restaurants each time.
- Vary the starting area: if seed is odd start from a different zone than usual. Don't always begin at 경복궁 or 명동.
- Each day needs personality: give it a vivid theme (e.g. "이태원 골목 미식 투어", "성수동 카페 & 빈티지 탐방", "종로 궁궐 & 북촌 한옥 산책").
- For food: vary cuisine types (Korean BBQ one meal, street food next, seafood, traditional, jjigae, tteokbokki, cafe dessert).
- Include at least ONE unexpected/delightful recommendation per day that tourists wouldn't find on their own.

## STYLE-DRIVEN PLANNING — MANDATORY (사용자 선택 스타일 반영)
The user selected specific styles (activity preferences). You MUST tailor at least 60% of stops:
- "Kpop": Include K-pop agency buildings (HYBE, SM, JYP), fan cafes, K-Star Road, album shops, music show venues
- "Food": Increase food stops to 3 per day, include market tours, cooking classes, food alleys
- "Night": Add night markets, Han River evening, rooftop bars, 야경 spots, 포장마차
- "Shopping": Include Myeongdong, Gangnam underground, 동대문 DDP, outlet malls, 가로수길
- "Temple": Include temple stays, major temples, meditation, Buddhist culture experiences
- "Photo": Include Instagram-worthy cafes, 벽화마을, 감성카페, scenic viewpoints
- "Drama": Include K-drama filming locations, drama-themed parks, filming studio tours
- "Hanbok": Include hanbok rental zones, traditional villages, Bukchon, Jeonju Hanok Village
- "Dmz": Reserve full day for DMZ tour — Imjingak, 제3땅굴, 도라전망대, 통일촌
- "Kbeauty": Include beauty shops, skincare experiences, Apgujeong, Garosugil beauty street

If "special_request" is present in the user message, treat it as HIGHEST PRIORITY:
- If the user names specific places (e.g. "경복궁", "HYBE"), those places MUST appear in the itinerary
- Build the surrounding route around those requested places
- Do NOT ignore or substitute the user's explicit requests

## MEAL PLANNING — STRICT RULES (NEVER VIOLATE)
- 1 dedicated lunch + 1 dinner per full day (category: "food")
- 3-5 signature menu items with KRW prices
- reservation_required + phone for popular spots

### ⚠️ RESTAURANT SELECTION — MANDATORY RULES (READ 3 TIMES)
When the user message contains "VERIFIED RESTAURANT DATABASE":
1. You MUST pick restaurants ONLY from that list. This is NOT optional.
2. Copy the EXACT "name" from the database as your stop's "name" field
3. Copy the EXACT "address" from the database
4. Set "verified": true on EVERY food stop from the database
5. Match by geographic proximity (same dong/neighborhood as nearby landmark stops)
6. Create recommended_items with 3-5 realistic menu items + KRW prices
7. If fewer DB restaurants than needed for the trip, REUSE a DB restaurant for a second meal before inventing one

If NO "VERIFIED RESTAURANT DATABASE" appears in the message:
- The city is not yet in our database
- Use ONLY these nationwide chains: 본죽, 교촌치킨, bhc, 명륜진사갈비, 스타벅스, 투썸플레이스, 설빙, 파리바게뜨, 이삭토스트, 김밥천국, 맘스터치, 빽다방
- OR use category description: "전통시장 내 분식집", "해변가 해산물 맛집"
- Set "verified": false
- NEVER invent specific restaurant names outside the chain list

### WHAT COUNTS AS "INVENTING"? (common mistakes to avoid)
- ❌ "명동교자 본점" — unless this EXACT name appears in the database
- ❌ "해산물 전문점 (할랄-프렌들리)" — vague category, not a real name
- ✅ Copying "토속촌|Tosokchon" exactly from the database → verified: true
- ✅ "김밥천국" (nationwide chain) → verified: false

### Diet preferences:
If diet_preferences includes "Halal":
- ONLY recommend halal-certified restaurants
- If verified halal restaurants are provided, use ONLY those
- NEVER recommend pork or non-halal meat dishes

If diet_preferences includes "Vegan":
- ONLY recommend 100% plant-based restaurants
- If verified vegan restaurants are provided, use ONLY those
- NEVER recommend dishes with fish sauce or anchovy stock

If diet_preferences includes "Seafood":
- Prioritize seafood restaurants: 회(sashimi), 해산물(seafood), 조개구이(grilled shellfish), 새우(shrimp), 게(crab)

If diet_preferences includes "Meat":
- Prioritize Korean BBQ, 한우(Korean beef), 삼겹살(pork belly), 갈비(ribs), 고기구이(grilled meat)

If diet_preferences includes "Spicy":
- Include spicy dishes: 불닭(fire chicken), 떡볶이(tteokbokki), 매운탕(spicy stew), 마라(mala), 닭발(chicken feet)

If diet_preferences includes "Street":
- Include street food: 시장(markets), 포장마차(street stalls), 분식(snack shops), 떡볶이, 호떡, 어묵, 길거리 음식

### Allergy safety:
If food_allergies includes any allergen:
- Treat as SAFETY-CRITICAL. NEVER recommend dishes containing the allergen.
- Add warning in tip: "⚠️ Inform restaurant about your [allergen] allergy"

### Meal price range:
If meal_budget is "Budget":
- Street food, markets, local diners (₩5,000-12,000 per person per meal)
- Gwangjang Market, Tongin Market, 분식집, 백반집

If meal_budget is "Moderate":
- Mid-range restaurants (₩12,000-30,000 per person per meal)
- Popular 맛집, well-reviewed local favorites

If meal_budget is "Premium":
- Michelin/high-end restaurants (₩50,000+ per person per meal)
- Set reservation_required: true

## VEHICLE PRICING
- staria_8 (1-8 pax): ₩330,000/8hrs
- sprinter (9-15 pax): ₩450,000/8hrs
- large_bus (16+): ₩650,000/8hrs

## ⚠️ DEFENSE RULES

### ANTI-HALLUCINATION
- NEVER invent restaurant names. Use ONLY restaurants from the VERIFIED DATABASE or nationwide chains listed above.
- If address unknown, OMIT it. Backend resolves addresses automatically.
- If unsure about any restaurant → pick one from the VERIFIED DATABASE instead.

### ADDRESS FORMAT (when you DO include it)
- Complete road address: "시/도 + 구/군 + 도로명 + 건물번호"
  ✅ "서울특별시 종로구 사직로 161"
  ❌ "서울 종로구" (too vague)
  ❌ "서울특별시 중구 명동길" (missing number)

### OUTPUT SIZE (prevent JSON truncation)
- Keep tip to 1-2 sentences max.
- Trips 4+ days: max 5 stops per day.
- Be concise everywhere. Shorter = safer.

### ⚠️ SAFETY-CRITICAL (OVERRIDE ALL)
- food_allergies → NEVER recommend allergen dishes. Add "⚠️ [Allergen] allergy — inform staff" to tip.
  Hidden: 땅콩소스(peanut), 새우젓(shrimp), 밀가루(gluten), 치즈/우유(dairy)
- Halal → ONLY verified halal restaurants. ZERO pork/alcohol/lard.
- Vegan → ZERO animal products. Watch: 멸치육수, 젓갈, 계란, 김치(often 젓갈)

### PRICING (2026)
- Palace: ₩3,000 (free with hanbok), N서울타워: ₩21,000
- If price uncertain → note "가격 변동 가능" in tip`;
}

// ── 차량 타입 결정 ─────────────────────────────────────────────────────────
function selectVehicle(pax, requestedVehicle) {
  if (requestedVehicle && requestedVehicle !== 'auto') return requestedVehicle;
  if (pax <= 8) return 'staria_8';
  if (pax <= 15) return 'sprinter';
  return 'large_bus';
}

// ── 가격 계산 ───────────────────────────────────────────────────────────────
function calcPrice(vehicle, durationDays) {
  const basePrices = { staria_8: 330000, sprinter: 450000, large_bus: 650000 };
  const base = basePrices[vehicle] || 330000;
  return base * Math.max(1, durationDays);
}

// ── 이메일 발송 (non-blocking) ──────────────────────────────────────────────
async function sendNotificationEmail({ email, guestName, tourTitle, planId, planUrl }) {
  const gmailUser = (process.env.GMAIL_USER || '').trim();
  const gmailPass = (process.env.GMAIL_APP_PASSWORD || '').trim();
  if (!gmailUser || !gmailPass || !email) return;

  const fullPlanUrl = `https://cocotripkr.com${planUrl}`;
  const html = `<!DOCTYPE html><html><body style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8f9fa;">
  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;border-radius:16px;text-align:center;margin-bottom:24px;">
    <h1 style="color:#fff;margin:0 0 8px;font-size:22px;">Your CocoTrip Plan is Ready ✨</h1>
    <p style="color:#a78bfa;margin:0;font-size:14px;">${tourTitle || 'Your Korea Itinerary'}</p>
  </div>
  <p style="font-size:16px;color:#333;">Hi ${guestName},</p>
  <p style="font-size:14px;color:#555;line-height:1.6;">Your AI-curated Korea itinerary is ready! View the full plan with maps, budget breakdown, airport arrival guide, and PDF download.</p>
  <div style="text-align:center;margin:32px 0;">
    <a href="${fullPlanUrl}" style="background:linear-gradient(135deg,#a855f7,#ec4899);color:#fff;padding:16px 48px;border-radius:30px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">View Your Full Itinerary</a>
  </div>
  <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:32px;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;">Plan ID: ${planId}<br>WhatsApp: +82-10-8714-0611 · cocotripkr.com</p>
  </div></body></html>`;

  try {
    const { default: nodemailer } = await import('nodemailer');
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
    await transporter.sendMail({
      from: `"CocoTrip" <${gmailUser}>`,
      to: email,
      subject: `✅ Your CocoTrip Plan: ${tourTitle || 'Korea Itinerary'}`,
      html,
    });
    console.log('[ai-planner-full] Email sent to:', email);
  } catch (e) {
    console.warn('[ai-planner-full] Email failed:', e.message);
  }
}

// ── 메인 핸들러 ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }

  const handlerStart = Date.now();
  console.log('[planner] === START ===');

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    // ── 재생성 모드 (Revision) ──────────────────────────────────────────────
    const revisionOf = body.revisionOf; // 원본 planId
    const revisionToken = body.revisionToken; // 게스트용 accessToken
    let isRevision = false;

    if (revisionOf && adminDb) {
      console.log('[planner] Revision mode — checking credits for plan:', revisionOf);
      const origRef = adminDb.collection('plans').doc(revisionOf);
      const origDoc = await origRef.get();
      if (!origDoc.exists) {
        res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Original plan not found' }));
      }
      const origData = origDoc.data();
      // 권한 확인: uid 매칭 또는 accessToken 매칭
      const uid = body.uid || null;
      const isOwner = uid && origData.uid === uid;
      const hasToken = origData.accessToken && origData.accessToken === revisionToken;
      if (!isOwner && !hasToken && origData.uid) {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized revision' }));
      }
      // 크레딧 확인
      const credits = origData.revisionCredits ?? 0;
      if (credits <= 0) {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No revision credits remaining', details: 'You have already used your free revision.' }));
      }
      // 크레딧 차감
      await origRef.update({
        revisionCredits: FieldValue.increment(-1),
        revisionCount: FieldValue.increment(1),
        lastRevisionAt: new Date().toISOString(),
      });
      isRevision = true;
      console.log('[planner] ✅ Revision credit consumed. Remaining:', credits - 1);
    }

    // ── PayPal 결제 검증 (revision 모드가 아닐 때만) ────────────────────────
    const paypalOrderId = body.paypalOrderId;
    const requestEmail = (body.email || '').toLowerCase().trim();

    if (!isRevision && !paypalOrderId) {
      res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Payment required', details: 'PayPal order ID is missing. Please complete payment first.' }));
    }

    // 테스트 계정은 샌드박스 API로, 일반 계정은 라이브 API로 검증
    const TEST_ACCOUNTS = ['2001leety@gmail.com'];
    const isTestAccount = TEST_ACCOUNTS.includes(requestEmail);

    if (!isRevision && paypalOrderId) {
      // ── TEST- prefix 바이패스 (테스트 계정 전용) ──────────────────────────
      const isTestOrderId = paypalOrderId.startsWith('TEST-');
      if (isTestOrderId && isTestAccount) {
        console.log('[planner] ✅ TEST MODE bypass — skipping PayPal verification for:', requestEmail);
      } else if (isTestOrderId && !isTestAccount) {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized test mode', details: 'Test mode is only available for authorized accounts.' }));
      } else {
        // 실제 PayPal 결제 검증
        const ppClientId = isTestAccount
          ? process.env.PAYPAL_SANDBOX_CLIENT_ID
          : process.env.PAYPAL_CLIENT_ID;
        const ppSecret = isTestAccount
          ? process.env.PAYPAL_SANDBOX_SECRET
          : process.env.PAYPAL_CLIENT_SECRET;
        const ppBase = isTestAccount
          ? 'https://api-m.sandbox.paypal.com'
          : 'https://api-m.paypal.com';

        console.log('[planner] PayPal mode:', isTestAccount ? 'SANDBOX' : 'LIVE', '| email:', requestEmail);

        const ppCreds = Buffer.from(`${ppClientId}:${ppSecret}`).toString('base64');
        const tokenRes = await fetch(`${ppBase}/v1/oauth2/token`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${ppCreds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials',
        });
        if (!tokenRes.ok) {
          const tokenBody = await tokenRes.text().catch(() => '');
          console.error('[planner] PayPal auth failed:', tokenRes.status, tokenBody);
          res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: `PayPal auth ${tokenRes.status}: ${tokenBody}` }));
        }
        const ppToken = (await tokenRes.json()).access_token;

        const orderRes = await fetch(`${ppBase}/v2/checkout/orders/${paypalOrderId}`, {
          headers: { 'Authorization': `Bearer ${ppToken}`, 'Content-Type': 'application/json' },
        });
        const orderData = await orderRes.json();
        console.log('[planner] PayPal order status:', orderData.status, 'id:', paypalOrderId);

        if (orderData.status !== 'COMPLETED' && orderData.status !== 'APPROVED') {
          res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Payment not completed', details: `Order status: ${orderData.status}` }));
        }

        // 중복 사용 방지 — Firestore에 사용된 orderID 확인
        if (adminDb) {
          const usedRef = adminDb.collection('used_paypal_orders').doc(paypalOrderId);
          const usedDoc = await usedRef.get();
          if (usedDoc.exists) {
            res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Order already used', details: 'This payment has already been used to generate a plan.' }));
          }
          await usedRef.set({ usedAt: new Date().toISOString(), status: orderData.status });
        }
      }
    }

    console.log('[planner] ✅ Auth passed:', isRevision ? `REVISION of ${revisionOf}` : paypalOrderId);

    // ── 입력 파싱 ──────────────────────────────────────────────────────────
    const guestName = body.guest_name || body.guestName || 'Guest';
    const paxRaw = Number(body.pax) || Number(body.guest_count) || 2;
    const pax = Math.max(1, Math.min(50, isFinite(paxRaw) ? paxRaw : 2));
    const styles = Array.isArray(body.styles) ? body.styles : body.preferences ? [body.preferences] : ['culture'];
    const area = body.area || body.destination || body.region || 'seoul_city';
    const duration = body.duration || 'full_day';
    const durationDays = body.durationDays || (duration === 'multi_day' ? 2 : 1);
    const startDate = body.date || body.startDate || new Date().toISOString().split('T')[0];
    const email = body.email || '';
    const specialRequest = body.special_request || body.message || '';
    const vehicleOverride = body.vehicle || 'auto';
    const vehicle = selectVehicle(pax, vehicleOverride);
    const language = body.language || 'en';

    // ── 신규 필드 (v2) ────────────────────────────────────────────────────
    const arrival_airport = body.arrival_airport || '';
    const departure_airport = body.departure_airport || arrival_airport || '';
    const hotel_address = body.hotel_address || '';
    const mobility = body.mobility || 'ok';
    const uid = body.uid || null;

    // ── 음식 취향 (v3) ────────────────────────────────────────────────────
    const dietPrefs = Array.isArray(body.dietPrefs) ? body.dietPrefs : [];
    const allergies = Array.isArray(body.allergies) ? body.allergies : [];
    const priceRange = body.priceRange || 'Any';

    const arrivalAddress = AIRPORT_ADDRESSES[arrival_airport] || '';
    const departureAddress = AIRPORT_ADDRESSES[departure_airport] || AIRPORT_ADDRESSES[arrival_airport] || '';

    console.log('[ai-planner-full] Request:', JSON.stringify({
      email: email ? '***' : undefined,
      styles, area, duration, pax, vehicle,
      arrival_airport, mobility, uid: uid ? '***' : null,
    }));

    // ── ENV 디버그 ──────────────────────────────────────────────────────
    console.log('[ai-planner-full] ENV check:', {
      gemini: !!(process.env.GEMINI_API_KEY),
      firebase: !!adminDb,
      gmail: !!(process.env.GMAIL_USER),
    });
    console.log('[ai-planner-full] body keys:', Object.keys(body));

    console.log('[planner] Step 1: Calling Gemini...');

    // ── Gemini 호출 ──────────────────────────────────────────────────────
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.95,
        maxOutputTokens: 24000,
        responseMimeType: 'application/json',
      },
    });

    let spotContext = '';
    try {
      spotContext = getSpotContext(area, 4) || '';
    } catch (spotErr) {
      console.warn('[ai-planner-full] getSpotContext failed:', spotErr.message);
    }

    // ── 맛집 DB 컨텍스트 주입 ────────────────────────────────────────────
    let foodContext = '';
    try {
      foodContext = getFoodContext(area, dietPrefs, priceRange, 10) || '';
      if (foodContext) {
        console.log('[ai-planner-full] Food context injected:', foodContext.length, 'chars');
      }
    } catch (foodErr) {
      console.warn('[ai-planner-full] getFoodContext failed:', foodErr.message);
    }

    const userMessage = JSON.stringify({
      guest_name: guestName,
      guest_count: pax,
      date: startDate,
      duration_days: durationDays,
      styles,
      area,
      duration,
      vehicle,
      arrival_airport: arrival_airport || undefined,
      departure_airport: departure_airport || undefined,
      arrival_address: arrivalAddress || undefined,
      departure_address: departureAddress || undefined,
      hotel_address: hotel_address || undefined,
      mobility,
      special_request: specialRequest || undefined,
      diet_preferences: dietPrefs.length > 0 ? dietPrefs : undefined,
      food_allergies: allergies.length > 0 ? allergies : undefined,
      meal_budget: priceRange !== 'Any' ? priceRange : undefined,
      variation_seed: Math.floor(Math.random() * 100) + 1,
    }) + spotContext + foodContext + (() => {
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
    })();

    // ── 프롬프트 계측 (Phase 1) ───────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(language);
    logPromptMetrics(systemPrompt + userMessage, {
      city: area,
      days: durationDays,
      diet: dietPrefs.join(',') || 'none',
      lang: language,
      injectedRestaurants: (foodContext.match(/•/g) || []).length,
    });

    // ── Gemini 호출 + 240초 타임아웃 (Promise.race) ───────────────────────
    const GEMINI_TIMEOUT_MS = 240000;
    const geminiStart = Date.now();

    const geminiPromise = model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: { role: 'system', parts: [{ text: buildSystemPrompt(language) }] },
    });
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Gemini API timeout')), GEMINI_TIMEOUT_MS);
    });

    let result;
    try {
      result = await Promise.race([geminiPromise, timeoutPromise]);
    } catch (err) {
      console.error('[planner] Gemini timeout or error:', err.message, '| elapsed:', Date.now() - geminiStart, 'ms');
      if (err.message.includes('timeout')) {
        throw new Error('AI is taking too long. Please try again.');
      }
      throw err;
    }
    console.log('[planner] Gemini:', Date.now() - geminiStart, 'ms');

    const rawText = result.response.text().trim();
    console.log('[ai-planner-full] Gemini raw (first 200):', rawText.substring(0, 200));
    console.log('[ai-planner-full] Gemini raw length:', rawText.length);
    let itinerary;
    try {
      itinerary = JSON.parse(rawText);
    } catch (parseErr1) {
      console.warn('[ai-planner-full] Direct parse failed:', parseErr1.message);
      // Step 1: strip markdown fences
      let cleaned = rawText.replace(/^```(?:json)?|```$/gm, '').trim();
      const first = cleaned.indexOf('{');
      if (first > 0) cleaned = cleaned.slice(first);

      // Step 2: try parsing cleaned text
      try {
        itinerary = JSON.parse(cleaned);
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
          itinerary = JSON.parse(repaired);
          console.log('[ai-planner-full] Truncated JSON repaired OK, days:', (itinerary.days || []).length);
        } catch (parseErr3) {
          console.error('[ai-planner-full] JSON repair also failed:', parseErr3.message);
          throw new Error('Gemini returned invalid JSON (possibly truncated). Please try again.');
        }
      }
    }
    console.log('[ai-planner-full] Parsed OK, days:', (itinerary.days || []).length);

    // ── 주소 정리 — Gemini가 "대한민국 " 접두사를 붙이는 경우 제거 ──────────
    for (const day of (itinerary.days || [])) {
      for (const stop of (day.stops || [])) {
        if (stop.address) {
          stop.address = stop.address.replace(/^대한민국\s+/, '').replace(/\bKR\s+/g, '');
        }
      }
    }

    // ── 응답 품질 검증 (Phase 1) ─────────────────────────────────────────
    let _foodIndex = [];
    try { _foodIndex = JSON.parse((await import('fs')).readFileSync(new URL('./_food_index.json', import.meta.url), 'utf-8')); } catch { /* ok */ }
    const _validationIssues = validateResponse(itinerary, { lang: language }, _foodIndex);

    // ── Phase 2: 백엔드 DB 매칭 + Address Resolver ──────────────────────
    // Gemini가 verified 플래그를 설정하지 않거나 DB 식당 이름을 약간 변형해도
    // 백엔드에서 강제로 매칭하여 주소/좌표를 교정합니다.
    if (_foodIndex.length > 0) {
      let dbMatched = 0, dbUnmatched = 0;
      const allStops = (itinerary.days || []).flatMap(d => d.stops || []);
      for (const stop of allStops) {
        if (stop.category !== 'food') continue;
        
        const stopName = (stop.name || stop.name_ko || '').trim();
        if (!stopName) { dbUnmatched++; continue; }

        const stopDisplayName = (stop.display_name || stop.name_en || '').toLowerCase();

        // 1차: 정확 매칭 (name 또는 nameEn)
        let match = _foodIndex.find(r => {
          const dbName = (r.name || '').split('|')[0].trim();
          const dbNameEn = (r.nameEn || '').toLowerCase();
          return dbName === stopName || (stopDisplayName && dbNameEn === stopDisplayName);
        });

        // 2차: 부분 매칭 (DB 이름이 stop 이름에 포함되거나 그 반대)
        if (!match) {
          match = _foodIndex.find(r => {
            const dbName = (r.name || '').split('|')[0].trim();
            if (!dbName || dbName.length < 2) return false;
            return stopName.includes(dbName) || dbName.includes(stopName);
          });
        }

        if (match) {
          // DB 데이터로 교정 — 주소/좌표/URL을 실제 검증된 데이터로 덮어씌움
          const dbName = (match.name || '').split('|')[0].trim();
          if (match.address) {
            // _food_index 주소 정리: "대한민국 " 접두사, "KR " 제거, 역순 주소 무시
            let cleanAddr = match.address
              .replace(/^대한민국\s+/, '')
              .replace(/\bKR\s+/g, '');
            // DB 주소가 한국 도시로 시작하면 덮어쓰기, 아니면 Gemini 주소 유지
            if (/^(서울|부산|제주|인천|경기|강원|충청|전라|경상|울산|대구|대전|광주|세종)/.test(cleanAddr)) {
              stop.address = cleanAddr;
            }
            // else: keep Gemini's address (usually cleaner)
          }
          if (match.lat) { stop.lat = match.lat; stop._dbLat = match.lat; }
          if (match.lng) { stop.lng = match.lng; stop._dbLng = match.lng; }
          if (match.googleMapsUrl) stop.googleMapsUrl = match.googleMapsUrl;
          stop.verified = true;
          stop._dbMatchedName = dbName;
          dbMatched++;
        } else {
          stop.verified = false;
          dbUnmatched++;
        }
      }
      console.log(`[planner] DB Match: ${dbMatched} matched, ${dbUnmatched} unmatched out of ${dbMatched + dbUnmatched} food stops`);
    }

    console.log('[planner] Step 2: Running RouteAgent...');

    // ALREADY 또는 미정(null/빈값) → arrival_guide / departure_guide 제거
    if (!arrival_airport || arrival_airport === 'ALREADY') {
      delete itinerary.arrival_guide;
    }
    if (!departure_airport || departure_airport === 'ALREADY') {
      delete itinerary.departure_guide;
    }

    // ── RouteAgent: Naver Maps + ODsay + Dynamic Time Stitching (non-fatal) ──
    const routeStart = Date.now();
    console.log('[planner] Step 2: Running RouteAgent... ENV:', {
      NAVER_CLIENT_ID: process.env.NAVER_CLIENT_ID ? '✅' : '❌',
      NAVER_CLIENT_SECRET: process.env.NAVER_CLIENT_SECRET ? '✅' : '❌',
      ODSAY_API_KEY: process.env.ODSAY_API_KEY ? '✅' : '❌',
    });
    try {
      const routeAgent = new RouteAgent(apiKey);
      const wrapped = { itinerary: (itinerary.days || []).map(d => ({ ...d, places: d.stops || [] })), hotel_address: hotel_address || '' };
      console.log('[planner] RouteAgent input days:', wrapped.itinerary.length, '| stops/day:', wrapped.itinerary.map(d => (d.places || d.stops || []).length));
      const enriched = await routeAgent.call(JSON.stringify(wrapped));
      const enrichedData = JSON.parse(enriched.rawOutput);

      if (enrichedData.itinerary) {
        enrichedData.itinerary.forEach((enrichedDay, i) => {
          // RouteAgent modifies 'stops' (via dayPlan.stops || dayPlan.places)
          const enrichedStops = enrichedDay.stops || enrichedDay.places || [];
          if (itinerary.days[i] && enrichedStops.length > 0) {
            // Log ODsay/Naver enrichment results
            const odsayCount = enrichedStops.filter(p => p.transit_from_prev?.source === 'odsay').length;
            const geoCount = enrichedStops.filter(p => p.lat != null).length;
            console.log(`[planner] Day ${i + 1}: ${enrichedStops.length} stops, ${geoCount} geocoded, ${odsayCount} ODsay routes`);

            itinerary.days[i].stops = enrichedStops.map((p, j) => {
              const original = itinerary.days[i].stops[j] || {};
              return {
                ...original,                    // Gemini 원본 (tip_en, recommended_items 등)
                ...p,                            // RouteAgent 보강 (lat, lng, naverMapUrl)
                // RouteAgent가 계산한 start_time 우선 (Dynamic Time Stitching)
                start_time: p.start_time || original.start_time,
                // RouteAgent가 ODsay로 교체한 transit_from_prev 우선
                transit_from_prev: p.transit_from_prev ?? original.transit_from_prev,
                // travelFromPrev: RouteAgent가 생성 (ODsay + Naver 상세)
                travelFromPrev: p.travelFromPrev || null,
                // Gemini 원본 유지 필드
                entry_fee_krw: original.entry_fee_krw,
                reservation_required: original.reservation_required,
                reservation_note: original.reservation_note,
                recommended_items: original.recommended_items,
              };
            });
          }
        });
      } else {
        console.warn('[planner] RouteAgent returned no itinerary key. Keys:', Object.keys(enrichedData));
      }
      console.log('[planner] Route + Time Stitch:', Date.now() - routeStart, 'ms');
    } catch (routeErr) {
      console.error('[planner] Route FAILED:', routeErr.message, '| stack:', routeErr.stack?.split('\n').slice(0, 3).join(' | '), '|', Date.now() - routeStart, 'ms');
    }
    console.log('[planner] Step 3: Saving to Firestore...');

    // ── T-money 서버 계산 (ODsay 요금 우선, Gemini fallback) ────────────
    const totalTransitFare = (itinerary.days || [])
      .flatMap(d => d.stops || [])
      .reduce((sum, s) => {
        // ODsay 실제 요금이 있으면 우선 사용
        const odsayFare = s.travelFromPrev?.transitOptions?.publicTransit?.fare;
        const geminiFare = s.transit_from_prev?.est_fare_krw;
        return sum + (odsayFare || geminiFare || 0);
      }, 0);

    const arrivalTransitCost =
      itinerary.arrival_guide?.steps
        ?.find(s => s.transport_to_hotel)
        ?.transport_to_hotel?.arex_all_stop?.price_krw || 0;

    const departureTransitCost =
      itinerary.departure_guide?.to_airport?.cost_krw || 0;

    const rawTotal = totalTransitFare + arrivalTransitCost + departureTransitCost;
    itinerary.t_money_recommended_load = Math.ceil(rawTotal * 1.1 / 5000) * 5000;

    if (itinerary.arrival_guide?.steps) {
      const tmStep = itinerary.arrival_guide.steps.find(s => s.t_money_recommended_load_krw !== undefined);
      if (tmStep) tmStep.t_money_recommended_load_krw = itinerary.t_money_recommended_load;
    }

    // ── 가격 계산 ────────────────────────────────────────────────────────
    const priceKRW = calcPrice(vehicle, durationDays);
    const exchangeRate = Number(process.env.KRW_USD_RATE) || 1380;
    const priceUSD = Math.round(priceKRW / exchangeRate * 100) / 100;

    // ── Firestore 저장 (blocking — 반드시 성공해야 planUrl 전송) ──────────
    if (!adminDb) {
      throw new Error('Firebase not configured — cannot save plan');
    }

    const planId = randomUUID();
    const accessToken = uid ? null : randomUUID();

    await adminDb.collection('plans').doc(planId).set({
      planId,
      status: 'ready',
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      uid: uid || null,
      accessToken,
      guestEmail: email || null,
      input: {
        guestName, pax, styles, area, duration, startDate,
        adults: body.adults ?? pax,
        children: body.children ?? 0,
        vehicle, language, specialRequest,
        arrival_airport: arrival_airport || null,
        departure_airport: departure_airport || null,
        hotel_address: hotel_address || null,
        mobility: mobility || null,
      },
      itinerary,
      pricing: { vehicle, priceKRW, priceUSD },
      revisionCredits: 1,  // 무료 재생성 1회 (결제 시 포함)
      revisionCount: 0,    // 현재까지 재생성 횟수
    });

    if (uid) {
      await adminDb
        .collection('users').doc(uid)
        .collection('plans').doc(planId)
        .set({
          planId,
          createdAt: new Date().toISOString(),
          status: 'ready',
          tourTitle: itinerary.tour_title || `${guestName}'s Korea Itinerary`,
          startDate,
          area,
          pax,
        });
    }

    console.log('[ai-planner-full] Firestore saved:', planId);

    // ── API 사용량 카운터 (non-blocking) ────────────────────────────────
    if (adminDb) {
      const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const monthKey = `${kst.getFullYear()}-${String(kst.getMonth() + 1).padStart(2, '0')}`;
      const dayKey = `${monthKey}-${String(kst.getDate()).padStart(2, '0')}`;
      const inc = FieldValue.increment(1);
      const incRevenue = FieldValue.increment(priceUSD);
      // 월별
      adminDb.collection('api_stats').doc(monthKey).set(
        { fullCount: inc, fullRevenue: incRevenue, lastUpdated: new Date().toISOString() },
        { merge: true }
      ).catch(e => console.warn('[full] counter error:', e.message));
      // 일별
      adminDb.collection('api_stats').doc(monthKey)
        .collection('daily').doc(dayKey).set(
          { fullCount: inc, fullRevenue: incRevenue, lastUpdated: new Date().toISOString() },
          { merge: true }
        ).catch(e => console.warn('[full] daily counter error:', e.message));
    }

    // ── Loyalty 포인트 적립 (non-blocking — uid가 있는 로그인 사용자만) ────
    if (uid && adminDb) {
      (async () => {
        try {
          const userRef = adminDb.collection('users').doc(uid);
          const userSnap = await userRef.get();
          if (userSnap.exists) {
            const userData = userSnap.data() || {};
            const currentCoins = userData.tripCoins || 0;
            const newSpent = (userData.totalSpentUSD || 0) + priceUSD;
            const newCount = (userData.bookingCount || 0) + 1;

            // 등급 + 적립률 계산
            let earnRate = 0.01, tierName = 'Bronze';
            if (newSpent >= 1000 || newCount >= 15) { earnRate = 0.03; tierName = 'Platinum'; }
            else if (newSpent >= 500 || newCount >= 7) { earnRate = 0.02; tierName = 'Gold'; }
            else if (newSpent >= 200 || newCount >= 3) { earnRate = 0.015; tierName = 'Silver'; }

            const earnedCoins = Math.round(priceUSD * 100 * earnRate);
            const newBalance = currentCoins + earnedCoins;

            await userRef.update({
              tripCoins: newBalance,
              totalSpentUSD: newSpent,
              bookingCount: newCount,
              tier: tierName,
              tierUpdatedAt: new Date().toISOString(),
            });

            // 포인트 이력 기록
            await adminDb.collection('users').doc(uid).collection('pointHistory').doc().set({
              type: 'earn',
              amount: earnedCoins,
              balance: newBalance,
              description: `AI Plan: ${itinerary.tour_title || 'Korea Itinerary'} ($${priceUSD})`,
              bookingRef: planId,
              createdAt: Date.now(),
            });

            console.log(`[planner] Loyalty: +${earnedCoins} coins (${tierName} ${(earnRate * 100).toFixed(1)}%) → total ${newBalance}`);
          }
        } catch (e) { console.warn('[planner] Loyalty earn error:', e.message); }
      })();
    }

    // ── planUrl 구성 ─────────────────────────────────────────────────────
    const planUrl = accessToken
      ? `/my-plans/${planId}?token=${accessToken}`
      : `/my-plans/${planId}`;

    // ── JSON 응답 ────────────────────────────────────────────────────────
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      planId,
      planUrl,
      firestoreSaved: true,
      emailSent: !!email,
      itinerary,
      pricing: {
        vehicle,
        vehicleLabel: vehicle === 'staria_8' ? 'Staria Van (1-8 pax)' :
                      vehicle === 'sprinter' ? 'Sprinter (9-15 pax)' : 'Large Bus',
        priceKRW,
        priceUSD,
        currency: 'KRW',
      },
    }));

    console.log('[planner] === TOTAL:', Date.now() - handlerStart, 'ms ===');

    // ── 알림 이메일 (non-blocking — 응답 후 발송) ───────────────────────
    if (email) {
      sendNotificationEmail({
        email, guestName,
        tourTitle: itinerary.tour_title || `${guestName}'s Korea Itinerary`,
        planId, planUrl,
      }).catch(e => console.warn('[planner] Email error:', e.message));
    }

    // ── Google Sheets 리드 기록 (non-blocking) ──────────────────────────
    if (email) {
      (async () => {
        try {
          const { google } = await import('googleapis');
          const sheetClientEmail = (process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
          const sheetPrivateKey = (process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n').trim();
          const sheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();
          if (sheetClientEmail && sheetPrivateKey && sheetId) {
            const auth = new google.auth.JWT(sheetClientEmail, undefined, sheetPrivateKey, ['https://www.googleapis.com/auth/spreadsheets']);
            const sheets = google.sheets({ version: 'v4', auth });
            await sheets.spreadsheets.values.append({
              spreadsheetId: sheetId, range: 'Leads!A:G', valueInputOption: 'USER_ENTERED',
              requestBody: { values: [[new Date().toISOString(), email, guestName, area, styles.join(', '), pax, `Plan: ${planId}`]] },
            });
          }
        } catch (e) { console.warn('[planner] Sheets error:', e.message); }
      })();
    }

    // ── 텔레그램 생성 완료 알림 (non-blocking) ──────────────────────────
    (async () => {
      try {
        const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        await sendMessage(`🎯 <b>AI 플랜 생성 완료</b>\n\n고객: ${guestName || '미입력'}\n이메일: ${email || '-'}\n지역: ${area}\n일수: ${durationDays}일\n인원: ${pax}명\nPlan ID: <code>${planId}</code>\n\n⏰ ${kst}`);
      } catch (e) { console.warn('[planner] Telegram notify error:', e.message); }
    })();

  } catch (error) {
    console.error('[ai-planner-full] UNHANDLED ERROR:', error.message, error.stack);
    // 텔레그램 에러 알림
    sendErrorAlert('ai-planner-full', error).catch(() => {});
    if (!res.headersSent) {
      res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Planner failed', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
      }));
    }
  }
}
