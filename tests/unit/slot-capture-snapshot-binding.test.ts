/**
 * F2 (2026-08-09) — 단건 capture 의 슬롯 확정은 **create 스냅샷 바인딩**만 쓴다 (좌석/돈 critical).
 *
 * 왜: `capturePaypalOrder.js` 는 tourId·tourSlotId·bookingDate·slotCapacity 를 capture-time
 * body 에서 읽어 그대로 confirmSlotLock 에 넘겼다. create 단계에서 서버가 어떤 슬롯을 잠갔는지는
 * `paypal_order_snapshots/{orderID}` 에 남지 않았다 → 두 값이 아무 것에도 묶여 있지 않았다.
 *
 * 그래서 가능했던 일 (돈은 한 번만 내고 좌석 회계를 어긋내는 공격):
 *   1. 값싼/한적한 슬롯으로 주문 생성(pre-lock) → capture 때 body 를 인기 슬롯/다른 날짜로 바꿔
 *      전송 → 결제하지 않은 슬롯에 confirmed 좌석이 올라간다(좌석 선점·타 고객 차단).
 *   2. 실제로 결제한 슬롯의 pending 은 confirm 되지 않고 10분 뒤 sweep 으로 풀린다 →
 *      만석 슬롯이 계속 비어 보이며 무제한 오버부킹.
 *   3. body.slotCapacity 는 #1259 가 서버 재확인을 붙였지만, **어느 슬롯을 재확인할지**가
 *      여전히 body 였다 — 재확인이 공격자가 고른 슬롯에 대해 성공해 버린다.
 *
 * 형제 경로 cart 는 이미 안전하다: `captureCartOrder.js` 가 `cart_orders/{orderID}` 스냅샷의
 * 라인 booking(서버 재계산 + 검증 정원 되쓰기)에서 readSlotFields 로 슬롯을 읽는다.
 * 이 파일은 단건 경로에 같은 계약을 요구한다.
 *
 * 정책 경계:
 *   - 스냅샷 바인딩 없음/불일치 = fail-closed **for the slot confirm only**. capture 는 돈이 이미
 *     빠진 뒤이므로 HTTP 응답을 깨지 않는다 — confirm 을 포기하고 운영자 알림을 남긴다.
 *   - 슬롯 없는 상품(AI 플래너·차터 등)은 바인딩도 body 슬롯 필드도 없다 → 아무 것도 하지 않는다.
 *
 * 실제 PayPal·Firestore 는 호출하지 않는다 (전 의존 모듈 mock).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Dict = Record<string, unknown>;

const dbHolder: { db: unknown } = { db: null };
const confirmCalls: Dict[] = [];
const acquireCalls: Dict[] = [];
const verifyCalls: Dict[] = [];
const alerts: Dict[] = [];
/** fetchServerSlotCapacity 응답 제어 — 정상 / 결정적 거부 / Firestore 장애(throw). */
const verifyHolder: { result: Dict; throws: boolean } = { result: { ok: true, capacity: 8 }, throws: false };

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbHolder.db }));
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api.mock' }),
  resolveIsSandbox: () => true,
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: async (a: Dict) => { alerts.push(a); },
}));
vi.mock('../../api/_shared/booking-processor-trigger.js', () => ({
  triggerBookingProcessor: async () => ({ ok: true, outcome: 'completed' }),
  PENDING_PROCESSOR_RETRIES_COLLECTION: 'pending_processor_retries',
}));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: async () => {} }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: async () => {} }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: async () => ({ ok: true, final: true }) }));
vi.mock('../../api/_exchange-rate.js', () => ({ getUsdToKrwRaw: async () => 1400 }));
// readSlotFields 는 순수 함수 — 실제 구현을 그대로 쓴다(사본을 만들면 계약이 갈라진다).
// DB 를 만지는 3개만 관측 가능한 stub 으로 교체.
vi.mock('../../api/_shared/slot-capacity.js', async (importOriginal) => {
  const actual = await importOriginal<Dict>();
  return {
    ...actual,
    acquireSlotLock: async (args: Dict) => { acquireCalls.push(args); return { ok: true }; },
    confirmSlotLock: async (args: Dict) => { confirmCalls.push(args); return { ok: true, confirmed: 1 }; },
    fetchServerSlotCapacity: async (args: Dict) => {
      verifyCalls.push(args);
      if (verifyHolder.throws) throw new Error('firestore read blip');
      return verifyHolder.result;
    },
  };
});

// @ts-expect-error — JS 핸들러 (타입 선언 없음)
const { default: captureHandler } = await import('../../api/capturePaypalOrder.js');
// @ts-expect-error — JS 핸들러
const { default: createHandler } = await import('../../api/createPaypalOrder.js');

const captureSrc = readFileSync(resolve(process.cwd(), 'api/capturePaypalOrder.js'), 'utf8');
const ORDER_ID = '5O190127TN364715T';

/** 결제된(= create 시 서버가 잠근) 슬롯. 스냅샷 바인딩의 shape = readSlotFields 입력과 동일. */
const PAID_SLOT = {
  tourId: 'tour_quiet',
  tourSlotId: 'slot_09',
  bookingDate: '2099-12-24',
  slotCapacity: 8,
  passengers: 2,
};
/** 공격자가 capture 때 갈아끼우는 값 — 인기 슬롯 + 다른 날짜 + 부풀린 정원 + 부풀린 pax. */
const FORGED_SLOT = {
  tourId: 'tour_popular',
  tourSlotId: 'slot_18',
  bookingDate: '2099-12-25',
  slotCapacity: 999,
};

function snapshotDoc(extra: Dict = {}): Dict {
  return {
    productType: 'charter_seoul_city',
    expectedUSD: '236.00',
    expectedCurrency: 'USD',
    expectedKRW: 330_000,
    passengers: PAID_SLOT.passengers,
    dateStart: PAID_SLOT.bookingDate,
    ...extra,
  };
}

/** capture 핸들러용 db — paypal_order_snapshots 문서만 제어하면 충분하다. */
function captureDb(snapshot: Dict | null) {
  const writes: Array<{ path: string; data: Dict }> = [];
  const docRef = (name: string, id: string) => ({
    get: async () => (name === 'paypal_order_snapshots' && snapshot
      ? { exists: true, data: () => snapshot }
      : { exists: false, data: () => ({}) }),
    set: async (data: Dict) => { writes.push({ path: `${name}/${id}`, data }); },
    update: async (data: Dict) => { writes.push({ path: `update:${name}/${id}`, data }); },
    delete: async () => {},
  });
  return {
    _writes: writes,
    collection: (name: string) => ({ doc: (id: string) => docRef(name, id) }),
    runTransaction: async (fn: (tx: Dict) => Promise<unknown>) =>
      fn({ get: async () => ({ exists: false, data: () => ({}) }), set: () => {}, update: () => {} }),
    batch: () => ({ set: () => {}, commit: async () => {} }),
  };
}

/** create 핸들러용 db — 스냅샷 set 페이로드를 관측한다. */
function createDb(writes: Array<{ path: string; data: Dict }>) {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        set: async (data: Dict) => { writes.push({ path: `${name}/${id}`, data }); },
        get: async () => ({ exists: false, data: () => ({}) }),
      }),
    }),
  };
}

function mockRes() {
  const out: { status?: number; body?: Dict } = {};
  return {
    _out: out,
    writeHead(status: number) { out.status = status; return this; },
    end(body?: string) { try { out.body = body ? JSON.parse(body) : undefined; } catch { out.body = { raw: body }; } return this; },
  };
}

/** PayPal capture 응답 — 금액·통화는 스냅샷과 정합(무결성 검증 통과 → 슬롯 단계 도달). */
function mockPaypal(value = '236.00') {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: ORDER_ID,
      status: 'COMPLETED',
      payer: { email_address: 'buyer@example.com', name: { given_name: 'Ada', surname: 'L' } },
      purchase_units: [{
        payments: { captures: [{ id: 'CAP-1', status: 'COMPLETED', amount: { value, currency_code: 'USD' } }] },
      }],
    }),
  })) as never;
}

async function runCapture(body: Dict, snapshot: Dict | null) {
  dbHolder.db = captureDb(snapshot);
  const res = mockRes();
  await captureHandler({ method: 'POST', headers: {}, body: { orderID: ORDER_ID, ...body } }, res);
  return res._out;
}

beforeEach(() => {
  confirmCalls.length = 0;
  acquireCalls.length = 0;
  verifyCalls.length = 0;
  alerts.length = 0;
  verifyHolder.result = { ok: true, capacity: 8 };
  verifyHolder.throws = false;
  mockPaypal();
});

// ═══════════ create — 서버가 잠근 슬롯을 스냅샷에 남긴다 ═══════════
describe('createPaypalOrder — 슬롯 바인딩을 주문 스냅샷에 영속화', () => {
  it('🔴 슬롯 주문 → 스냅샷에 tourId/slotId/date/pax + **서버 검증 정원** 저장 (body 999 무시)', async () => {
    const writes: Array<{ path: string; data: Dict }> = [];
    dbHolder.db = createDb(writes);
    global.fetch = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: ORDER_ID }) })) as never;
    const res = mockRes();
    await createHandler({
      method: 'POST',
      headers: {},
      body: {
        productType: 'charter_seoul_city',
        passengers: PAID_SLOT.passengers,
        dateStart: PAID_SLOT.bookingDate,
        tourId: PAID_SLOT.tourId,
        tourSlotId: PAID_SLOT.tourSlotId,
        bookingDate: PAID_SLOT.bookingDate,
        slotCapacity: 999, // 클라가 부풀린 값 — 스냅샷엔 서버 검증값(8)이 들어가야 한다.
      },
    }, res);

    expect(res._out.status).toBe(200);
    const snap = writes.find((w) => w.path === `paypal_order_snapshots/${ORDER_ID}`);
    expect(snap, '스냅샷이 안 쓰였다').toBeTruthy();
    expect(snap!.data.slotBooking).toMatchObject({
      tourId: PAID_SLOT.tourId,
      tourSlotId: PAID_SLOT.tourSlotId,
      bookingDate: PAID_SLOT.bookingDate,
      slotCapacity: 8,
      passengers: PAID_SLOT.passengers,
    });
    // 잠금도 서버 검증 정원으로 (#1258 계약 유지 — 회귀 가드).
    expect(acquireCalls[0]).toMatchObject({ tourId: PAID_SLOT.tourId, slotId: PAID_SLOT.tourSlotId, capacity: 8 });
  });

  it('비슬롯 상품(AI 플래너) → slotBooking 없음 + pre-lock 없음 (기존 결제 회귀 없음)', async () => {
    const writes: Array<{ path: string; data: Dict }> = [];
    dbHolder.db = createDb(writes);
    global.fetch = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ id: ORDER_ID }) })) as never;
    const res = mockRes();
    await createHandler({ method: 'POST', headers: {}, body: { productType: 'ai_planner_full', passengers: 1 } }, res);

    expect(res._out.status).toBe(200);
    const snap = writes.find((w) => w.path === `paypal_order_snapshots/${ORDER_ID}`);
    // create 는 키를 항상 쓴다 — 슬롯 없는 상품이면 값이 정확히 null.
    // (nullish 병합 연산자는 레포 mojibake 체커가 물음표 2개로 오탐하므로 쓰지 않는다.)
    expect(snap!.data.slotBooking).toBeNull();
    expect(acquireCalls).toHaveLength(0);
  });
});

// ═══════════ capture — 위조 body 무력화 (핵심 빨강) ═══════════
describe('🔴 capturePaypalOrder — 위조된 capture body 는 슬롯 확정에 영향 없음', () => {
  const forgedBody = { ...FORGED_SLOT, paxCount: 7, product: 'charter_seoul_city' };

  it('confirmSlotLock 이 **스냅샷 바인딩** 값으로 호출된다 (body 값 아님)', async () => {
    await runCapture(forgedBody, snapshotDoc({ slotBooking: PAID_SLOT }));

    expect(confirmCalls, 'confirm 이 아예 안 불렸다').toHaveLength(1);
    expect(confirmCalls[0]).toMatchObject({
      tourId: PAID_SLOT.tourId,
      slotId: PAID_SLOT.tourSlotId,
      date: PAID_SLOT.bookingDate,
      pax: PAID_SLOT.passengers,
      orderId: ORDER_ID,
    });
    // 공격자가 고른 값이 어떤 인자로도 새어 들어가지 않는다.
    const flat = JSON.stringify(confirmCalls[0]);
    expect(flat).not.toContain(FORGED_SLOT.tourId);
    expect(flat).not.toContain(FORGED_SLOT.tourSlotId);
    expect(flat).not.toContain(FORGED_SLOT.bookingDate);
    expect(flat).not.toContain('999');
    expect(flat).not.toContain('"pax":7');
  });

  it('서버 정원 재확인도 **스냅샷** tourId/slotId 로 조회한다 (#1259 계약 유지)', async () => {
    await runCapture(forgedBody, snapshotDoc({ slotBooking: PAID_SLOT }));
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0]).toMatchObject({ tourId: PAID_SLOT.tourId, slotId: PAID_SLOT.tourSlotId });
  });

  it('confirm 정원 = 서버 재확인 값 (스냅샷 정원과 달라도 서버가 이긴다)', async () => {
    verifyHolder.result = { ok: true, capacity: 5 };
    await runCapture(forgedBody, snapshotDoc({ slotBooking: PAID_SLOT }));
    expect(confirmCalls[0].capacity).toBe(5);
  });

  it('Firestore 조회 장애(throw) → **스냅샷 정원**으로 후퇴 (body 999 아님)', async () => {
    verifyHolder.throws = true;
    await runCapture(forgedBody, snapshotDoc({ slotBooking: PAID_SLOT }));
    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0].capacity).toBe(PAID_SLOT.slotCapacity);
  });

  it('결정적 거부(위조 투어/슬롯·꺼짐·정원 미설정) → confirm 안 함 + 운영자 알림 (응답은 200)', async () => {
    verifyHolder.result = { ok: false, code: 'SLOT_NOT_IN_TOUR' };
    const out = await runCapture(forgedBody, snapshotDoc({ slotBooking: PAID_SLOT }));
    expect(confirmCalls).toHaveLength(0);
    expect(alerts.some((a) => JSON.stringify(a).includes('SLOT_NOT_IN_TOUR'))).toBe(true);
    expect(out.status).toBe(200);
  });

  it('돈이 이미 빠졌으므로 응답은 깨지 않는다 — 위조 요청도 200 + 예약 확정', async () => {
    const out = await runCapture(forgedBody, snapshotDoc({ slotBooking: PAID_SLOT }));
    expect(out.status).toBe(200);
    expect(out.body?.ok).toBe(true);
  });
});

// ═══════════ capture — 바인딩 없음 = fail-closed (알림) ═══════════
describe('🔴 capturePaypalOrder — 스냅샷 슬롯 바인딩 없음 = 슬롯 확정 포기 + 알림', () => {
  it('스냅샷은 있지만 slotBooking 없음 + body 는 슬롯 주장 → confirm 안 함', async () => {
    await runCapture({ ...FORGED_SLOT, paxCount: 7 }, snapshotDoc());
    expect(confirmCalls).toHaveLength(0);
    expect(verifyCalls).toHaveLength(0);
    expect(alerts.some((a) => JSON.stringify(a).includes('SLOT_SNAPSHOT_MISSING'))).toBe(true);
  });

  it('스냅샷 문서 자체가 없음(레거시/클라 주문) + body 슬롯 주장 → confirm 안 함 + 알림', async () => {
    await runCapture({ ...FORGED_SLOT, paxCount: 7, product: 'charter_seoul_city' }, null);
    expect(confirmCalls).toHaveLength(0);
    expect(alerts.some((a) => JSON.stringify(a).includes('SLOT_SNAPSHOT_MISSING'))).toBe(true);
  });

  it('바인딩 없음 + body 도 슬롯 아님(비슬롯 상품) → confirm 없음 **+ 알림도 없음** (회귀·노이즈 0)', async () => {
    const out = await runCapture({ paxCount: 2 }, snapshotDoc({ productType: 'ai-planner-full', expectedUSD: '236.00' }));
    expect(confirmCalls).toHaveLength(0);
    expect(alerts.some((a) => JSON.stringify(a).includes('SLOT_SNAPSHOT_MISSING'))).toBe(false);
    expect(out.status).toBe(200);
  });
});

// ═══════════ 소스 불변식 (mutation 가드) ═══════════
describe('capturePaypalOrder — 슬롯 인자 출처 (소스 잠금)', () => {
  it('confirm/재확인 인자에 body 슬롯 변수를 직접 쓰지 않는다', () => {
    expect(captureSrc).not.toMatch(/slotId:\s*tourSlotId/);
    expect(captureSrc).not.toMatch(/date:\s*bookingDate/);
  });

  it('슬롯 확정 게이트가 스냅샷 바인딩(readSlotFields)에서 나온다 — cart 형제 경로와 같은 헬퍼', () => {
    expect(captureSrc).toMatch(/import \{[^}]*readSlotFields[^}]*\} from '\.\/_shared\/slot-capacity\.js'/);
    expect(captureSrc).toMatch(/readSlotFields\(/);
  });
});

// ═══════════ 형제 경로 — cart capture 는 이미 안전하다 (변경 없음, 증명만) ═══════════
describe('captureCartOrder — 슬롯 인자가 body 에서 오지 않는다 (기존 안전 상태 고정)', () => {
  const cartSrc = readFileSync(resolve(process.cwd(), 'api/captureCartOrder.js'), 'utf8');

  it('body 에서 읽는 값에 슬롯 필드가 없다 (orderID·userEmail·쿠폰/프로모뿐)', () => {
    const bodyReads = [...cartSrc.matchAll(/body\.(\w+)/g)].map((m) => m[1]);
    expect(bodyReads.length).toBeGreaterThan(0);
    for (const f of ['tourId', 'tourSlotId', 'bookingDate', 'slotCapacity', 'passengers', 'paxCount']) {
      expect(bodyReads, `captureCartOrder 가 body.${f} 를 읽는다 — 단건과 같은 구멍`).not.toContain(f);
    }
  });

  it('슬롯은 cart_orders 스냅샷 라인에서 readSlotFields 로 읽는다', () => {
    expect(cartSrc).toMatch(/readSlotFields\(line[^)]*booking\)/);
    const snapLoad = cartSrc.indexOf("collection('cart_orders').doc(orderID).get()");
    const confirm = cartSrc.indexOf('await confirmSlotLock(');
    expect(snapLoad).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(snapLoad);
  });
});
