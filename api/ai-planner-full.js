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
import { captureError } from './_shared/sentry.js';
import { verifyUserToken } from './_shared/user-auth.js';
import { getSpotContext } from './_spots_helper.js';
import { getFoodContext, buildFoodPrefSnippet } from './_food_helper.js';
import { sendErrorAlert } from './_telegram.js';
import { throttledTelegramAlert } from './_shared/telegram-throttle.js';

import { CORS, AIRPORT_ADDRESSES } from './_ai_core/constants.js';
import { buildSystemPrompt, logPromptMetrics, buildRevisionInstruction } from './_ai_core/buildPrompt.js';
import { calculateTmoney, persistPlan } from './_ai_core/planPersister.js';
import { pickRecommendedRestaurantsByStyle } from './_ai_core/recommendedRestaurants.js';
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
  // batch 9 fix (PR-N, 2026-05-09): env 변수 유무 진단 — handler 진입 즉시.
  // 키 값은 노출 X, 길이/존재만 노출. 5/9 prod 500 빈 body 회귀 추적용.
  console.log('[planner] env check:', {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ? `set(len=${process.env.GEMINI_API_KEY.length})` : 'MISSING',
    FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ? `set(len=${process.env.FIREBASE_PRIVATE_KEY.length})` : 'MISSING',
    GOOGLE_SERVICE_ACCOUNT_KEY: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    adminDb_initialized: !!adminDb,
  });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    // ── Audit P0-#2 (2026-05-04): Firebase ID token 검증 ─────────────────────
    // body.email 신뢰 종료 — 이전 버전에서 admin email 위장으로 TEST mode bypass 가능.
    // 클라이언트는 Authorization: Bearer <idToken> 필수 (api/_shared/admin-auth.js 패턴 동일).
    const auth = await verifyUserToken(req);
    if (!auth.ok) {
      res.writeHead(auth.status, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(_err(auth.error, 'AUTH_REQUIRED')));
    }
    const authenticatedEmail = auth.email;

    // ── 결제 + 재생성 게이트 (인증된 email 전달) ──────────────────────────
    const gate = await enforcePaymentAndRevision(body, adminDb, authenticatedEmail);
    if (gate.rejection) {
      const { statusCode, code, message, details } = gate.rejection;
      res.writeHead(statusCode, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(_err(message, code, details ? { details } : undefined)));
    }
    // 인증된 email 사용 — body.email 무시 (downstream consumers 의 단일 source of truth).
    const requestEmail = authenticatedEmail;

    // ── AI 플래너 출발일 검증: day1 = 오늘 불가 (내일 이후만) ─────────────────
    // 정책 (2026-05-07 운영자 확정): AI 플래너는 디지털 상품이지만
    //   오늘 날짜 시작은 부적절 — Gemini가 한국 로컬 정보를 기반으로 플랜 생성 시
    //   최소 익일 출발을 전제로 설계됨. 12h cutoff 적용 대신 "오늘 = 불가" 단순 정책.
    // 재생성(revision) 은 이미 결제된 플랜 → 날짜 변경 없으므로 체크 skip.
    if (!gate.isRevision) {
      const reqStartDate = body.date || body.startDate || '';
      if (reqStartDate && /^\d{4}-\d{2}-\d{2}$/.test(reqStartDate)) {
        // KST(+09:00) 오늘 날짜 계산
        const nowKST = new Date(Date.now() + 9 * 3600 * 1000);
        const todayKST = nowKST.toISOString().slice(0, 10); // YYYY-MM-DD
        if (reqStartDate <= todayKST) {
          console.warn('[ai-planner-full] day1 today rejected:', reqStartDate, 'today KST:', todayKST);
          res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(_err(
            'Start date must be tomorrow or later. Today\'s trips cannot be planned via AI Planner.',
            'PLANNER_DATE_TOO_SOON',
            { details: `Requested: ${reqStartDate}, today KST: ${todayKST}` }
          )));
        }
      }
    }

    // ── 입력 파싱 ──────────────────────────────────────────────────────────
    const guestName = body.guest_name || body.guestName || 'Guest';
    const paxRaw = Number(body.pax) || Number(body.guest_count) || 2;
    const pax = Math.max(1, Math.min(50, isFinite(paxRaw) ? paxRaw : 2));
    const styles = Array.isArray(body.styles) ? body.styles : body.preferences ? [body.preferences] : ['culture'];
    const area = body.area || body.destination || body.region || 'seoul_city';
    const duration = body.duration || 'full_day';
    const durationDays = body.durationDays || (duration === 'multi_day' ? 2 : 1);
    const startDate = body.date || body.startDate || new Date().toISOString().split('T')[0];
    // Audit P0-#2: email은 인증된 값 (authenticatedEmail). body.email 무시.
    const email = authenticatedEmail;
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
    // 2026-05-03: zone의 대표 주소 (예: "서울 마포구 홍익대학교"). RouteAgent에는
    // hotel_address fallback으로 사용 (공항↔zone 환승 경로 계산). Firestore 저장 시
    // 사용자가 입력한 hotel_address는 빈 문자열 그대로 유지 — "호텔 미정" 의미.
    const recommendedZoneAddress = body.recommended_zone_address || '';
    // RouteAgent용 effective hotel address: 사용자가 호텔 직접 입력하면 그것 우선,
    // 안 했으면 zone anchor 사용. 둘 다 없으면 빈 문자열 (route_to_hotel 생성 안 됨).
    const routeHotelAddress = hotel_address || recommendedZoneAddress;

    const dietPrefs = Array.isArray(body.dietPrefs) ? body.dietPrefs : [];
    const allergies = Array.isArray(body.allergies) ? body.allergies : [];
    const priceRange = body.priceRange || 'Any';
    // W4 (2026-05-08): revision reason chips + free note + previous plan stop names
    const revisionReason = typeof body.revisionReason === 'string' ? body.revisionReason.slice(0, 200) : '';
    const revisionNote   = typeof body.revisionNote   === 'string' ? body.revisionNote.slice(0, 300)   : '';
    const avoidListBody  = typeof body.avoidList      === 'string' ? body.avoidList.slice(0, 1000)     : '';
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

[LODGING ZONE PREFERENCE — STRICT]
The user has not booked a hotel and chose "${recommendedZone}" as their preferred lodging district within ${area}.
This is a HARD anchor — assume they will sleep in or near "${recommendedZone}" every night.

REQUIREMENTS:
- 80%+ of all stops MUST be within 3km of "${recommendedZone}" centroid.
- Day 1: first stop MUST be in "${recommendedZone}" (arrival convenience).
- Day N (last day): last stop MUST be in "${recommendedZone}" (departure convenience).
- Food stops (lunch/dinner): 90%+ within 3km of "${recommendedZone}".
- Outside-zone stops: maximum 20% per day, AND only if the spot is genuinely iconic (major palace, must-see landmark, signature experience that cannot be substituted nearby).
- DO NOT scatter stops across multiple distant districts — that defeats the purpose of choosing a base zone.
- If "${recommendedZone}" lacks options for a category, prefer the closest adjacent neighborhood over a distant one.` : '') + (wantAccom ? `

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

    // ── W4 revision instruction (사유 → Gemini 추가 지시) ────────────────────
    // gate.isRevision이 true일 때만 revision instruction 추가 (일반 신규 플랜 불필요).
    const revisionInstruction = gate.isRevision
      ? buildRevisionInstruction(revisionReason, revisionNote, avoidListBody)
      : '';
    if (revisionInstruction) {
      console.log('[planner] W4 revisionInstruction injected:', revisionReason, '| note:', revisionNote?.slice(0, 50), '| avoidList:', avoidListBody.split(',').length, 'items');
    }

    // ── 프롬프트 계측 ───────────────────────────────────────────────────────
    const systemPrompt = buildSystemPrompt(language);
    const finalUserMessage = userMessage + avoidClause + revisionInstruction;
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

    // 2026-05-05 (운영자 요청): 숙소→공항 경로 무조건 표시 정책 강화.
    // Gemini 가 departure_guide 자체를 생성 안 한 케이스에 대비해 빈 객체라도
    // 만들어 둔다. 그래야 RouteAgent 가 route_to_airport 를 attach 할 수 있고,
    // 프론트엔드는 호텔/zone fallback 좌표로 출국 경로 카드를 항상 노출함.
    if (departure_airport && departure_airport !== 'ALREADY' && !itinerary.departure_guide) {
      itinerary.departure_guide = { airport: departure_airport };
      console.log('[planner] departure_guide synthesized (airport=', departure_airport, ')');
    }

    // ── RouteAgent enrichment (mutates itinerary in place) ────────────────
    // 2026-05-03: routeHotelAddress = hotel_address || zone anchor. zone만 골랐어도
    // 공항↔zone 환승 경로(arrival_guide.route_to_hotel)가 정상 계산됨. 사용자가
    // Firestore에서 보는 hotel_address 필드는 그대로 빈 값 유지.
    await enrichItineraryWithRoute(itinerary, {
      apiKey,
      body,
      hotel_address: routeHotelAddress,
      arrival_airport,
      departure_airport,
      pax,
    });
    // arrival_guide / departure_guide의 route_to_hotel에 zone fallback이 적용됐음을
    // 표시 — UI가 "Lotte Hotel 기준" 대신 "홍대 지역 기준"으로 라벨링할 수 있게.
    if (!hotel_address && recommendedZoneAddress) {
      if (itinerary.arrival_guide?.route_to_hotel) {
        itinerary.arrival_guide.route_to_hotel.anchor_label = recommendedZone;
        itinerary.arrival_guide.route_to_hotel.anchor_address = recommendedZoneAddress;
      }
      if (itinerary.departure_guide?.route_to_airport) {
        itinerary.departure_guide.route_to_airport.anchor_label = recommendedZone;
        itinerary.departure_guide.route_to_airport.anchor_address = recommendedZoneAddress;
      }
    }

    console.log('[planner] Step 3: Saving to Firestore...');

    // ── T-money 서버 계산 ─────────────────────────────────────────────────
    calculateTmoney(itinerary);

    // ── Must-visit 맛집 추천 (DB 기반 — Gemini 미경유) ─────────────────────
    // 동선 5km 이내 + plan 미포함 식당 중 rating × log(reviews) 상위 10개씩.
    // dietPrefs 기준 per-style bucket: { general, vegan?, halal? } — 섞지 않음.
    // 2026-05-05 regression fix: 이전엔 general만 노출 → vegan/halal 사용자도
    // 일반 식당만 봤음. SAFETY-CRITICAL (CLAUDE.md J).
    let foodIndexForQuality = [];
    try {
      const foodIndex = await loadFoodIndex();
      foodIndexForQuality = foodIndex;
      itinerary.recommended_restaurants = pickRecommendedRestaurantsByStyle(
        foodIndex, itinerary, area, dietPrefs,
      );
      const _bucketSizes = Object.entries(itinerary.recommended_restaurants)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : 0}`).join(' ');
      console.log('[planner] recommended_restaurants buckets:', _bucketSizes);
    } catch (recErr) {
      // Non-critical — plan still ships if recommendation fails.
      console.warn('[planner] recommended_restaurants failed:', recErr.message);
      itinerary.recommended_restaurants = { general: [] };
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
      dietary: dietPrefs, foodIndex: foodIndexForQuality,
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

    // batch 9 fix (PR-N, 2026-05-09): 응답을 먼저 보내고 부수 작업은 fire-and-forget.
    // 이전: await captureError 가 throw 하면 catch 블록 자체가 abort → res.end 못 보냄
    //       → Vercel 500 + 빈 body. 운영자가 client console 에서 정확한 에러 못 봄.
    // 변경: res.end() 먼저, telemetry/sentry 는 setImmediate 로 분리.
    if (!res.headersSent) {
      const statusCode = error.statusCode || 500;
      const code = error.code || 'INTERNAL_ERROR';
      res.writeHead(statusCode, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_err('Planner failed', code, {
        details: error.message || 'Unknown error',
        // batch 9 fix (PR-N): root cause 진단 위해 prod 에서도 stack head 일부 노출.
        // 운영자 본인 + Test Mode 케이스라 사용자에게 stack 노출 위험 낮음. 진단
        // 완료 후 dev only 로 좁힐 것.
        stackHead: (error.stack || '').slice(0, 500),
      })));
    }

    // K Tier 2-E (PR #266) — throttled. 동일 unhandled 패턴 5분 윈도우 내 dedup.
    // catch 블록 첫 응답 전에 await 하면 telemetry throw 시 응답 못 감 → 분리.
    Promise.resolve().then(async () => {
      try {
        await throttledTelegramAlert({
          key: 'ai-planner-unhandled',
          channel: 'error',
          message: `🔴 [ai-planner-full] ${error.message || 'unknown error'}`,
          severity: 'high',
          context: { errorMessage: (error.message || '').slice(0, 200), stack: (error.stack || '').slice(0, 500) },
        });
      } catch (e) {
        console.warn('[ai-planner-full] telegram alert failed:', e.message);
      }
      try {
        await captureError(error, {
          route: '/api/ai-planner-full',
          method: req.method,
          planner_mode: PLANNER_MODE,
        });
      } catch (e) {
        console.warn('[ai-planner-full] sentry capture failed:', e.message);
      }
    });
  }
}
