/**
 * Vercel API Route: AI Planner Full
 * POST /api/ai-planner-full
 *
 * Lean Gemini prompt (토큰 92% 절감) → HTML 이메일 렌더링
 * 체크박스 UI의 구조화된 input을 받아 처리
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import nodemailer from 'nodemailer';
import { renderBookingEmail, renderBookingEmailText } from './_email-renderer.js';
import { getSpotContext } from './_spots_helper.js';
import { RouteAgent } from './_ai_core/agents/RouteAgent.js';

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Rich System Prompt (시간 + 이동 + 비용 포함) ──────────────────────────
const LEAN_SYSTEM_PROMPT = `You are CocoTrip AI, Korea's premium private tour planner for cocotripkr.com.
Create a REAL, actionable itinerary — not just a location list. Include times, transit directions, entry fees, and meal recommendations.

## OUTPUT FORMAT — STRICT JSON ONLY
No markdown. No code blocks. No extra text.

{
  "tour_title": "Personalized title (e.g. Sarah's K-Pop & Gangnam Food Adventure)",
  "vehicle": "staria_8 | sprinter | large_bus",
  "base_price_krw": 330000,
  "days": [
    {
      "day": 1,
      "date": "YYYY-MM-DD or empty string",
      "theme": "Day theme in English",
      "stops": [
        {
          "order": 1,
          "start_time": "09:30",
          "name_ko": "경복궁",
          "name_en": "Gyeongbokgung Palace",
          "category": "culture | food | shopping | nature | landmark | kpop",
          "address": "서울특별시 종로구 사직로 161",
          "stay_min": 90,
          "entry_fee_krw": 3000,
          "reservation_required": false,
          "reservation_note": "",
          "tip_en": "Rent hanbok at the east gate for free entry. Changing of the guard ceremony at 10:00 and 14:00.",
          "recommended_items": [
            { "name": "Hanbok rental", "price_krw": 20000, "note": "Includes free palace entry" }
          ],
          "transit_from_prev": null
        }
      ]
    }
  ]
}

## transit_from_prev FORMAT (null for stop #1)
"transit_from_prev": {
  "method": "subway",
  "instruction_en": "Line 3 (Orange) → Gyeongbokgung Stn, Exit 5. 3 min walk.",
  "est_min": 20,
  "est_fare_krw": 1500
}
- method: "subway" | "taxi" | "walk" | "bus" | "car"
- For subway: always include LINE NAME + EXIT NUMBER
- For walk: include street or landmark reference
- est_fare_krw: 0 for walk, ~1500 for subway, taxi ≈ (est_min × 200 + 4800)

## RULES
- stops: 5-7 per full day (09:00–20:30 coverage), 3-4 per half day
- start_time: realistic schedule — include 12:30 lunch break, 18:30 dinner slot
- stay_min: honest estimates (palace 90min, restaurant 60min, market 75min, museum 120min)
- entry_fee_krw: 0 if free, real KRW admission price otherwise
- recommended_items: 1-3 must-try items with REAL prices in KRW
  - Food: specific dish name + price (e.g. 삼계탕 ₩17,000)
  - Market: what to buy + budget range
  - Culture: specific exhibit, activity, or souvenir
- reservation_required: true for popular restaurants — always add reservation_note
- address: 도로명 주소 (Korean road address, required for map geocoding)
- tip_en: 1-2 sentences, practical first-timer advice

## MEAL PLANNING
- Include 1 dedicated lunch stop and 1 dinner stop per full day
- Use REAL restaurant names (not "a restaurant in Myeongdong")
- Specify 2-3 signature menu items with prices in KRW
- Mark reservation_required: true if recommended

## PRICING
staria_8 (1-8 pax): base 330000 KRW / 8hrs
sprinter (9-15 pax): base 450000 KRW / 8hrs
large_bus (16+ pax): base 650000 KRW / 8hrs`;

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    console.log('[ai-planner-full] Request:', JSON.stringify({
      email: body.email ? '***' : undefined,
      styles: body.styles,
      area: body.area,
      duration: body.duration,
      pax: body.pax,
      vehicle: body.vehicle,
    }));

    // ── 입력 파싱 (체크박스 구조화 입력 우선, 자유 텍스트 폴백) ─────────
    const guestName = body.guest_name || body.guestName || 'Guest';
    const paxRaw = Number(body.pax) || Number(body.guest_count) || 2;
    const pax = Math.max(1, Math.min(50, isFinite(paxRaw) ? paxRaw : 2));
    const styles = Array.isArray(body.styles) ? body.styles : body.preferences ? [body.preferences] : ['culture'];
    const area = body.area || body.destination || body.region || 'seoul_city';
    const duration = body.duration || 'full_day'; // half_day | full_day | multi_day
    const durationDays = body.durationDays || (duration === 'multi_day' ? 2 : 1);
    const startDate = body.date || body.startDate || '';
    const email = body.email || '';
    const specialRequest = body.special_request || body.message || '';
    const vehicleOverride = body.vehicle || 'auto';
    const vehicle = selectVehicle(pax, vehicleOverride);
    const language = body.language || 'en';

    // ── Gemini 호출 ──────────────────────────────────────────────────────
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    });

    // 구조화된 유저 메시지 (체크박스 input → ~150 tokens)
    const spotContext = getSpotContext(area, 4);
    const userMessage = JSON.stringify({
      guest_name: guestName,
      guest_count: pax,
      date: startDate,
      duration_days: durationDays,
      styles,
      area,
      duration,
      vehicle,
      special_request: specialRequest || undefined,
    }) + spotContext;

    const fullController = new AbortController();
    const fullTimer = setTimeout(() => fullController.abort(), 25000);
    let result;
    try {
      result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        systemInstruction: { role: 'system', parts: [{ text: LEAN_SYSTEM_PROMPT }] },
      });
    } finally {
      clearTimeout(fullTimer);
    }

    const rawText = result.response.text().trim();
    let itinerary;
    try {
      // JSON 파싱 (responseMimeType: application/json으로 클린 JSON 보장)
      itinerary = JSON.parse(rawText);
    } catch {
      // 폴백: 코드블록 제거 후 재시도
      const cleaned = rawText.replace(/^```(?:json)?|```$/gm, '').trim();
      try { itinerary = JSON.parse(cleaned); }
      catch { throw new Error('Gemini returned invalid JSON: ' + rawText.substring(0, 200)); }
    }

    // ── RouteAgent: Naver Maps 좌표 + 경로 보강 ──────────────────────────
    try {
      const routeAgent = new RouteAgent(apiKey);
      // RouteAgent expects itinerary.itinerary[] format — adapt
      const wrapped = { itinerary: (itinerary.days || []).map(d => ({ ...d, places: d.stops || [] })) };
      const enriched = await routeAgent.call(JSON.stringify(wrapped));
      const enrichedData = JSON.parse(enriched.rawOutput);
      // Map enriched places back onto itinerary.days[].stops
      if (enrichedData.itinerary) {
        enrichedData.itinerary.forEach((enrichedDay, i) => {
          if (itinerary.days[i] && enrichedDay.places) {
            itinerary.days[i].stops = enrichedDay.places.map((p, j) => ({
              ...(itinerary.days[i].stops[j] || {}),
              ...p,
              // Keep Gemini fields that RouteAgent doesn't overwrite
              start_time: (itinerary.days[i].stops[j] || {}).start_time,
              entry_fee_krw: (itinerary.days[i].stops[j] || {}).entry_fee_krw,
              reservation_required: (itinerary.days[i].stops[j] || {}).reservation_required,
              reservation_note: (itinerary.days[i].stops[j] || {}).reservation_note,
              recommended_items: (itinerary.days[i].stops[j] || {}).recommended_items,
              transit_from_prev: (itinerary.days[i].stops[j] || {}).transit_from_prev,
            }));
          }
        });
      }
      console.log('[ai-planner-full] RouteAgent enrichment complete');
    } catch (routeErr) {
      console.warn('[ai-planner-full] RouteAgent failed (non-fatal):', routeErr.message);
    }

    // ── 가격 계산 ────────────────────────────────────────────────────────
    const priceKRW = calcPrice(vehicle, durationDays);
    const exchangeRate = Number(process.env.KRW_USD_RATE) || 1380;
    const priceUSD = Math.round(priceKRW / exchangeRate * 100) / 100;

    // ── 이메일 발송 ──────────────────────────────────────────────────────
    if (email) {
      try {
        const gmailUser = (process.env.GMAIL_USER || '').trim();
        const gmailPass = (process.env.GMAIL_APP_PASSWORD || '').trim();

        if (gmailUser && gmailPass) {
          const htmlEmail = renderBookingEmail({
            guestName,
            orderID: body.orderID || '',
            tourTitle: itinerary.tour_title || `${guestName}'s Korea Private Tour`,
            tourDate: startDate,
            vehicle,
            pax,
            durationDays,
            amountUSD: priceUSD,
            amountKRW: priceKRW,
            days: itinerary.days || [],
            language,
            promoCode: process.env.PROMO_CODE || 'EARLY50',
          });

          const textEmail = renderBookingEmailText({
            guestName,
            tourTitle: itinerary.tour_title,
            tourDate: startDate,
            vehicle,
            pax,
            amountUSD: priceUSD,
            amountKRW: priceKRW,
            days: itinerary.days || [],
          });

          const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailUser, pass: gmailPass },
          });

          await transporter.sendMail({
            from: `"CocoTrip Private Tours" <${gmailUser}>`,
            to: email,
            subject: `✅ [CocoTrip] ${itinerary.tour_title || 'Your Korea Private Tour Plan'} — ${startDate || 'Confirmed'}`,
            html: htmlEmail,
            text: textEmail,
          });

          console.log('[ai-planner-full] Email sent to:', email);
        }
      } catch (emailErr) {
        console.error('[ai-planner-full] Email failed:', emailErr.message);
        // 이메일 실패해도 응답은 성공 처리
      }

      // Google Sheets 리드 기록
      try {
        const { google } = await import('googleapis');
        const clientEmail = (process.env.GOOGLE_CLIENT_EMAIL || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
        const privateKey = (process.env.GOOGLE_PRIVATE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n').trim();
        const sheetId = (process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();

        if (clientEmail && privateKey && sheetId) {
          const auth = new google.auth.JWT(clientEmail, undefined, privateKey, ['https://www.googleapis.com/auth/spreadsheets']);
          const sheets = google.sheets({ version: 'v4', auth });
          await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: 'Leads!A:G',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[
                new Date().toISOString(),
                email,
                guestName,
                area,
                styles.join(', '),
                pax,
                'Planner Lead',
              ]],
            },
          });
        }
      } catch (sheetErr) {
        console.error('[ai-planner-full] Sheets failed:', sheetErr.message);
      }
    }

    // ── 응답 ─────────────────────────────────────────────────────────────
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
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

  } catch (error) {
    console.error('[ai-planner-full] Error:', error.message);
    res.writeHead(500, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Planner failed', details: error.message }));
  }
}
