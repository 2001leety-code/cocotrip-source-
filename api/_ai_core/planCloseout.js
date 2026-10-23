/**
 * handler catch 정리 — 실패 시 streaming plan 문서 즉시 error 마감 (2026-10-23).
 *
 * 잠근 사고: 저장 직전 게이트(applyRecommendedRestaurants)가 던지면 catch 가 422 응답·쿠폰 복구·
 *   발급권 해제·알림까지 하지만 streaming skeleton 문서는 'streaming' 으로 남았다.
 *   plan-streaming-sweep(30분)이 치울 때까지 손님 화면은 "생성 중" 이었다.
 *   이제 catch 에서 그 문서를 바로 'error' 로 닫는다 — PlanDetailPage 는 status==='error' 면 기존 ErrorState.
 *
 * handlerCore 는 500줄 cap(P129)이라 catch 본문을 여기로 옮겼다 — 동작·순서는 그대로.
 * 변경 없음: plan-streaming-sweep / Inngest onFailure / 쿠폰·발급권 본문.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { captureError } from '../_shared/sentry.js';
import { throttledTelegramAlert } from '../_shared/telegram-throttle.js';
import { PLAN_ISSUANCE_COLLECTION } from '../_shared/plan-issuance.js';
import { CORS } from './constants.js';
import { restoreAiPlanCoupon } from './paymentGate.js';

/**
 * streaming 중인 plan 문서를 error 로 닫는다. **절대 throw 하지 않는다.**
 *
 * 한 트랜잭션에서 아래가 **전부** 참일 때만 쓴다(하나라도 아니면 쓰기 0):
 *   - plans/{planId} 존재 · status==='streaming' · _streaming_in_progress===true
 *     (이미 'ready' 면 저장 성공, 이미 'error' 면 sweep/onFailure 가 먼저 닫은 것)
 *   - 유료 claim 이 있으면 plan_issued_orders 의 attemptId·planId 가 이 요청 claim 과 일치.
 *     재선점(takeover)은 planId 는 유지하고 attemptId 만 바꾼다(plan-issuance.js) — 대조가 없으면
 *     늦게 실패한 옛 attempt 가 새 attempt 가 만들고 있는 문서를 error 로 덮는다.
 *
 * @returns {Promise<{closed: true} | {closed: false, reason: 'missing'|'not_streaming'|'claim_mismatch'|'error', message?: string}>}
 */
export async function closeStreamingPlanOnFailure({ adminDb, planId, error, stage, issuanceClaim = null }) {
  try {
    const planRef = adminDb.collection('plans').doc(planId);
    const claimRef = issuanceClaim ? adminDb.collection(PLAN_ISSUANCE_COLLECTION).doc(issuanceClaim.orderId) : null;
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(planRef);
      const claimSnap = claimRef ? await tx.get(claimRef) : null;
      if (!snap.exists) return { closed: false, reason: 'missing' };
      const d = snap.data() || {};
      if (d.status !== 'streaming' || d._streaming_in_progress !== true) return { closed: false, reason: 'not_streaming' };
      if (claimRef) {
        const c = (claimSnap.exists && claimSnap.data()) || {};
        if (c.attemptId !== issuanceClaim.attemptId || c.planId !== issuanceClaim.planId || c.planId !== planId) {
          return { closed: false, reason: 'claim_mismatch' };
        }
      }
      tx.update(planRef, {
        status: 'error',
        _streaming_in_progress: false,
        _streaming_error: 'handler_catch',
        _streaming_error_code: error?.code || 'INTERNAL_ERROR',
        _streaming_error_message: String(error?.message || '').slice(0, 300),
        _streaming_failed_at: FieldValue.serverTimestamp(),
        _streaming_failed_stage: stage,
      });
      return { closed: true };
    });
  } catch (e) {
    return { closed: false, reason: 'error', message: e?.message || String(e) };
  }
}

/**
 * handlerCore catch 본문. 순서 고정: 응답 → 쿠폰 복구 → plan 마감(await) → 발급권 해제(await) → 알림.
 *   - 마감이 해제보다 먼저다 — releaseIfUnused 가 issuance.claim 을 비운다(그 뒤면 claim 대조 불가).
 *   - worker 로 인계된 뒤(handedToWorker)엔 쿠폰·마감·해제 모두 하지 않는다 — worker 가 플랜을
 *     계속 만들고 있다. handOff() 는 유료 claim 이 없어도 플래그를 세운다(무료쿠폰 경로 포함).
 */
export async function runHandlerFailureCleanup({
  req, res, adminDb, error, issuance, consumedCouponInfo, planPersisted, streamingPlanId, stage, plannerMode,
}) {
  console.error('[ai-planner-full] UNHANDLED ERROR:', error.message, error.stack);

  // batch 9 fix (PR-N): 응답 먼저 보내고 부수작업은 fire-and-forget (이전: await captureError throw 시 catch abort → res.end 못 보냄).
  if (!res.headersSent) {
    const statusCode = error.statusCode || 500;
    const code = error.code || 'INTERNAL_ERROR';
    res.writeHead(statusCode, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Planner failed',
      code,
      details: error.message || 'Unknown error',
      // batch 9 fix (PR-N): root cause 진단 위해 prod 에서도 stack head 일부 노출.
      // 운영자 본인 + Test Mode 케이스라 사용자에게 stack 노출 위험 낮음. 진단
      // 완료 후 dev only 로 좁힐 것.
      stackHead: (error.stack || '').slice(0, 500),
    }));
  }
  // 버그헌트 A fix (2026-06-27): 무료 쿠폰으로 시작했는데 plan 저장 전 실패 → 쿠폰 롤백(재시도 가능하게).
  //   저장 성공(planPersisted) 후엔 정당 소비라 롤백 X. worker 인계 뒤에도 X — 플랜이 계속 만들어진다.
  //   fire-and-forget(응답 후) — 롤백 실패해도 사용자 응답엔 영향 없음.
  if (consumedCouponInfo && !planPersisted && !issuance.handedToWorker) {
    restoreAiPlanCoupon(adminDb, consumedCouponInfo.uid, consumedCouponInfo.code)
      .catch((e) => console.warn('[ai-planner-full] coupon rollback failed:', e.message));
  }
  // streaming 문서 즉시 마감 — 결과는 로그만(실패해도 sweep 이 30분 뒤 정리).
  if (streamingPlanId && !planPersisted && !issuance.handedToWorker) {
    const closeout = await closeStreamingPlanOnFailure({ adminDb, planId: streamingPlanId, error, stage, issuanceClaim: issuance.claim });
    console.warn('[ai-planner-full] streaming plan closeout:', streamingPlanId, JSON.stringify(closeout));
  }
  // 🔴 P0: 발급권 해제(plan 미저장 + worker 미이관일 때만). await 필수 — freeze 유실 방지.
  await issuance.releaseIfUnused(adminDb, planPersisted, 'handler-catch');
  // K Tier 2-E (PR #266) — throttled. 동일 unhandled 패턴 5분 윈도우 내 dedup.
  // catch 블록 첫 응답 전에 await 하면 telemetry throw 시 응답 못 감 → 분리.
  Promise.resolve().then(async () => {
    try {
      await throttledTelegramAlert({
        key: 'ai-planner-unhandled',
        channel: 'error',
        message: `🔴 <b>AI 플래너 처리 실패</b>\n\n${error.message || '알 수 없는 오류'}\n\n경로: /api/ai-planner-full | 모드: ${plannerMode}`,
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
        planner_mode: plannerMode,
      });
    } catch (e) {
      console.warn('[ai-planner-full] sentry capture failed:', e.message);
    }
  });
}
