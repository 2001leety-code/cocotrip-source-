/**
 * Inngest dispatch helper — P220 (2026-05-26).
 *
 * handlerCore.js 가 post-Gemini pipeline 을 Inngest worker 로 분기할지 결정.
 *   - INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY 둘 다 설정 → Inngest dispatch
 *   - 누락 → false 반환 → handlerCore 가 기존 inline pipeline 진행 (silent fail 방지)
 *
 * SAFETY-CRITICAL (CLAUDE.md J): 본 모듈은 dietary validation 을 안 한다.
 *   - dispatch 시점 = runGeminiPipeline 이 이미 validateResponse 통과한 후.
 *   - dispatch payload 의 dietary 는 worker 의 persistPlan 의 doc 저장용만.
 *
 * 환각 차단:
 *   - inngest.send() 시그니처 = { name, data } (Inngest SDK 공식 — context7 docs).
 *   - INNGEST_EVENTS.PLAN_AI_COMPLETE = 'plan/ai.complete' (client.js export 상수).
 */
import { inngest, isInngestConfigured, INNGEST_EVENTS } from '../_inngest/client.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';

/**
 * Inngest 활성화 여부 + 환경 의도 검사.
 *
 * P220: PLANNER_INNGEST_ENABLED env 토글 (default OFF) — 운영자가 Inngest ENV 만
 *   추가한 후에도 inline pipeline 으로 계속 운영 가능. 점진 ramp 전략:
 *     Phase A: ENV 만 추가 → Inngest dashboard 에 dry-run 도착 검증
 *     Phase B: PLANNER_INNGEST_ENABLED=true → 실제 dispatch 시작
 *
 * @returns {boolean} true = Inngest dispatch 진행, false = inline fallback.
 */
export function shouldDispatchToInngest() {
  if (!isInngestConfigured()) return false;
  // P318 (2026-05-31): dispatch only when ALL three hold — otherwise inline
  // (handlerCore persistPlan, the PROVEN delivery path). Background:
  //   (a) VERCEL_ENV='production' — preview/branch deploys use a SEPARATE Inngest
  //       env (별도 INNGEST_EVENT_KEY) with NO synced worker → dispatched events sit
  //       unhandled → plan stub never finalized (days=0) → P292 sweep → error
  //       ("결제했는데 plan 안 나옴"). Confirmed in the 2026-05-31 P311 sandbox e2e:
  //       preview plans dispatched but never persisted (0 worker events).
  //   (b) PLANNER_INNGEST_WORKER_SYNCED='true' — explicit confirmation that the prod
  //       Inngest app is synced AND a worker run has succeeded. This is P220 ramp
  //       "Phase A" (dispatch-arrival 검증) which was skipped when the toggle was
  //       enabled. Default UNSET → inline everywhere → guaranteed delivery. Flip to
  //       'true' only AFTER verifying Inngest Cloud sync + one successful
  //       processPlanAfterAI run (app.inngest.com → prod env → Apps).
  //   (c) PLANNER_INNGEST_ENABLED='true' — operator ramp toggle (P220).
  // Current prod traffic is admin-bypass LEGACY (never dispatches) → this gate has
  // ZERO impact on existing traffic; it only routes future real-payment streaming
  // plans onto the proven inline path until the worker is verified.
  if (String(process.env.VERCEL_ENV || '').toLowerCase() !== 'production') return false;
  const synced = String(process.env.PLANNER_INNGEST_WORKER_SYNCED || '').toLowerCase();
  if (synced !== 'true' && synced !== '1') return false;
  const enabled = String(process.env.PLANNER_INNGEST_ENABLED || '').toLowerCase();
  return enabled === 'true' || enabled === '1';
}

/**
 * `plan/ai.complete` event 발행.
 *
 * 호출 시점: handlerCore.js 가 Gemini 호출 + validateResponse + dbMatcher 완료 후.
 * 이 시점에 client 에는 streaming planId (P169) 를 이미 전송한 상태 가능. worker
 * 가 그 planId 를 재사용해 set merge 로 enrichment 완성 후 status='ready' 마킹.
 *
 * @param {{ planId?: string, itinerary: object, ctx: object }} payload
 * @returns {Promise<{ ids: string[] }>} Inngest SDK 반환값 (event ID 목록)
 *
 * 실패 처리:
 *   - send() 가 throw 하면 handlerCore 의 catch 블록이 inline fallback 으로 전환.
 *   - alert telegram — 외부 의존성 down 추적.
 */
export async function publishPlanAiComplete(payload) {
  try {
    const result = await inngest.send({
      name: INNGEST_EVENTS.PLAN_AI_COMPLETE,
      data: payload,
    });
    return result;
  } catch (err) {
    // throttledTelegramAlert 5min dedup — Inngest 외부 down 시 storm 방지.
    throttledTelegramAlert({
      key: 'inngest-send-fail',
      channel: 'admin',
      severity: 'high',
      message: `Inngest send() 실패 (P220) — inline fallback 진행. err=${err.message}`,
    }).catch(() => {});
    throw err;
  }
}

/**
 * P220: handlerCore.js 가 dispatch 시 payload 를 한 줄로 호출하도록 빌더 헬퍼.
 *
 * handlerCore 의 inline pipeline 과 동일한 변수 그룹을 받아 inngestDispatch payload
 * 로 정규화. handlerCore.js 의 P129 line cap (500L) 보호 위해 별도 모듈로 추출.
 *
 * P231 (2026-05-27): skeletonCtx 포함 — skeleton-in-worker 모드 시 worker Step 0
 *   가 full skeleton 저장. skeletonCtx 없으면 (ENV off) worker 가 무시.
 *
 * @param {object} args  - handlerCore scope 의 변수 집합 (shaped + computed)
 * @returns {{ planId, itinerary, ctx }} publishPlanAiComplete() 입력
 */
export function buildPlanAiCompletePayload(args) {
  const {
    itinerary,
    streamingPlanId,
    skeletonCtx,      // P231: skeleton-in-worker 모드 시 full skeleton 파라미터. undefined = 기존 동작.
    apiKey, body,
    routeHotelAddress, hotelAddressFromBody,
    arrival_airport, departure_airport, pax,
    recommendedZone, recommendedZoneAddress,
    hotelByCity,
    area, dietPrefs, regions,
    vehicle, durationDays,
    uid, guestName, styles, duration, startDate, email,
    specialRequest, mobility, language,
    plannerMode, abReason, abBucket, blocksUsed,
    isAdminBypass, identifierForBucketing,
    forceGuestToken,  // FEATURE_GUEST_ANON_AUTH: worker persistPlan accessToken 발급용.
  } = args;

  // P256 (2026-05-28): zone_id 도출 — Inngest worker 의 4번째 layer fix.
  //   P253 가 sync path (handlerCore L376 → postResponsePipeline → routeEnrichment) 만 fix.
  //   block_mode plan 은 Inngest worker (processPlanAfterAI.js) 가 runRouteEnrichment 호출
  //   → ctx 에 zone_id 가 없어서 cache miss 계속 발생 (P251/P253 round 1+2 모두 cache 0%).
  //   본 라인 = blocksUsed[0] 추출해서 ctx.zone_id 로 worker 에 전달.
  //   다도시 plan 은 dayPlan.source_block_id per-day fallback (RouteAgent.js L787) 으로 보완.
  const zone_id = (plannerMode === 'block_mode' && Array.isArray(blocksUsed) && blocksUsed.length > 0)
    ? blocksUsed[0]
    : null;

  // P266 (2026-05-28): P195 cache instrumentation explicit pass-through —
  //   itinerary._cache_metadata hidden mutation 이 Inngest event payload serialize/deserialize 통과
  //   하지만 worker step.run 의 step output store 로 next step 에 넘어가는 과정에서 reconstruction
  //   layer 가 stamped marker 누락 가능 (5/28 P259 lesson 와 동일 함정). ctx 의 명시적 field 로
  //   pass-through 하면 worker savePlan 호출 site 가 itinerary 의 hidden field 의존 없이 안전 persist.
  const cacheMetadata = (itinerary && itinerary._cache_metadata) || null;

  return {
    planId: streamingPlanId,
    itinerary,
    ctx: {
      apiKey, body,
      hotel_address: routeHotelAddress,
      arrival_airport, departure_airport, pax,
      recommendedZone, recommendedZoneAddress,
      hotelAddressFromBody,
      hotelByCity,
      area, dietPrefs, regions,
      vehicle, durationDays,
      uid, guestName, styles, duration, startDate, email,
      specialRequest, mobility, language,
      plannerMode, abReason, abBucket, blocksUsed,
      zone_id,  // P256: Inngest worker layer 4 — transit cache hit 0% round 3 fix
      streamingPlanId,
      isAdminBypass: !!isAdminBypass,
      identifierForBucketing,
      // FEATURE_GUEST_ANON_AUTH: 게스트 익명 소유자 uid 면 true → worker persistPlan/skeleton 이
      // accessToken 발급. undefined/false (플래그 OFF) = 기존 동작 byte-identical.
      forceGuestToken: !!forceGuestToken,
      // P266: P195 cache instrumentation persistence — measure marker survives reconstruction layer.
      //   null = block_mode / 3pass / non-Gemini path. numeric object = legacy 1-pass measurement.
      ...(cacheMetadata ? { cacheMetadata } : {}),
      // P231: skeleton-in-worker 모드 시 full skeleton 파라미터 전달.
      // worker Step 0 가 skeletonCtx 있으면 savePlanSkeleton 호출 (stub → full skeleton).
      // skeletonCtx 없으면 (ENV off) worker 가 무시 — backward compat.
      ...(skeletonCtx ? { skeletonCtx } : {}),
    },
  };
}

/**
 * P220: handlerCore.js 가 호출하는 dispatch + fallback 통합 헬퍼.
 *
 * shouldDispatchToInngest() 가 false 면 즉시 false 반환 (inline fallback).
 * send() 가 throw 하면 alert 발사 + false 반환 — handlerCore 가 inline fallback 진행.
 *
 * silent fail 차단 규칙 (CLAUDE.md):
 *   - throw 안 함 (handlerCore 의 catch 블록 abort 회피).
 *   - 단순 boolean — handlerCore 가 분기.
 *
 * @param {object} args - buildPlanAiCompletePayload 와 동일 입력
 * @returns {Promise<boolean>} true = Inngest dispatch 성공 (post-response skip), false = inline fallback
 */
export async function tryDispatchOrFallback(args) {
  if (!shouldDispatchToInngest()) return false;
  // P226 (2026-05-27): non-streaming 요청 보호 — streamingPlanId 없으면 worker 가 처리할
  //   planId 가 없음. P222 가 early response 폐기 후 streaming 분기에서도 streamingPlanId
  //   는 유지되므로 본 가드는 P226 의 maybeDispatchToInngest gate 제거 안전판 (non-streaming
  //   path 에서 dispatch 시도 시 worker payload 가 invalid).
  if (!args.streamingPlanId) return false;
  try {
    const payload = buildPlanAiCompletePayload(args);
    await publishPlanAiComplete(payload);
    console.log('[planner P220] Inngest worker dispatched. Skipping inline post-response pipeline.');
    return true;
  } catch (dispatchErr) {
    console.error('[planner P220] Inngest dispatch failed — falling back to inline pipeline:', dispatchErr.message);
    return false;
  }
}

/**
 * P220: handlerCore.js 의 line cap (P129 500L) 보호 — streaming response 가 이미 전송된
 * 상태인지 + Inngest dispatch 가능 여부를 한 줄에 결정.
 *
 * handlerCore 가 그냥 `if (await maybeDispatchToInngest(args)) return;` 한 줄로 사용.
 *
 * @returns {Promise<boolean>} true = dispatched (handler 즉시 종료), false = inline 계속
 */
export async function maybeDispatchToInngest(args) {
  // P226 (2026-05-27): streamingResponseSent 가드 제거. P222 가 early response 폐기 후
  //   streamingResponseSent=false 가 default → 본 가드가 Inngest dispatch 차단 → inline +21s.
  //   tryDispatchOrFallback 내부의 shouldDispatchToInngest() (ENV + PLANNER_INNGEST_ENABLED)
  //   가 이미 guard 역할 + streamingPlanId null 보호 추가됨.
  //   결과: Inngest 활성 시 dispatch + worker durable (status='ready' 보장) + HTTP latency 회복.
  return tryDispatchOrFallback(args);
}

/**
 * P220: handlerCore.js line cap (500L) 보호 — dispatch + early return 을 한 함수로.
 * handlerCore 의 scope 변수들을 그대로 받아 dispatch 시도 + dispatched 면 console.log 까지.
 *
 * @param {object} scope - handlerCore 의 const/let 변수 묶음
 * @returns {Promise<boolean>} true = handler 즉시 return, false = inline 계속
 */
export async function tryDispatchAndLog(scope, handlerStart) {
  const dispatched = await maybeDispatchToInngest(scope);
  if (dispatched) console.log('[planner] === TOTAL:', Date.now() - handlerStart, 'ms (P220 dispatched) ===');
  return dispatched;
}

/**
 * P220: handlerCore.js line cap 보호 (단일 호출). handlerCore 의 scope 변수들을
 * shorthand 로 받아 plannerMode/abReason/abBucket/blocksUsed 정규화 + dispatch.
 *
 * 운영자 의도: handlerCore 가 한 줄로 dispatch — 추가 줄 압박 없음. P220 cycle 외부에서
 * 들어오는 scope 객체는 호출자 책임 (handlerCore 가 단일 진입점).
 */
export async function dispatchOrInlineForHandlerCore({
  streamingResponseSent, itinerary, streamingPlanId,
  skeletonCtx,  // P231: skeleton-in-worker 모드 시 full skeleton 파라미터. null = 기존 동작.
  apiKey, body, routeHotelAddress, hotel_address,
  arrival_airport, departure_airport, pax, recommendedZone, recommendedZoneAddress, hotelByCity,
  area, dietPrefs, regions, vehicle, durationDays, uid, guestName, styles, duration, startDate, email,
  specialRequest, mobility, language, PLANNER_MODE, blockModeUsed, blocksUsed,
  abDecision, isAdminBypass, identifierForBucketing, handlerStart,
  // FEATURE_GUEST_ANON_AUTH: 게스트 익명 소유자 uid (=planOwnerUid) 가 부여된 경우 true.
  // worker persistPlan/skeleton 이 accessToken 발급. 플래그 OFF (handlerCore 기본) 시 false.
  forceGuestToken = false,
}) {
  return tryDispatchAndLog({
    streamingResponseSent, itinerary, streamingPlanId, skeletonCtx: skeletonCtx || undefined,
    apiKey, body, routeHotelAddress, hotelAddressFromBody: hotel_address,
    arrival_airport, departure_airport, pax, recommendedZone, recommendedZoneAddress, hotelByCity,
    area, dietPrefs, regions, vehicle, durationDays, uid, guestName, styles, duration, startDate, email,
    specialRequest, mobility, language,
    plannerMode: blockModeUsed ? 'block_mode' : PLANNER_MODE,
    abReason: abDecision.reason, abBucket: abDecision.bucket,
    blocksUsed: blockModeUsed ? blocksUsed : null,
    isAdminBypass, identifierForBucketing, forceGuestToken,
  }, handlerStart);
}
