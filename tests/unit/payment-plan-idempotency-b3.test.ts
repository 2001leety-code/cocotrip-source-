// ─────────────────────────────────────────────────────────────────────────────
// B3 (P311, 2026-05-30) — 결제 vs plan-발급 멱등성 분리 회귀 테스트 (출시 blocker)
//
// 배경 (deep-search prod 데이터 확정):
//   capturePaypalOrder.js 가 capture 성공 시 used_paypal_orders/{orderID}='captured'
//   를 만드는데, paymentGate 가 같은 doc 존재를 DUPLICATE 로 오인 → 실제 유료 첫 plan
//   도 100% DUPLICATE_ORDER 403. 현재 전 트래픽 ADMIN-BYPASS 라 미발현이나, 6월 상용화
//   실제 PayPal 결제 시작 시 즉시 터지는 출시 blocker.
//
// P311 fix:
//   - paymentGate: PayPal 분기에서 plan_issued_orders 검사 (used_paypal_orders 아님) +
//     write 제거 (planPersister 로 이전).
//   - used_paypal_orders (결제 capture 멱등성, capturePaypalOrder) 는 절대 불변.
//
// ⭐ 핵심 회귀: paymentGate 가 (1) plan_issued_orders 를 검사하고 (2) used_paypal_orders
//    에 절대 write 안 한다 (capture 멱등성 침범 0).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach } from 'vitest';

// PayPal API + Sentry mock (PayPal 분기 진입 위해).
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'mock-token', baseUrl: 'https://api.mock' }),
  // P314 (2026-05-30): paymentGate.js 가 resolveIsSandbox 도 import → mock 에 추가 (없으면 3건 실패).
  resolveIsSandbox: () => false,
}));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));

// @ts-expect-error — paymentGate.js 는 JS 모듈 (타입 선언 없음)
import { enforcePaymentAndRevision } from '../../api/_ai_core/paymentGate.js';

// PayPal order status fetch mock (COMPLETED 반환).
beforeEach(() => {
  global.fetch = vi.fn(async () => ({ json: async () => ({ status: 'COMPLETED' }) })) as never;
});

// mock adminDb — collection().doc().get/set 추적.
function mockDb(opts: { issuedExists?: boolean } = {}) {
  const writes: Array<{ collection: string; id: string; data: unknown }> = [];
  const reads: Array<{ collection: string; id: string }> = [];
  const db = {
    _writes: writes,
    _reads: reads,
    collection(name: string) {
      return {
        add: async (data: unknown) => { writes.push({ collection: name, id: '(auto)', data }); },
        doc(id: string) {
          return {
            get: async () => {
              reads.push({ collection: name, id });
              const exists = name === 'plan_issued_orders' ? !!opts.issuedExists : false;
              return { exists, data: () => ({}) };
            },
            set: async (data: unknown) => { writes.push({ collection: name, id, data }); },
            update: async () => {},
          };
        },
      };
    },
  };
  return db;
}

const PAYPAL_ORDER = '5O190127TN364715T'; // 17자 실제 PayPal order ID 형식

describe('B3 (P311) — paymentGate plan-발급 멱등성 분리', () => {
  it('PayPal 첫 결제 (plan_issued_orders 미존재) → 통과 (rejection 없음)', async () => {
    const db = mockDb({ issuedExists: false });
    const result = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, db, 'user@example.com');
    expect(result.rejection).toBeUndefined();
    expect(result.isRevision).toBe(false);
  });

  it('⭐ 출시 blocker fix: paymentGate 가 plan_issued_orders 를 검사 (used_paypal_orders 아님)', async () => {
    const db = mockDb({ issuedExists: false });
    await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, db, 'user@example.com');
    // plan_issued_orders 를 읽어야 함.
    expect(db._reads.some(r => r.collection === 'plan_issued_orders' && r.id === PAYPAL_ORDER)).toBe(true);
    // used_paypal_orders 는 읽지 않아야 함 (capture 멱등성 영역).
    expect(db._reads.some(r => r.collection === 'used_paypal_orders')).toBe(false);
  });

  it('⭐ capture 멱등성 불변: paymentGate 가 used_paypal_orders 에 절대 write 안 함', async () => {
    const db = mockDb({ issuedExists: false });
    await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, db, 'user@example.com');
    expect(db._writes.some(w => w.collection === 'used_paypal_orders')).toBe(false);
  });

  it('⭐ 재시도 허용: paymentGate 는 plan_issued_orders 에도 write 안 함 (write 는 persistPlan 으로 이전)', async () => {
    // 통과 시점에 write 하면 plan 생성 실패 후 재시도가 막힘 (원래 버그). write 는 persistPlan.
    const db = mockDb({ issuedExists: false });
    await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, db, 'user@example.com');
    expect(db._writes.some(w => w.collection === 'plan_issued_orders')).toBe(false);
  });

  it('이중 plan 차단: plan_issued_orders 존재 → DUPLICATE_ORDER 403', async () => {
    const db = mockDb({ issuedExists: true });
    const result = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, db, 'user@example.com');
    expect(result.rejection).toBeDefined();
    expect(result.rejection.code).toBe('DUPLICATE_ORDER');
    expect(result.rejection.statusCode).toBe(403);
  });

  it('ADMIN-BYPASS 는 멱등성 검사 안 거침 (plan_issued_orders read 0)', async () => {
    const db = mockDb({ issuedExists: false });
    const result = await enforcePaymentAndRevision(
      { paypalOrderId: 'ADMIN-BYPASS-test-123' }, db, '2001leety@gmail.com',
    );
    expect(result.isAdminBypass).toBe(true);
    expect(db._reads.some(r => r.collection === 'plan_issued_orders')).toBe(false);
    expect(db._reads.some(r => r.collection === 'used_paypal_orders')).toBe(false);
  });
});

describe('B3 (P311) — persistPlan plan_issued_orders write 대상 판정 (prefix regex)', () => {
  // planPersister 의 write 가드: /^(ADMIN-BYPASS-|TEST-|MANUAL-)/ 아니면 PayPal 실제 결제.
  const SKIP = /^(ADMIN-BYPASS-|TEST-|MANUAL-)/;
  it('PayPal 17자 orderId → write 대상 (skip 아님)', () => {
    expect(SKIP.test('5O190127TN364715T')).toBe(false);
  });
  it('ADMIN-BYPASS-* → skip', () => {
    expect(SKIP.test('ADMIN-BYPASS-p296-123')).toBe(true);
  });
  it('TEST-* → skip', () => {
    expect(SKIP.test('TEST-abc')).toBe(true);
  });
  it('MANUAL-* → skip (capturePaypalOrder 안 거침, used_paypal_orders 별도)', () => {
    expect(SKIP.test('MANUAL-booking123')).toBe(true);
  });
});
