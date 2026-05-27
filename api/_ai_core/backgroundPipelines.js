/**
 * backgroundPipelines.js — P168/P169 background + streaming pipeline 추출 (P170, 2026-05-23).
 *
 * 기존 handlerCore.js 가 try/catch + withStep + 합성 책임만 (P129 cap 500L) 유지하도록
 * Pass3 background trigger (P168) + streaming early-response pipeline (P169) 를 분리.
 *
 * Export:
 *   - triggerPass3BackgroundIfPending({ adminDb, planId, language, apiKey, itinerary })
 *     plan Firestore 저장 후 itinerary._pass3_pending=true 면 background Gemini enrich + Firestore update.
 *     isPass3BackgroundEnabled() false 시 no-op.
 *     fail = non-critical, throttledTelegramAlert 1건.
 *
 *   - shouldUseStreaming({ itinerary, plannerMode })
 *     true 면 handlerCore 가 streaming 분기 진입.
 *     isStreamingEnabled() + block-mode 미사용 + 3pass 아닌 경우만 true.
 *
 *   - tryInitStreamingSkeleton({ adminDb, uid, email, area, startDate, guestName, pax, language, vehicle, durationDays, body })
 *     planId + planUrl 생성 + Firestore skeleton 저장.
 *     P231 (2026-05-27): PLANNER_SKELETON_IN_WORKER=true 시 stub doc 만 저장 (1-2s → ~150ms),
 *     full skeleton data 는 skeletonCtx 로 반환 → Inngest worker Step 0 가 full skeleton 저장.
 *     실패 시 null 반환 (일반 모드로 fallback 하도록 설계).
 *
 *   - tryInitBlockModeForInngest({ adminDb, uid, email, area, startDate, guestName, pax, language, vehicle, durationDays, body, itinerary })
 *     P230 (2026-05-27): block-mode + Inngest 통합. block-mode 결과를 _streaming_in_progress=true
 *     skeleton 으로 저장 + itinerary merge → handlerCore 가 streamingPlanId 확보 → Inngest dispatch.
 *     P231 (2026-05-27): PLANNER_SKELETON_IN_WORKER=true 시 stub doc 만 저장.
 *     실패 시 null 반환 → handlerCore 의 inline pipeline 으로 fallback (silent fail 차단).
 *
 *   - isSkeletonInWorkerEnabled()
 *     P231 (2026-05-27): PLANNER_SKELETON_IN_WORKER env 토글 체크. default false = 기존 동작 100% 유지.
 *
 *   - sendStreamingEarlyResponse({ res, CORS, planId, planUrl })
 *     status:'streaming' 응답 즉시 전송 (Gemini 완료 직후).
 *
 * ⚠️ 기능 변경 0 — handlerCore.js 의 inline 로직을 그대로 이동. P168/P169 동작 동일.
 *
 * Related: [[feedback_mistake_p129_ai_planner_full_decompose]]
 *          [[feedback_mistake_p168_pass3_background_async]]
 *          [[feedback_mistake_p169_gemini_streaming]]
 */
import { pass3Enrich } from './threePassPipeline.js';
import { updatePlanEnrichment, savePlanSkeleton } from './planPersister.js';
import { isPass3BackgroundEnabled, isStreamingEnabled, buildModel } from './geminiPipeline.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';
import { calcPrice } from './vehicleAndPrice.js';
import { randomUUID } from 'crypto';

// P231 (2026-05-27): skeleton 저장을 Inngest worker 의 첫 step 으로 이동.
// ENV off (default) = 기존 동작 100% 유지 (rollback 안전).
export function isSkeletonInWorkerEnabled() {
  return String(process.env.PLANNER_SKELETON_IN_WORKER || '').toLowerCase() === 'true';
}

// ── P168: Pass3 background trigger ───────────────────────────────────────────

/**
 * P168 (2026-05-23): Pass3 background enrich.
 * itinerary._pass3_pending === true + isPass3BackgroundEnabled() 일 때만 실행.
 * fire-and-forget — 실패해도 plan 은 정상 저장됨 (non-critical).
 *
 * @param {{ adminDb, planId: string, language: string, apiKey: string, itinerary: object, isAdminBypass?: boolean }} args
 *   isAdminBypass — P171 (2026-05-23): admin Test Mode 면 background Gemini 호출도
 *   GEMINI_ADMIN_BYPASS_MODEL 우선 (운영자 Pro→Flash 비교 시 background tip 도 Flash).
 */
export function triggerPass3BackgroundIfPending({ adminDb, planId, language, apiKey, itinerary, isAdminBypass, identifierForBucketing }) {
  if (!itinerary._pass3_pending || !isPass3BackgroundEnabled()) return;

  // fire-and-forget — UnhandledPromiseRejection 방지를 위해 .catch() 필수.
  (async () => {
    try {
      // P171: admin Test Mode 만 GEMINI_ADMIN_BYPASS_MODEL 우선. 일반 사용자 영향 0.
      // P172 (2026-05-24): identifierForBucketing propagate — background Pass3 도 일관성
      // (사용자가 Flash bucket 이면 main + Pass3 tip 둘 다 Flash).
      const bgModel = buildModel(apiKey, undefined, { isAdminBypass, identifierForBucketing });
      const enriched = await pass3Enrich(bgModel, itinerary, language);
      await updatePlanEnrichment(adminDb, planId, enriched);
      console.log(`[planner] P168 Pass3 background completed: planId=${planId}`);
    } catch (bgErr) {
      console.error('[planner] P168 Pass3 background fail:', bgErr.message);
      throttledTelegramAlert({
        key: `pass3-background-fail:${planId}`,
        channel: 'admin',
        severity: 'low',
        message: `⚠️ <b>Pass3 background 실패 (P168)</b>\n\n<b>planId:</b> <code>${planId}</code>\n<b>err:</b> ${bgErr.message}\n\n→ tip/recommended_items 미채움 (plan 은 정상 저장). 재시도: 없음 (non-critical).`,
        context: { planId, error: bgErr.message },
      }).catch(() => {});
    }
  })();
}

// ── P169: Streaming early-response pipeline ───────────────────────────────────

/**
 * P169 (2026-05-23): streaming 모드 사용 여부 판단.
 * isStreamingEnabled() + block-mode 미사용 (itinerary null) + 3pass 아닌 경우.
 *
 * @param {{ itinerary: object|null, plannerMode: string }} args
 * @returns {boolean}
 */
export function shouldUseStreaming({ itinerary, plannerMode }) {
  return isStreamingEnabled() && !itinerary && plannerMode !== '3pass';
}

/**
 * P169 (2026-05-23): planId + skeleton Firestore 저장.
 * 실패 시 null 반환 → handlerCore 가 일반 모드로 fallback.
 *
 * P231 (2026-05-27): PLANNER_SKELETON_IN_WORKER=true 시 Firestore 에 stub doc 만
 *   저장 (planId + _streaming_in_progress + status = ~150ms), full skeleton 저장은
 *   Inngest worker Step 0 에서 수행 (savePlanSkeleton 전체 호출 1-2s 절감).
 *   skeletonCtx 를 반환값에 포함 → inngestDispatch.buildPlanAiCompletePayload 가
 *   payload 에 포함 → worker Step 0 가 받아서 Firestore 에 저장.
 *   stub doc 은 404 차단 전용 — PlanDetailPage onSnapshot 이 즉시 _streaming_in_progress
 *   감지 → 로딩 인디케이터 표시 (stub + full skeleton 공통 동작).
 *   ENV off (default) = 기존 동작 100% 유지 (rollback 안전).
 *
 * @param {{ adminDb, uid: string, email: string, area: string, startDate: string,
 *           guestName: string, pax: number, language: string,
 *           vehicle: string, durationDays: number, body: object }} args
 * @returns {Promise<{ planId: string, planUrl: string, skeletonCtx?: object }|null>}
 *   skeletonCtx: P231 모드 시 worker Step 0 에 전달할 full skeleton 입력 파라미터.
 *                ENV off (기존) 시 undefined (worker 에서 무시됨).
 */
export async function tryInitStreamingSkeleton({
  adminDb, uid, email, area, startDate, guestName, pax, language, vehicle, durationDays, body,
}) {
  try {
    const { priceKRW: skPriceKRW, priceUSD: skPriceUSD } = (() => {
      try { return calcPrice(vehicle, durationDays); } catch { return { priceKRW: 0, priceUSD: 0 }; }
    })();

    // P231: skeleton-in-worker 모드 — stub doc 만 저장해 HTTP 응답 경로에서 1-2s 절감.
    if (isSkeletonInWorkerEnabled()) {
      if (!adminDb) throw new Error('[P231] Firebase not configured — cannot save stub');
      const planId = randomUUID();
      const planUrl = `/my-plans/${planId}`;
      // stub doc: 404 차단 전용. PlanDetailPage 가 _streaming_in_progress 감지 가능.
      await adminDb.collection('plans').doc(planId).set({
        planId,
        status: 'streaming',
        _streaming_in_progress: true,
        _streaming_started_at: Date.now(),
        _p231_stub: true, // P231 디버그용 — worker Step 0 가 full skeleton 으로 교체
      });
      console.log('[planner P231] Stub doc saved (skeleton-in-worker mode):', planId);
      // skeletonCtx: worker Step 0 에서 savePlanSkeleton 호출 시 필요한 파라미터 전체.
      const skeletonCtx = {
        uid, email, area, startDate, guestName, pax, language,
        vehicle, priceKRW: skPriceKRW, priceUSD: skPriceUSD, body,
      };
      return { planId, planUrl, skeletonCtx };
    }

    // 기존 동작: full skeleton Firestore 저장 (ENV off 시 100% 유지).
    const sk = await savePlanSkeleton(adminDb, {
      uid, email, area, startDate, guestName, pax, language,
      vehicle, priceKRW: skPriceKRW, priceUSD: skPriceUSD, body,
    });
    console.log('[planner P169] Skeleton saved:', sk.planId);
    return { planId: sk.planId, planUrl: sk.planUrl };
  } catch (skErr) {
    console.warn('[planner P169] Skeleton save failed, falling back to normal mode:', skErr.message);
    return null;
  }
}

/**
 * P230 (2026-05-27): block-mode + Inngest 전체 path 통합 helper.
 *
 * handlerCore.js 의 P129 500L cap 보호 — skeleton init + dispatch + response 발사를
 * 한 helper 로 wrap. handlerCore 는 `if (await tryBlockModeInngestPath(...)) return;`
 * 한 줄로 호출.
 *
 * Flow:
 *   1. shouldDispatchToInngest() false → return null (handlerCore inline 진행).
 *   2. tryInitBlockModeForInngest() 실패 → return null.
 *   3. dispatchOrInline... 실패 → { streamingPlanId, streamingPlanUrl, dispatched: false }
 *      → handlerCore 의 inline path 가 같은 planId 재사용 (skeleton merge).
 *   4. dispatch 성공 → sendEarlyResponse → { dispatched: true } → handlerCore return.
 *
 * 반환값:
 *   - null: 본 path 미진입 (handlerCore inline 진행).
 *   - { dispatched: true, streamingPlanId, streamingPlanUrl }: dispatched + response sent (handler return).
 *   - { dispatched: false, streamingPlanId, streamingPlanUrl }: skeleton 만 저장 → handlerCore inline fallback (planId 재사용).
 *
 * @param {object} args - handlerCore scope + { adminDb, dispatchFn, sendEarlyResponse, buildDebug, isInngestEnabled }
 */
export async function tryBlockModeInngestPath({
  adminDb, isInngestEnabled, blockModeUsed, itinerary, uid, email, area, startDate, guestName, pax,
  language, vehicle, durationDays, body, dispatchFn, sendEarlyResponse, buildDebug, handlerStart,
}) {
  if (!blockModeUsed || !itinerary || !isInngestEnabled) return null;
  const sk = await tryInitBlockModeForInngest({ adminDb, uid, email, area, startDate, guestName, pax, language, vehicle, durationDays, body, itinerary });
  if (!sk) return null;
  // P231: sk.skeletonCtx → dispatchFn 에 전달 → worker Step 0 가 full skeleton 저장.
  const dispatched = await dispatchFn({ streamingPlanId: sk.planId, streamingPlanUrl: sk.planUrl, skeletonCtx: sk.skeletonCtx || null });
  if (dispatched) {
    sendEarlyResponse({ planId: sk.planId, planUrl: sk.planUrl, debug: buildDebug() });
    console.log('[planner P230] block-mode + Inngest dispatched. Response sent, worker handles enrichment.');
    if (handlerStart) console.log('[planner] === TOTAL:', Date.now() - handlerStart, 'ms (P230 dispatched) ===');
    return { dispatched: true, streamingPlanId: sk.planId, streamingPlanUrl: sk.planUrl, skeletonCtx: sk.skeletonCtx || null };
  }
  console.warn('[planner P230] block-mode Inngest dispatch failed — falling back to inline (skeleton kept).');
  return { dispatched: false, streamingPlanId: sk.planId, streamingPlanUrl: sk.planUrl, skeletonCtx: sk.skeletonCtx || null };
}

/**
 * P230 (2026-05-27): block-mode + Inngest 통합용 skeleton init.
 *
 * 배경: block-mode (P128/P167) 가 itinerary 를 미리 생성하면 shouldUseStreaming() 이
 *   false 를 반환 → streamingPlanId 가 null → tryDispatchOrFallback 의
 *   `if (!args.streamingPlanId) return false` 가드가 Inngest dispatch 차단 →
 *   inline routeEnrich (20s) 가 진행. block-mode 가 Inngest worker 우회.
 *
 * 본 helper 는 block-mode itinerary 를 skeleton 으로 Firestore 에 미리 저장 +
 * streamingPlanId 확보 → handlerCore 가 dispatch 진행 가능. worker 는
 * planIdOverride 로 동일 planId 의 doc 을 set merge 로 enrichment 완성.
 *
 * 차이점 (tryInitStreamingSkeleton 대비):
 *   - itinerary 가 이미 존재 → skeleton 의 days 를 block-mode 결과로 채움
 *     (사용자가 PlanDetailPage 진입 시 빈 days 가 아닌 block-mode 결과 표시).
 *   - _streaming_in_progress=true 유지 → routeEnrich 완료 전 client 가 loading
 *     인디케이터 표시 (PlanDetailPage._streaming_in_progress listener 그대로).
 *   - Inngest worker 가 _inngest_status='ready' 마킹 시 client onSnapshot 자동 갱신.
 *
 * Inngest 미설정 / dispatch 실패 시 fallback 보장:
 *   - 본 helper 호출 전에 handlerCore 가 shouldDispatchToInngest() 검사.
 *   - skeleton save 실패 시 null → handlerCore 가 기존 inline pipeline 진행.
 *
 * SAFETY-CRITICAL (CLAUDE.md J):
 *   - block-mode 자체가 이미 dietary 검증 통과 (eligible: false → legacy fallback 했음).
 *   - 본 helper 는 dietary 재검증 안 함 — 단순 Firestore write.
 *
 * @param {{ adminDb, uid: string, email: string, area: string, startDate: string,
 *           guestName: string, pax: number, language: string, vehicle: string,
 *           durationDays: number, body: object, itinerary: object }} args
 * @returns {Promise<{ planId: string, planUrl: string }|null>}
 */
export async function tryInitBlockModeForInngest({
  adminDb, uid, email, area, startDate, guestName, pax, language, vehicle, durationDays, body, itinerary,
}) {
  if (!adminDb || !itinerary) return null;
  try {
    const { priceKRW: skPriceKRW, priceUSD: skPriceUSD } = (() => {
      try { return calcPrice(vehicle, durationDays); } catch { return { priceKRW: 0, priceUSD: 0 }; }
    })();

    // P231: skeleton-in-worker 모드 — stub doc 만 저장 (full skeleton + itinerary merge 는 worker Step 0).
    // 기존 2 Firestore 호출 (~2-3s) → stub 1 호출 (~150ms) 로 단축.
    if (isSkeletonInWorkerEnabled()) {
      const planId = randomUUID();
      const planUrl = `/my-plans/${planId}`;
      await adminDb.collection('plans').doc(planId).set({
        planId,
        status: 'streaming',
        _streaming_in_progress: true,
        _streaming_started_at: Date.now(),
        _p231_stub: true,
      });
      console.log('[planner P231] block-mode stub doc saved (skeleton-in-worker mode):', planId);
      // skeletonCtx: worker Step 0 에서 full skeleton + itinerary merge 수행.
      const skeletonCtx = {
        uid, email, area, startDate, guestName, pax, language,
        vehicle, priceKRW: skPriceKRW, priceUSD: skPriceUSD, body,
        blockModeItinerary: itinerary, // block-mode 결과 — worker 가 merge
      };
      return { planId, planUrl, skeletonCtx };
    }

    // 기존 동작: savePlanSkeleton 의 기본 itinerary (empty days) 대신 block-mode 결과를 직접 set.
    // savePlanSkeleton 은 _streaming_in_progress=true 와 planId 생성을 담당. 이후 별 doc.set merge
    // 로 block-mode itinerary 를 덮어쓰면 동일 planId 의 days 가 block-mode 결과로 채워짐.
    const sk = await savePlanSkeleton(adminDb, {
      uid, email, area, startDate, guestName, pax, language,
      vehicle, priceKRW: skPriceKRW, priceUSD: skPriceUSD, body,
    });
    // block-mode 결과를 skeleton 위에 merge — _streaming_in_progress / status / pricing 유지하면서
    // itinerary.days 만 block-mode 결과로 덮어씀. 사용자는 PlanDetailPage 진입 시 빈 days 가
    // 아닌 block-mode plan 즉시 표시. routeEnrich 진행은 _streaming_in_progress 로 표시.
    try {
      await adminDb.collection('plans').doc(sk.planId).set({
        itinerary: { ...itinerary, _streaming_skeleton: true },
        _block_mode_used: true,
      }, { merge: true });
    } catch (mergeErr) {
      // skeleton 은 저장됐으나 itinerary merge 실패 — client 는 empty days 잠시 봤다가
      // worker 완료 시 채워짐. non-fatal 처리.
      console.warn('[planner P230] block-mode itinerary merge failed (non-fatal):', mergeErr.message);
    }
    console.log('[planner P230] block-mode skeleton saved for Inngest:', sk.planId);
    return { planId: sk.planId, planUrl: sk.planUrl };
  } catch (skErr) {
    console.warn('[planner P230] block-mode skeleton save failed, falling back to inline pipeline:', skErr.message);
    return null;
  }
}

/**
 * P169 (2026-05-23): streaming early response 전송.
 * Gemini 완료 직후, background pipeline 이 계속 실행되는 동안 클라이언트에 planId 전달.
 *
 * P186 (2026-05-25): admin-bypass 한정 `_debug` payload 동봉. streaming 모드에서
 * 비-streaming 분기 (handlerCore.js:407-415) 가 SKIP 되어 measure script 가 model /
 * plannerMode / abReason 식별 불가했던 P177 회귀 해소. 일반 user `debug=undefined` →
 * spread 시 미포함 (정보 leak 차단 유지).
 *
 * @param {{ res, CORS: object, planId: string, planUrl: string, debug?: object }} args
 */
export function sendStreamingEarlyResponse({ res, CORS, planId, planUrl, debug }) {
  res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      planId,
      planUrl,
      status: 'streaming',
      firestoreSaved: false,
      emailSent: false,
      ...(debug ? { _debug: debug } : {}),
    },
  }));
  console.log('[planner P169] Early streaming response sent. Continuing background pipeline...');
}
