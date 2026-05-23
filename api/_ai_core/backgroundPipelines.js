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
 *     실패 시 null 반환 (일반 모드로 fallback 하도록 설계).
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
export function triggerPass3BackgroundIfPending({ adminDb, planId, language, apiKey, itinerary, isAdminBypass }) {
  if (!itinerary._pass3_pending || !isPass3BackgroundEnabled()) return;

  // fire-and-forget — UnhandledPromiseRejection 방지를 위해 .catch() 필수.
  (async () => {
    try {
      // P171: admin Test Mode 만 GEMINI_ADMIN_BYPASS_MODEL 우선. 일반 사용자 영향 0.
      const bgModel = buildModel(apiKey, undefined, { isAdminBypass });
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
 * @param {{ adminDb, uid: string, email: string, area: string, startDate: string,
 *           guestName: string, pax: number, language: string,
 *           vehicle: string, durationDays: number, body: object }} args
 * @returns {Promise<{ planId: string, planUrl: string }|null>}
 */
export async function tryInitStreamingSkeleton({
  adminDb, uid, email, area, startDate, guestName, pax, language, vehicle, durationDays, body,
}) {
  try {
    const { priceKRW: skPriceKRW, priceUSD: skPriceUSD } = (() => {
      try { return calcPrice(vehicle, durationDays); } catch { return { priceKRW: 0, priceUSD: 0 }; }
    })();
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
 * P169 (2026-05-23): streaming early response 전송.
 * Gemini 완료 직후, background pipeline 이 계속 실행되는 동안 클라이언트에 planId 전달.
 *
 * @param {{ res, CORS: object, planId: string, planUrl: string }} args
 */
export function sendStreamingEarlyResponse({ res, CORS, planId, planUrl }) {
  res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    data: {
      planId,
      planUrl,
      status: 'streaming',
      firestoreSaved: false,
      emailSent: false,
    },
  }));
  console.log('[planner P169] Early streaming response sent. Continuing background pipeline...');
}
