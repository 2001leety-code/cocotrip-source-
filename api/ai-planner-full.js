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
import { RouteAgent } from './_ai_core/agents/RouteAgent.js';
import { randomUUID } from 'crypto';
import { Buffer } from 'buffer';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
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

// ── Rich System Prompt ──────────────────────────────────────────────────
const LANG_INSTRUCTION = {
  en: 'Write ALL text fields in English.',
  ko: '모든 텍스트 필드를 한국어로 작성하세요.',
  ja: 'すべてのテキストフィールドを日本語で記述してください。',
  zh: '请用中文填写所有文本字段。',
};

function buildSystemPrompt(language = 'en') {
  const langNote = LANG_INSTRUCTION[language] || LANG_INSTRUCTION.en;
  return `You are CocoTrip AI, Korea's #1 private tour planner (cocotripkr.com).
Create a REAL, actionable itinerary with precise times, transit directions, entry fees, meal recommendations, and budget breakdowns.

## LANGUAGE — IMPORTANT
${langNote} The output language must match the user's language setting.

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
          "name_ko": "경복궁",
          "name_en": "Gyeongbokgung Palace",
          "category": "culture",
          "address": "서울특별시 종로구 사직로 161",
          "address_en": "161, Sajik-ro, Jongno-gu, Seoul",
          "stay_min": 90,
          "entry_fee_krw": 3000,
          "entry_fee_note": "Free with hanbok",
          "reservation_required": false,
          "reservation_note": "",
          "reservation_url": "",
          "reservation_phone": "",
          "accessibility_note": "",
          "tip_en": "Practical first-timer tip (1-2 sentences)",
          "recommended_items": [
            {"name": "Hanbok rental", "price_krw": 20000, "note": "Includes free palace entry"}
          ],
          "transit_from_prev": null
        },
        {
          "order": 2,
          "start_time": "12:00",
          "name_ko": "토속촌",
          "name_en": "Tosokchon Samgyetang",
          "category": "food",
          "address": "서울특별시 종로구 자하문로5길 5",
          "address_en": "5, Jahamun-ro 5-gil, Jongno-gu, Seoul",
          "stay_min": 60,
          "entry_fee_krw": 0,
          "entry_fee_note": "",
          "reservation_required": true,
          "reservation_note": "Popular — arrive by 11:30 or wait 30+ min",
          "reservation_url": "",
          "reservation_phone": "02-737-7444",
          "accessibility_note": "",
          "tip_en": "Order the original samgyetang (₩17,000). Cash preferred.",
          "recommended_items": [
            {"name": "삼계탕 Samgyetang", "price_krw": 17000, "note": "Signature dish"},
            {"name": "파전 Pajeon", "price_krw": 15000, "note": "To share"},
            {"name": "동동주 Dongdongju", "price_krw": 10000, "note": "Traditional rice wine"}
          ],
          "transit_from_prev": {
            "method": "walk",
            "instruction_en": "Walk 10 min through Gyeongbokgung west gate → left on Jahamun-ro",
            "step_by_step": ["Exit palace via west gate (Yeongchumun)", "Turn left on Jahamun-ro", "Walk 600m, restaurant on right"],
            "est_min": 10,
            "est_fare_krw": 0
          }
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

## RULES
- stops: 5-7 per full day (09:00-20:30), 3-4 per half day
- start_time: realistic — include 12:00-13:30 lunch, 18:30-20:00 dinner
- stay_min: honest (palace 90, restaurant 60, market 75, museum 120)
- entry_fee_krw: 0 if free, real KRW otherwise
- transit_from_prev: null for first stop of each day
  - method: "subway"|"taxi"|"walk"|"bus"|"car"
  - For subway: LINE NAME + color + EXIT NUMBER always
  - step_by_step: array of physical actions for subway transfers
  - est_fare_krw: 0=walk, ~1500=subway, taxi=(est_min×200+4800)
- recommended_items: 2-4 items with REAL KRW prices
  - Food: specific dish name + price (e.g. 삼계탕 ₩17,000)
  - Market: what to buy + budget
- address: Korean road address (도로명 주소) — required for geocoding
- address_en: English romanized road address — for foreign tourists (e.g. "161, Sajik-ro, Jongno-gu, Seoul")
- tip_en: 1-2 sentences, practical advice
- arrival_guide: SKIP if arrival_airport is "already_in_korea"
- t_money_recommended_load_krw: always 0 (server calculates)
- daily_budget_summary: sum all est_fare_krw as transport, sum entry fees, sum meal items
- accessibility_note: required when mobility is "limited"

## DIVERSITY — CRITICAL
- NEVER repeat the same itinerary twice. Each plan must feel unique.
- Rotate restaurants: use different real restaurants each time, not always the same famous ones.
- Mix well-known landmarks with hidden gems, local favorites, and off-the-beaten-path spots.
- Vary the route order: don't always start from the same area.
- Include at least 1-2 lesser-known but highly-rated places per day.
- For food: rotate between different cuisine types (Korean BBQ, seafood, street food, traditional, fusion, cafe).

## ROUTE OPTIMIZATION — CRITICAL
- Group stops by geographic zone. NEVER zigzag across the city.
  - Seoul zones: Jongno/Gwanghwamun → Yongsan/Itaewon → Gangnam/COEX → Hongdae/Mapo → Myeongdong/Jung-gu → Seongsu/Gwangjin
  - Plan each half-day within 1-2 adjacent zones maximum.
  - BAD: Hongdae → Gangnam → Yongsan (zigzag across city)
  - GOOD: Hongdae → Yeonnam-dong → Mapo (same zone, walkable)
- If the user specifies must-visit places in special_request, BUILD the route AROUND those places.
  - Place them first, then fill gaps with nearby attractions.
  - Example: user wants "HYBE" (Yongsan) → plan Yongsan/Itaewon zone that day.
- Transit between consecutive stops should be under 30 minutes.
- First stop of Day 1 should be near the hotel or arrival point.

## MEAL PLANNING — STRICT RULES (NEVER VIOLATE)
- 1 dedicated lunch + 1 dinner per full day
- REAL restaurant names (not generic)
- 3-5 signature menu items with KRW prices
- reservation_required + phone for popular spots

If diet_preferences includes "Halal":
- ONLY recommend halal-certified restaurants
- Verify the restaurant is in Korea Tourism Organization's halal restaurant list
- NEVER recommend pork or non-halal meat dishes
- Common Seoul halal restaurants: Eid (Itaewon), Murree (Itaewon), Yang Good (Itaewon)

If diet_preferences includes "Vegan":
- ONLY recommend 100% plant-based restaurants
- Vegetarian-friendly Korean dishes: Bibimbap (no egg/meat), Kongguksu, Doenjang-jjigae (no fish stock)
- NEVER recommend dishes with fish sauce or anchovy stock

If food_allergies includes [allergen]:
- Treat as a SAFETY-CRITICAL constraint
- NEVER recommend any dish containing the allergen
- Add a warning note in tip_en: "⚠️ Inform restaurant of [allergen] allergy"

If meal_budget is "Budget":
- Prioritize street food, market stalls, and local diners (₩5,000-12,000 per meal)
- Examples: Gwangjang Market, Tongin Market, school cafeterias

If meal_budget is "Premium":
- Recommend Michelin-listed or high-end restaurants (₩50,000+ per meal)
- Reservation usually required — set reservation_required: true

## VEHICLE PRICING
- staria_8 (1-8 pax): ₩330,000/8hrs
- sprinter (9-15 pax): ₩450,000/8hrs
- large_bus (16+): ₩650,000/8hrs`;
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

    // ── PayPal 결제 검증 ───────────────────────────────────────────────────
    const paypalOrderId = body.paypalOrderId;
    const requestEmail = (body.email || '').toLowerCase().trim();

    if (!paypalOrderId) {
      res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Payment required', details: 'PayPal order ID is missing. Please complete payment first.' }));
    }

    // 테스트 계정은 샌드박스 API로, 일반 계정은 라이브 API로 검증
    const TEST_ACCOUNTS = ['2001leety@gmail.com'];
    const isTestAccount = TEST_ACCOUNTS.includes(requestEmail);

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

    console.log('[planner] ✅ Payment verification passed:', paypalOrderId);

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
    }) + spotContext + `\n\n[VARIATION SEED: ${Math.floor(Math.random() * 1000)}] Create a UNIQUE itinerary — pick different restaurants and routes than usual.`;

    // ── Gemini 호출 + 45초 타임아웃 (Promise.race) ───────────────────────
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
    try {
      const routeAgent = new RouteAgent(apiKey);
      const wrapped = { itinerary: (itinerary.days || []).map(d => ({ ...d, places: d.stops || [] })) };
      const enriched = await routeAgent.call(JSON.stringify(wrapped));
      const enrichedData = JSON.parse(enriched.rawOutput);
      if (enrichedData.itinerary) {
        enrichedData.itinerary.forEach((enrichedDay, i) => {
          if (itinerary.days[i] && enrichedDay.places) {
            itinerary.days[i].stops = enrichedDay.places.map((p, j) => {
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
      }
      console.log('[planner] Route + Time Stitch:', Date.now() - routeStart, 'ms');
    } catch (routeErr) {
      console.warn('[planner] Route failed (non-fatal):', routeErr.message, '|', Date.now() - routeStart, 'ms');
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
