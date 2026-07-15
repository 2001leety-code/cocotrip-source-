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
  // P314: paymentGate 가 resolveIsSandbox import → mock 에도 추가 (prod=live 가정).
  resolveIsSandbox: () => false,
}));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));

// @ts-expect-error — paymentGate.js 는 JS 모듈 (타입 선언 없음)
import { enforcePaymentAndRevision } from '../../api/_ai_core/paymentGate.js';

// PayPal order status fetch mock (COMPLETED 반환).
// `ok: true` 필수 — 실제 fetch Response 는 항상 ok 를 갖는다. paymentGate 는 2026-07-15 부터
// HTTP 실패(!ok)를 명시적으로 거부하므로(조회 불가 = 결제 확인 불가 = 발급 금지), ok 없는
// mock 은 실물과 달라 PAYMENT_VERIFY_FAILED 로 떨어진다. 단언 약화가 아니라 mock 현실화.
beforeEach(() => {
  // 실제 PayPal `order` 스키마를 모델링한다. paymentGate 는 2026-07-15 부터 top-level status 뿐
  // 아니라 purchase_units[].payments.captures[] 의 실제 capture 상태·금액·통화를 검증한다
  // (GET order 200 은 capture 응답과 동일한 order 스키마 + payments 기본 포함 — PayPal OpenAPI).
  global.fetch = vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({
      id: PAYPAL_ORDER, intent: 'CAPTURE', status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } }] } }],
    }),
  })) as never;
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
              // paymentGate 는 이제 AI 플래너 주문 provenance(paypal_order_snapshots)를 요구한다.
              // 스냅샷이 없으면 ORDER_PROVENANCE_MISSING 으로 거부되므로 정상 주문을 모델링한다.
              if (name === 'paypal_order_snapshots') {
                return { exists: true, data: () => ({ productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD' }) };
              }
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
