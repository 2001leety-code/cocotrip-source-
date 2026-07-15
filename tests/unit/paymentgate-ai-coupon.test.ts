// ─────────────────────────────────────────────────────────────────────────────
// P1-②(여름 이벤트, 2026-06-27) — AI 플랜 무료 쿠폰 0원 결제 경로 (paymentGate).
//
// body.aiCouponCode 로 들어온 AI 무료 쿠폰을 검증(소유 uid·productScope='ai-plan'·
// type='free'·미사용·미만료·durationDays≤maxDays)하고 멱등 소비(트랜잭션 isUsed)한 뒤
// 0원 통과(isFreeAiCoupon=true). 더블클릭/동시요청이 무료 plan 2개 생성(돈손실)하는 것 차단.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'x', baseUrl: 'https://api.mock' }),
  resolveIsSandbox: () => false,
}));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));

// @ts-expect-error — paymentGate.js 는 JS 모듈 (타입 선언 없음)
import { enforcePaymentAndRevision, restoreAiPlanCoupon } from '../../api/_ai_core/paymentGate.js';

beforeEach(() => {
  // `ok: true` 포함 — 실제 fetch Response 는 항상 ok 를 갖는다. paymentGate 는 HTTP 실패(!ok)를
  // 명시적으로 거부하므로 ok 없는 mock 은 실물과 다르다. (쿠폰 경로는 이 mock 을 소비하지 않지만,
  // 다음 사람이 복사해 쓰면 PAYMENT_VERIFY_FAILED 로 헛디딘다.)
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) })) as never;
});

// users/{uid}/coupons.where('code','==',code).limit(1).get() + runTransaction 흐름 mock.
function couponDb(coupon: Record<string, unknown> | null) {
  let used = (coupon?.isUsed as boolean) || false;
  const couponRef = { _ref: true, async update(data: { isUsed?: boolean }) { if ('isUsed' in data) used = data.isUsed as boolean; } };
  const col = {
    where() { return col; },   // .where().where() chain
    limit() { return col; },
    async get() {
      return {
        empty: !coupon,
        docs: coupon ? [{ ref: couponRef, data: () => ({ ...coupon, isUsed: used }) }] : [],
      };
    },
  };
  return {
    collection: () => ({ doc: () => ({ collection: () => col }) }),
    async runTransaction(fn: (tx: unknown) => Promise<unknown>) {
      const tx = {
        get: async () => ({ data: () => ({ isUsed: used }) }),
        update: (_ref: unknown, data: { isUsed?: boolean }) => { if (data.isUsed) used = true; },
      };
      return fn(tx);
    },
  };
}

const UID = 'user123';
const AI = { code: 'WELCOME-AIPLAN-ABC23', productScope: 'ai-plan', type: 'free', value: 100, isUsed: false, maxDays: 3 };

describe('paymentGate — AI 무료 쿠폰 0원 경로 (P1-②)', () => {
  it('유효 쿠폰 + 1~3일 → 0원 통과 (isFreeAiCoupon=true, rejection 없음)', async () => {
    const db = couponDb({ ...AI });
    const r = await enforcePaymentAndRevision({ aiCouponCode: AI.code, durationDays: 3 }, db, 'u@e.com', UID);
    expect(r.rejection).toBeUndefined();
    expect(r.isFreeAiCoupon).toBe(true);
    expect(r.isRevision).toBe(false);
  });

  it('미로그인(uid 없음) → AUTH_REQUIRED (로그인 강제)', async () => {
    const db = couponDb({ ...AI });
    const r = await enforcePaymentAndRevision({ aiCouponCode: AI.code, durationDays: 3 }, db, 'u@e.com', null);
    expect(r.rejection?.code).toBe('AUTH_REQUIRED');
  });

  it('이미 사용한 쿠폰 → COUPON_USED (재사용 차단)', async () => {
    const db = couponDb({ ...AI, isUsed: true });
    const r = await enforcePaymentAndRevision({ aiCouponCode: AI.code, durationDays: 3 }, db, 'u@e.com', UID);
    expect(r.rejection?.code).toBe('COUPON_USED');
  });

  it('일수 초과 (4일 > maxDays 3) → COUPON_DAYS_EXCEEDED', async () => {
    const db = couponDb({ ...AI });
    const r = await enforcePaymentAndRevision({ aiCouponCode: AI.code, durationDays: 4 }, db, 'u@e.com', UID);
    expect(r.rejection?.code).toBe('COUPON_DAYS_EXCEEDED');
  });

  it('없는 쿠폰 코드 → COUPON_NOT_FOUND', async () => {
    const db = couponDb(null);
    const r = await enforcePaymentAndRevision({ aiCouponCode: 'NOPE-CODE', durationDays: 3 }, db, 'u@e.com', UID);
    expect(r.rejection?.code).toBe('COUPON_NOT_FOUND');
  });

  it('잘못된 scope (charter 쿠폰을 AI 에) → COUPON_WRONG_TYPE', async () => {
    const db = couponDb({ code: 'WELCOME-CHARTER-X', productScope: 'charter', type: 'percent', isUsed: false });
    const r = await enforcePaymentAndRevision({ aiCouponCode: 'WELCOME-CHARTER-X', durationDays: 3 }, db, 'u@e.com', UID);
    expect(r.rejection?.code).toBe('COUPON_WRONG_TYPE');
  });

  it('멱등: 소비 후 같은 쿠폰 재시도 → COUPON_USED (트랜잭션이 두 번째 막음)', async () => {
    const db = couponDb({ ...AI });
    const r1 = await enforcePaymentAndRevision({ aiCouponCode: AI.code, durationDays: 2 }, db, 'u@e.com', UID);
    expect(r1.isFreeAiCoupon).toBe(true);
    const r2 = await enforcePaymentAndRevision({ aiCouponCode: AI.code, durationDays: 2 }, db, 'u@e.com', UID);
    expect(r2.rejection?.code).toBe('COUPON_USED');
  });

  it('롤백(버그헌트 A): 소비 후 restoreAiPlanCoupon → 재시도 통과 (plan 생성 실패 보상)', async () => {
    const db = couponDb({ ...AI });
    const r1 = await enforcePaymentAndRevision({ aiCouponCode: AI.code, durationDays: 2 }, db, 'u@e.com', UID);
    expect(r1.isFreeAiCoupon).toBe(true);
    // gate 가 롤백용 쿠폰 정보(uid+code)를 반환해야 함
    expect(r1.consumedCoupon).toEqual({ uid: UID, code: AI.code });
    // plan 생성 실패 시나리오 → 쿠폰 롤백(isUsed=false)
    await restoreAiPlanCoupon(db, UID, AI.code);
    // 롤백 후 재시도 → 쿠폰 부활로 다시 0원 통과 (1장뿐인 쿠폰 영구 소실 안 됨)
    const r2 = await enforcePaymentAndRevision({ aiCouponCode: AI.code, durationDays: 2 }, db, 'u@e.com', UID);
    expect(r2.rejection).toBeUndefined();
    expect(r2.isFreeAiCoupon).toBe(true);
  });
});
