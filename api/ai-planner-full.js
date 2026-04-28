/**
 * Vercel API Route: AI Planner Full v2
 * POST /api/ai-planner-full
 *
 * Gemini 2.5 Pro → RouteAgent → T-money 계산 → Firestore 저장 (blocking)
 * → planId + planUrl 응답 → 알림 이메일 (non-blocking)
 *
 * Refactored: behavior-preserving extraction to api/_ai_core/ modules.
 * P1 lock target: ≤ 500 lines. Inline logic kept here is now limited to
 * request shaping, response writing, and post-response side effects.
 */
import { getSpotContext } from './_spots_helper.js';
import { getFoodContext, buildFoodPrefSnippet } from './_food_helper.js';
import { sendErrorAlert } from './_telegram.js';

import { CORS, AIRPORT_ADDRESSES } from './_ai_core/constants.js';
import { buildSystemPrompt, logPromptMetrics } from './_ai_core/buildPrompt.js';
import { calculateTmoney, persistPlan } from './_ai_core/planPersister.js';
import { pickRecommendedRestaurants } from './_ai_core/recommendedRestaurants.js';
import { loadFoodIndex } from './_ai_core/geminiPipeline.js';
import { sendNotificationEmail, recordLeadToSheets } from './_ai_core/emailNotifier.js';
import { initAdminDb } from './_ai_core/firestoreAdmin.js';
import { enforcePaymentAndRevision } from './_ai_core/paymentGate.js';
import { selectVehicle, calcPrice, VEHICLE_LABELS } from './_ai_core/vehicleAndPrice.js';
import { buildAvoidClause } from './_ai_core/avoidListQuery.js';
import { runGeminiPipeline } from './_ai_core/geminiPipeline.js';
import { enrichItineraryWithRoute } from './_ai_core/routeEnrichment.js';

// Feature flag: 'legacy' (default) or '3pass'
const PLANNER_MODE = (process.env.PLANNER_MODE || 'legacy').trim();

export const maxDuration = 300;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──────────────────────────────────────────────────────────
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR', extra) => ({ ok: false, error: msg, code, ...extra });

const adminDb = initAdminDb();

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
    // Sprint 2 #5: zone hint (string key like 'myeongdong'). Used as a soft
    // anchor for hub-and-spoke when no hotel_address provided. Ignored when
    // hotel_address present (hotel coords win).
    const recommendedZone = body.recommended_zone || '';

    const dietPrefs = Array.isArray(body.dietPrefs) ? body.dietPrefs : [];
    const allergies = Array.isArray(body.allergies) ? body.allergies : [];
    const priceRange = body.priceRange || 'Any';
    const wantAccom = !!body.wantAccom;
    const accomBudget = body.accomBudget || 'moderate';
    // 이동 강도 — 명시 pace 우선, 없으면 기존 tourPace에서 derive (UI 변경 최소화).
    const pace = ['relaxed', 'standard', 'packed'].includes(body.pace) ? body.pace
      : (body.tourPace === 'half' || body.tourPace === 'short') ? 'relaxed'
      : (body.tourPace === 'action') ? 'packed' : 'standard';

    const arrivalAddress = AIRPORT_ADDRESSES[arrival_airport] || '';
    const departureAddress = AIRPORT_ADDRESSES[departure_airport] || AIRPORT_ADDRESSES[arrival_airport] || '';

    console.log('[ai-planner-full] Request:', JSON.stringify({ styles, area, duration, pax, vehicle, arrival_airport, mobility }));
    console.log('[ai-planner-full] ENV:', { gemini: !!process.env.GEMINI_API_KEY, firebase: !!adminDb, gmail: !!process.env.GMAIL_USER });

    console.log('[planner] Step 1: Calling Gemini...');

    // ── Gemini 호출 준비 ───────────────────────────────────────────────────
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

    let spotContext = '';
    try { spotContext = getSpotContext(area, 6) || ''; }
    catch (spotErr) { console.warn('[ai-planner-full] getSpotContext failed:', spotErr.message); }

    let foodContext = '';
    try {
      foodContext = getFoodContext(area, dietPrefs, priceRange, 10) || '';
      if (foodContext) console.log('[ai-planner-full] Food context injected:', foodContext.length, 'chars');
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
      // Sprint 2 #5: zone hint passed only when hotel_address absent.
      recommended_zone: !hotel_address && recommendedZone ? recommendedZone : undefined,
      mobility,
      special_request: specialRequest || undefined,
      diet_preferences: dietPrefs.length > 0 ? dietPrefs : undefined,
      food_allergies: allergies.length > 0 ? allergies : undefined,
      meal_budget: priceRange !== 'Any' ? priceRange : undefined, ...buildFoodPrefSnippet(body),
      pace, // relaxed: 단일 zone / standard: 2 인접 zone / packed: 자유
      variation_seed: Math.floor(Math.random() * 100) + 1,
      want_accommodation: wantAccom || undefined,
      accommodation_budget: wantAccom ? accomBudget : undefined,
    }) + spotContext + foodContext + (!hotel_address && recommendedZone ? `

[LODGING ZONE PREFERENCE]
The user has not booked a hotel and chose "${recommendedZone}" as their preferred district within ${area}.
Treat this zone as the hub: Day 1 starts there, Day N ends there, food stops within ~2km radius when possible.
This is a soft anchor — you may suggest stops outside the zone if they fit the user's interests.` : '') + (wantAccom ? `

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

    // ── AVOID 리스트 (최근 plan 식당 중복 방지) ────────────────────────────
    const avoidClause = await buildAvoidClause(adminDb, { uid, requestEmail });

    // ── 프롬프트 계측 ───────────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(language);
    const finalUserMessage = userMessage + avoidClause;
    logPromptMetrics(systemPrompt + finalUserMessage, {
      city: area,
      days: durationDays,
      diet: dietPrefs.join(',') || 'none',
      lang: language,
      injectedRestaurants: (foodContext.match(/•/g) || []).length,
    });

    // ── Gemini 파이프라인 (legacy or 3pass) ────────────────────────────────
    const itinerary = await runGeminiPipeline({
      apiKey,
      systemPrompt,
      userMessage: finalUserMessage,
      area,
      language,
      mode: PLANNER_MODE,
    });

    console.log('[planner] Step 2: Running RouteAgent...');

    // ALREADY 또는 미정 → arrival_guide / departure_guide 제거
    if (!arrival_airport || arrival_airport === 'ALREADY') delete itinerary.arrival_guide;
    if (!departure_airport || departure_airport === 'ALREADY') delete itinerary.departure_guide;

    // ── RouteAgent enrichment (mutates itinerary in place) ────────────────
    await enrichItineraryWithRoute(itinerary, {
      apiKey,
      body,
      hotel_address,
      arrival_airport,
      departure_airport,
      pax,
    });

    console.log('[planner] Step 3: Saving to Firestore...');

    // ── T-money 서버 계산 ─────────────────────────────────────────────────
    calculateTmoney(itinerary);

    // ── Must-visit 맛집 추천 (DB 기반 — Gemini 미경유) ─────────────────────
    // 동선 5km 이내 + tag='general' + plan 미포함 식당 중 rating × log(reviews)
    // 상위 10개. halal/vegan은 제외 (니치 다이어트라 일반 사용자에 부적합).
    try {
      const foodIndex = await loadFoodIndex();
      itinerary.recommended_restaurants = pickRecommendedRestaurants(foodIndex, itinerary, area);
      console.log('[planner] recommended_restaurants:', itinerary.recommended_restaurants.length);
    } catch (recErr) {
      // Non-critical — plan still ships if recommendation fails.
      console.warn('[planner] recommended_restaurants failed:', recErr.message);
      itinerary.recommended_restaurants = [];
    }

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
        vehicleLabel: VEHICLE_LABELS[vehicle] || VEHICLE_LABELS.staria_8,
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
      }).catch((e) => console.warn('[planner] Email error:', e.message));
    }

    // ── Google Sheets 리드 기록 (non-blocking) ──────────────────────────
    if (email) {
      recordLeadToSheets({ email, guestName, area, styles, pax, planId })
        .catch((e) => console.warn('[planner] Sheets error:', e.message));
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
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      })));
    }
  }
}
