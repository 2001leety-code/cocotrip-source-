/**
 * AI Planner Full v2 — Vercel handler 진입점 (P129, 2026-05-21).
 *
 * Refactored from api/ai-planner-full.js (800L → 50L wrapper).
 * Behavior-preserving extraction — request shaping, userMessage 조립,
 * post-response pipeline 은 각각 별 모듈 (requestShaper / userMessageBuilder /
 * postResponsePipeline) 로 분리됐다. 본 모듈은 그 모듈들을 합성하는
 * orchestrator + try/catch/finally + step instrumentation (P96).
 *
 * Flow:
 *   1. CORS preflight / method gate
 *   2. withStep('verifyAuth') → Firebase ID token 검증
 *   3. withStep('paymentGate') → PayPal/revision 게이트
 *   4. shapeRequest(body, email) → 정규화된 입력
 *   5. decidePlannerMode (uid/email/sessionId → bucket → 3pass/legacy)
 *   6. buildUserMessage + spotContext + foodContext + zone/hotel blocks
 *   7. withStep('avoidClause') + revisionInstruction
 *   8. block-mode (P128) | legacy runGeminiPipeline (withStep('gemini'))
 *   9. withStep('routeEnrich') + backfills + T-money
 *   10. recommended_restaurants + pricing
 *   11. withStep('persistPlan') → Firestore
 *   12. respond 200 — non-blocking email/sheets/telegram/push
 *   13. catch: respond 500 (res first) → telegram+sentry (fire-and-forget)
 *   14. finally: clearTimeout(hangWarnTimer)
 *
 * SAFETY-CRITICAL (CLAUDE.md J): dietary 흐름 100% 유지 — block-mode +
 * legacy 양쪽 모두 dietPrefs forward + validateResponse + halal/vegan
 * critical violation throw.
 */
import { captureError } from '../_shared/sentry.js';
import { verifyUserToken } from '../_shared/user-auth.js';
import { getSpotContext } from '../_spots_helper.js';
import { getFoodContext } from '../_food_helper.js';
import { getAttractionsContext } from '../_attractions_helper.js';
import { getMountainContextForPrompt } from '../_mountain_helper.js'; // P191 SAFETY: Trekking/Hallasan
import { getRunningContextForPrompt } from '../_running_helper.js'; // P237: Running 코스 16개 DB
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';

import { CORS } from './constants.js';
import { buildSystemPrompt, logPromptMetrics, buildRevisionInstruction } from './buildPrompt.js';
import { loadFoodIndex, runGeminiPipeline } from './geminiPipeline.js';
import { sendNotificationEmail, recordLeadToSheets } from './emailNotifier.js';
import { initAdminDb } from './firestoreAdmin.js';
import { enforcePaymentAndRevision } from './paymentGate.js';
import { VEHICLE_LABELS } from './vehicleAndPrice.js';
import { buildAvoidClause } from './avoidListQuery.js';
import { decidePlannerMode, pickIdentifier } from './plannerMode.js';
import { buildAdminDebug } from './debugInfo.js';
import { tryRunBlockMode } from './blockMode.js';
import {
  triggerPass3BackgroundIfPending,
  shouldUseStreaming,
  tryInitStreamingSkeleton,
  tryBlockModeInngestPath,
  sendStreamingEarlyResponse,
} from './backgroundPipelines.js';

import { shapeRequest } from './requestShaper.js';
import { buildUserMessage } from './userMessageBuilder.js';
import { runRouteEnrichment, applyBackfillsAndTmoney, applyRecommendedRestaurants, computePricing, savePlan } from './postResponsePipeline.js';
import { dispatchOrInlineForHandlerCore, shouldDispatchToInngest } from './inngestDispatch.js';

// Phase 4 A/B test (2026-05-13): mode resolved per-request via
// decidePlannerMode (api/_ai_core/plannerMode.js). Inputs: uid / guestEmail /
// sessionId hash → bucket [0..99] → < PLANNER_AB_3PASS_PCT means 3-pass.
// PLANNER_MODE='3pass' env still overrides (entire population → 3-pass).
// Default behaviour with both env unset = legacy 100% (Phase 3 baseline).

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
  // Phase 4 A/B test (2026-05-13): mode trace 변수 — try 블록 밖에서 선언해
  // 초기 throw 시에도 catch 블록의 sentry/log 가 안전하게 read 할 수 있게.
  // try 안에서 decidePlannerMode 호출 후 덮어쓰기. body parse 전에 throw 하면
  // 'unknown' 그대로 sentry 에 기록.
  let resolvedPlannerMode = 'unknown';
  // P96 (2026-05-19): step-level elapsed instrumentation. 기존엔 START + TOTAL
  // 두 로그만 있어 hang 시 어느 step 에서 멈췄는지 prod logs 로도 진단 불가.
  // withStep 으로 핵심 await 마다 ENTER + DONE/FAILED elapsed 로그. catch 블록
  // 의 hangWarn alert 는 5분 Vercel cap 도달 30초 전 (4분30초) 발사. P218: ms → "NNNms (Xh Y분 Z초)".
  function fmtMs(ms) { const n=Math.round(Number(ms)||0); if(n<1000) return `${n}ms`; const t=Math.floor(n/1000),h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60,p=[];if(h)p.push(`${h}h`);if(m)p.push(`${m}분`);p.push(`${s}초`);return `${n}ms (${p.join(' ')})`; }
  let currentStep = 'init';
  let currentStepStart = handlerStart;
  let lastUid = null;
  let lastEmail = null;
  async function withStep(label, fn) {
    currentStep = label;
    currentStepStart = Date.now();
    console.log(`[planner] step=${label} ENTER`);
    try {
      const result = await fn();
      const elapsed = Date.now() - currentStepStart;
      console.log(`[planner] step=${label} DONE ${elapsed}ms`);
      return result;
    } catch (err) {
      const elapsed = Date.now() - currentStepStart;
      console.error(`[planner] step=${label} FAILED ${elapsed}ms — ${err && err.message ? err.message : err}`);
      throw err;
    }
  }
  const HANG_WARN_MS = 270_000;
  const hangWarnTimer = setTimeout(() => {
    // fire-and-forget — throttledTelegramAlert dedup (5분 window, P67) 로
    // 폭주 자동 차단. clearTimeout 으로 정상 종료 시 alert 안 가게 함.
    throttledTelegramAlert({
      key: 'ai-planner-hang',
      channel: 'admin',
      severity: 'high',
      message: [
        `⚠️ <b>ai-planner-full 4분30초 경과 — Vercel 5분 cap 임박</b>`,
        ``,
        `<b>last step:</b> ${currentStep}`,
        `<b>step elapsed:</b> ${fmtMs(Date.now() - currentStepStart)}`,
        `<b>total elapsed:</b> ${fmtMs(Date.now() - handlerStart)}`,
        `<b>mode:</b> ${resolvedPlannerMode}`,
        `<b>uid:</b> ${lastUid || '-'} <b>email:</b> ${lastEmail || '-'}`,
      ].join('\n'),
      context: {
        lastStep: currentStep,
        elapsedTotal: Date.now() - handlerStart,
        lastStepStart: currentStepStart,
        mode: resolvedPlannerMode,
        uid: lastUid,
        email: lastEmail,
      },
    }).catch(() => {});
  }, HANG_WARN_MS);
  if (hangWarnTimer.unref) hangWarnTimer.unref();

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
    const auth = await withStep('verifyAuth', () => verifyUserToken(req));
    if (!auth.ok) {
      res.writeHead(auth.status, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(_err(auth.error, 'AUTH_REQUIRED')));
    }
    const authenticatedEmail = auth.email;
    lastEmail = authenticatedEmail;

    // ── 결제 + 재생성 게이트 (인증된 email 전달) ──────────────────────────
    const gate = await withStep('paymentGate', () => enforcePaymentAndRevision(body, adminDb, authenticatedEmail));
    if (gate.rejection) {
      const { statusCode, code, message, details } = gate.rejection;
      res.writeHead(statusCode, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(_err(message, code, details ? { details } : undefined)));
    }

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

    // ── 입력 정규화 (requestShaper) ────────────────────────────────────────
    const shaped = shapeRequest(body, authenticatedEmail);
    const {
      guestName, pax, styles, area, regions, duration, durationDays, startDate,
      email, specialRequest, vehicle, language,
      arrival_airport, departure_airport, hotel_address, hotelByCity,
      mobility, uid,
      recommendedZone, recommendedZones, recommendedZoneAddress, routeHotelAddress,
      dietPrefs, allergies, priceRange,
      revisionReason, revisionNote, avoidListBody,
      arrivalTime, departureTime, tourStartTime, tourEndTime, sessionId, // P239: tourStartTime architectural (default 09:00) / #tour-end: tourEndTime (default 21:00)
    } = shaped;
    lastUid = uid;
    const requestEmail = email; // 인증된 email — body.email 무시 (downstream single source).
    // P298 (2026-05-29) SAFETY-CRITICAL: 할랄/비건이 allergies 칸으로 들어옴 (WizardForm P10 4/24 ALLERGY_KEYS). dietPrefs 만 보던 검증·필터·추천·저장·dispatch 체인에 합집합 전달 ('None' 제외). 검증 함수(responseValidator/_food_helper)는 'Halal'/'Vegan' 문자열 처리 가능 — 값 도달만 하면 즉시 작동.
    const dietaryAll = [...new Set([...(Array.isArray(dietPrefs) ? dietPrefs : []), ...(Array.isArray(allergies) ? allergies : [])])].filter((d) => d && d !== 'None');

    // ── Phase 4 A/B test: planner mode 결정 (uid > guestEmail > sessionId) ───
    // sessionId 는 client 가 보낼 수 있는 anonymous 식별자 (현재 미사용이지만 향후
    // 비로그인 게스트 결제 흐름 대비). hash → bucket → PCT 미만이면 3pass.
    // 결정론적 — 동일 사용자 = 동일 mode 유지 (revision 도 같은 mode 사용).
    // SAFETY-CRITICAL (CLAUDE.md J): mode 결정은 dietary validation 에 영향 없음.
    // 1-pass / 3-pass 모두 동일한 validateResponse + hasCriticalDietaryViolation 적용.
    // P102 (2026-05-20): isAdminBypass 를 decidePlannerMode 에 전달 → admin Test
    // Mode 는 항상 'legacy'. 3-pass 는 Pass1+Pass2+Pass3 = 90-150s + retry 시 5분
    // cap 도달 → Test Mode 클릭 시 client 5min timeout (handlePaymentSuccess).
    // customer 흐름은 변동 없음 (isAdminBypass=false).
    // P172 (2026-05-24): identifier 1회 계산 → runGeminiPipeline + triggerPass3 양쪽 propagate (deterministic per-user).
    const identifierForBucketing = pickIdentifier({ uid, guestEmail: authenticatedEmail, sessionId });

    const abDecision = decidePlannerMode({
      uid,
      guestEmail: authenticatedEmail,
      sessionId,
      isAdminBypass: !!gate.isAdminBypass,
    });
    const PLANNER_MODE = abDecision.mode;
    resolvedPlannerMode = PLANNER_MODE;  // expose to catch-block sentry context
    console.log(
      `[planner] AB test: uid=${uid || '-'} email=${authenticatedEmail || '-'} ` +
      `mode=${abDecision.mode} reason=${abDecision.reason} ` +
      `bucket=${abDecision.bucket ?? '-'}`,
    );

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
      foodContext = getFoodContext(area, dietaryAll, priceRange, 10) || '';
      if (foodContext) console.log('[ai-planner-full] Food context injected:', foodContext.length, 'chars');
    } catch (foodErr) {
      console.warn('[ai-planner-full] getFoodContext failed:', foodErr.message);
    }
    // P190 attractions + P191 Trekking/Hallasan + P237 Running 컨텍스트 주입.
    let attractionsContext = '', mountainContext = '', runningContext = '';
    try { attractionsContext = getAttractionsContext({ city: area, styles, language, maxLocations: 6 }) || ''; } catch (e) { console.warn('[ai-planner-full] getAttractionsContext failed:', e.message); }
    try { const s = Array.isArray(styles) ? styles : []; const h = s.includes('Hallasan'); if (h || s.includes('Trekking') || s.includes('NamsanHike')) mountainContext = getMountainContextForPrompt({ regions: Array.isArray(regions) && regions.length > 0 ? regions : [area], hallaOnly: h, language, maxItems: 5 }) || ''; } catch (e) { console.warn('[ai-planner-full] getMountainContextForPrompt failed (P191):', e.message); }
    try { const s = Array.isArray(styles) ? styles : []; if (s.includes('HangangRun') || s.includes('Running')) runningContext = getRunningContextForPrompt({ cities: Array.isArray(regions) && regions.length > 0 ? regions : [area], language, maxItems: 4 }) || ''; } catch (e) { console.warn('[ai-planner-full] getRunningContextForPrompt failed (P237):', e.message); }
    const userMessage = buildUserMessage({ shaped, body, spotContext, foodContext, attractionsContext, mountainContext, runningContext });

    // ── AVOID 리스트 (최근 plan 식당 중복 방지) ────────────────────────────
    const avoidClause = await withStep('avoidClause', () => buildAvoidClause(adminDb, { uid, requestEmail }));

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
      diet: dietaryAll.join(',') || 'none',
      lang: language,
      injectedRestaurants: (foodContext.match(/•/g) || []).length,
    });

    // Block-mode (P128) — SAFETY-CRITICAL dietary unsatisfied = skipped→legacy. P240: allergies + P239: tour_start_time 의무. PR-E: mobility (활동 블록 SAFETY 거동 제약 필터, FEATURE_ACTIVITY_BLOCKS ON 시에만 효과).
    // P271: userInput 에 arrival_airport/departure_airport/pax 추가 — expand 가 arrival_guide/departure_guide minimal default 채움 (self_heal placeholder 회피).
    const _blkR = await loadFoodIndex().then((fi) => withStep('blockMode', () => tryRunBlockMode({ adminDb, regions, area, apiKey, foodIndex: fi, userInput: { durationDays, dietPrefs: dietaryAll, allergies, styles, special_request: specialRequest, language, startDate, arrival_time: arrivalTime, departure_time: departureTime, tour_start_time: tourStartTime, tour_end_time: tourEndTime, arrival_airport, departure_airport, pax, mobility } })));
    const blockModeUsed = !!(_blkR && !_blkR.skipped), blocksUsed = blockModeUsed ? (_blkR.blocks_used || []) : [];
    let itinerary = blockModeUsed ? _blkR.itinerary : null;

    // ── P169: Streaming 모드 — planId 먼저 + skeleton 저장. block-mode/3-pass 는 useStreaming=false.
    //   PLANNER_STREAMING_ENABLED + legacy 1-pass 만 활성. [P170] 세부 로직은 backgroundPipelines.js. P231: sk.skeletonCtx 반환.
    const useStreaming = shouldUseStreaming({ itinerary, plannerMode: PLANNER_MODE });
    let streamingPlanId = null;
    let streamingPlanUrl = null;
    let streamingResponseSent = false;
    let skeletonCtx = null; // P231: worker Step 0 에 전달할 full skeleton 파라미터 (ENV off 시 null)
    if (useStreaming) {
      const sk = await tryInitStreamingSkeleton({ adminDb, uid, email, area, startDate, guestName, pax, language, vehicle, durationDays, body });
      if (sk) { streamingPlanId = sk.planId; streamingPlanUrl = sk.planUrl; skeletonCtx = sk.skeletonCtx || null; }
    }

    // ── Gemini 파이프라인 (legacy or 3pass) ────────────────────────────────
    // P0-3 SAFETY-CRITICAL (CLAUDE.md J): 사용자 dietary 전달 → validateResponse 가
    // halal/vegan/vegetarian 위반 검사 → 위반 시 1회 retry → 그래도 위반이면 throw.
    // 2026-05-12 pattern validation: body 전달 → regions/arrival_airport/
    // departure_airport 기반 lodging bookend / min stops / start_time / 출국 공항
    // 검증 (B-10/B-12/B-14/B-15). 위반 시 1회 retry → 그래도 위반이면 500 throw.
    if (!itinerary) itinerary = await withStep('gemini', () => runGeminiPipeline({
      apiKey,
      systemPrompt,
      userMessage: finalUserMessage,
      area,
      language,
      mode: PLANNER_MODE,
      dietary: dietaryAll,
      // 2026-05-19: admin Test Mode (ADMIN-BYPASS- orderId) downgrades the strict
      // validatePatternStructure throw to a soft telegram alert — admin testing
      // shouldn't be blocked by Gemini non-determinism (CLAUDE.md §F intermittent
      // PLAN_VALIDATION_FAILED). Customers still get hard validation.
      isAdminBypass: !!gate.isAdminBypass,
      identifierForBucketing, // P172: PCT bucketing 입력 (admin > PCT 우선)
      body: {
        regions,
        arrival_airport,
        departure_airport,
        durationDays,
        styles, // P246: DMZ city-mismatch guard — validateResponse R-P246 needs styles
      },
      // P169: streaming 모드에서 progressive Firestore write 용
      ...(streamingPlanId ? { adminDb, planId: streamingPlanId } : {}),
    }));

    // P169/P186/P222/P319: PLANNER_STREAMING_EARLY_RESPONSE ENV 토글 (default false). Vercel serverless instance freeze 회피 (P222 hang lesson). admin-bypass _debug 포함. P319(2026-05-31): early-response=freeze 유발 → 뒤처리 워커 있을 때만(shouldDispatchToInngest) 전송, 없으면 동기(P222 ready 100% 보장) — 워커 미sync 시 stub-stuck 출시 blocker fix(P311 e2e), P318 dispatch 게이트와 동일 조건.
    if (streamingPlanId && !streamingResponseSent && shouldDispatchToInngest() && String(process.env.PLANNER_STREAMING_EARLY_RESPONSE || '').toLowerCase() === 'true') {
      const earlyDebug = buildAdminDebug({ gate, plannerMode: PLANNER_MODE, abDecision, identifierForBucketing, blockModeUsed, blocksUsed, useStreaming, itinerary });
      sendStreamingEarlyResponse({ res, CORS, planId: streamingPlanId, planUrl: streamingPlanUrl, debug: earlyDebug });
      streamingResponseSent = true;
    }

    // P230 (2026-05-27): block-mode + Inngest 통합 — skeleton + dispatch + early response 단일 helper.
    // 성공 시 handler return. dispatch 실패 시 streamingPlanId 만 받아 inline path 재사용. P231: blkInn.skeletonCtx → dispatchFn 전달.
    const blkInn = blockModeUsed && !streamingPlanId
      ? await tryBlockModeInngestPath({
          adminDb, isInngestEnabled: shouldDispatchToInngest(), blockModeUsed, itinerary, uid, email, area,
          startDate, guestName, pax, language, vehicle, durationDays, body, handlerStart,
          dispatchFn: ({ streamingPlanId: spid, skeletonCtx: spCtx }) => dispatchOrInlineForHandlerCore({
            streamingResponseSent: true, itinerary, streamingPlanId: spid, skeletonCtx: spCtx || null, apiKey, body, routeHotelAddress, hotel_address,
            arrival_airport, departure_airport, pax, recommendedZone, recommendedZoneAddress, hotelByCity,
            area, dietPrefs: dietaryAll, regions, vehicle, durationDays, uid, guestName, styles, duration, startDate, email,
            specialRequest, mobility, language, PLANNER_MODE, blockModeUsed, blocksUsed, abDecision,
            isAdminBypass: gate.isAdminBypass, identifierForBucketing, handlerStart,
          }),
          sendEarlyResponse: ({ planId, planUrl, debug }) => sendStreamingEarlyResponse({ res, CORS, planId, planUrl, debug }),
          buildDebug: () => buildAdminDebug({ gate, plannerMode: PLANNER_MODE, abDecision, identifierForBucketing, blockModeUsed, blocksUsed, useStreaming, itinerary }),
        })
      : null;
    if (blkInn && blkInn.dispatched) { streamingResponseSent = true; return; }
    if (blkInn) { streamingPlanId = blkInn.streamingPlanId; streamingPlanUrl = blkInn.streamingPlanUrl; skeletonCtx = blkInn.skeletonCtx || null; }

    // P220 (2026-05-26): Inngest dispatch — streaming + ENV + 토글 시 post-Gemini 를 별 invocation 으로. ENV/throw 시 inline fallback (silent fail 차단).
    // P230 (2026-05-27): block-mode 경로는 위에서 이미 처리 → skip. legacy streaming 만 본 분기 진입.
    // P231 (2026-05-27): skeletonCtx 전달 — worker Step 0 가 full skeleton 저장 (PLANNER_SKELETON_IN_WORKER=true 시).
    if (!blockModeUsed && await dispatchOrInlineForHandlerCore({ streamingResponseSent, itinerary, streamingPlanId, skeletonCtx, apiKey, body, routeHotelAddress, hotel_address, arrival_airport, departure_airport, pax, recommendedZone, recommendedZoneAddress, hotelByCity, area, dietPrefs: dietaryAll, regions, vehicle, durationDays, uid, guestName, styles, duration, startDate, email, specialRequest, mobility, language, PLANNER_MODE, blockModeUsed, blocksUsed, abDecision, isAdminBypass: gate.isAdminBypass, identifierForBucketing, handlerStart })) return;

    console.log('[planner] Step 2: Running RouteAgent...');

    // ── RouteAgent enrichment (mutates itinerary in place; P253: zone_id = blocksUsed[0]) ──
    await withStep('routeEnrich', () => runRouteEnrichment(itinerary, { apiKey, body, hotel_address: routeHotelAddress, arrival_airport, departure_airport, pax, recommendedZone, recommendedZoneAddress, hotelAddressFromBody: hotel_address, tourEndTime, zone_id: blockModeUsed ? (blocksUsed[0] || null) : null }));

    console.log('[planner] Step 3: Saving to Firestore...');

    // ── Backfills + T-money + recommended restaurants + pricing ───────────
    // P290 (2026-05-29): ctx 확장 (hotel_address / hotelAddressFromBody / recommendedZone) — selfHealLodgingBookend personalize. day.lodging 없는 block_mode plan 의 synthesized lodging stop 에 사용자 입력 호텔 반영.
    applyBackfillsAndTmoney(itinerary, { hotelByCity, body, hotel_address: routeHotelAddress, hotelAddressFromBody: hotel_address, recommendedZone, language, blockMode: blockModeUsed });

    // ── Must-visit 맛집 추천 ──────────────────────────────────────────────
    const foodIndexForQuality = await applyRecommendedRestaurants(itinerary, { area, dietPrefs: dietaryAll, regions, blockModeUsed });

    // ── 가격 계산 ────────────────────────────────────────────────────────
    const { priceKRW, priceUSD } = computePricing(vehicle, durationDays);

    // ── Firestore 저장 + Loyalty ──────────────────────────────────────────
    // Phase 4 (2026-05-13): plannerMode + abReason + abBucket — admin
    // dashboard 에서 mode 별 qualityScore 비교 위함. legacy vs 3-pass 평균
    // 차이 + diet/unverified/route 카운트 차이를 운영자가 직접 확인 가능.
    const { planId, planUrl } = await withStep('persistPlan', () => savePlan(adminDb, {
      body, itinerary, uid, vehicle, priceKRW, priceUSD,
      guestName, pax, styles, area, duration, startDate, email,
      specialRequest, arrival_airport, departure_airport,
      hotel_address, mobility, language,
      dietary: dietaryAll, foodIndex: foodIndexForQuality,
      cacheMetadata: itinerary?._cache_metadata || null,  // P266: P195 cache instrumentation explicit pass-through (geminiPipeline:1515 attach → debugInfo:42 pop 전)
      plannerMode: blockModeUsed ? 'block_mode' : PLANNER_MODE,  // P128 block-mode trace
      abReason: abDecision.reason, abBucket: abDecision.bucket,
      blocksUsed: blockModeUsed ? blocksUsed : null,
      ...(streamingPlanId ? { planIdOverride: streamingPlanId } : {}),  // P169: streaming 모드 skeleton planId 재사용
    }));

    // ── P168/P170/P171/P172/P173: Pass3 background trigger (fire-and-forget; backgroundPipelines.js 추출; gate.isAdminBypass 명시 전달)
    triggerPass3BackgroundIfPending({ adminDb, planId, language, apiKey, itinerary, isAdminBypass: !!gate.isAdminBypass, identifierForBucketing });

    // ── JSON 응답 ────────────────────────────────────────────────────────
    // P169: streaming 모드에서는 이미 early response 전송 완료 → skip.
    // 비스트리밍 모드 (기존 흐름) 에서만 여기서 response 전송.
    if (!streamingResponseSent) {
      // P177/P195: admin-bypass 한정 _debug 노출 (model + cache hit rate). debugInfo.js#buildAdminDebug.
      const debug = buildAdminDebug({ gate, plannerMode: PLANNER_MODE, abDecision, identifierForBucketing, blockModeUsed, blocksUsed, useStreaming, itinerary });
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(_ok({
        planId, planUrl, firestoreSaved: true, emailSent: !!email, itinerary,
        pricing: { vehicle, vehicleLabel: VEHICLE_LABELS[vehicle] || VEHICLE_LABELS.staria_8, priceKRW, priceUSD, currency: 'KRW' },
        ...(debug ? { _debug: debug } : {}),
      })));
    } else {
      // P169: streaming 모드 — background pipeline 완료. Firestore 는 persistPlan 이 update 완료.
      console.log('[planner P169] Background pipeline completed. Plan finalized in Firestore:', planId);
    }

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
    import('../_plan-ready-push.js').then(({ sendPlanCreatedTelegram, sendPlanReadyPush }) => {
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
          message: `🔴 <b>AI 플래너 처리 실패</b>\n\n${error.message || '알 수 없는 오류'}\n\n경로: /api/ai-planner-full | 모드: ${resolvedPlannerMode}`,
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
  } finally {
    // P96: 정상 완료 + error path 모두에서 4분30초 hang alert timer 해제.
    clearTimeout(hangWarnTimer);
  }
}
