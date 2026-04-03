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

export const maxDuration = 60;
export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Lean System Prompt (캐시 대상) ────────────────────────────────────────
const LEAN_SYSTEM_PROMPT = `You are CocoTrip AI, a Korea private tour planner for cocotripkr.com.
Create itineraries for foreign tourists. Be specific with real, well-known places.

## OUTPUT FORMAT — STRICT JSON ONLY
Respond ONLY with valid JSON. No markdown, no extra text, no code blocks.

{
  "tour_title": "Personalized title in English (e.g. Sarah's K-Pop & Gangnam Food Adventure)",
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
          "name_ko": "장소명",
          "name_en": "Place Name in English",
          "category": "culture | food | shopping | nature | landmark | kpop",
          "address": "도로명 주소 (Korean address)",
          "stay_min": 90,
          "tip_en": "1-2 sentence practical tip for first-time visitors"
        }
      ]
    }
  ]
}

## RULES
- Max stops: 4-5 per full day, 2-3 per half day
- stay_min: realistic (museum 90min, restaurant 60min, shopping 90min)
- tip_en: practical info, what to see/do, recommended items to buy/eat
- All tips in ENGLISH regardless of customer language
- Use only real, well-known places in Korea
- Do NOT include: lat, lng, URLs, naverMapUrl, travelFromPrev, transitOptions

## PRICING
staria_8 (1-8 pax): base 330000 KRW / 8hrs
sprinter (9-15 pax): base 450000 KRW / 8hrs  
large_bus (16+ pax): contact for quote`;

// ── 차량 타입 결정 ─────────────────────────────────────────────────────────
function selectVehicle(pax, requestedVehicle) {
  if (requestedVehicle && requestedVehicle !== 'auto') return requestedVehicle;
  if (pax <= 8) return 'staria_8';
  if (pax <= 15) return 'sprinter';
  return 'large_bus';
}

// ── 가격 계산 ───────────────────────────────────────────────────────────────
function calcPrice(vehicle, durationDays) {
  const basePrices = { staria_8: 330000, sprinter: 450000, large_bus: 0 };
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
    const pax = Number(body.pax) || Number(body.guest_count) || 2;
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
    const apiKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.75,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    });

    // 구조화된 유저 메시지 (체크박스 input → ~150 tokens)
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
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: { role: 'system', parts: [{ text: LEAN_SYSTEM_PROMPT }] },
    });

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

    // ── 가격 계산 ────────────────────────────────────────────────────────
    const priceKRW = calcPrice(vehicle, durationDays);
    const exchangeRate = 1380;
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
            promoCode: 'EARLY50',
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
