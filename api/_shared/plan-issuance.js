/**
 * PayPal AI 플랜 발급권 원자 claim (P0, 2026-07-15).
 *
 * 불변식: **정상 PayPal 결제 order ID 1개 → 발급 완료된 AI 플랜 최대 1개.**
 *
 * 이전 구조는 이 불변식을 지키지 못했다:
 *   - paymentGate 가 plan_issued_orders 를 `get()` 으로 **읽기만** 했다(비원자 read-then-pass).
 *     같은 order ID 의 동시 요청 둘이 모두 "없음" 을 읽고 둘 다 유료 플랜을 생성할 수 있었다.
 *   - planPersister.markPlanIssued 가 `.set()` 실패를 `.catch()` 로 삼키고 `true` 를 반환했다.
 *     마커가 안 박히면 플랜은 저장됐는데 결제 ID 는 다시 쓸 수 있었다.
 *
 * ## 상태 모델 — ISSUING → COMMITTING → ISSUED
 *
 *   없음
 *     └─ claim tx ─→ ISSUING
 *                      ├─ 생성 실패(플랜 미저장) ─→ release(삭제) ─→ 같은 결제로 재시도 가능
 *                      └─ beginCommit tx ─→ COMMITTING
 *                                             ├─ plans/{planId} 저장  ← tx **밖**
 *                                             └─ finalize tx ─→ ISSUED
 *
 * **왜 3단계인가 — plans 문서를 트랜잭션에 넣을 수 없기 때문이다.**
 *   plans 문서는 최대 900KB(planPersister SIZE_LIMIT_BYTES)이고, 저장 직전 truncation 루프가
 *   `days.pop()` 으로 문서를 **in-place mutate** 한다. 트랜잭션 재시도는 콜백을 재실행하므로
 *   이미 pop 된 days 위에서 다시 돌아 데이터가 손상된다.
 *   → 대용량 write 를 tx 밖에 두되, 그 **직전에** COMMITTING 을 원자적으로 선점한다.
 *     그러면 takeover 된 오래된 attempt 는 beginCommit 에서 fencing 에 걸려 plans 저장 단계에
 *     아예 진입하지 못한다. ISSUING 에서 바로 plans 를 저장하면 이 TOCTOU 가 남는다.
 *
 * ## fencing
 *   모든 전이 tx 가 `status` + `attemptId` + `planId` 3개를 다시 확인한다. attemptId 는 서버가
 *   tx **밖에서 한 번** 생성한다(tx 콜백은 재시도 시 재실행되므로 안쪽에서 만들면 값이 흔들린다).
 *
 * ## lease 와 takeover
 *   Vercel 은 maxDuration(vercel.json 의 api/ai-planner-full.js) 도달 시 프로세스를 **강제 종료**한다.
 *   catch/finally 가 실행되지 않으므로 claim 해제를 코드 정리 경로에만 의존할 수 없다 → 자기만료.
 *   다만 Inngest worker 는 별 invocation + step retry 라 최초 HTTP 요청보다 오래 살 수 있어서,
 *   "TTL 만료 = 죽었다" 로 단정하지 않는다. **안전은 TTL 이 아니라 fencing 이 담당한다** —
 *   takeover 는 새 attemptId 를 발급하므로 이전 attempt 는 beginCommit 에서 반드시 차단된다.
 *   takeover 전에 예약된 planId 로 완성 plan 을 먼저 대조해, "플랜 저장 성공 + 확정 직전 종료" 를
 *   새 생성 없이 ISSUED 로 복구한다.
 *
 * ## 시간 필드
 *   `leaseExpiresAt` 은 **ms 정수**(Date.now() 기준)다. 기존 `issuedAt`(ISO 문자열)을 lease 계산
 *   근거로 재사용하지 않는다. serverTimestamp 는 tx 안에서 되읽어 비교할 수 없어 쓰지 않았다.
 *   (레포 선례: _crons/plan-streaming-sweep.js 도 _streaming_started_at ms 로 판정한다.)
 *   ⚠️ 서버 로컬 시계 기반이므로 인스턴스 간 clock skew 는 보정하지 않는다. lease 를 실행시간보다
 *   넉넉히 잡아 흡수한다.
 *
 * ## 범위
 *   **유료 PayPal 경로 전용.** revision / 무료쿠폰 / ADMIN-BYPASS- / TEST- / MANUAL- 은 대상이 아니다
 *   (각자 별도 멱등성 정책 보유). 호출부(paymentGate)가 이미 provider==='paypal' 분기 안이라
 *   여기서 prefix 를 다시 판정하지 않는다 — prefix 판별 SSOT 는 _shared/admin-bypass-detector.js 의
 *   detectPaymentSource 이며 4번째 구현을 만들지 않는다.
 *
 * 신규 코드 규약: nullish coalescing 금지, OR 사용 (레포 전역 규약).
 */
import { randomUUID } from 'crypto';

export const PLAN_ISSUANCE_STATUS = {
  ISSUING: 'ISSUING',
  COMMITTING: 'COMMITTING',
  ISSUED: 'ISSUED',
};

/**
 * lease 유효기간. vercel.json 의 api/ai-planner-full.js maxDuration(현재 800초) 보다 길어야 한다 —
 * 짧으면 첫 요청이 **아직 살아 있는 동안** takeover 가 열려 동시 생성이 재발한다.
 * ⚠️ maxDuration 을 바꾸면 이 값도 함께 올릴 것. (P270: vercel.json 이 export 보다 우선하며,
 *    export=600/vercel.json=300 불일치로 296초 사망을 실측한 이력이 있다.)
 * ⚠️ 이 값은 "이 시간이 지나면 죽었다" 는 단정이 아니다 — 실제 안전은 fencing 이 담당한다.
 */
export const PLAN_ISSUANCE_LEASE_MS = 900_000; // 15분 (= 800초 하드킬 + 여유)

export const PLAN_ISSUANCE_COLLECTION = 'plan_issued_orders';

/** 발급 claim 실패 코드 — 호출자가 HTTP 응답으로 변환한다. */
export const PLAN_ISSUANCE_CODE = {
  DUPLICATE: 'DUPLICATE_ORDER',
  IN_PROGRESS: 'PLAN_GENERATION_IN_PROGRESS',
  UNAVAILABLE: 'PLAN_ISSUANCE_CHECK_UNAVAILABLE',
  CLAIM_LOST: 'PLAN_CLAIM_LOST',
};

function issuanceRef(adminDb, orderId) {
  return adminDb.collection(PLAN_ISSUANCE_COLLECTION).doc(orderId);
}

/**
 * 완성 plan 인정 조건 (COMMITTING/만료 ISSUING 복구 판정).
 *
 * status==='ready' 가 **유일한 완료 신호**다. `_streaming_in_progress: false` 로 판정하면 안 된다 —
 * 정상 완료 경로는 그 필드를 명시적으로 false 로 쓰지 않고, persistPlan 의 merge 없는 .set() 이
 * 필드를 **삭제**해 falsy 가 될 뿐이다(false 를 쓰는 곳은 Inngest onFailure 와 sweep cron 뿐).
 *
 * streaming skeleton / P231 stub / error 문서를 완료로 오인하면 결제한 사용자가 플랜을 영영 못 받는다.
 *
 * @param {{exists?: boolean, data?: Function}|null} planSnap
 * @param {{orderId: string, planId: string}} claim
 * @returns {boolean}
 */
export function isCompletedPlanForClaim(planSnap, claim) {
  if (!planSnap || !planSnap.exists) return false;
  const d = (typeof planSnap.data === 'function' ? planSnap.data() : null) || {};
  if (d.status !== 'ready') return false;
  if (d._streaming_in_progress === true) return false;
  if (d._p231_stub === true) return false;
  if (d.planId !== claim.planId) return false;
  const input = d.input || {};
  if (input.paypalOrderId !== claim.orderId) return false;
  return true;
}

/**
 * 발급권 원자 선점. **모든 결제 검증(capture 무결성·provenance·payment_reviews) 통과 후,
 * AI 생성 시작 전**에 호출한다. 검증 전에 부르면 실패한 주문이 발급권을 선점한 채 reject 되어
 * 정당한 재시도를 DUPLICATE 로 막는 self-DoS 가 된다.
 *
 * planId 를 여기서 **예약**해 반환한다 — skeleton/inline/worker 가 전부 같은 문서를 쓰게 해
 * "attempt 마다 다른 plan 문서" 를 원천 차단하고, 복구 시 쿼리 없이 직접 읽을 수 있게 한다
 * (plans.input.paypalOrderId 는 persistPlan 이 실행돼야 생기므로 streaming 창에서는 조회 불가).
 *
 * @param {object} adminDb — firebase-admin Firestore
 * @param {string} orderId — 검증 완료된 PayPal order ID
 * @param {{uid?: string|null, now?: number}} [opts]
 * @returns {Promise<{claim: {orderId, attemptId, planId}} | {code: string, detail?: string}>}
 */
export async function claimPlanIssuance(adminDb, orderId, { uid, now } = {}) {
  if (!adminDb || !orderId) return { code: PLAN_ISSUANCE_CODE.UNAVAILABLE, detail: 'missing db or orderId' };

  // tx 콜백 밖에서 1회 생성 — 콜백은 충돌 시 재실행되므로 안쪽에서 만들면 attempt/plan ID 가 흔들린다.
  const attemptId = randomUUID();
  const freshPlanId = randomUUID();
  const nowMs = typeof now === 'number' ? now : Date.now();
  const ref = issuanceRef(adminDb, orderId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    if (!snap.exists) {
      const claim = { orderId, attemptId, planId: freshPlanId };
      tx.set(ref, {
        status: PLAN_ISSUANCE_STATUS.ISSUING,
        attemptId,
        planId: freshPlanId,
        provider: 'paypal',
        claimedAt: new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
        leaseExpiresAt: nowMs + PLAN_ISSUANCE_LEASE_MS,
        uid: uid || null,
      });
      return { claim };
    }

    const d = snap.data() || {};

    // 레거시 마커(2026-07-15 이전 markPlanIssued 산출물)는 status 필드가 없다.
    // { planId, issuedAt, uid, provider } 만 있고 존재 자체가 "이미 발급함" 을 뜻했다 → ISSUED 취급.
    if (!d.status) return { code: PLAN_ISSUANCE_CODE.DUPLICATE, detail: 'legacy issued marker' };

    if (d.status === PLAN_ISSUANCE_STATUS.ISSUED) {
      return { code: PLAN_ISSUANCE_CODE.DUPLICATE, detail: 'already issued' };
    }

    const reservedPlanId = d.planId || freshPlanId;
    const leaseExpiresAt = Number(d.leaseExpiresAt) || 0;
    const leaseAlive = leaseExpiresAt > nowMs;

    // COMMITTING = plans 저장이 진행 중이거나 저장 후 확정 직전에 종료됐다.
    // 완성 plan 이 있으면 새 생성 없이 ISSUED 로 복구하고, 없으면 **takeover 하지 않는다**
    // (저장 중일 수 있으므로 — 여기서 뺏으면 이중 저장 창이 열린다).
    if (d.status === PLAN_ISSUANCE_STATUS.COMMITTING) {
      const recovered = await recoverIfPlanComplete(tx, adminDb, ref, { orderId, planId: reservedPlanId }, nowMs);
      if (recovered) return { code: PLAN_ISSUANCE_CODE.DUPLICATE, detail: 'recovered committing → issued' };
      return { code: PLAN_ISSUANCE_CODE.IN_PROGRESS, detail: 'commit in progress' };
    }

    if (d.status === PLAN_ISSUANCE_STATUS.ISSUING) {
      if (leaseAlive) return { code: PLAN_ISSUANCE_CODE.IN_PROGRESS, detail: 'lease alive' };

      // lease 만료 — takeover 전에 "저장 성공 + 마킹 직전 종료" 를 먼저 복구한다.
      const recovered = await recoverIfPlanComplete(tx, adminDb, ref, { orderId, planId: reservedPlanId }, nowMs);
      if (recovered) return { code: PLAN_ISSUANCE_CODE.DUPLICATE, detail: 'recovered stale issuing → issued' };

      // fencing takeover: 새 attemptId 발급 → 이전 attempt 는 beginPlanCommit 에서 반드시 차단된다.
      // 예약 planId 는 **유지**한다 — 같은 문서를 재사용해야 고아 plan 이 생기지 않는다.
      const claim = { orderId, attemptId, planId: reservedPlanId };
      tx.update(ref, {
        status: PLAN_ISSUANCE_STATUS.ISSUING,
        attemptId,
        planId: reservedPlanId,
        updatedAt: new Date(nowMs).toISOString(),
        leaseExpiresAt: nowMs + PLAN_ISSUANCE_LEASE_MS,
        takenOverAt: new Date(nowMs).toISOString(),
      });
      return { claim };
    }

    // 미지 status — fail-closed.
    return { code: PLAN_ISSUANCE_CODE.UNAVAILABLE, detail: `unknown status: ${String(d.status)}` };
  });
}

/**
 * 예약된 planId 로 plans 문서를 **직접 읽어**(쿼리·신규 index 불필요) 완성 여부를 판정하고,
 * 완성이면 같은 tx 안에서 ISSUED 로 복구한다.
 * @returns {Promise<boolean>} 복구했으면 true
 */
async function recoverIfPlanComplete(tx, adminDb, ref, claim, nowMs) {
  if (!claim.planId) return false;
  const planSnap = await tx.get(adminDb.collection('plans').doc(claim.planId));
  if (!isCompletedPlanForClaim(planSnap, claim)) return false;
  tx.update(ref, {
    status: PLAN_ISSUANCE_STATUS.ISSUED,
    issuedAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    recoveredAt: new Date(nowMs).toISOString(),
  });
  return true;
}

/**
 * plans 대용량 저장 **직전** fencing. status/attemptId/planId 3개가 전부 일치할 때만 COMMITTING 전이.
 * 하나라도 다르면 이 attempt 는 발급권을 잃은 것이므로 plan 을 저장하면 안 된다.
 *
 * @returns {Promise<{ok: true} | {code: string, detail?: string}>}
 */
export async function beginPlanCommit(adminDb, claim, { now } = {}) {
  if (!adminDb || !claim || !claim.orderId || !claim.attemptId || !claim.planId) {
    return { code: PLAN_ISSUANCE_CODE.UNAVAILABLE, detail: 'incomplete claim' };
  }
  const nowMs = typeof now === 'number' ? now : Date.now();
  const ref = issuanceRef(adminDb, claim.orderId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { code: PLAN_ISSUANCE_CODE.CLAIM_LOST, detail: 'claim gone' };
    const d = snap.data() || {};
    if (d.status !== PLAN_ISSUANCE_STATUS.ISSUING) {
      return { code: PLAN_ISSUANCE_CODE.CLAIM_LOST, detail: `status=${String(d.status)}` };
    }
    if (d.attemptId !== claim.attemptId) return { code: PLAN_ISSUANCE_CODE.CLAIM_LOST, detail: 'attempt fenced' };
    if (d.planId !== claim.planId) return { code: PLAN_ISSUANCE_CODE.CLAIM_LOST, detail: 'planId mismatch' };
    tx.update(ref, {
      status: PLAN_ISSUANCE_STATUS.COMMITTING,
      updatedAt: new Date(nowMs).toISOString(),
      // 저장이 오래 걸릴 수 있으므로 같은 attempt 에 한해 lease 갱신.
      leaseExpiresAt: nowMs + PLAN_ISSUANCE_LEASE_MS,
    });
    return { ok: true };
  });
}

/**
 * plans 저장 성공 후 최종 확정. **실패를 삼키지 않는다** — 호출자가 결과를 반드시 확인해야 한다.
 * (구 markPlanIssued 는 .set() 실패를 .catch() 로 먹고 true 를 반환했다. 그게 이 P0 의 원인 절반이다.)
 *
 * @returns {Promise<{ok: true} | {code: string, detail?: string}>}
 */
export async function finalizePlanIssuance(adminDb, claim, { now } = {}) {
  if (!adminDb || !claim || !claim.orderId || !claim.attemptId || !claim.planId) {
    return { code: PLAN_ISSUANCE_CODE.UNAVAILABLE, detail: 'incomplete claim' };
  }
  const nowMs = typeof now === 'number' ? now : Date.now();
  const ref = issuanceRef(adminDb, claim.orderId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { code: PLAN_ISSUANCE_CODE.CLAIM_LOST, detail: 'claim gone' };
    const d = snap.data() || {};
    if (d.status === PLAN_ISSUANCE_STATUS.ISSUED && d.attemptId === claim.attemptId) {
      return { ok: true }; // 멱등 — Inngest step retry 로 같은 attempt 가 두 번 확정해도 성공.
    }
    if (d.status !== PLAN_ISSUANCE_STATUS.COMMITTING) {
      return { code: PLAN_ISSUANCE_CODE.CLAIM_LOST, detail: `status=${String(d.status)}` };
    }
    if (d.attemptId !== claim.attemptId) return { code: PLAN_ISSUANCE_CODE.CLAIM_LOST, detail: 'attempt fenced' };
    if (d.planId !== claim.planId) return { code: PLAN_ISSUANCE_CODE.CLAIM_LOST, detail: 'planId mismatch' };
    tx.update(ref, {
      status: PLAN_ISSUANCE_STATUS.ISSUED,
      issuedAt: new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
    });
    return { ok: true };
  });
}

/**
 * 생성이 **확실히 시작되지 않았거나 플랜이 저장되지 않은** 조기 실패에서 발급권을 되돌린다.
 * doc 을 삭제해 같은 결제로 재시도가 통과하게 한다(구 설계의 "write 를 persistPlan 까지 미룸" 이
 * 담당하던 재시도 보장을 대체).
 *
 * 안전 규칙:
 *   - `status === ISSUING` + attemptId 일치일 때만 삭제한다.
 *   - **COMMITTING 은 절대 삭제하지 않는다** — plans 가 이미 저장됐을 수 있다. reconcile 대상으로 남긴다.
 *   - 다른 attempt 가 takeover 한 claim 을 오래된 cleanup 이 지우지 못한다(attemptId 대조).
 *
 * @returns {Promise<{released: boolean, code?: string, detail?: string}>}
 */
export async function releasePlanIssuance(adminDb, claim) {
  if (!adminDb || !claim || !claim.orderId || !claim.attemptId) {
    return { released: false, code: PLAN_ISSUANCE_CODE.UNAVAILABLE, detail: 'incomplete claim' };
  }
  const ref = issuanceRef(adminDb, claim.orderId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { released: false, detail: 'already absent' };
    const d = snap.data() || {};
    if (d.status !== PLAN_ISSUANCE_STATUS.ISSUING) {
      // COMMITTING/ISSUED — 플랜이 저장됐을 수 있으므로 건드리지 않는다.
      return { released: false, detail: `not releasable: status=${String(d.status)}` };
    }
    if (d.attemptId !== claim.attemptId) {
      return { released: false, detail: 'attempt fenced — not mine' };
    }
    tx.delete(ref);
    return { released: true };
  });
}
