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
import { decidePlannerMode } from './_ai_core/plannerMode.js';

// Phase 4 A/B test (2026-05-13): mode resolved per-request via
// decidePlannerMode (api/_ai_core/plannerMode.js). Inputs: uid / guestEmail /
// sessionId hash → bucket [0..99] → < PLANNER_AB_3PASS_PCT means 3-pass.
// PLANNER_MODE='3pass' env still overrides (entire population → 3-pass).
// Default behaviour with both env unset = legacy 100% (Phase 3 baseline).

export const maxDuration = 300;
export const config = { runtime: 'nodejs' };

// ── 표준 응답 래퍼 ──────────────────────────────────────────────────────────
const _ok  = (data) => ({ ok: true, data });
const _err = (msg, code = 'UNKNOWN_ERROR', extra) => ({ ok: false, error: msg, code, ...extra });

// ── 도시 → 기본 공항 매핑 (PDF-issue-4, 2026-05-14) ─────────────────────────
// 다도시 plan 의 출국 공항 inference. arrival_airport 와 마지막 city 가 다르면
// 그 city 기본 공항으로 자동 추론 (예: 부산 입국 → 서울 마지막 → ICN 출국).
const CITY_DEFAULT_AIRPORT = {
  seoul: 'ICN', '서울': 'ICN',
  busan: 'PUS', '부산': 'PUS',
  jeju:  'CJU', '제주': 'CJU',
  daegu: 'TAE', '대구': 'TAE',
};

function inferDepartureAirport(arrivalAirport, regions, cities) {
  // 다도시 plan 만 처리. 단도시거나 regions/cities 미정이면 arrivalAirport 그대로.
  const list = Array.isArray(regions) && regions.length > 0
    ? regions
    : (Array.isArray(cities) && cities.length > 0 ? cities : null);
  if (!list || list.length <= 1) return arrivalAirport;

  const last = String(list[list.length - 1] || '').toLowerCase().trim();
  if (!last) return arrivalAirport;

  // substring 매칭 (예: "seoul_city" → seoul, "부산광역시" → 부산)
  for (const [key, airport] of Object.entries(CITY_DEFAULT_AIRPORT)) {
    if (last.includes(key)) return airport;
  }
  return arrivalAirport;
}

export { inferDepartureAirport };

const adminDb = initAdminDb();

// ── 메인 핸들러 ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
  if (req.method !== 'POST') {
    res.writeHead(405, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(_err('Method Not Allowed', 'METHOD_NOT_ALLOWED')));
  }

  const handlerStart = Date.now();
  // Phase 4 A/B test (2026-05-13): mode trace 변수 — try 블록 밖에서 선언해
  // 초기 throw 시에도 catch 블록의 sentry/log 가 안전하게 read 할 수 있게.
  // try 안에서 decidePlannerMode 호출 후 덮어쓰기. body parse 전에 throw 하면
  // 'unknown' 그대로 sentry 에 기록.
  let resolvedPlannerMode = 'unknown';
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
    // 2026-05-10 (P0-1 launch blocker): regions array 추출 — 다도시 plan 처리 핵심.
    // PR #331 의 _enrichMultiCityDays 가 regions.length>=2 시 작동. 누락 시 dead code.
    const regions = Array.isArray(body.regions) && body.regions.length > 0
      ? body.regions.filter((r) => typeof r === 'string' && r.trim()).slice(0, 5)
      : (body.region ? [body.region] : (area ? [area] : ['Seoul']));
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
    // PDF-issue-4 fix (2026-05-14): 다도시 plan 의 마지막 도시가 도착 도시와 다르면
    // 그 도시 기본 공항으로 inference. 이전: arrival_airport 그대로 fallback →
    // 부산 도착 → 서울 이동 plan 에서 wrap-up "PUS 출발" 표시 (잘못).
    // 운영자 명시 departure_airport 가 있으면 그 값 우선.
    const departure_airport = body.departure_airport
      || inferDepartureAirport(arrival_airport, body.regions, body.cities)
      || arrival_airport
      || '';
    const hotel_address = body.hotel_address || '';
    const mobility = body.mobility || 'ok';
    const uid = body.uid || null;

    // ── Phase 4 A/B test: planner mode 결정 (uid > guestEmail > sessionId) ───
    // sessionId 는 client 가 보낼 수 있는 anonymous 식별자 (현재 미사용이지만 향후
    // 비로그인 게스트 결제 흐름 대비). hash → bucket → PCT 미만이면 3pass.
    // 결정론적 — 동일 사용자 = 동일 mode 유지 (revision 도 같은 mode 사용).
    // SAFETY-CRITICAL (CLAUDE.md J): mode 결정은 dietary validation 에 영향 없음.
    // 1-pass / 3-pass 모두 동일한 validateResponse + hasCriticalDietaryViolation 적용.
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
    const abDecision = decidePlannerMode({
      uid,
      guestEmail: authenticatedEmail,
      sessionId,
    });
    const PLANNER_MODE = abDecision.mode;
    resolvedPlannerMode = PLANNER_MODE;  // expose to catch-block sentry context
    console.log(
      `[planner] AB test: uid=${uid || '-'} email=${authenticatedEmail || '-'} ` +
      `mode=${abDecision.mode} reason=${abDecision.reason} ` +
      `bucket=${abDecision.bucket ?? '-'}`,
    );

    // Sprint 2 #5: zone hint (string key like 'myeongdong'). Used as a soft
    // anchor for hub-and-spoke when no hotel_address provided. Ignored when
    // hotel_address present (hotel coords win).
    // 2026-05-11 (B-2 fix): recommended_zones (Record<city, zone>) 도 함께 처리.
    // 다도시 plan 시 도시별 zone hint. 단도시 plan 도 동일 형식이지만 backward
    // compat — recommended_zone (string) 만 받아도 작동. recommended_zones 우선.
    const recommendedZone = body.recommended_zone || '';
    const recommendedZones = (() => {
      const raw = body.recommended_zones;
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const out = {};
        for (const [k, v] of Object.entries(raw)) {
          if (typeof k === 'string' && typeof v === 'string' && v.trim()) {
            out[k.trim()] = v.trim();
          }
        }
        if (Object.keys(out).length > 0) return out;
      }
      // fallback: legacy recommended_zone + area → single-entry Record
      // (단도시 plan 또는 client 가 recommended_zones 안 보낸 케이스).
      if (recommendedZone && area) {
        // area 는 'seoul_city' 형태. zone Record key 는 frontend zoneData key
        // (e.g. 'seoul'). 안전한 매핑 — area startsWith 로 첫 도시 추출.
        const cityKey = String(area).split('_')[0].toLowerCase();
        return { [cityKey]: recommendedZone };
      }
      return {};
    })();
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
    // 2026-05-10 (P1 launch blocker): WizardForm 누락 필드들 추출 — RouteAgent
    // late-night/heavy-luggage 분기 + Gemini prompt 정확도 개선용.
    const arrivalTime = typeof body.arrivalTime === 'string' ? body.arrivalTime.slice(0, 5) : '';
    const departureTime = typeof body.departureTime === 'string' ? body.departureTime.slice(0, 5) : '';
    const luggage = (body.luggage && typeof body.luggage === 'object') ? {
      small: Number(body.luggage.small) || 0,
      medium: Number(body.luggage.medium) || 0,
      large: Number(body.luggage.large) || 0,
    } : null;
    const spiceLevel = typeof body.spiceLevel === 'string' ? body.spiceLevel : '';
    const bucketDishes = Array.isArray(body.bucketDishes)
      ? body.bucketDishes.filter((d) => typeof d === 'string').slice(0, 10)
      : [];
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
      // 2026-05-10 (P0-1): regions array — 다도시 plan 시 buildPrompt MULTI-CITY
      // HANDLING 섹션 (regions.length>=2) 트리거 + Gemini 가 city 별 분배 가능.
      regions,
      duration,
      vehicle,
      arrival_airport: arrival_airport || undefined,
      departure_airport: departure_airport || undefined,
      arrival_address: arrivalAddress || undefined,
      departure_address: departureAddress || undefined,
      // 2026-05-10 (P1): 도착/출발 시각 — Gemini 가 첫/마지막 day 일정 시각 분기.
      arrival_time: arrivalTime || undefined,
      departure_time: departureTime || undefined,
      hotel_address: hotel_address || undefined,
      // Sprint 2 #5: zone hint passed only when hotel_address absent.
      recommended_zone: !hotel_address && recommendedZone ? recommendedZone : undefined,
      // 2026-05-11 (B-2): 다도시 plan zone hint Record — buildPrompt MULTI-CITY 분기 보완.
      recommended_zones: !hotel_address && Object.keys(recommendedZones).length > 0
        ? recommendedZones
        : undefined,
      mobility,
      // 2026-05-10 (P1): luggage — RouteAgent late-night/heavy-luggage 분기 + Gemini.
      luggage: luggage || undefined,
      special_request: specialRequest || undefined,
      diet_preferences: dietPrefs.length > 0 ? dietPrefs : undefined,
      food_allergies: allergies.length > 0 ? allergies : undefined,
      // 2026-05-10 (P1): 매운맛 / 한국 음식 bucket — 식당 매칭 정확도 개선.
      spice_level: spiceLevel || undefined,
      bucket_dishes: bucketDishes.length > 0 ? bucketDishes : undefined,
      meal_budget: priceRange !== 'Any' ? priceRange : undefined, ...buildFoodPrefSnippet(body),
      pace, // relaxed: 단일 zone / standard: 2 인접 zone / packed: 자유
      variation_seed: Math.floor(Math.random() * 100) + 1,
      want_accommodation: wantAccom || undefined,
      accommodation_budget: wantAccom ? accomBudget : undefined,
    }) + spotContext + foodContext + (() => {
      // 2026-05-11 (B-2 fix): 다도시 plan zone-per-city prompt 분기.
      // recommended_zones 가 2개 이상 도시 zone 갖고 있으면 도시별 LODGING ZONE
      // anchor 모두 강제. 단일 도시이거나 zones 1개 = 기존 single-zone 분기.
      if (hotel_address) return '';
      const zoneEntries = Object.entries(recommendedZones).filter(([, z]) => !!z);
      if (zoneEntries.length === 0) return '';

      if (zoneEntries.length === 1) {
        const [, singleZone] = zoneEntries[0];
        return `

[LODGING ZONE PREFERENCE — STRICT]
The user has not booked a hotel and chose "${singleZone}" as their preferred lodging district within ${area}.
This is a HARD anchor — assume they will sleep in or near "${singleZone}" every night.

REQUIREMENTS:
- 80%+ of all stops MUST be within 3km of "${singleZone}" centroid.
- Day 1: first stop MUST be in "${singleZone}" (arrival convenience).
- Day N (last day): last stop MUST be in "${singleZone}" (departure convenience).
- Food stops (lunch/dinner): 90%+ within 3km of "${singleZone}".
- Outside-zone stops: maximum 20% per day, AND only if the spot is genuinely iconic (major palace, must-see landmark, signature experience that cannot be substituted nearby).
- DO NOT scatter stops across multiple distant districts — that defeats the purpose of choosing a base zone.
- If "${singleZone}" lacks options for a category, prefer the closest adjacent neighborhood over a distant one.`;
      }

      // 다도시: 도시별 zone anchor. 도시 변경 day 마다 그 도시 zone 중심 5km 반경.
      const cityZoneLines = zoneEntries
        .map(([city, zone]) => `- In ${city.charAt(0).toUpperCase() + city.slice(1)}, hub stops around "${zone}" — selected by user. Day blocks for this city: 80%+ stops within 3km of "${zone}" centroid, first + last stop within "${zone}".`)
        .join('\n');
      return `

[MULTI-CITY LODGING ZONE PREFERENCE — STRICT]
The user has not booked hotels. For each city they selected, they chose a preferred lodging district:

${cityZoneLines}

REQUIREMENTS:
- Each Day's "city" field determines which zone anchor applies.
- 80%+ of stops on a given day MUST be within 3km of THAT city's chosen zone.
- First stop of each city-block MUST be in that city's zone (arrival/transit convenience).
- Last stop of each city-block MUST be in that city's zone (rest/sleep convenience).
- Food stops (lunch/dinner): 90%+ within 3km of the day's city zone.
- DO NOT scatter stops across cities mid-day. Inter-city travel only at start of a new city-block via intercity_transit (see MULTI-CITY HANDLING).
- If a city's zone lacks options for a category, prefer the closest adjacent neighborhood within the SAME city — never cross-city.`;
    })() + (wantAccom ? `

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
    // P0-3 SAFETY-CRITICAL (CLAUDE.md J): 사용자 dietary 전달 → validateResponse 가
    // halal/vegan/vegetarian 위반 검사 → 위반 시 1회 retry → 그래도 위반이면 throw.
    // 2026-05-12 pattern validation: body 전달 → regions/arrival_airport/
    // departure_airport 기반 lodging bookend / min stops / start_time / 출국 공항
    // 검증 (B-10/B-12/B-14/B-15). 위반 시 1회 retry → 그래도 위반이면 500 throw.
    const itinerary = await runGeminiPipeline({
      apiKey,
      systemPrompt,
      userMessage: finalUserMessage,
      area,
      language,
      mode: PLANNER_MODE,
      dietary: dietPrefs,
      body: {
        regions,
        arrival_airport,
        departure_airport,
        durationDays,
      },
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
      // 2026-05-11 (B-3 fix): regions array forward — 다도시 plan 시 도시별
      // 추천 식당 분배 (5+5 또는 4+3+3). 단도시는 regions=[area] → 기존 10개 동일.
      itinerary.recommended_restaurants = pickRecommendedRestaurantsByStyle(
        foodIndex, itinerary, area, dietPrefs, regions,
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
    // Phase 4 (2026-05-13): plannerMode + abReason + abBucket — admin
    // dashboard 에서 mode 별 qualityScore 비교 위함. legacy vs 3-pass 평균
    // 차이 + diet/unverified/route 카운트 차이를 운영자가 직접 확인 가능.
    const { planId, planUrl } = await persistPlan(adminDb, {
      body, itinerary, uid, vehicle, priceKRW, priceUSD,
      guestName, pax, styles, area, duration, startDate, email,
      specialRequest, arrival_airport, departure_airport,
      hotel_address, mobility, language,
      dietary: dietPrefs, foodIndex: foodIndexForQuality,
      plannerMode: PLANNER_MODE,
      abReason: abDecision.reason,
      abBucket: abDecision.bucket,
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
          planner_mode: resolvedPlannerMode,
        });
      } catch (e) {
        console.warn('[ai-planner-full] sentry capture failed:', e.message);
      }
    });
  }
}
