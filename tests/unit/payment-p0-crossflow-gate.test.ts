/**
 * PayPal 잔여 P0 — cross-flow 가드 + AI paymentGate fail-closed (money-critical).
 *
 * 왜 (감사 근거: PAYMENT_P0_AUDIT_RESULT_HANDOFF.md):
 *  1. cross-flow — cart 주문은 cart_orders/{id} 에만 있고 paypal_order_snapshots/{id} 엔 없다.
 *     스냅샷이 없으면 금액 검증이 스킵되므로(strict provenance 기본 off), 싼 cart 주문을 승인한 뒤
 *     단건 capture endpoint 에 비싼 product/pax 를 body 로 보내면 저가 결제로 고가 예약이 기록된다.
 *  2. APPROVED — 구매자 승인만 끝난 미캡처 상태(돈 0). paymentGate 가 이를 통과시켜,
 *     승인 후 capture 호출만 차단하고 /api/ai-planner-full 을 직접 호출하면 무료 플랜이 발급됐다.
 *  3. 격리가 서버 신뢰 경계가 아니었다 — payment_reviews 를 프론트만 보고 서버는 안 봤다.
 *
 * ⚠️ 이 파일의 cross-flow 테스트는 **행위(behavioral)** 다 — 핸들러를 실제로 실행해
 *    "capture 가 호출되지 않았음" 을 증명한다. 소스 문자열 가드만 두면 가드를 삭제해도
 *    통과해 버려(-1 < 무엇이든) 아무것도 지키지 못한다.
 *
 * 실제 PayPal 은 호출하지 않는다 (전 의존 모듈 mock).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── capturePaypalOrder 의 부작용 import 전부 차단 ──────────────────────────
const dbHolder: { db: unknown } = { db: null };
const fetchCalls: string[] = [];

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbHolder.db }));
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => { fetchCalls.push('TOKEN'); return { accessToken: 't', baseUrl: 'https://api.mock' }; },
  resolveIsSandbox: () => true,
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: async () => {} }));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({ triggerBookingProcessor: async () => {} }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: async () => {} }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: async () => {} }));
vi.mock('../../api/onboarding-coupons.js', () => ({ issuePurchaseCouponsForOrder: async () => {} }));
vi.mock('../../api/_shared/slot-capacity.js', () => ({ confirmSlotLock: async () => {} }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: async () => ({ ok: true }) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));

// @ts-expect-error — JS 핸들러 (타입 선언 없음)
import captureHandler from '../../api/capturePaypalOrder.js';
// @ts-expect-error — JS 모듈
import { enforcePaymentAndRevision } from '../../api/_ai_core/paymentGate.js';

const captureSrc = readFileSync(resolve(process.cwd(), 'api/capturePaypalOrder.js'), 'utf8');
const rulesSrc = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const PAYPAL_ORDER = '5O190127TN364715T';

/** writeHead/end 를 기록하는 가짜 res. */
function mockRes() {
  const out: { status?: number; body?: Record<string, unknown> } = {};
  return {
    _out: out,
    writeHead(status: number) { out.status = status; return this; },
    end(body?: string) { try { out.body = body ? JSON.parse(body) : undefined; } catch { out.body = { raw: body }; } return this; },
  };
}

/** capture 핸들러용 db mock — cart_orders 존재/throw 를 제어. */
function captureDb(opts: { cartExists?: boolean; cartThrows?: boolean } = {}) {
  const writes: string[] = [];
  return {
    _writes: writes,
    collection(name: string) {
      return {
        doc(id: string) {
          return {
            get: async () => {
              if (name === 'cart_orders') {
                if (opts.cartThrows) throw new Error('firestore down');
                return { exists: !!opts.cartExists, data: () => ({}) };
              }
              return { exists: false, data: () => ({}) };
            },
            set: async () => { writes.push(`${name}/${id}`); },
            update: async () => { writes.push(`update:${name}/${id}`); },
            delete: async () => {},
          };
        },
      };
    },
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      writes.push('runTransaction');
      return fn({ get: async () => ({ exists: false, data: () => ({}) }), set: () => {}, update: () => {} });
    },
    batch: () => ({ set: () => {}, commit: async () => {} }),
  };
}

// ═════════════ P0-2: cross-flow 가드 (행위 테스트) ═════════════
describe('capturePaypalOrder — cross-flow 가드 (행위)', () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    global.fetch = vi.fn(async (url: unknown) => {
      fetchCalls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ status: 'COMPLETED' }) };
    }) as never;
  });

  it('cart_orders 존재 → 400 CROSS_FLOW_ORDER 로 거부', async () => {
    dbHolder.db = captureDb({ cartExists: true });
    const res = mockRes();
    await captureHandler({ method: 'POST', body: { orderID: PAYPAL_ORDER }, headers: {} }, res);
    expect(res._out.status).toBe(400);
    expect(res._out.body?.code).toBe('CROSS_FLOW_ORDER');
    expect(res._out.body?.ok).toBe(false);
  });

  it('cart_orders 존재 → PayPal capture 를 절대 호출하지 않음 (돈이 움직이지 않음)', async () => {
    dbHolder.db = captureDb({ cartExists: true });
    await captureHandler({ method: 'POST', body: { orderID: PAYPAL_ORDER }, headers: {} }, mockRes());
    expect(fetchCalls.some((u) => u.includes('/capture'))).toBe(false);
    expect(fetchCalls).not.toContain('TOKEN'); // 토큰 발급조차 안 함
  });

  it('cart_orders 존재 → 단건 lock 을 소비하지 않음 (정상 cart 재시도를 막지 않음)', async () => {
    const db = captureDb({ cartExists: true });
    dbHolder.db = db;
    await captureHandler({ method: 'POST', body: { orderID: PAYPAL_ORDER }, headers: {} }, mockRes());
    expect(db._writes).not.toContain('runTransaction');
    expect(db._writes.some((w) => w.includes('used_paypal_orders'))).toBe(false);
  });

  it('cart_orders 조회 throw → capture 전 retryable 503 (문서 없음으로 취급 안 함)', async () => {
    dbHolder.db = captureDb({ cartThrows: true });
    const res = mockRes();
    await captureHandler({ method: 'POST', body: { orderID: PAYPAL_ORDER }, headers: {} }, res);
    expect(res._out.status).toBe(503);
    expect(res._out.body?.code).toBe('ORDER_CHECK_UNAVAILABLE');
    expect(fetchCalls.some((u) => u.includes('/capture'))).toBe(false);
  });

  it('오류 응답에 내부 Firestore 오류/이메일/secret 미노출', async () => {
    dbHolder.db = captureDb({ cartThrows: true });
    const res = mockRes();
    await captureHandler({ method: 'POST', body: { orderID: PAYPAL_ORDER, userEmail: 'leak@example.com' }, headers: {} }, res);
    const body = JSON.stringify(res._out.body);
    expect(body).not.toMatch(/firestore down/i);
    expect(body).not.toMatch(/leak@example\.com/);
    expect(body).not.toMatch(/FIREBASE|PRIVATE_KEY/i);
  });

  it('cart 문서 없음 → cross-flow 로 막지 않고 기존 흐름 진입 (정상 단건 결제 회귀 없음)', async () => {
    dbHolder.db = captureDb({ cartExists: false });
    const res = mockRes();
    await captureHandler({ method: 'POST', body: { orderID: PAYPAL_ORDER }, headers: {} }, res);
    // cross-flow 로 거부되지 않았음 = 이 가드가 정상 주문을 오탐하지 않음.
    expect(res._out.body?.code).not.toBe('CROSS_FLOW_ORDER');
    expect(res._out.body?.code).not.toBe('ORDER_CHECK_UNAVAILABLE');
  });

  // 🔴 DB init 실패도 cart lookup 실패와 동일 정책 — 이전엔 throw 해서 outer catch 의
  //    500 INTERNAL_ERROR 로 빠졌고 응답에 내부 env 변수명이 실릴 수 있었다.
  it('initAdminDb() null → capture 전 503 ORDER_CHECK_UNAVAILABLE (500 아님)', async () => {
    dbHolder.db = null;
    const res = mockRes();
    await captureHandler({ method: 'POST', body: { orderID: PAYPAL_ORDER }, headers: {} }, res);
    expect(res._out.status).toBe(503);
    expect(res._out.body?.code).toBe('ORDER_CHECK_UNAVAILABLE');
    expect(res._out.body?.code).not.toBe('INTERNAL_ERROR');
  });

  it('DB null → PayPal token/capture 미호출', async () => {
    dbHolder.db = null;
    await captureHandler({ method: 'POST', body: { orderID: PAYPAL_ORDER }, headers: {} }, mockRes());
    expect(fetchCalls).not.toContain('TOKEN');
    expect(fetchCalls.some((u) => u.includes('/capture'))).toBe(false);
  });

  it('DB null → 응답에 내부 오류·FIREBASE_* env 명·이메일·secret 미노출', async () => {
    dbHolder.db = null;
    const res = mockRes();
    await captureHandler({ method: 'POST', body: { orderID: PAYPAL_ORDER, userEmail: 'leak@example.com' }, headers: {} }, res);
    const body = JSON.stringify(res._out.body);
    expect(body).not.toMatch(/FIREBASE/i);
    expect(body).not.toMatch(/env var/i);
    expect(body).not.toMatch(/admin db unavailable/i);
    expect(body).not.toMatch(/leak@example\.com/);
  });
});

// ═════════════ P0-3 A: order status fail-closed ═════════════
// ⚠️ mock 은 실제 PayPal `order` 스키마를 모델링한다. GET /v2/checkout/orders/{id} 200 은
//    capture 응답과 동일한 `#/components/schemas/order` 를 반환하고 payments.captures[] 를
//    기본 포함한다(PayPal OpenAPI 확인). 그래서 gate 가 같은 검증기를 재사용할 수 있다.
type OrderOpts = {
  ok?: boolean; status?: string; captureStatus?: string; value?: string; currency?: string;
  captures?: unknown[]; purchaseUnits?: unknown[]; id?: string;
};
function mockOrder(o: OrderOpts = {}) {
  const {
    ok = true, status = 'COMPLETED', captureStatus = 'COMPLETED',
    value = '9.90', currency = 'USD', id = 'CAP-1', captures, purchaseUnits,
  } = o;
  const node = { id, status: captureStatus, amount: { value, currency_code: currency } };
  const body = {
    id: '5O190127TN364715T', intent: 'CAPTURE', status,
    purchase_units: purchaseUnits ?? [{ payments: { captures: captures ?? [node] } }],
  };
  global.fetch = vi.fn(async () => ({ ok, status: ok ? 200 : 502, json: async () => body })) as never;
}

/** AI 플래너 정상 스냅샷 (프론트는 하이픈 'ai-planner-full' 를 보내고 create 가 원본 저장). */
const AI_SNAPSHOT = { productType: 'ai-planner-full', expectedUSD: '9.90', expectedCurrency: 'USD', expectedKRW: 14000 };

type GateOpts = {
  issuedExists?: boolean; issuedData?: Record<string, unknown>;
  review?: Record<string, unknown> | null; reviewThrows?: boolean;
  snapshot?: Record<string, unknown> | null; snapshotThrows?: boolean;
  claimTxThrows?: boolean;
};
// 2026-07-15 (P0 원자 발급): gate 가 plan_issued_orders 를 **transaction 으로 선점**하도록 바뀌어
// runTransaction 이 필수가 됐다(없으면 이 파일 전체가 TypeError).
// 함께 고친 것: 기존 set/update 가 `async () => {}` **no-op** 이라 gate 가 write 를 해도 mock 이
// 삼켜서 "통과" 했다 — 가드를 지워도 green 이 되는 구조였다. 이제 _writes 로 관찰한다.
// 이 tx 는 **직렬 실행**만 모델링한다(경합 X). 이 파일의 목적은 검증 **순서** 계약이고,
// 실제 race 증명은 payment-p0-atomic-issuance.test.ts 가 담당한다.
function gateDb(opts: GateOpts = {}) {
  const reads: string[] = [];
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];
  const store = new Map<string, Record<string, unknown>>();
  const snapshot = opts.snapshot === undefined ? AI_SNAPSHOT : opts.snapshot;

  function snapshotFor(name: string, id: string) {
    reads.push(`${name}/${id}`);
    if (name === 'payment_reviews') {
      if (opts.reviewThrows) throw new Error('firestore unavailable');
      return opts.review ? { exists: true, data: () => opts.review } : { exists: false, data: () => ({}) };
    }
    if (name === 'paypal_order_snapshots') {
      if (opts.snapshotThrows) throw new Error('firestore unavailable');
      return snapshot ? { exists: true, data: () => snapshot } : { exists: false, data: () => ({}) };
    }
    if (name === 'plan_issued_orders') {
      const seeded = store.get(`${name}/${id}`);
      if (seeded) return { exists: true, data: () => seeded };
      // issuedExists 기본 = status 없는 레거시 마커 → DUPLICATE (기존 테스트 의미 보존).
      if (opts.issuedExists) return { exists: true, data: () => opts.issuedData || { planId: 'p1', provider: 'paypal' } };
      return { exists: false, data: () => ({}) };
    }
    return { exists: false, data: () => ({}) };
  }

  function docRef(name: string, id: string) {
    return {
      __c: name, __id: id,
      get: async () => snapshotFor(name, id),
      set: async (data: Record<string, unknown>) => { writes.push({ path: `${name}/${id}`, data }); },
      update: async (data: Record<string, unknown>) => { writes.push({ path: `${name}/${id}`, data }); },
    };
  }

  return {
    _reads: reads,
    _writes: writes,
    collection: (name: string) => ({ doc: (id: string) => docRef(name, id) }),
    async runTransaction(cb: (tx: unknown) => Promise<unknown>) {
      if (opts.claimTxThrows) throw new Error('firestore unavailable');
      const staged: Array<{ ref: ReturnType<typeof docRef>; data: Record<string, unknown>; op: string }> = [];
      const tx = {
        get: async (ref: ReturnType<typeof docRef>) => snapshotFor(ref.__c, ref.__id),
        set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => staged.push({ ref, data, op: 'set' }),
        update: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => staged.push({ ref, data, op: 'update' }),
        delete: (ref: ReturnType<typeof docRef>) => staged.push({ ref, data: {}, op: 'delete' }),
      };
      const result = await cb(tx);
      for (const w of staged) {
        writes.push({ path: `${w.ref.__c}/${w.ref.__id}`, data: w.data });
        const path = `${w.ref.__c}/${w.ref.__id}`;
        if (w.op === 'delete') store.delete(path);
        else store.set(path, { ...(store.get(path) || {}), ...w.data });
      }
      return result;
    },
  };
}

describe('paymentGate — order status fail-closed (COMPLETED 만 통과)', () => {

  it('APPROVED → 거부 (승인만 = 미캡처 = 돈 0)', async () => {
    mockOrder({ status: 'APPROVED' });
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_INCOMPLETE');
    expect(r.rejection?.statusCode).toBe(403);
  });

  it.each(['CREATED', 'SAVED', 'VOIDED', 'PAYER_ACTION_REQUIRED', 'WEIRD_UNKNOWN'])(
    '%s → 거부 (미지 상태도 통과 금지)', async (status) => {
      mockOrder({ status });
      const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
      expect(r.rejection?.code).toBe('PAYMENT_INCOMPLETE');
    });

  it('PayPal GET order HTTP 실패 → 본문 status 를 믿지 않고 거부', async () => {
    mockOrder({ ok: false });
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_VERIFY_FAILED');
    expect(r.rejection?.statusCode).toBe(403);
  });

  it('COMPLETED + review 없음 → 정상 통과 (회귀 없음)', async () => {
    mockOrder({});
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
    expect(r.rejection).toBeUndefined();
    expect(r.isRevision).toBe(false);
  });

  // ── P0-3 B: 격리를 서버 신뢰 경계로 ──
  it('미해결 review → 거부 (프론트 우회 직접 호출 차단)', async () => {
    mockOrder({});
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ review: { resolvedAt: null, resolution: null } }), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_UNDER_REVIEW');
    expect(r.rejection?.statusCode).toBe(403);
  });

  it('review 확인이 plan_issued_orders 검사보다 먼저', async () => {
    mockOrder({});
    const db = gateDb({ review: { resolvedAt: null }, issuedExists: false });
    await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, db, 'u@e.com');
    expect(db._reads.some((k) => k.startsWith('payment_reviews/'))).toBe(true);
    expect(db._reads.some((k) => k.startsWith('plan_issued_orders/'))).toBe(false);
  });

  // 정책 근거: 환불로 종결된 건은 돈이 없으므로 발급 금지.
  it('resolved + resolution=REFUNDED → 거부 (돈이 없음)', async () => {
    mockOrder({});
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ review: { resolvedAt: 123, resolution: 'REFUNDED' } }), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_UNDER_REVIEW');
  });

  // mutant 가드: 조건의 resolvedAt 쪽을 지워도 잡히도록.
  it('resolution=MANUALLY_CONFIRMED 이지만 resolvedAt 없음 → 거부 (미해결)', async () => {
    mockOrder({});
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ review: { resolvedAt: null, resolution: 'MANUALLY_CONFIRMED' } }), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_UNDER_REVIEW');
  });

  it('resolved + MANUALLY_CONFIRMED → 통과 (운영자가 명시 확정한 건만)', async () => {
    mockOrder({});
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ review: { resolvedAt: 123, resolution: 'MANUALLY_CONFIRMED' } }), 'u@e.com');
    expect(r.rejection).toBeUndefined();
  });

  it('review 조회 실패 → "review 없음" 으로 간주하지 않고 fail-closed', async () => {
    mockOrder({});
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ reviewThrows: true }), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_REVIEW_CHECK_UNAVAILABLE');
    expect(r.rejection?.statusCode).toBe(503);
  });

  it('Admin DB unavailable → 거부 (이전엔 검사 통째 스킵 = fail-open)', async () => {
    mockOrder({});
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, null, 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_VERIFY_UNAVAILABLE');
    expect(r.rejection?.statusCode).toBe(503);
  });

  it('기존 plan_issued_orders 중복 방지 유지 (회귀 없음)', async () => {
    mockOrder({});
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ issuedExists: true }), 'u@e.com');
    expect(r.rejection?.code).toBe('DUPLICATE_ORDER');
  });
});

// ═════════════ P0-A: Order COMPLETED ≠ 결제 완료 (실제 capture 상태 검증) ═════════════
// PayPal 공식: "The Order and Capture objects have separate lifecycles" — Order COMPLETED 는
// capture 라이프사이클이 **시작**됐다는 뜻일 뿐이다. Order COMPLETED 의 next step 은
// "checking the Capture object status in the Order API response". eCheck/리스크홀드로
// PENDING 이, 위험판정으로 DECLINED 가 정상 흐름에서 발생한다.
describe('paymentGate — 실제 capture 상태만 신뢰 (P0-A)', () => {
  it('Order COMPLETED + capture COMPLETED + 금액 정합 → 통과', async () => {
    mockOrder({});
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
    expect(r.rejection).toBeUndefined();
  });

  // 🔴 디지털 상품은 PENDING 에 이행하지 않는다 (PayPal: "Wait until COMPLETED or DECLINED
  //    before fulfilling"). 재결제 유도도 금지 → 전용 코드.
  it('Order COMPLETED + capture PENDING → 발급 금지 (정산 대기)', async () => {
    mockOrder({ captureStatus: 'PENDING' });
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_PENDING_SETTLEMENT');
  });

  it.each(['DECLINED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'WEIRD'])(
    'Order COMPLETED + capture %s → 발급 금지', async (captureStatus) => {
      mockOrder({ captureStatus });
      const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
      expect(r.rejection?.code).toBe('PAYMENT_NOT_CAPTURED');
    });

  it('capture node 없음 → 발급 금지', async () => {
    mockOrder({ captures: [] });
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_NOT_CAPTURED');
  });

  it('capture 2개 → 발급 금지 (intent=CAPTURE 는 order 당 1회)', async () => {
    const n = { id: 'C1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } };
    mockOrder({ captures: [n, { ...n, id: 'C2' }] });
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_NOT_CAPTURED');
  });

  it('purchase unit 2개 → 발급 금지', async () => {
    const pu = { payments: { captures: [{ id: 'C1', status: 'COMPLETED', amount: { value: '9.90', currency_code: 'USD' } }] } };
    mockOrder({ purchaseUnits: [pu, pu] });
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_NOT_CAPTURED');
  });

  it.each([['9.89', '1 cent 부족'], ['9.91', '1 cent 초과']])(
    'capture 금액 %s (%s) → 발급 금지', async (value) => {
      mockOrder({ value });
      const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
      expect(r.rejection?.code).toBe('PAYMENT_NOT_CAPTURED');
    });

  it('capture 통화가 USD 아님 → 발급 금지', async () => {
    mockOrder({ currency: 'KRW', value: '14000' });
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb(), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_NOT_CAPTURED');
  });
});

// ═════════════ P0-B: AI 플래너 주문 provenance 바인딩 ═════════════
describe('paymentGate — 주문 provenance (P0-B)', () => {
  beforeEach(() => { mockOrder({}); });

  it('스냅샷 productType=ai-planner-full (하이픈) + 정합 → 통과', async () => {
    // 🔴 프론트는 하이픈으로 보내고 create 는 원본을 저장한다. 문자열 직접 비교로 구현하면
    //    정상 결제가 100% 거부된다 → 정규화 헬퍼(isAiPlannerProduct) 사용을 고정.
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ snapshot: { ...AI_SNAPSHOT, productType: 'ai-planner-full' } }), 'u@e.com');
    expect(r.rejection).toBeUndefined();
  });

  it('스냅샷 productType=ai_planner_full (언더스코어) 도 통과', async () => {
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ snapshot: { ...AI_SNAPSHOT, productType: 'ai_planner_full' } }), 'u@e.com');
    expect(r.rejection).toBeUndefined();
  });

  // 🔴 핵심: 정상 결제한 다른 상품 주문 ID 재사용 = 무료 플랜 (이번에 막는 구멍)
  it.each(['charter_busan', 'airport_pickup', 'kpop_shuttle', 'tour'])(
    '다른 상품 주문(%s) ID 로 플랜 요청 → 거부', async (productType) => {
      const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ snapshot: { ...AI_SNAPSHOT, productType, expectedUSD: '300.00' } }), 'u@e.com');
      expect(r.rejection?.code).toBe('ORDER_PRODUCT_MISMATCH');
    });

  it('스냅샷 없음 → 거부 (body fallback 금지)', async () => {
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ snapshot: null }), 'u@e.com');
    expect(r.rejection?.code).toBe('ORDER_PROVENANCE_MISSING');
  });

  it('스냅샷 조회 throw → retryable 503 ("없음" 으로 취급 금지)', async () => {
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ snapshotThrows: true }), 'u@e.com');
    expect(r.rejection?.code).toBe('PAYMENT_VERIFY_UNAVAILABLE');
    expect(r.rejection?.statusCode).toBe(503);
  });

  it.each([[undefined], [''], ['0.00'], ['abc'], [-1]])(
    'expectedUSD 무효(%s) → 거부', async (expectedUSD) => {
      const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ snapshot: { ...AI_SNAPSHOT, expectedUSD } }), 'u@e.com');
      expect(r.rejection?.code).toBe('ORDER_PROVENANCE_INVALID');
    });

  // 환율이 바뀌어도 주문 생성 당시 스냅샷 값을 쓴다 (현재가로 재계산 금지).
  it('스냅샷 expectedUSD 를 사용 — 현재 환율/가격과 무관', async () => {
    // 스냅샷은 과거 가격 8.50 으로 결제된 주문. capture 도 8.50 → 정합 → 통과해야 한다.
    mockOrder({ value: '8.50' });
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ snapshot: { ...AI_SNAPSHOT, expectedUSD: '8.50' } }), 'u@e.com');
    expect(r.rejection).toBeUndefined();
  });

  it('legacy 스냅샷(expectedCurrency 없음) → USD 로 간주해 통과 (create 가 항상 USD 주문 생성)', async () => {
    const { expectedCurrency: _drop, ...legacy } = AI_SNAPSHOT;
    const r = await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, gateDb({ snapshot: legacy }), 'u@e.com');
    expect(r.rejection).toBeUndefined();
  });

  it('provenance 검사가 plan_issued_orders 보다 먼저', async () => {
    const db = gateDb({ snapshot: null, issuedExists: false });
    await enforcePaymentAndRevision({ paypalOrderId: PAYPAL_ORDER }, db, 'u@e.com');
    expect(db._reads.some((k) => k.startsWith('paypal_order_snapshots/'))).toBe(true);
    expect(db._reads.some((k) => k.startsWith('plan_issued_orders/'))).toBe(false);
  });
});

// ═════════════ 지역화 — "다시 결제하지 마세요" 가 한국어 전용이면 안 됨 ═════════════
describe('결제 오류 코드 지역화 (이중청구 방지 문구)', () => {
  const CODES = [
    'PAYMENT_UNDER_REVIEW', 'PAYMENT_VERIFY_FAILED', 'PAYMENT_VERIFY_UNAVAILABLE', 'PAYMENT_REVIEW_CHECK_UNAVAILABLE',
    'ORDER_PROVENANCE_MISSING', 'ORDER_PRODUCT_MISMATCH', 'ORDER_PROVENANCE_INVALID',
    'PAYMENT_PENDING_SETTLEMENT', 'PAYMENT_NOT_CAPTURED',
  ];

  it.each(['en', 'ko', 'ja', 'zh'])('%s 로케일에 4개 코드 모두 존재', (lang) => {
    const j = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${lang}.json`), 'utf8'));
    for (const c of CODES) expect(j.planner?.errors?.[c], `${lang}.planner.errors.${c} 누락`).toBeTruthy();
  });

  it('PlannerErrorCode union 에 4개 코드 등록 (없으면 서버 한국어 details 로 폴백)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/pages/PlannerPage/hooks/usePlannerHandlers.ts'), 'utf8');
    for (const c of CODES) expect(src).toContain(`'${c}'`);
  });
});

// ═════════════ P0-1: firestore.rules (정적) ═════════════
// rules emulator 인프라(@firebase/rules-unit-testing / tests/rules)가 이 레포에 없다.
// → 거대한 테스트 인프라를 새로 만들지 않고 정적 검토로 고정. **실제 rules 평가는 미검증.**
describe('firestore.rules — payment_reviews (정적, 실평가 미검증)', () => {
  const start = rulesSrc.indexOf('match /payment_reviews/');
  const block = start === -1 ? '' : rulesSrc.slice(start, rulesSrc.indexOf('}', rulesSrc.indexOf('allow write', start)) + 1);

  it('payment_reviews match 블록 존재', () => {
    expect(start).toBeGreaterThan(-1);
  });
  it('read 는 admin 만 + client write 전면 금지, 규칙은 정확히 2개', () => {
    expect(block).toMatch(/allow read: if isAdminEmail\(\);/);
    expect(block).toMatch(/allow write: if false;/);
    expect(block.match(/allow /g)?.length).toBe(2); // 규칙이 추가/이동되면 잡힌다
  });
});

// ═════════════ 소스 불변식 (행위 테스트 보조 — 앵커 존재를 먼저 단언) ═════════════
describe('capturePaypalOrder — cross-flow 배치 불변식 (소스)', () => {
  const crossFlowIdx = captureSrc.indexOf("collection('cart_orders')");
  const lockIdx = captureSrc.indexOf("collection('used_paypal_orders')");
  const tokenIdx = captureSrc.indexOf('getPaypalAccessToken(');
  const captureCallIdx = captureSrc.indexOf('/capture`');

  // ⚠️ 앵커가 없으면(-1) 아래 순서 단언이 전부 자동 통과해 버린다 → 먼저 존재를 단언.
  it('앵커 4개 모두 존재 (가드가 삭제되면 여기서 실패)', () => {
    expect(crossFlowIdx, 'cart_orders 가드 없음').toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(-1);
    expect(tokenIdx).toBeGreaterThan(-1);
    expect(captureCallIdx).toBeGreaterThan(-1);
  });

  it('가드가 토큰발급·lock·capture 보다 모두 먼저', () => {
    expect(crossFlowIdx).toBeGreaterThan(-1);
    expect(crossFlowIdx).toBeLessThan(tokenIdx);
    expect(crossFlowIdx).toBeLessThan(lockIdx);
    expect(crossFlowIdx).toBeLessThan(captureCallIdx);
  });

  it('가드 블록이 catch 로 fail-closed (구조 기준 — 로그 문구에 의존하지 않음)', () => {
    const guard = captureSrc.slice(crossFlowIdx, captureCallIdx);
    expect(guard).toMatch(/catch \(_cfErr\)/);
    expect(guard).toMatch(/ORDER_CHECK_UNAVAILABLE/);
    expect(guard).toMatch(/writeHead\(503/);
  });
});
