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
import { getFoodContext, buildFoodPrefSnippet } from './_food_helper.js';
import { RouteAgent } from './_ai_core/agents/RouteAgent.js';
import { sendErrorAlert } from './_telegram.js';

// ── Extracted modules ─────────────────────────────────────────────────────
import { CORS, AIRPORT_ADDRESSES } from './_ai_core/constants.js';
import { buildSystemPrompt, logPromptMetrics } from './_ai_core/buildPrompt.js';
import { validateResponse, repairAndParseJSON, cleanAddresses } from './_ai_core/responseValidator.js';
import { applyDBMatcher } from './_ai_core/dbMatcher.js';
import { calculateTmoney, persistPlan } from './_ai_core/planPersister.js';
import { sendNotificationEmail, recordLeadToSheets } from './_ai_core/emailNotifier.js';
import { pass1Intent, pass2Resolve, pass3Enrich } from './_ai_core/threePassPipeline.js';
import { initAdminDb } from './_ai_core/firestoreAdmin.js';
import { enforcePaymentAndRevision } from './_ai_core/paymentGate.js';

// Feature flag: 'legacy' (default) or '3pass'
const PLANNER_MODE = (process.env.PLANNER_MODE || 'legacy').trim();

export const maxDuration = 300;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──────────────────────────────────────────────────────────
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR', extra) => ({ ok: false, error: msg, code, ...extra });

const adminDb = initAdminDb();

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
    return res.end(JSON.stringify(_err('Method Not Allowed', 'METHOD_NOT_ALLOWED')));
  }

  const handlerStart = Date.now();
  console.log('[planner] === START ===');

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    // ── 결제 + 재생성 게이트 ────────────────────────────────────────────────
    const gate = await enforcePaymentAndRevision(body, adminDb);
    if (gate.rejection) {
      const { statusCode, code, message, details } = gate.rejection;
      res.writeHead(statusCode, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(_err(message, code, details ? { details } : undefined)));
    }
    const requestEmail = (body.email || '').toLowerCase().trim();

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
        temperature: 0.7, thinkingConfig: { thinkingBudget: 8000 }, // 0.95→0.7 + Flash thinking for instruction following + multi-step reasoning
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
      meal_budget: priceRange !== 'Any' ? priceRange : undefined, ...buildFoodPrefSnippet(body),
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

    // ── AVOID 리스트: 최근 플랜의 식당 중복 방지 ────────────────────────────
    let avoidClause = '';
    if (adminDb && (uid || requestEmail)) {
      try {
        // 같은 사용자/이메일의 최근 3개 플랜에서 사용된 식당 이름 추출
        let recentQuery = adminDb.collection('plans')
          .orderBy('createdAt', 'desc')
          .limit(3);
        if (uid) {
          recentQuery = recentQuery.where('uid', '==', uid);
        } else {
          recentQuery = recentQuery.where('email', '==', requestEmail);
        }
        const recentSnap = await recentQuery.get();
        const usedNames = new Set();
        recentSnap.forEach(doc => {
          const plan = doc.data();
          const days = plan.itinerary?.days || [];
          for (const day of days) {
            for (const stop of (day.stops || [])) {
              if (stop.category === 'food' && stop.name) {
                usedNames.add(stop.name);
              }
            }
          }
        });
        if (usedNames.size > 0) {
          const names = [...usedNames].slice(0, 20).join(', ');
          avoidClause = `\n\n[AVOID LIST — DO NOT USE THESE RESTAURANTS]\nThe user has already received plans with these restaurants. Pick DIFFERENT ones:\n${names}`;
          console.log(`[planner] AVOID list: ${usedNames.size} restaurants from ${recentSnap.size} recent plans`);
        }
      } catch (avoidErr) {
        // Non-critical: if AVOID query fails, just proceed without it
        console.warn('[planner] AVOID list query failed:', avoidErr.message);
      }
    }

    // ── 프롬프트 계측 ───────────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(language);
    // AVOID 리스트가 있으면 userMessage에 추가
    const finalUserMessage = userMessage + avoidClause;
    logPromptMetrics(systemPrompt + finalUserMessage, {
      city: area,
      days: durationDays,
      diet: dietPrefs.join(',') || 'none',
      lang: language,
      injectedRestaurants: (foodContext.match(/•/g) || []).length,
    });

    // ── Gemini 호출 + 240초 타임아웃 (Promise.race) ───────────────────────
    const GEMINI_TIMEOUT_MS = 240000;
    const geminiStart = Date.now();

    // ── 공통: food DB 로딩 ─────────────────────────────────────────────────
    let _foodIndex = [];
    try { _foodIndex = JSON.parse((await import('fs')).readFileSync(new URL('./_food_index.json', import.meta.url), 'utf-8')); } catch { /* ok */ }

    let itinerary;

    if (PLANNER_MODE === '3pass') {
      // ══════════════════════════════════════════════════════════════════════
      // 3-PASS PIPELINE
      // ══════════════════════════════════════════════════════════════════════
      console.log('[planner] 🔀 3-pass mode activated');

      // Pass 1: Intent generation (Gemini → food slots as intents)
      console.log('[planner] Pass 1/3: Intent generation...');
      const pass1Promise = pass1Intent(model, systemPrompt, finalUserMessage);
      const timeoutPromise1 = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Gemini API timeout (pass1)')), GEMINI_TIMEOUT_MS);
      });
      let rawText;
      try {
        rawText = await Promise.race([pass1Promise, timeoutPromise1]);
      } catch (err) {
        console.error('[planner] Pass 1 timeout:', err.message);
        throw new Error('AI is taking too long. Please try again.');
      }
      console.log('[planner] Pass 1 done:', Date.now() - geminiStart, 'ms');

      itinerary = repairAndParseJSON(rawText);
      cleanAddresses(itinerary);

      // Pass 2: Resolve food intents from DB
      console.log('[planner] Pass 2/3: DB resolution...');
      const pass2Start = Date.now();
      itinerary = pass2Resolve(itinerary, _foodIndex, area);
      console.log('[planner] Pass 2 done:', Date.now() - pass2Start, 'ms');

      // Pass 3: Narrative enrichment (Gemini → tips for resolved restaurants)
      console.log('[planner] Pass 3/3: Narrative enrichment...');
      const pass3Start = Date.now();
      itinerary = await pass3Enrich(model, itinerary, language);
      console.log('[planner] Pass 3 done:', Date.now() - pass3Start, 'ms');

      // Validate + legacy DB matcher as fallback for any remaining unresolved
      validateResponse(itinerary, { lang: language }, _foodIndex);
      applyDBMatcher(itinerary, _foodIndex, area, language);

      console.log('[planner] 3-pass total:', Date.now() - geminiStart, 'ms');

    } else {
      // ══════════════════════════════════════════════════════════════════════
      // LEGACY PIPELINE (default)
      // ══════════════════════════════════════════════════════════════════════
      const geminiPromise = model.generateContent({
        contents: [{ role: 'user', parts: [{ text: finalUserMessage }] }],
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
        // Quota 감지 → 즉시 telegram + 503 (사용자도 막힘, 외부 catch보다 빨리)
        const em = String(err.message || err.code || '');
        if (em.includes('RESOURCE_EXHAUSTED') || em.includes('429') || /quota/i.test(em)) {
          sendErrorAlert('🚨 GEMINI QUOTA EXCEEDED', err).catch(() => {});
          const e = new Error('AI service at capacity. Try again shortly.'); e.code = 'GEMINI_QUOTA'; e.statusCode = 503; throw e;
        }
        if (err.message.includes('timeout')) {
          const timeoutErr = new Error('AI is taking too long. Please try again.');
          timeoutErr.code = 'GEMINI_TIMEOUT';
          timeoutErr.statusCode = 504;
          throw timeoutErr;
        }
        if (!err.code) err.code = 'GEMINI_ERROR';
        throw err;
      }
      console.log('[planner] Gemini:', Date.now() - geminiStart, 'ms');

      const rawText = result.response.text().trim();
      console.log('[ai-planner-full] Gemini raw (first 200):', rawText.substring(0, 200));
      console.log('[ai-planner-full] Gemini raw length:', rawText.length);

      // ── JSON 파싱 + 복구 ──────────────────────────────────────────────────
      itinerary = repairAndParseJSON(rawText);
      console.log('[ai-planner-full] Parsed OK, days:', (itinerary.days || []).length);

      // ── 주소 정리 ─────────────────────────────────────────────────────────
      cleanAddresses(itinerary);

      // ── 응답 품질 검증 ────────────────────────────────────────────────────
      validateResponse(itinerary, { lang: language }, _foodIndex);

      // ── DB 매칭 ───────────────────────────────────────────────────────────
      applyDBMatcher(itinerary, _foodIndex, area, language);
    }

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
      // Wrapped as an ITINERARY OBJECT (not just days array) so RouteAgent can
      // also enrich arrival_guide.route_to_hotel + departure_guide.route_to_airport
      // using the ODsay airport↔hotel routing added in this release.
      const wrapped = {
        itinerary: {
          days: (itinerary.days || []).map(d => ({ ...d, places: d.stops || [] })),
          arrival_guide: itinerary.arrival_guide,
          departure_guide: itinerary.departure_guide,
        },
        hotel_address: hotel_address || '',
        arrival_airport,
        departure_airport,
        // Wizard inputs used for smart airport-transport recommendation
        // (late-night arrival → limousine, heavy luggage → taxi, etc.)
        arrival_time: body.arrival_time || '',
        luggage: body.luggage || null,
        pax,
      };
      console.log('[planner] RouteAgent input days:', wrapped.itinerary.days.length, '| stops/day:', wrapped.itinerary.days.map(d => (d.places || d.stops || []).length));
      const enriched = await routeAgent.call(JSON.stringify(wrapped));
      const enrichedData = JSON.parse(enriched.rawOutput);

      // enrichedData.itinerary may be array (legacy) or object (new wrapped form).
      const enrichedItin = enrichedData.itinerary;
      const enrichedDays = Array.isArray(enrichedItin) ? enrichedItin : (enrichedItin?.days || []);

      if (enrichedDays.length > 0) {
        enrichedDays.forEach((enrichedDay, i) => {
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
        console.warn('[planner] RouteAgent returned no itinerary days. Keys:', Object.keys(enrichedData));
      }

      // Merge RouteAgent's airport↔hotel route enrichment back onto the plan.
      if (enrichedItin && !Array.isArray(enrichedItin)) {
        if (enrichedItin.arrival_guide?.route_to_hotel && itinerary.arrival_guide) {
          itinerary.arrival_guide.route_to_hotel = enrichedItin.arrival_guide.route_to_hotel;
          console.log('[planner] Airport→Hotel route attached:', itinerary.arrival_guide.route_to_hotel.est_min, 'min');
        }
        if (enrichedItin.departure_guide?.route_to_airport && itinerary.departure_guide) {
          itinerary.departure_guide.route_to_airport = enrichedItin.departure_guide.route_to_airport;
          console.log('[planner] Hotel→Airport route attached:', itinerary.departure_guide.route_to_airport.est_min, 'min');
        }
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
    res.end(JSON.stringify(_ok({
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
    })));

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

    // ── Telegram + Web Push 알림 (non-blocking) ─────────────────────
    import('./_plan-ready-push.js').then(({ sendPlanCreatedTelegram, sendPlanReadyPush }) => {
      sendPlanCreatedTelegram({ guestName, email, area, durationDays, pax, planId });
      if (uid) sendPlanReadyPush(adminDb, uid, { planId, planUrl, tourTitle: itinerary.tour_title, language });
    });

  } catch (error) {
    console.error('[ai-planner-full] UNHANDLED ERROR:', error.message, error.stack);
    sendErrorAlert('ai-planner-full', error).catch(() => {});
    if (!res.headersSent) {
      const statusCode = error.statusCode || 500;
      const code = error.code || 'INTERNAL_ERROR';
      res.writeHead(statusCode, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_err('Planner failed', code, {
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })));
    }
  }
}
