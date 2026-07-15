/**
 * PayPal AI 플랜 발급 원자성 (P0, 2026-07-15).
 *
 * 불변식: **정상 PayPal 결제 order ID 1개 → 발급 완료된 AI 플랜 최대 1개.**
 *
 * 이전 구조는 이걸 지키지 못했다 — paymentGate 가 plan_issued_orders 를 `get()` 으로 읽기만 해서
 * 동시 요청 둘이 모두 "없음" 을 읽고 둘 다 플랜을 생성할 수 있었고, markPlanIssued 는 `.set()`
 * 실패를 `.catch()` 로 삼키고 `true` 를 반환했다.
 *
 * 이 파일은 **행위 테스트**다. 소스 문자열을 세지 않고 실제 함수를 version 기반 낙관적 동시성
 * fake Firestore 위에서 돌린다(helpers/fakeFirestore.ts). 그 fake 는 읽은 문서의 version 이
 * commit 시점에 바뀌면 콜백을 재실행한다 = 실제 Firestore 의 serializable 보장.
 * → claim tx 를 일반 read-then-set 으로 되돌리면 이 파일이 **실제로 실패한다**(뮤테이션 #1 로 확인).
 */
import { describe, it, expect } from 'vitest';
import { makeFakeDb } from './helpers/fakeFirestore';
import { isAiPlannerFullProduct, isAiPlannerProduct } from '../../api/_shared/ai-planner-policy.js';
import {
  claimPlanIssuance,
  beginPlanCommit,
  finalizePlanIssuance,
  releasePlanIssuance,
  isCompletedPlanForClaim,
  PLAN_ISSUANCE_STATUS,
  PLAN_ISSUANCE_CODE,
  PLAN_ISSUANCE_LEASE_MS,
} from '../../api/_shared/plan-issuance.js';

const ORDER = '5O190127TN364715T';
const CLAIM_PATH = `plan_issued_orders/${ORDER}`;

/** 완성 plan 문서 (persistPlan 이 실제로 저장하는 모양). */
function readyPlan(planId: string, orderId = ORDER) {
  return { planId, status: 'ready', input: { paypalOrderId: orderId } };
}

describe('claimPlanIssuance — 동시 요청에서 winner 정확히 1개', () => {
  it('같은 order ID 2개 동시 claim → winner 1 / loser 는 IN_PROGRESS', async () => {
    const db = makeFakeDb();
    const [a, b] = await Promise.all([
      claimPlanIssuance(db, ORDER, { uid: 'u1' }),
      claimPlanIssuance(db, ORDER, { uid: 'u1' }),
    ]);
    const winners = [a, b].filter((r) => 'claim' in r && r.claim);
    expect(winners).toHaveLength(1);
    const losers = [a, b].filter((r) => 'code' in r && r.code);
    expect(losers).toHaveLength(1);
    expect((losers[0] as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.IN_PROGRESS);
    // 문서는 하나뿐이고 winner 의 attempt 가 박혀 있다.
    const doc = db._peek(CLAIM_PATH)!;
    expect(doc.status).toBe(PLAN_ISSUANCE_STATUS.ISSUING);
    expect(doc.attemptId).toBe((winners[0] as { claim: { attemptId: string } }).claim.attemptId);
  });

  it('8개 동시 claim → winner 정확히 1개 (나머지 7은 생성 진입 금지)', async () => {
    const db = makeFakeDb();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimPlanIssuance(db, ORDER, { uid: 'u1' })),
    );
    const winners = results.filter((r) => 'claim' in r && r.claim);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => 'code' in r && r.code === PLAN_ISSUANCE_CODE.IN_PROGRESS)).toHaveLength(7);
  });

  it('winner 는 planId 를 예약한다 (skeleton/inline/worker 가 같은 문서를 쓰게)', async () => {
    const db = makeFakeDb();
    const r = await claimPlanIssuance(db, ORDER, { uid: 'u1' });
    expect('claim' in r && r.claim.planId).toBeTruthy();
    expect(db._peek(CLAIM_PATH)!.planId).toBe((r as { claim: { planId: string } }).claim.planId);
  });

  it('claim 은 plan_issued_orders 외 어떤 컬렉션에도 write 하지 않는다 (used_paypal_orders 불변)', async () => {
    const db = makeFakeDb();
    await claimPlanIssuance(db, ORDER, { uid: 'u1' });
    const paths = db._writes.map((w) => w.path);
    expect(paths.every((p) => p.startsWith('plan_issued_orders/'))).toBe(true);
    expect(paths.some((p) => p.startsWith('used_paypal_orders/'))).toBe(false);
  });

  it('transaction 자체 실패 → throw (호출자가 Gemini 전에 retryable 로 중단)', async () => {
    const db = makeFakeDb();
    db._failNextTx(1, 'firestore unavailable');
    await expect(claimPlanIssuance(db, ORDER, { uid: 'u1' })).rejects.toThrow('firestore unavailable');
    expect(db._peek(CLAIM_PATH)).toBeUndefined();
  });

  it('ISSUED 존재 → DUPLICATE (재생성 금지)', async () => {
    const db = makeFakeDb();
    db._seed(CLAIM_PATH, { status: PLAN_ISSUANCE_STATUS.ISSUED, attemptId: 'old', planId: 'p1' });
    const r = await claimPlanIssuance(db, ORDER, {});
    expect((r as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.DUPLICATE);
  });

  it('레거시 마커(status 필드 없음) → DUPLICATE (2026-07-15 이전 markPlanIssued 산출물)', async () => {
    const db = makeFakeDb();
    db._seed(CLAIM_PATH, { planId: 'p1', issuedAt: '2026-07-01T00:00:00.000Z', uid: 'u1', provider: 'paypal' });
    const r = await claimPlanIssuance(db, ORDER, {});
    expect((r as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.DUPLICATE);
  });

  it('유효한 lease 의 ISSUING → IN_PROGRESS (takeover 금지)', async () => {
    const db = makeFakeDb();
    db._seed(CLAIM_PATH, {
      status: PLAN_ISSUANCE_STATUS.ISSUING, attemptId: 'live', planId: 'p1',
      leaseExpiresAt: Date.now() + PLAN_ISSUANCE_LEASE_MS,
    });
    const r = await claimPlanIssuance(db, ORDER, {});
    expect((r as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.IN_PROGRESS);
    expect(db._peek(CLAIM_PATH)!.attemptId).toBe('live'); // 뺏기지 않았다
  });
});

describe('상태 전이와 fencing', () => {
  it('owner attempt 만 ISSUING → COMMITTING', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    const ok = await beginPlanCommit(db, claim);
    expect(ok).toEqual({ ok: true });
    expect(db._peek(CLAIM_PATH)!.status).toBe(PLAN_ISSUANCE_STATUS.COMMITTING);
  });

  it('🔴 stale attempt 의 beginCommit 실패 → plans 저장 단계 진입 금지 (fencing 본체)', async () => {
    const db = makeFakeDb();
    const first = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    // lease 만료 → 새 attempt 가 takeover
    db._seed(CLAIM_PATH, {
      status: PLAN_ISSUANCE_STATUS.ISSUING, attemptId: first.claim.attemptId,
      planId: first.claim.planId, leaseExpiresAt: Date.now() - 1,
    });
    const second = (await claimPlanIssuance(db, ORDER, {})) as { claim: { attemptId: string; planId: string } };
    expect(second.claim.attemptId).not.toBe(first.claim.attemptId);
    expect(second.claim.planId).toBe(first.claim.planId); // 예약 planId 유지 = 고아 plan 방지

    // 이전 attempt 가 뒤늦게 커밋 시도 → 차단
    const stale = await beginPlanCommit(db, first.claim);
    expect((stale as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.CLAIM_LOST);
    expect(db._peek(CLAIM_PATH)!.status).toBe(PLAN_ISSUANCE_STATUS.ISSUING); // COMMITTING 으로 안 넘어감
  });

  it('planId 불일치 attempt 는 beginCommit 차단', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    const r = await beginPlanCommit(db, { ...claim, planId: 'someone-elses-plan' });
    expect((r as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.CLAIM_LOST);
  });

  it('owner 만 COMMITTING → ISSUED', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    await beginPlanCommit(db, claim);
    expect(await finalizePlanIssuance(db, claim)).toEqual({ ok: true });
    const doc = db._peek(CLAIM_PATH)!;
    expect(doc.status).toBe(PLAN_ISSUANCE_STATUS.ISSUED);
    expect(doc.planId).toBe(claim.planId);
    expect(doc.issuedAt).toBeTruthy();
  });

  it('ISSUING 을 건너뛴 finalize 는 거부 (COMMITTING 아니면 확정 금지)', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    const r = await finalizePlanIssuance(db, claim); // beginPlanCommit 없이
    expect((r as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.CLAIM_LOST);
  });

  it('🔴 finalize 실패를 성공으로 삼키지 않는다 (구 markPlanIssued 의 .catch() 회귀 차단)', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    await beginPlanCommit(db, claim);
    db._failNextTx(1, 'firestore down');
    await expect(finalizePlanIssuance(db, claim)).rejects.toThrow('firestore down');
  });

  it('같은 attempt 의 finalize 재실행은 멱등 (Inngest step retry)', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    await beginPlanCommit(db, claim);
    expect(await finalizePlanIssuance(db, claim)).toEqual({ ok: true });
    expect(await finalizePlanIssuance(db, claim)).toEqual({ ok: true }); // 두 번째도 성공
  });

  it('takeover 된 뒤 이전 attempt 의 finalize 도 차단', async () => {
    const db = makeFakeDb();
    const first = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    await beginPlanCommit(db, first.claim);
    // 다른 attempt 가 COMMITTING 을 차지한 상황 모사
    db._seed(CLAIM_PATH, {
      status: PLAN_ISSUANCE_STATUS.COMMITTING, attemptId: 'newer-attempt', planId: first.claim.planId,
    });
    const r = await finalizePlanIssuance(db, first.claim);
    expect((r as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.CLAIM_LOST);
    expect(db._peek(CLAIM_PATH)!.status).toBe(PLAN_ISSUANCE_STATUS.COMMITTING);
  });
});

describe('COMMITTING 복구 — 저장 성공 + 확정 직전 종료', () => {
  it('COMMITTING + 완성 plan 존재 → 새 생성 없이 ISSUED 복구 후 DUPLICATE', async () => {
    const db = makeFakeDb();
    db._seed(CLAIM_PATH, { status: PLAN_ISSUANCE_STATUS.COMMITTING, attemptId: 'dead', planId: 'plan-1' });
    db._seed('plans/plan-1', readyPlan('plan-1'));
    const r = await claimPlanIssuance(db, ORDER, {});
    expect((r as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.DUPLICATE);
    const doc = db._peek(CLAIM_PATH)!;
    expect(doc.status).toBe(PLAN_ISSUANCE_STATUS.ISSUED);
    expect(doc.recoveredAt).toBeTruthy();
  });

  it('COMMITTING + plan 없음 → takeover 하지 않고 IN_PROGRESS (저장 중일 수 있음)', async () => {
    const db = makeFakeDb();
    db._seed(CLAIM_PATH, { status: PLAN_ISSUANCE_STATUS.COMMITTING, attemptId: 'busy', planId: 'plan-1' });
    const r = await claimPlanIssuance(db, ORDER, {});
    expect((r as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.IN_PROGRESS);
    expect(db._peek(CLAIM_PATH)!.attemptId).toBe('busy');
  });

  it('만료 ISSUING + 완성 plan 존재 → 새 생성 없이 ISSUED 복구', async () => {
    const db = makeFakeDb();
    db._seed(CLAIM_PATH, {
      status: PLAN_ISSUANCE_STATUS.ISSUING, attemptId: 'dead', planId: 'plan-1', leaseExpiresAt: Date.now() - 1,
    });
    db._seed('plans/plan-1', readyPlan('plan-1'));
    const r = await claimPlanIssuance(db, ORDER, {});
    expect((r as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.DUPLICATE);
    expect(db._peek(CLAIM_PATH)!.status).toBe(PLAN_ISSUANCE_STATUS.ISSUED);
  });

  it('만료 ISSUING + plan 없음 → fencing takeover (새 attemptId, 같은 planId)', async () => {
    const db = makeFakeDb();
    db._seed(CLAIM_PATH, {
      status: PLAN_ISSUANCE_STATUS.ISSUING, attemptId: 'dead', planId: 'plan-1', leaseExpiresAt: Date.now() - 1,
    });
    const r = (await claimPlanIssuance(db, ORDER, {})) as { claim: { attemptId: string; planId: string } };
    expect(r.claim.attemptId).not.toBe('dead');
    expect(r.claim.planId).toBe('plan-1');
    expect(db._peek(CLAIM_PATH)!.takenOverAt).toBeTruthy();
  });
});

describe('isCompletedPlanForClaim — 미완성을 완료로 오인하면 결제한 사용자가 플랜을 영영 못 받는다', () => {
  const claim = { orderId: ORDER, planId: 'plan-1' };
  const snap = (d: Record<string, unknown> | null) => (d ? { exists: true, data: () => d } : { exists: false, data: () => undefined });

  it('정상 ready plan → 완료', () => {
    expect(isCompletedPlanForClaim(snap(readyPlan('plan-1')), claim)).toBe(true);
  });

  it('문서 없음 → 미완료', () => {
    expect(isCompletedPlanForClaim(snap(null), claim)).toBe(false);
  });

  it('🔴 streaming skeleton → 미완료 (완료로 오인 시 플랜 미발급)', () => {
    expect(isCompletedPlanForClaim(snap({ planId: 'plan-1', status: 'streaming', _streaming_in_progress: true, input: { paypalOrderId: ORDER } }), claim)).toBe(false);
  });

  it('🔴 status=ready 인데 _streaming_in_progress=true (progressive write 지연 도착) → 미완료', () => {
    expect(isCompletedPlanForClaim(snap({ ...readyPlan('plan-1'), _streaming_in_progress: true }), claim)).toBe(false);
  });

  it('🔴 P231 stub → 미완료', () => {
    expect(isCompletedPlanForClaim(snap({ ...readyPlan('plan-1'), _p231_stub: true }), claim)).toBe(false);
  });

  it('🔴 error plan → 미완료', () => {
    expect(isCompletedPlanForClaim(snap({ planId: 'plan-1', status: 'error', input: { paypalOrderId: ORDER } }), claim)).toBe(false);
  });

  it('🔴 다른 주문의 plan → 미완료 (보안: 남의 plan 을 이 결제의 완료로 인정 금지)', () => {
    expect(isCompletedPlanForClaim(snap(readyPlan('plan-1', 'OTHER-ORDER-ID')), claim)).toBe(false);
  });

  it('🔴 planId 불일치 → 미완료', () => {
    expect(isCompletedPlanForClaim(snap(readyPlan('different-plan')), claim)).toBe(false);
  });

  it('input.paypalOrderId 누락 → 미완료 (skeleton 창에는 이 필드가 없다)', () => {
    expect(isCompletedPlanForClaim(snap({ planId: 'plan-1', status: 'ready' }), claim)).toBe(false);
  });
});

describe('releasePlanIssuance — 생성 실패 후 같은 결제로 재시도', () => {
  it('ISSUING + owner → 삭제되어 재claim 통과 (재시도 보장)', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    expect(await releasePlanIssuance(db, claim)).toEqual({ released: true });
    expect(db._peek(CLAIM_PATH)).toBeUndefined();
    // 같은 결제로 재시도가 실제로 통과한다
    const again = await claimPlanIssuance(db, ORDER, {});
    expect('claim' in again && again.claim).toBeTruthy();
  });

  it('🔴 COMMITTING 은 release 하지 않는다 (plans 가 이미 저장됐을 수 있음 → reconcile 대상)', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    await beginPlanCommit(db, claim);
    const r = await releasePlanIssuance(db, claim);
    expect(r.released).toBe(false);
    expect(db._peek(CLAIM_PATH)!.status).toBe(PLAN_ISSUANCE_STATUS.COMMITTING); // 살아있다
  });

  it('🔴 오래된 cleanup 이 새 attempt 의 claim 을 삭제하지 못한다', async () => {
    const db = makeFakeDb();
    const first = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    db._seed(CLAIM_PATH, {
      status: PLAN_ISSUANCE_STATUS.ISSUING, attemptId: 'newer-attempt', planId: first.claim.planId,
      leaseExpiresAt: Date.now() + PLAN_ISSUANCE_LEASE_MS,
    });
    const r = await releasePlanIssuance(db, first.claim);
    expect(r.released).toBe(false);
    expect(db._peek(CLAIM_PATH)!.attemptId).toBe('newer-attempt'); // 살아있다
  });

  it('ISSUED 는 release 하지 않는다', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    await beginPlanCommit(db, claim);
    await finalizePlanIssuance(db, claim);
    expect((await releasePlanIssuance(db, claim)).released).toBe(false);
    expect(db._peek(CLAIM_PATH)!.status).toBe(PLAN_ISSUANCE_STATUS.ISSUED);
  });
});

// P1-A: 유료 발급 provenance 는 정확 비교. isAiPlannerProduct 의 "AI 상품군" 넓은 의미는
// 쿠폰 정책·주문 생성·line item 에서 정당하므로 **전역 의미를 좁히지 않는다** — 두 함수가
// 각자 다른 계약을 지킨다는 것 자체를 고정한다.
describe('isAiPlannerFullProduct — 정확한 유료 상품 판별 (P1-A)', () => {
  it.each(['ai_planner_full', 'ai-planner-full', 'AI_PLANNER_FULL', 'Ai-Planner-Full'])(
    '%s → true (하이픈/대소문자 정규화)', (v) => {
      expect(isAiPlannerFullProduct(v)).toBe(true);
    });

  it.each(['ai_planner_quick', 'ai-planner-quick', 'ai_planner_full_extra', 'ai_planner', 'charter_multiday', 'tour', ''])(
    '🔴 %s → false (다른 가격 상품으로 full 플랜 발급 금지)', (v) => {
      expect(isAiPlannerFullProduct(v)).toBe(false);
    });

  it.each([null, undefined, 123, {}])('비문자열 %s → false', (v) => {
    expect(isAiPlannerFullProduct(v as unknown as string)).toBe(false);
  });

  it('🔴 isAiPlannerProduct 의 넓은 의미는 그대로다 (쿠폰 정책·주문 생성이 의존 — 좁히면 회귀)', () => {
    expect(isAiPlannerProduct('ai_planner_quick')).toBe(true);
    expect(isAiPlannerProduct('ai_planner_full_extra')).toBe(true);
    // 두 함수의 계약이 실제로 갈라진다 = 정확 helper 를 따로 둔 이유
    expect(isAiPlannerFullProduct('ai_planner_quick')).toBe(false);
  });
});

describe('전체 수명 — 완성 plan 최대 1개', () => {
  it('정상 1회: claim → beginCommit → plans 저장 → finalize → 이후 재요청은 DUPLICATE', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, { uid: 'u1' })) as { claim: { orderId: string; attemptId: string; planId: string } };
    expect(await beginPlanCommit(db, claim)).toEqual({ ok: true });
    db._seed(`plans/${claim.planId}`, readyPlan(claim.planId));
    expect(await finalizePlanIssuance(db, claim)).toEqual({ ok: true });

    const retry = await claimPlanIssuance(db, ORDER, { uid: 'u1' });
    expect((retry as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.DUPLICATE);
  });

  it('🔴 응답 유실 후 재요청이 두 번째 plan 을 만들지 않는다', async () => {
    const db = makeFakeDb();
    const { claim } = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    await beginPlanCommit(db, claim);
    db._seed(`plans/${claim.planId}`, readyPlan(claim.planId));
    await finalizePlanIssuance(db, claim);
    // 사용자가 응답을 못 받고 재시도
    const retry = await claimPlanIssuance(db, ORDER, {});
    expect('claim' in retry).toBe(false);
    expect((retry as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.DUPLICATE);
  });

  it('🔴 takeover 뒤 이전 worker 가 늦게 완료 → 완성 plan 최대 1개 (fencing 이 저장을 차단)', async () => {
    const db = makeFakeDb();
    const first = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };
    db._seed(CLAIM_PATH, {
      status: PLAN_ISSUANCE_STATUS.ISSUING, attemptId: first.claim.attemptId,
      planId: first.claim.planId, leaseExpiresAt: Date.now() - 1,
    });
    const second = (await claimPlanIssuance(db, ORDER, {})) as { claim: { orderId: string; attemptId: string; planId: string } };

    // 새 attempt 가 정상 완주
    expect(await beginPlanCommit(db, second.claim)).toEqual({ ok: true });
    db._seed(`plans/${second.claim.planId}`, readyPlan(second.claim.planId));
    expect(await finalizePlanIssuance(db, second.claim)).toEqual({ ok: true });

    // 이전 worker 가 이제야 깨어나 저장하려 함 → beginCommit 에서 차단 → plans set 도달 못 함
    const stale = await beginPlanCommit(db, first.claim);
    expect((stale as { code: string }).code).toBe(PLAN_ISSUANCE_CODE.CLAIM_LOST);
    // plans 문서는 예약 planId 하나뿐
    const planPaths = db._writes.filter((w) => w.path.startsWith('plans/')).map((w) => w.path);
    expect(new Set(planPaths).size).toBeLessThanOrEqual(1);
  });
});
