/**
 * Vercel API Route: AI Planner Full v2
 * POST /api/ai-planner-full
 *
 * Gemini 2.5 Flash → RouteAgent → T-money 계산 → Firestore 저장 (blocking)
 * → planId + planUrl 응답 → 알림 이메일 (non-blocking)
 *
 * Refactored: logic extracted to api/_ai_core/ modules.
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSpotContext } from './_spots_helper.js';
import { getFoodContext } from './_food_helper.js';
import { RouteAgent } from './_ai_core/agents/RouteAgent.js';
import { Buffer } from 'buffer';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, FieldValue } from 'firebase-admin/firestore';
import { sendMessage, sendErrorAlert } from './_telegram.js';

// ── Extracted modules ─────────────────────────────────────────────────────
import { CORS, AIRPORT_ADDRESSES } from './_ai_core/constants.js';
import { buildSystemPrompt, logPromptMetrics } from './_ai_core/buildPrompt.js';
import { validateResponse, repairAndParseJSON, cleanAddresses } from './_ai_core/responseValidator.js';
import { applyDBMatcher } from './_ai_core/dbMatcher.js';
import { calculateTmoney, persistPlan } from './_ai_core/planPersister.js';
import { sendNotificationEmail, recordLeadToSheets } from './_ai_core/emailNotifier.js';

export const maxDuration = 300;
export const config = { runtime: 'nodejs' };

// ── firebase-admin 초기화 ─────────────────────────────────────────────────
let adminDb = null;
try {
  const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();

  let rawKey = (process.env.FIREBASE_PRIVATE_KEY || '')
    .replace(/^\uFEFF/, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n')
    .trim();

  let privateKey = '';
  const pemMatch = rawKey.match(/-----BEGIN[^-]*-----([^-]+)-----END[^-]*-----/s);
  if (pemMatch) {
    const base64Clean = pemMatch[1].replace(/\s+/g, '');
    const lines = base64Clean.match(/.{1,64}/g) || [];
    privateKey = '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
  } else {
    privateKey = rawKey;
  }

  console.log('[ai-planner-full] Key:', { projectId: projectId ? 'ok' : 'MISSING', clientEmail: clientEmail ? 'ok' : 'MISSING', keyLen: privateKey.length, pem: !!pemMatch });

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
    const revisionOf = body.revisionOf;
    const revisionToken = body.revisionToken;
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
      const uid = body.uid || null;
      const isOwner = uid && origData.uid === uid;
      const hasToken = origData.accessToken && origData.accessToken === revisionToken;
      if (!isOwner && !hasToken && origData.uid) {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized revision' }));
      }
      const credits = origData.revisionCredits ?? 0;
      if (credits <= 0) {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'No revision credits remaining', details: 'You have already used your free revision.' }));
      }
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

    const TEST_ACCOUNTS = ['2001leety@gmail.com'];
    const isTestAccount = TEST_ACCOUNTS.includes(requestEmail);

    if (!isRevision && paypalOrderId) {
      const isTestOrderId = paypalOrderId.startsWith('TEST-');
      if (isTestOrderId && isTestAccount) {
        console.log('[planner] ✅ TEST MODE bypass — skipping PayPal verification for:', requestEmail);
      } else if (isTestOrderId && !isTestAccount) {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized test mode', details: 'Test mode is only available for authorized accounts.' }));
      } else {
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

    const arrival_airport = body.arrival_airport || '';
    const departure_airport = body.departure_airport || arrival_airport || '';
    const hotel_address = body.hotel_address || '';
    const mobility = body.mobility || 'ok';
    const uid = body.uid || null;

    const dietPrefs = Array.isArray(body.dietPrefs) ? body.dietPrefs : [];
    const allergies = Array.isArray(body.allergies) ? body.allergies : [];
    const priceRange = body.priceRange || 'Any';
    const wantAccom = !!body.wantAccom;
    const accomBudget = body.accomBudget || 'moderate';

    const arrivalAddress = AIRPORT_ADDRESSES[arrival_airport] || '';
    const departureAddress = AIRPORT_ADDRESSES[departure_airport] || AIRPORT_ADDRESSES[arrival_airport] || '';

    console.log('[ai-planner-full] Request:', JSON.stringify({ styles, area, duration, pax, vehicle, arrival_airport, mobility }));
    console.log('[ai-planner-full] ENV:', { gemini: !!process.env.GEMINI_API_KEY, firebase: !!adminDb, gmail: !!process.env.GMAIL_USER });

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
      spotContext = getSpotContext(area, 6) || '';
    } catch (spotErr) {
      console.warn('[ai-planner-full] getSpotContext failed:', spotErr.message);
    }

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
      want_accommodation: wantAccom || undefined,
      accommodation_budget: wantAccom ? accomBudget : undefined,
    }) + spotContext + foodContext + (wantAccom ? `

[ACCOMMODATION REQUEST]
The user wants hotel recommendations. Budget level: ${accomBudget}.
Add an "accommodation" object to the JSON with:
- "name": hotel name
- "area": neighborhood
- "price_range": estimated nightly rate in KRW
- "why": 1-sentence reason this hotel fits the itinerary
- "booking_tip": practical booking advice
Pick a REAL hotel that exists near the main activity zone.` : '') + (() => {
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

    // ── 프롬프트 계측 ───────────────────────────────────────────────────────
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
      systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
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

    // ── JSON 파싱 + 복구 ──────────────────────────────────────────────────
    const itinerary = repairAndParseJSON(rawText);
    console.log('[ai-planner-full] Parsed OK, days:', (itinerary.days || []).length);

    // ── 주소 정리 ─────────────────────────────────────────────────────────
    cleanAddresses(itinerary);

    // ── 응답 품질 검증 ────────────────────────────────────────────────────
    let _foodIndex = [];
    try { _foodIndex = JSON.parse((await import('fs')).readFileSync(new URL('./_food_index.json', import.meta.url), 'utf-8')); } catch { /* ok */ }
    validateResponse(itinerary, { lang: language }, _foodIndex);

    // ── DB 매칭 ───────────────────────────────────────────────────────────
    applyDBMatcher(itinerary, _foodIndex);

    console.log('[planner] Step 2: Running RouteAgent...');

    // ALREADY 또는 미정 → arrival_guide / departure_guide 제거
    if (!arrival_airport || arrival_airport === 'ALREADY') {
      delete itinerary.arrival_guide;
    }
    if (!departure_airport || departure_airport === 'ALREADY') {
      delete itinerary.departure_guide;
    }

    // ── RouteAgent ────────────────────────────────────────────────────────
    const routeStart = Date.now();
    console.log('[planner] Step 2: RouteAgent...', { NAVER: !!process.env.NAVER_CLIENT_ID, ODSAY: !!process.env.ODSAY_API_KEY });
    try {
      const routeAgent = new RouteAgent(apiKey);
      const wrapped = { itinerary: (itinerary.days || []).map(d => ({ ...d, places: d.stops || [] })), hotel_address: hotel_address || '' };
      console.log('[planner] RouteAgent input days:', wrapped.itinerary.length, '| stops/day:', wrapped.itinerary.map(d => (d.places || d.stops || []).length));
      const enriched = await routeAgent.call(JSON.stringify(wrapped));
      const enrichedData = JSON.parse(enriched.rawOutput);

      if (enrichedData.itinerary) {
        enrichedData.itinerary.forEach((enrichedDay, i) => {
          const enrichedStops = enrichedDay.stops || enrichedDay.places || [];
          if (itinerary.days[i] && enrichedStops.length > 0) {
            const odsayCount = enrichedStops.filter(p => p.transit_from_prev?.source === 'odsay').length;
            const geoCount = enrichedStops.filter(p => p.lat != null).length;
            console.log(`[planner] Day ${i + 1}: ${enrichedStops.length} stops, ${geoCount} geocoded, ${odsayCount} ODsay routes`);

            itinerary.days[i].stops = enrichedStops.map((p, j) => {
              const original = itinerary.days[i].stops[j] || {};
              return {
                ...original,
                ...p,
                start_time: p.start_time || original.start_time,
                transit_from_prev: p.transit_from_prev ?? original.transit_from_prev,
                travelFromPrev: p.travelFromPrev || null,
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

    // ── T-money 서버 계산 ─────────────────────────────────────────────────
    calculateTmoney(itinerary);

    // ── 가격 계산 ────────────────────────────────────────────────────────
    const priceKRW = calcPrice(vehicle, durationDays);
    const exchangeRate = Number(process.env.KRW_USD_RATE) || 1380;
    const priceUSD = Math.round(priceKRW / exchangeRate * 100) / 100;

    // ── Firestore 저장 + Loyalty ──────────────────────────────────────────
    const { planId, planUrl } = await persistPlan(adminDb, {
      body, itinerary, uid, vehicle, priceKRW, priceUSD,
      guestName, pax, styles, area, duration, startDate, email,
      specialRequest, arrival_airport, departure_airport,
      hotel_address, mobility, language,
    });

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

    // ── 알림 이메일 (non-blocking) ───────────────────────────────────────
    if (email) {
      sendNotificationEmail({
        email, guestName,
        tourTitle: itinerary.tour_title || `${guestName}'s Korea Itinerary`,
        planId, planUrl,
      }).catch(e => console.warn('[planner] Email error:', e.message));
    }

    // ── Google Sheets 리드 기록 (non-blocking) ──────────────────────────
    if (email) {
      recordLeadToSheets({ email, guestName, area, styles, pax, planId })
        .catch(e => console.warn('[planner] Sheets error:', e.message));
    }

    // ── 텔레그램 알림 (non-blocking) ──────────────────────────────────
    (async () => {
      try {
        const kst = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        await sendMessage(`🎯 <b>AI 플랜 생성 완료</b>\n\n고객: ${guestName || '미입력'}\n이메일: ${email || '-'}\n지역: ${area}\n일수: ${durationDays}일\n인원: ${pax}명\nPlan ID: <code>${planId}</code>\n\n⏰ ${kst}`);
      } catch (e) { console.warn('[planner] Telegram notify error:', e.message); }
    })();

  } catch (error) {
    console.error('[ai-planner-full] UNHANDLED ERROR:', error.message, error.stack);
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
