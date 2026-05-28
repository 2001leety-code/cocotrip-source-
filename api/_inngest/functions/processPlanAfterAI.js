/**
 * Inngest worker — P220 (2026-05-26).
 *
 * Event: `plan/ai.complete` (handlerCore.js 에서 Gemini + DB match 완료 직후 발행)
 *
 * 흐름 (각 step 별도 retry + Inngest 자체 timeout):
 *   0. skeleton-write     — P231 (2026-05-27): PLANNER_SKELETON_IN_WORKER=true 시만 실행.
 *                           HTTP handler 가 저장한 stub doc 을 full skeleton 으로 업그레이드.
 *                           skeletonCtx 없으면 (ENV off) skip. 실패해도 non-fatal.
 *   1. routeEnrich        — Naver Geocoding + ODsay Transit + lodging bookend
 *   2. backfillsAndTmoney — end_time / day.lodging / cross-city / T-money
 *   3. recommendedFood    — DB 기반 maxlocal-rating 식당 추천 (Gemini 미경유)
 *   4. computePricing     — KRW + USD
 *   5. persistPlan        — Firestore set merge + Loyalty (gRPC retry 가능)
 *   6. updateStatus       — _inngest_status='ready' Firestore mark + non-blocking notifications
 *
 * SAFETY-CRITICAL (CLAUDE.md J): 본 worker 는 dietary validation 을 다시 안 한다.
 *   - handlerCore.js 의 runGeminiPipeline 이 이미 validateResponse + halal/vegan
 *     critical violation throw 수행.
 *   - worker 는 enrich + persist 만. payload 의 dietary 는 persistPlan 의 doc 저장용만.
 *
 * Retry policy:
 *   - 각 step.run() 자체 3회 retry (Inngest 기본). step.run id 별 idempotency.
 *   - persistPlan 의 gRPC DEADLINE_EXCEEDED → Inngest retry 가 5min 후 재시도 → 결국 성공.
 *   - routeEnrich 의 27분 hang → Promise.race(180s cap) 유지 (P203 cap 그대로 import).
 *
 * 환각 차단 (운영자 의무 grep 검증 필수):
 *   - import path 는 모두 ../../_ai_core/* (worktree root 기준).
 *   - postResponsePipeline.js export 함수명: runRouteEnrichment / applyBackfillsAndTmoney /
 *     applyRecommendedRestaurants / computePricing / savePlan.
 *
 * Vercel 환경:
 *   - 본 함수는 api/inngest.js 의 serve() 로 expose. Vercel function timeout = 300s
 *     기본 + Fluid Compute = 800s (handlerCore P165 패턴 동일).
 *   - 단, Inngest 는 각 step.run() 을 별도 invocation 으로 호출 → 누적 시간 무관.
 *     1 step 당 300s 이내면 OK (routeEnrich 180s cap 으로 안전).
 */
import { inngest } from '../client.js';
import { initAdminDb } from '../../_ai_core/firestoreAdmin.js';
import {
  runRouteEnrichment,
  applyBackfillsAndTmoney,
  applyRecommendedRestaurants,
  computePricing,
  savePlan,
} from '../../_ai_core/postResponsePipeline.js';
import { triggerPass3BackgroundIfPending } from '../../_ai_core/backgroundPipelines.js';
import { savePlanSkeleton } from '../../_ai_core/planPersister.js'; // P231: stub → full skeleton 업그레이드
import { VEHICLE_LABELS } from '../../_ai_core/vehicleAndPrice.js';
import { sendNotificationEmail, recordLeadToSheets } from '../../_ai_core/emailNotifier.js';
import { throttledTelegramAlert } from '../../_shared/telegram-throttle.js';

const adminDb = initAdminDb();

/**
 * Worker: routeEnrich → backfill+T-money → recommended_restaurants → persist.
 *
 * Event payload shape (handlerCore.js publishPlanAiComplete() 가 생성):
 *   {
 *     planId,                       // streaming skeleton planId (있으면) 또는 randomUUID
 *     itinerary,                    // Gemini + dbMatcher + 검증 완료 결과
 *     ctx: {
 *       // RouteAgent input
 *       apiKey, body, hotel_address, arrival_airport, departure_airport, pax,
 *       recommendedZone, recommendedZoneAddress, hotelAddressFromBody,
 *       hotelByCity,
 *       // recommended_restaurants input
 *       area, dietPrefs, regions,
 *       // pricing input
 *       vehicle, durationDays,
 *       // persistPlan input
 *       uid, guestName, styles, duration, startDate, email,
 *       specialRequest, mobility, language,
 *       plannerMode, abReason, abBucket, blocksUsed,
 *       streamingPlanId,            // P169 skeleton 재사용
 *       // Pass3 background trigger input
 *       isAdminBypass, identifierForBucketing,
 *       // P231: skeleton-in-worker — HTTP handler 가 stub doc 만 저장 후 full skeleton 파라미터 전달.
 *       //   skeletonCtx 있으면 Step 0 에서 savePlanSkeleton 호출 (stub → full skeleton 업그레이드).
 *       //   skeletonCtx 없으면 (ENV off, 기존 동작) Step 0 skip.
 *       skeletonCtx?,               // { uid, email, area, startDate, guestName, pax, language, vehicle, priceKRW, priceUSD, body, blockModeItinerary? }
 *     },
 *   }
 */
export const processPlanAfterAI = inngest.createFunction(
  {
    id: 'process-plan-after-ai',
    name: 'Plan post-AI pipeline (routeEnrich + persist)',
    // P221 (2026-05-26): Inngest v4 createFunction 시그니처 — triggers 를
    // 첫 인자 안에 포함. v3 의 3-arg form (config, trigger, handler) 은 v4 에서
    // throw "expected a handler function as the second argument".
    triggers: [{ event: 'plan/ai.complete' }],
    // P220: 운영자 후속 액션 — Inngest 대시보드에서 동시 실행 제한 설정 가능.
    //   기본은 무제한. Vercel 동시 function invocation 한도 (Pro: 1000) 고려.
  },
  async ({ event, step, logger }) => {
    const { planId: eventPlanId, itinerary, ctx } = event.data;
    const startMs = Date.now();
    logger.info(`[P220] worker start: planId=${eventPlanId || '(new)'}, days=${(itinerary?.days || []).length}`);

    // ── Step 0 (P231): skeleton-write — stub doc → full skeleton 업그레이드 ────
    // HTTP handler 가 PLANNER_SKELETON_IN_WORKER=true 시 stub doc 만 저장하고 full skeleton
    // 파라미터를 ctx.skeletonCtx 로 전달. 본 step 이 savePlanSkeleton 으로 full skeleton 을
    // set merge 해서 stub 을 교체 → PlanDetailPage 가 tour_title / days 등 즉시 표시 가능.
    //
    // skeletonCtx 없으면 (ENV off = 기존 동작) step 전체 skip (step ID 'skeleton-write' 신규
    // → 기존 replay 에서 memoized 값 없음 = 신규 실행). ENV off 시 ctx.skeletonCtx = undefined.
    //
    // SAFETY (CLAUDE.md J): dietary 흐름 무관 — 단순 Firestore meta write.
    // 역할: "접수증 → 풀 인수인계 문서 교체" (stub 이 접수증, full skeleton 이 인수인계 문서).
    if (ctx.skeletonCtx) {
      await step.run('skeleton-write', async () => {
        const planIdForSkeleton = ctx.streamingPlanId || eventPlanId;
        if (!planIdForSkeleton) {
          logger.warn('[P231] skeleton-write: planId 없음, skip');
          return null;
        }
        try {
          // savePlanSkeleton 은 새 planId 를 생성하므로 직접 호출 불가.
          // 대신 skeletonCtx 의 파라미터로 full skeleton doc 을 merge 구성.
          const { uid, email, area, startDate, guestName, pax, language,
                  vehicle, priceKRW, priceUSD, body: skBody, blockModeItinerary } = ctx.skeletonCtx;
          const fullDoc = {
            planId: planIdForSkeleton,
            status: 'streaming',
            _streaming_in_progress: true,
            _streaming_started_at: ctx.skeletonCtx._streaming_started_at || Date.now(),
            isPublic: false,
            createdAt: new Date().toISOString(),
            createdAtMs: Date.now(),
            uid: uid || null,
            guestEmail: email || null,
            input: {
              guestName: guestName || 'Guest',
              pax: pax || 2,
              styles: Array.isArray(skBody?.styles) ? skBody.styles : [],
              area: area || null,
              startDate: startDate || null,
              language: language || 'en',
              vehicle: vehicle || null,
              regions: Array.isArray(skBody?.regions) && skBody.regions.length > 0 ? skBody.regions : (area ? [area] : []),
            },
            pricing: { vehicle, priceKRW: priceKRW || 0, priceUSD: priceUSD || 0 },
            revisionCredits: 2,
            revisionCount: 0,
            // block-mode itinerary 있으면 days 미리 채움 (PlanDetailPage 즉시 표시).
            // 없으면 빈 skeleton (legacy streaming 경우).
            itinerary: blockModeItinerary
              ? { ...blockModeItinerary, _streaming_skeleton: true }
              : { tour_title: null, days: [], _streaming_skeleton: true },
            ...(blockModeItinerary ? { _block_mode_used: true } : {}),
            _p231_stub: false, // stub 교체 완료 표시
          };
          await adminDb.collection('plans').doc(planIdForSkeleton).set(fullDoc, { merge: true });
          logger.info(`[P231] skeleton-write done: planId=${planIdForSkeleton}`);
          return { planId: planIdForSkeleton };
        } catch (skErr) {
          // full skeleton 저장 실패 — stub doc 은 살아있으므로 client 404 안 남.
          // routeEnrich + persistPlan 은 계속 진행 (non-fatal).
          logger.warn(`[P231] skeleton-write failed (non-fatal): ${skErr.message}`);
          throttledTelegramAlert({
            key: `p231-skeleton-write-fail:${planIdForSkeleton}`,
            channel: 'admin',
            severity: 'low',
            message: `P231 skeleton-write step 실패 (non-fatal). planId=${planIdForSkeleton}, err=${skErr.message}. stub doc 유지 → persistPlan 이 set merge 로 완성.`,
          }).catch(() => {});
          return null;
        }
      });
    }

    // ── Step 1: routeEnrich (180s wall-clock cap 유지) ────────────────────────
    // runRouteEnrichment 가 in-place mutation 이라 step.run 의 반환값은 사용 X.
    // 단, Inngest 가 step output 으로 itinerary 를 serialize 해서 다음 step 으로 넘김.
    // → 명시적 return 으로 mutation 결과 전파.
    const itinAfterRoute = await step.run('routeEnrich', async () => {
      await runRouteEnrichment(itinerary, {
        apiKey: ctx.apiKey,
        body: ctx.body,
        hotel_address: ctx.hotel_address,
        arrival_airport: ctx.arrival_airport,
        departure_airport: ctx.departure_airport,
        pax: ctx.pax,
        recommendedZone: ctx.recommendedZone,
        recommendedZoneAddress: ctx.recommendedZoneAddress,
        hotelAddressFromBody: ctx.hotelAddressFromBody,
        // P256 (2026-05-28): zone_id pass-through — Inngest worker layer 4 fix.
        //   P253 가 sync path 만 fix 했고 block_mode plan 은 Inngest 경유 → cache 0% 유지.
        //   ctx.zone_id 는 inngestDispatch.buildPlanAiCompletePayload 가 blocksUsed[0] 로 채움.
        //   다도시는 RouteAgent dayPlan.source_block_id per-day fallback 으로 보완.
        zone_id: ctx.zone_id || null,
      });
      return itinerary;
    });

    // ── Step 2: backfills + T-money ──────────────────────────────────────────
    const itinAfterBackfill = await step.run('backfillsAndTmoney', () => {
      applyBackfillsAndTmoney(itinAfterRoute, { hotelByCity: ctx.hotelByCity, body: ctx.body });
      return itinAfterRoute;
    });

    // ── Step 3: recommended_restaurants ──────────────────────────────────────
    const foodIndexForQuality = await step.run('recommendedRestaurants', async () => {
      return applyRecommendedRestaurants(itinAfterBackfill, {
        area: ctx.area,
        dietPrefs: ctx.dietPrefs,
        regions: ctx.regions,
      });
    });

    // ── Step 4: pricing ──────────────────────────────────────────────────────
    const { priceKRW, priceUSD } = await step.run('computePricing', () => {
      return computePricing(ctx.vehicle, ctx.durationDays);
    });

    // ── Step 5: persistPlan (Firestore — gRPC retry 가능) ────────────────────
    // P181 alert "Plan save failed (4)" = DEADLINE_EXCEEDED 가 본 step 에서 발생.
    // Inngest retry 정책으로 5분 후 재시도 → 거의 항상 성공.
    const { planId, planUrl } = await step.run('persistPlan', async () => {
      return savePlan(adminDb, {
        body: ctx.body,
        itinerary: itinAfterBackfill,
        uid: ctx.uid,
        vehicle: ctx.vehicle,
        priceKRW,
        priceUSD,
        guestName: ctx.guestName,
        pax: ctx.pax,
        styles: ctx.styles,
        area: ctx.area,
        duration: ctx.duration,
        startDate: ctx.startDate,
        email: ctx.email,
        specialRequest: ctx.specialRequest,
        arrival_airport: ctx.arrival_airport,
        departure_airport: ctx.departure_airport,
        hotel_address: ctx.hotel_address,
        mobility: ctx.mobility,
        language: ctx.language,
        dietary: ctx.dietPrefs,
        foodIndex: foodIndexForQuality,
        plannerMode: ctx.plannerMode,
        abReason: ctx.abReason,
        abBucket: ctx.abBucket,
        blocksUsed: ctx.blocksUsed,
        ...(ctx.streamingPlanId ? { planIdOverride: ctx.streamingPlanId } : (eventPlanId ? { planIdOverride: eventPlanId } : {})),
        // P266 (2026-05-28): P195 cache instrumentation persistence — worker savePlan explicit pass-through.
        //   ctx.cacheMetadata = inngestDispatch.buildPlanAiCompletePayload 가 itinerary._cache_metadata 에서 추출.
        //   fallback: itinAfterBackfill._cache_metadata (step output store reconstruction 통과한 경우)
        //   둘 다 없으면 null → persistPlan silent skip (block_mode / non-Gemini).
        cacheMetadata: ctx.cacheMetadata || itinAfterBackfill?._cache_metadata || null,
      });
    });

    // ── Step 6: Pass3 background + notifications (non-blocking, fire-and-forget) ─
    // 본 step 은 retry 무의미 (e-mail 발송 / push 등은 외부 시스템 idempotency 없음).
    // step.run 안에 가두지 말고 직접 호출 (1회 시도).
    triggerPass3BackgroundIfPending({
      adminDb,
      planId,
      language: ctx.language,
      apiKey: ctx.apiKey,
      itinerary: itinAfterBackfill,
      isAdminBypass: !!ctx.isAdminBypass,
      identifierForBucketing: ctx.identifierForBucketing,
    });

    if (ctx.email) {
      sendNotificationEmail({
        email: ctx.email,
        guestName: ctx.guestName,
        tourTitle: itinAfterBackfill.tour_title || `${ctx.guestName}'s Korea Itinerary`,
        planId,
        planUrl,
      }).catch((e) => logger.warn(`[P220] email error: ${e.message}`));

      recordLeadToSheets({
        email: ctx.email,
        guestName: ctx.guestName,
        area: ctx.area,
        styles: ctx.styles,
        pax: ctx.pax,
        planId,
      }).catch((e) => logger.warn(`[P220] sheets error: ${e.message}`));
    }

    // Telegram + Web Push (handlerCore.js L446-449 와 동일 패턴)
    import('../../_plan-ready-push.js').then(({ sendPlanCreatedTelegram, sendPlanReadyPush }) => {
      sendPlanCreatedTelegram({
        guestName: ctx.guestName,
        email: ctx.email,
        area: ctx.area,
        durationDays: ctx.durationDays,
        pax: ctx.pax,
        planId,
      });
      if (ctx.uid) {
        sendPlanReadyPush(adminDb, ctx.uid, {
          planId,
          planUrl,
          tourTitle: itinAfterBackfill.tour_title,
          language: ctx.language,
        });
      }
    }).catch(() => {});

    const elapsedMs = Date.now() - startMs;
    logger.info(`[P220] worker done: planId=${planId}, elapsed=${elapsedMs}ms`);

    // step.run 으로 wrap 안 한 status flag — Inngest 자동 onSuccess 가 안 박힘.
    // PlanDetailPage onSnapshot listener 가 _inngest_status='ready' 감지 → 화면 자동 갱신.
    try {
      await adminDb.collection('plans').doc(planId).set(
        {
          _inngest_status: 'ready',
          _inngest_completed_at: new Date().toISOString(),
          _inngest_elapsed_ms: elapsedMs,
        },
        { merge: true },
      );
    } catch (markErr) {
      logger.warn(`[P220] status mark failed (non-fatal): ${markErr.message}`);
      // alert — 사용자 화면 자동 갱신 실패 가능성 (plan 자체는 정상 저장됨).
      throttledTelegramAlert({
        key: `inngest-status-mark-fail:${planId}`,
        channel: 'admin',
        severity: 'low',
        message: `Inngest worker 완료 후 _inngest_status mark 실패. planId=${planId}, err=${markErr.message}`,
      }).catch(() => {});
    }

    return {
      planId,
      planUrl,
      elapsedMs,
      priceKRW,
      priceUSD,
      vehicleLabel: VEHICLE_LABELS[ctx.vehicle] || VEHICLE_LABELS.staria_8,
    };
  },
);
