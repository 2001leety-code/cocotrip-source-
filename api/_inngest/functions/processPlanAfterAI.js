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
import { randomUUID } from 'crypto'; // FEATURE_GUEST_ANON_AUTH: 게스트 익명 skeleton accessToken 발급용
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
import { releasePlanIssuance } from '../../_shared/plan-issuance.js'; // P0: onFailure 시 발급권 해제
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
    // P307 (2026-05-30, audit B8): worker 모든 step retry 소진 후 최종 실패 시
    // Inngest 가 onFailure 호출. status='error' + _streaming_in_progress=false 즉시
    // 마킹 → 사용자 stuck 노출 단축 (P292 30분 sweep net 보완).
    // SAFETY (CLAUDE.md J): dietary validation 무관 — Firestore status mark 만.
    onFailure: async ({ event, error }) => {
      const planId = event?.data?.event?.data?.planId || event?.data?.planId;
      if (!planId) {
        console.warn('[P307] onFailure: planId 없음 — skip');
        return;
      }
      try {
        await adminDb.collection('plans').doc(planId).set(
          {
            status: 'error',
            _streaming_in_progress: false,
            _streaming_error: 'inngest_worker_failure_p307',
            _streaming_error_message: (error?.message || 'unknown').slice(0, 500),
            _failed_at: new Date().toISOString(),
          },
          { merge: true },
        );
        console.warn(`[P307] onFailure marked plan ${planId} as error: ${error?.message?.slice(0, 100)}`);
      } catch (markErr) {
        console.error(`[P307] onFailure mark failed (P292 cron sweep 가 30분 후 정리): ${markErr.message}`);
      }

      // 🔴 P0 원자 발급 (2026-07-15): worker 가 retry 를 다 쓰고 최종 실패했다 → 발급권을 되돌려
      //   사용자가 같은 결제로 재시도할 수 있게 한다. 안 풀면 lease 만료(15분)까지 409 로 잠긴다.
      //
      //   원본 이벤트는 inngest/function.failed 의 event.data.event 에 통째로 중첩된다
      //   (planId 를 꺼낼 때 이미 쓰는 그 경로).
      //
      //   ⚠️ 오래된 worker 의 onFailure 가 새 attempt 의 claim 을 지우면 안 된다 →
      //     releasePlanIssuance 가 **status===ISSUING + attemptId 일치**일 때만 삭제하므로
      //     구조적으로 안전하다. takeover 됐거나(attemptId 불일치) 이미 COMMITTING/ISSUED 면
      //     (= plans 가 저장됐을 수 있음) 건드리지 않고 reconcile 대상으로 남긴다.
      const failedClaim = event?.data?.event?.data?.ctx?.issuanceClaim;
      if (failedClaim && failedClaim.orderId && failedClaim.attemptId) {
        try {
          const rel = await releasePlanIssuance(adminDb, failedClaim);
          if (rel.released) {
            console.warn(`[P307] onFailure: 발급권 해제 — 같은 결제로 재시도 가능 (order=${String(failedClaim.orderId).slice(0, 6)}...)`);
          } else {
            // 해제 못 함 = 정상일 수 있다(COMMITTING = plan 저장됨 / 남이 takeover). fail-open 금지.
            console.warn(`[P307] onFailure: 발급권 해제 안 됨(잠금 유지): ${rel.code || ''} ${rel.detail || ''}`);
          }
        } catch (relErr) {
          console.error(`[P307] onFailure: 발급권 해제 실패 — lease 만료까지 잠김: ${relErr.message}`);
        }
      }
      // 운영자 escalation — sweep 30분 net 보다 빠르게 manual 환불 안내 시작 가능.
      try {
        await throttledTelegramAlert({
          key: `inngest-worker-fail:${planId}`,
          channel: 'admin',
          severity: 'high',
          message: `🔴 <b>Inngest worker 최종 실패 (P307 onFailure)</b>\n\nplanId=<code>${planId.slice(0, 8)}</code>\nerror=${(error?.message || 'unknown').slice(0, 200)}\n\n→ 운영자 manual: 사용자 결제 후 plan 안 받음 → 환불 안내 + 원인 분석 (Vercel logs / Inngest run).`,
        });
      } catch (alertErr) {
        console.warn(`[P307] onFailure alert failed: ${alertErr.message}`);
      }
    },
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
                  vehicle, priceKRW, priceUSD, body: skBody, blockModeItinerary,
                  forceGuestToken } = ctx.skeletonCtx;
          // FEATURE_GUEST_ANON_AUTH: 게스트 익명 소유자 uid 면 stub→full skeleton 교체 시점에
          //   accessToken 발급 (streaming window 동안 게스트 공유 접근). forceGuestToken 이 truthy
          //   (= 플래그 ON + 익명 uid) 일 때만 accessToken 키 추가 → 아래 spread 로 조건부 포함.
          //   플래그 OFF (forceGuestToken falsy) 시 fullDoc 에 accessToken 키 자체가 없음 = 기존 동작
          //   byte-identical (이전엔 accessToken 미설정, persistPlan 이 최종 set). nullish 금지, OR 사용.
          const fullDoc = {
            planId: planIdForSkeleton,
            status: 'streaming',
            _streaming_in_progress: true,
            _streaming_started_at: ctx.skeletonCtx._streaming_started_at || Date.now(),
            isPublic: false,
            createdAt: new Date().toISOString(),
            createdAtMs: Date.now(),
            uid: uid || null,
            ...(forceGuestToken ? { accessToken: randomUUID() } : {}),
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
    // P290 (2026-05-29): selfHealLodgingBookend personalize 위해 ctx 확장.
    //   Inngest worker path 도 sync path 와 동일 ctx 전달 (block_mode plan 의
    //   주요 처리 경로 — day.lodging 없는 zone_courses JSON 의 lodging anchor 보강).
    const itinAfterBackfill = await step.run('backfillsAndTmoney', () => {
      applyBackfillsAndTmoney(itinAfterRoute, {
        hotelByCity: ctx.hotelByCity,
        body: ctx.body,
        hotel_address: ctx.hotel_address,
        hotelAddressFromBody: ctx.hotelAddressFromBody,
        recommendedZone: ctx.recommendedZone,
        // P-launch (2026-05-31): worker path 도 tip 언어 + block_mode bookend suppress 전달.
        language: ctx.language,
        blockMode: ctx.blockModeUsed,
        // #1227 후속 (2026-08-04): 출국일 항공 컷. **이 worker 가 legacy 경로다**
        //   (handlerCore 는 block_mode 일 때만 applyBackfillsAndTmoney 를 부른다).
        //   departure_airport 는 shaped 값 — requestShaper 가 미입력 시 arrival_airport
        //   로 폴백해 둔 것이라 raw body 를 쓰면 컷이 조용히 skip 된다.
        //   departureTime 은 ctx 에 없어 postResponsePipeline 이 body 에서 같은 방식
        //   (camel → snake, slice(0,5)) 으로 읽는다.
        departure_airport: ctx.departure_airport,
      });
      return itinAfterRoute;
    });

    // ── Step 3: recommended_restaurants ──────────────────────────────────────
    const foodIndexForQuality = await step.run('recommendedRestaurants', async () => {
      // 2026-08-24: language/styles 전달 — 이 helper 끝의 종단 식이/식사 게이트 입력.
      //   게이트가 실패하면 이 step 이 throw → persistPlan 미실행 (위반본 저장 금지, fail-closed).
      return applyRecommendedRestaurants(itinAfterBackfill, {
        area: ctx.area,
        dietPrefs: ctx.dietPrefs,
        regions: ctx.regions,
        language: ctx.language,
        styles: ctx.styles,
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
        // FEATURE_GUEST_ANON_AUTH: 게스트 익명 소유자 uid 면 accessToken 발급. ctx.forceGuestToken
        //   = inngestDispatch.buildPlanAiCompletePayload 가 채움. undefined (플래그 OFF) → persistPlan
        //   기본 false → 기존 (uid ? null : random) byte-identical.
        forceGuestToken: !!ctx.forceGuestToken,
        ...(ctx.streamingPlanId ? { planIdOverride: ctx.streamingPlanId } : (eventPlanId ? { planIdOverride: eventPlanId } : {})),
        // P266 (2026-05-28): P195 cache instrumentation persistence — worker savePlan explicit pass-through.
        //   ctx.cacheMetadata = inngestDispatch.buildPlanAiCompletePayload 가 itinerary._cache_metadata 에서 추출.
        //   fallback: itinAfterBackfill._cache_metadata (step output store reconstruction 통과한 경우)
        //   둘 다 없으면 null → persistPlan silent skip (block_mode / non-Gemini).
        cacheMetadata: ctx.cacheMetadata || itinAfterBackfill?._cache_metadata || null,
        // 🔴 P0 원자 발급 (2026-07-15): dispatch 시 handler 가 넘긴 발급권.
        //   persistPlan 이 plans 저장 직전 beginPlanCommit 으로 fencing 하고 저장 후 finalize 로 확정한다.
        //   step retry 는 event.data 를 그대로 재수화하므로 **같은 attemptId/planId** 가 유지된다
        //   (event.data 는 불변). 따라서 재시도해도 같은 발급권으로 같은 plan 문서에 쓴다.
        //   claim 이 예약한 planId 가 planIdOverride 보다 우선한다(persistPlan 이 대조·강제).
        issuanceClaim: ctx.issuanceClaim || null,
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
