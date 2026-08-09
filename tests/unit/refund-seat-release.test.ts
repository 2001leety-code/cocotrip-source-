/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * 좌석 해제 (2026-08-09) — **환불·취소가 실제로 성공한 뒤에도 확정 좌석이 남아 슬롯이 잠기던 결함**.
 *
 * 결함의 본체:
 *   `api/_shared/slot-capacity.js` 에는 pending 을 푸는 `releaseSlotLock` 만 있고
 *   confirmed(`slot_bookings[slotId]`)를 되돌리는 경로가 **아예 없었다**(그 헤더가
 *   "확정석은 절대 만지지 않는다"고 못박고 있다). 그래서 `cancelBooking.js` 도
 *   `admin-booking-action.js`(mark-refunded / dispatch-cancel)도 환불 성공 후
 *   좌석을 그대로 남겼다 → 취소된 좌석이 영구히 팔리지 않는다(매출손실).
 *
 * 왜 "그냥 pax 만큼 빼기" 가 틀린가:
 *   confirm 이 실제로 일어났는지 모르는 상태에서 빼면 **남의 좌석**을 깎는다.
 *   capture 는 confirm 을 건너뛸 수 있다(F2 SLOT_SNAPSHOT_MISSING / SLOT_FULL_AT_CAPTURE).
 *   → confirm 이 남긴 원장(`slot_confirmed[slotId][orderId]`)이 증명하는 만큼만 되돌린다.
 *   증명이 없으면 좌석을 건드리지 않고 보류·기록한다.
 *
 * 어떤 슬롯인지의 근거는 F2 와 같은 SSOT — `paypal_order_snapshots/{orderID}.slotBooking`.
 * 클라이언트가 보낸 tourId/slot/date/pax 는 신뢰하지 않는다.
 *
 * 실제 PayPal·Firestore 는 호출하지 않는다(전 의존 모듈 mock).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  acquireSlotLock,
  confirmSlotLock,
  releaseConfirmedSlot,
  releaseSlotForCanceledOrder,
  summarizeSlot,
} from '../../api/_shared/slot-capacity.js';

type DocData = Record<string, any>;

function isPlainObject(v: unknown): v is DocData {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Firestore set(data, {merge:true}) 의 중첩 맵 깊은 병합. 키 삭제는 일어나지 않는다. */
function deepMerge(target: DocData, patch: DocData): DocData {
  const out: DocData = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/**
 * 경로 하나로 통일된 가짜 Firestore.
 *   - `collection(name).doc(id)` / `doc(path)` 둘 다 같은 store 를 가리킨다.
 *   - merge:true 는 **깊은** 병합 (슬롯 계열 결함이 전부 여기서 났다).
 */
function makeStore(initial: Record<string, DocData> = {}) {
  const store = new Map<string, DocData>();
  for (const [p, d] of Object.entries(initial)) store.set(p, structuredClone(d));
  const adds: Array<{ path: string; data: DocData }> = [];

  const write = (path: string, data: DocData, merge?: boolean) => {
    const cur = store.get(path);
    store.set(path, merge && cur ? deepMerge(cur, structuredClone(data)) : structuredClone(data));
  };
  const snapOf = (path: string) => {
    const cur = store.get(path);
    return { exists: cur !== undefined, data: () => structuredClone(cur || {}) };
  };
  const docRef = (path: string) => ({
    path,
    get: async () => snapOf(path),
    set: async (data: DocData, opts: { merge?: boolean } = {}) => write(path, data, opts.merge),
    update: async (patch: DocData) => write(path, patch, true),
  });

  return {
    _store: store,
    _adds: adds,
    _peek: (path: string) => store.get(path),
    doc: (path: string) => docRef(path),
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${name}/${id}`),
      add: async (data: DocData) => { adds.push({ path: name, data }); },
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({
      get: async (ref: { path: string }) => snapOf(ref.path),
      set: (ref: { path: string }, data: DocData, opts: { merge?: boolean } = {}) => write(ref.path, data, opts.merge),
      update: (ref: { path: string }, patch: DocData) => write(ref.path, patch, true),
    }),
  };
}

const TOUR = 'tour_gyeongbok';
const DATE = '2099-11-02';
const SLOT = 'slot_09';
const AVAIL = `tour_availability/${TOUR}/dates/${DATE}`;
const CAPACITY = 8;

/** create 스냅샷의 slotBooking 형태 (readSlotFields 입력과 동일). */
const SLOT_BOOKING = {
  tourId: TOUR,
  tourSlotId: SLOT,
  bookingDate: DATE,
  slotCapacity: CAPACITY,
  passengers: 2,
};

// ═════════════════ 1. 헬퍼 — 확정 좌석 해제 원장 ═════════════════

describe('confirmSlotLock — 확정한 좌석을 주문별 원장에 남긴다', () => {
  it('🔴 confirm 후 slot_confirmed[slot][orderId].count = 확정 pax (해제의 유일한 증거)', async () => {
    const db = makeStore();
    await acquireSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 2, capacity: CAPACITY, orderId: 'ORDER-1' });
    await confirmSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 2, capacity: CAPACITY, orderId: 'ORDER-1' });

    const doc = db._peek(AVAIL)!;
    expect(doc.slot_bookings[SLOT]).toBe(2);
    expect(doc.slot_confirmed[SLOT]['ORDER-1'].count).toBe(2);
  });

  it('🔴 단건 실서비스 흐름 — acquire 는 PRELOCK 키, confirm 은 실제 orderID → 원장 키 = orderID', async () => {
    // createPaypalOrder 는 PayPal orderId 를 알기 전이라 `PRELOCK-*` 로 잠근다.
    // 원장은 confirm 이 쓰므로 취소 때 조회하는 키(= 실제 orderID)와 일치해야 한다.
    const db = makeStore();
    await acquireSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 2, capacity: CAPACITY, orderId: `PRELOCK-1-${SLOT}` });
    await confirmSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 2, capacity: CAPACITY, orderId: 'PAYPAL-ORDER-1' });

    expect(db._peek(AVAIL)!.slot_confirmed[SLOT]['PAYPAL-ORDER-1'].count).toBe(2);

    const r = await releaseConfirmedSlot({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, orderId: 'PAYPAL-ORDER-1' });
    expect(r).toMatchObject({ released: true, pax: 2 });
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(0);
  });

  it('cart — 같은 주문의 두 라인이 같은 슬롯이면 원장이 **누적**된다 (한쪽만 지워지면 좌석 유실)', async () => {
    const db = makeStore();
    for (const pax of [2, 3]) {
      await acquireSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax, capacity: CAPACITY, orderId: 'CART-1' });
      await confirmSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax, capacity: CAPACITY, orderId: 'CART-1' });
    }
    const doc = db._peek(AVAIL)!;
    expect(doc.slot_bookings[SLOT]).toBe(5);
    expect(doc.slot_confirmed[SLOT]['CART-1'].count).toBe(5);
  });
});

describe('releaseConfirmedSlot — 원장이 증명하는 만큼만, 정확히 한 번', () => {
  async function seedConfirmed(orderIds: Array<[string, number]>) {
    const db = makeStore();
    for (const [orderId, pax] of orderIds) {
      await acquireSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax, capacity: CAPACITY, orderId });
      await confirmSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax, capacity: CAPACITY, orderId });
    }
    return db;
  }

  it('🔴 확정 좌석이 실제로 줄어든다 (버그 본체 — 취소해도 안 줄었다)', async () => {
    const db = await seedConfirmed([['ORDER-1', 2], ['ORDER-2', 3]]);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(5);

    const r = await releaseConfirmedSlot({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, orderId: 'ORDER-1' });

    expect(r).toMatchObject({ ok: true, released: true, pax: 2 });
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(3); // 남의 좌석(ORDER-2=3)은 그대로
  });

  it('🔴 두 번 호출해도 한 번만 차감 (재시도·중복 웹훅·중복 취소 멱등)', async () => {
    const db = await seedConfirmed([['ORDER-1', 2], ['ORDER-2', 3]]);
    await releaseConfirmedSlot({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, orderId: 'ORDER-1' });
    const second = await releaseConfirmedSlot({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, orderId: 'ORDER-1' });

    expect(second).toMatchObject({ ok: true, released: false, reason: 'ALREADY_RELEASED' });
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(3); // 두 번째 차감 없음
  });

  it('🔴 확정 원장이 없는 주문은 좌석을 **건드리지 않는다** (남의 좌석 차감 금지)', async () => {
    const db = await seedConfirmed([['ORDER-2', 3]]);
    const r = await releaseConfirmedSlot({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, orderId: 'ORDER-NEVER-CONFIRMED' });

    expect(r).toMatchObject({ ok: true, released: false, reason: 'NO_CONFIRMED_RECORD' });
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(3);
  });

  it('availability 문서 자체가 없으면 아무것도 쓰지 않는다', async () => {
    const db = makeStore();
    const r = await releaseConfirmedSlot({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, orderId: 'ORDER-1' });
    expect(r).toMatchObject({ released: false, reason: 'NO_CONFIRMED_RECORD' });
    expect(db._peek(AVAIL)).toBeUndefined();
  });

  it('원장이 확정석보다 크면 0 으로 clamp — 음수 좌석 금지', async () => {
    const db = makeStore({
      [AVAIL]: {
        tourId: TOUR, date: DATE, status: 'available',
        slot_bookings: { [SLOT]: 1 },
        slot_confirmed: { [SLOT]: { 'ORDER-1': { count: 4 } } },
      },
    });
    const r = await releaseConfirmedSlot({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, orderId: 'ORDER-1' });
    expect(r).toMatchObject({ released: true, confirmed: 0 });
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(0);
  });

  it('해제는 pending 을 건드리지 않는다 — 다른 주문의 살아있는 pending 보존', async () => {
    const db = await seedConfirmed([['ORDER-1', 2]]);
    await acquireSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 3, capacity: CAPACITY, orderId: 'ORDER-LIVE' });
    await releaseConfirmedSlot({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, orderId: 'ORDER-1' });

    const s = summarizeSlot(db._peek(AVAIL)!, SLOT);
    expect(s.confirmed).toBe(0);
    expect(s.pending).toBe(3); // 결제 진행 중인 주문의 자리는 지킨다
  });

  it('해제 후 좌석이 실제로 재판매된다 (SLOT_FULL 오차단 해소 — 결함의 사용자 증상)', async () => {
    const db = makeStore();
    await acquireSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 8, capacity: CAPACITY, orderId: 'ORDER-FULL' });
    await confirmSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 8, capacity: CAPACITY, orderId: 'ORDER-FULL' });
    await expect(
      acquireSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 1, capacity: CAPACITY, orderId: 'NEXT' }),
    ).rejects.toMatchObject({ code: 'SLOT_FULL' });

    await releaseConfirmedSlot({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, orderId: 'ORDER-FULL' });

    await expect(
      acquireSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 1, capacity: CAPACITY, orderId: 'NEXT' }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe('releaseSlotForCanceledOrder — 슬롯 근거는 서버 스냅샷 바인딩뿐', () => {
  it('🔴 스냅샷 slotBooking 으로 슬롯을 찾아 해제 (클라 입력 미사용)', async () => {
    const db = makeStore({ [`paypal_order_snapshots/ORDER-1`]: { slotBooking: SLOT_BOOKING } });
    await acquireSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 2, capacity: CAPACITY, orderId: 'ORDER-1' });
    await confirmSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 2, capacity: CAPACITY, orderId: 'ORDER-1' });

    const r = await releaseSlotForCanceledOrder({ adminDb: db as any, orderId: 'ORDER-1' });
    expect(r).toMatchObject({ released: true, pax: 2 });
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(0);
  });

  it('스냅샷이 없으면(비슬롯 상품·레거시) 보류 — 아무 좌석도 건드리지 않는다', async () => {
    const db = makeStore();
    const r = await releaseSlotForCanceledOrder({ adminDb: db as any, orderId: 'ORDER-NO-SNAP' });
    expect(r).toMatchObject({ released: false, reason: 'NO_SNAPSHOT_BINDING' });
  });

  it('스냅샷은 있으나 슬롯 바인딩이 반쪽이면 보류 (반쪽 잠금 금지 규칙과 동일)', async () => {
    const db = makeStore({
      [`paypal_order_snapshots/ORDER-HALF`]: { slotBooking: { tourId: TOUR, tourSlotId: SLOT } },
    });
    const r = await releaseSlotForCanceledOrder({ adminDb: db as any, orderId: 'ORDER-HALF' });
    expect(r).toMatchObject({ released: false, reason: 'NO_SNAPSHOT_BINDING' });
  });
});

// ═════════════════ 2. cancelBooking 배선 ═════════════════

const authHolder: { r: any } = { r: { ok: true, email: 'cust@x.com', uid: 'u1' } };
const refundHolder: { r: any } = { r: { ok: true, final: true, refund: { id: 'RF-1', status: 'COMPLETED' } } };
const alertSpy = vi.fn(async () => ({ ok: true }));
const adminNotify = vi.fn(async () => undefined);
const adminAuthHolder: { r: any } = { r: { ok: true, email: 'admin@cocotrip.kr', uid: 'admin1' } };
const dbHolder: { db: any } = { db: null };

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbHolder.db }));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: async () => authHolder.r }));
vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: async () => adminAuthHolder.r }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: async () => refundHolder.r }));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: (...a: any[]) => alertSpy(...(a as [])) }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => adminNotify(...(a as [])) }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({ buildManualPaymentEmail: () => ({ subject: '', html: '', text: '' }) }));
vi.mock('../../api/_shared/pricing.js', () => ({ productDisplayLabel: (x: string) => x }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn(async () => ({ ok: true, bookingId: 'b1' })) }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } }));

// @ts-expect-error — JS 핸들러 (타입 선언 없음)
const { default: cancelHandler } = await import('../../api/cancelBooking.js');
// @ts-expect-error — JS 핸들러
const { default: adminHandler } = await import('../../api/admin-booking-action.js');

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return { out, writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
}

const ORDER_ID = '5O190127TN364715T';

/** 확정 좌석 + 스냅샷 바인딩을 갖춘 슬롯 예약 상태를 만든다. */
async function seedSlotBooking(extraDocs: Record<string, DocData> = {}) {
  const db = makeStore({
    [`paypal_order_snapshots/${ORDER_ID}`]: { slotBooking: SLOT_BOOKING },
    'users/u1': { tier: 'Bronze' },
    ...extraDocs,
  });
  await acquireSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 2, capacity: CAPACITY, orderId: ORDER_ID });
  await confirmSlotLock({ adminDb: db as any, tourId: TOUR, date: DATE, slotId: SLOT, pax: 2, capacity: CAPACITY, orderId: ORDER_ID });
  return db;
}

const CONFIRMED_BOOKING = {
  userEmail: 'cust@x.com', status: 'CONFIRMED', captureID: 'CAP-1', orderID: ORDER_ID,
  productType: 'tour-gyeongbok', tourDate: '2099-12-31', tourTime: '10:00',
  amountUSD: '100.00', amountKRW: 143000, currency: 'USD', paxCount: 2,
};

async function cancel(bookingID = ORDER_ID) {
  const res = mockRes();
  await cancelHandler(
    { method: 'POST', url: '/api/cancelBooking', headers: { host: 'unit.test' }, body: { bookingID, reason: 'change of plans' } } as any,
    res as any,
  );
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

beforeEach(() => {
  authHolder.r = { ok: true, email: 'cust@x.com', uid: 'u1' };
  adminAuthHolder.r = { ok: true, email: 'admin@cocotrip.kr', uid: 'admin1' };
  refundHolder.r = { ok: true, final: true, refund: { id: 'RF-1', status: 'COMPLETED' } };
  alertSpy.mockClear();
  adminNotify.mockClear();
});

describe('cancelBooking — 환불 성공 후 좌석을 정확히 한 번 해제', () => {
  it('🔴 환불 성공 → CANCELED + 확정 좌석 해제 (수정 전: 좌석이 영구 잔류)', async () => {
    const db = await seedSlotBooking({ [`bookings/${ORDER_ID}`]: { ...CONFIRMED_BOOKING } });
    dbHolder.db = db;
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);

    const r = await cancel();

    expect(r.statusCode).toBe(200);
    expect(db._peek(`bookings/${ORDER_ID}`)!.status).toBe('CANCELED');
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(0);
  });

  it('🔴 환불 실패(확정 실패) → 좌석을 풀지 않는다 (돈 안 나갔는데 좌석만 열리는 것 금지)', async () => {
    const db = await seedSlotBooking({ [`bookings/${ORDER_ID}`]: { ...CONFIRMED_BOOKING } });
    dbHolder.db = db;
    refundHolder.r = { ok: false, code: 'PAYPAL_REFUND_FAILED', error: 'declined', status: 502 };

    const r = await cancel();

    expect(r.statusCode).toBe(502);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);
  });

  it('🔴 환불 결과 미상(타임아웃) → 좌석 미해제 (돈의 행방이 확정될 때까지 보류)', async () => {
    const db = await seedSlotBooking({ [`bookings/${ORDER_ID}`]: { ...CONFIRMED_BOOKING } });
    dbHolder.db = db;
    refundHolder.r = { ok: false, code: 'PAYPAL_REFUND_TIMEOUT', error: 'timed out', status: 502 };

    const r = await cancel();

    expect(r.statusCode).toBe(202);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);
  });

  it('🔴 이미 취소된 예약 재요청(409) → 두 번째 차감 없음', async () => {
    const db = await seedSlotBooking({ [`bookings/${ORDER_ID}`]: { ...CONFIRMED_BOOKING } });
    dbHolder.db = db;
    await cancel();
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(0);

    const again = await cancel();
    expect(again.statusCode).toBe(409);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(0);
  });

  it('비슬롯 상품(스냅샷 바인딩 없음) → 좌석 로직 무발화, 취소는 정상 200', async () => {
    const db = makeStore({
      'users/u1': { tier: 'Bronze' },
      [`bookings/${ORDER_ID}`]: { ...CONFIRMED_BOOKING, productType: 'airport-pickup' },
    });
    dbHolder.db = db;

    const r = await cancel();

    expect(r.statusCode).toBe(200);
    expect(db._peek(`bookings/${ORDER_ID}`)!.status).toBe('CANCELED');
    expect(alertSpy).not.toHaveBeenCalled(); // 정상 상품마다 알림이 울리면 안 된다
  });

  it('🔴 좌석 해제가 터져도 취소 응답은 200 (돈은 이미 나갔다) + 운영자 알림', async () => {
    const db = await seedSlotBooking({ [`bookings/${ORDER_ID}`]: { ...CONFIRMED_BOOKING } });
    // 예약 CAS(1번째 트랜잭션)는 통과시키고 좌석 해제 트랜잭션만 폭파시킨다.
    let txCalls = 0;
    dbHolder.db = {
      ...db,
      runTransaction: async (fn: any) => {
        txCalls += 1;
        if (txCalls === 1) return db.runTransaction(fn);
        throw new Error('firestore blip');
      },
    };

    const r = await cancel();

    expect(r.statusCode).toBe(200);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2); // 해제 실패 = 좌석 유지 (임의 조작 금지)
    expect(alertSpy).toHaveBeenCalled();
  });

  it('확정 원장이 없는 슬롯 예약(레거시·confirm 실패분) → 좌석 미변경 + 운영자 알림', async () => {
    const db = makeStore({
      'users/u1': { tier: 'Bronze' },
      [`paypal_order_snapshots/${ORDER_ID}`]: { slotBooking: SLOT_BOOKING },
      [`bookings/${ORDER_ID}`]: { ...CONFIRMED_BOOKING },
      [AVAIL]: { tourId: TOUR, date: DATE, status: 'available', slot_bookings: { [SLOT]: 5 } },
    });
    dbHolder.db = db;

    const r = await cancel();

    expect(r.statusCode).toBe(200);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(5); // 남의 좌석을 깎지 않는다
    expect(alertSpy).toHaveBeenCalled();
  });
});

// ═════════════════ 3. admin-booking-action 배선 ═════════════════

const PENDING_REF = 'CT-20991102-001';
const PENDING_DOC = {
  status: 'CONFIRMED', priceKRW: 143000, customerEmail: 'cust@x.com',
  paypalTransactionId: ORDER_ID, language: 'ko',
};

async function adminCall(body: object) {
  const res = mockRes();
  await adminHandler(
    { method: 'POST', url: '/api/admin-booking-action', headers: { host: 'unit.test' }, body } as any,
    res as any,
  );
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

async function seedAdmin(bookingExtra: DocData = {}) {
  const db = await seedSlotBooking({
    [`pending_bookings/${PENDING_REF}`]: { ...PENDING_DOC },
    [`bookings/${ORDER_ID}`]: {
      captureID: 'CAP-1', amountKRW: 143000, amountUSD: '100.00', currency: 'USD',
      orderID: ORDER_ID, ...bookingExtra,
    },
  });
  dbHolder.db = db;
  return db;
}

describe('admin-booking-action — 환불/배차취소 성공 후 좌석 해제', () => {
  it('🔴 mark-refunded 전액환불 성공 → 좌석 해제', async () => {
    const db = await seedAdmin();
    const r = await adminCall({ bookingRef: PENDING_REF, action: 'mark-refunded', reason: '고객 요청' });

    expect(r.statusCode).toBe(200);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(0);
  });

  it('🔴 mark-refunded PayPal 실패 → 좌석 미해제', async () => {
    const db = await seedAdmin();
    refundHolder.r = { ok: false, code: 'PAYPAL_REFUND_FAILED', error: 'declined', status: 502 };

    const r = await adminCall({ bookingRef: PENDING_REF, action: 'mark-refunded' });

    expect(r.statusCode).toBe(502);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);
  });

  it('🔴 부분환불은 좌석을 풀지 않는다 (예약이 살아있을 수 있다 — 보류 + 기록)', async () => {
    const db = await seedAdmin();
    const r = await adminCall({ bookingRef: PENDING_REF, action: 'mark-refunded', refundedKRW: 50000 });

    expect(r.statusCode).toBe(200);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);
  });

  it('🔴 dispatch-cancel(우리 귀책 전액환불) → 좌석 해제', async () => {
    const db = await seedAdmin();
    const r = await adminCall({
      bookingRef: PENDING_REF, action: 'dispatch-cancel',
      cancelCategory: 'no_vehicle', reason: '폭설로 차량 운행 불가',
    });

    expect(r.statusCode).toBe(200);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(0);
  });

  it('🔴 dispatch-cancel 재클릭(409) → 두 번째 차감 없음', async () => {
    const db = await seedAdmin();
    const body = { bookingRef: PENDING_REF, action: 'dispatch-cancel', cancelCategory: 'no_vehicle', reason: '폭설' };
    await adminCall(body);
    const again = await adminCall(body);

    expect(again.statusCode).toBe(400);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(0);
  });

  it('cart 자식(parentOrderID) 은 좌석을 건드리지 않는다 — 형제와 capture 공유로 귀속 불가', async () => {
    const db = await seedAdmin({ parentOrderID: 'CART-PARENT-1' });
    const r = await adminCall({ bookingRef: PENDING_REF, action: 'mark-refunded' });

    expect(r.statusCode).toBe(200);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);
  });

  it('mark-canceled(결제 전 취소) → 좌석 로직 무발화 (확정석이 존재하지 않는 경로)', async () => {
    const db = await seedAdmin();
    const r = await adminCall({ bookingRef: PENDING_REF, action: 'mark-canceled', reason: '노쇼' });

    expect(r.statusCode).toBe(200);
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);
  });
});

// ═════════════════ 4. 환불 미확정 = 좌석 미해제 (Codex 리뷰 P1/P2) ═════════════════
//
// `ok:true` 는 "환불 요청이 접수됐다" 일 뿐이다. 돈이 **확정으로** 고객에게 갔다는 뜻이 아니다.
//   - PENDING(eCheck·리스크홀드): 나중에 FAILED 로 뒤집힐 수 있다 → F4 webhook 이 REFUND_FAILED 로 치유.
//   - captureID 없음: PayPal 을 아예 호출하지 않았다 → 운영자 수동 환불 대기 상태.
// 이 두 경우에 좌석을 풀면 **환불받지 못한 손님의 자리를 남에게 판** 상태가 된다(좌석 회계 ↔ 환불 상태 불일치).
// 종단 성공의 SSOT 는 helper 의 `final` 플래그다(api/_shared/paypal-refund.js — COMPLETED 만 final:true).
//
// 회귀 시 이 블록을 깨는 프로덕션 변경:
//   - cancelBooking.js 의 `refundResult.final ? releaseSlotForCanceledOrder(...) : ...` 삼항을 무조건 호출로 되돌림
//   - admin-booking-action.js 의 releaseSeatsAfterRefund 진입 가드(`if (!refundFinal) return;`) 제거
//   - 두 호출자가 `refundFinal` 인자를 넘기지 않게 되어도(= undefined) fail-closed 라 깨지지 않는다 —
//     그건 의도다. 깨지는 쪽은 "게이트 자체를 없애는" 변경뿐이다.
describe('환불 미확정(PENDING·captureID 없음) → 좌석을 풀지 않는다', () => {
  const PENDING_REFUND = { ok: true, final: false, pending: true, refund: { id: 'RF-PEND', status: 'PENDING' } };

  it('🔴 cancelBooking — 환불 PENDING(eCheck) → CANCELED 는 유지, 좌석은 미해제', async () => {
    const db = await seedSlotBooking({ [`bookings/${ORDER_ID}`]: { ...CONFIRMED_BOOKING } });
    dbHolder.db = db;
    refundHolder.r = PENDING_REFUND;

    const r = await cancel();

    expect(r.statusCode).toBe(200);
    expect(db._peek(`bookings/${ORDER_ID}`)!.status).toBe('CANCELED'); // F3c-lite: 종단 상태는 유지
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);             // 좌석만 보류
  });

  it('🔴 admin mark-refunded — 환불 PENDING → REFUNDED 는 유지, 좌석은 미해제', async () => {
    const db = await seedAdmin();
    refundHolder.r = PENDING_REFUND;

    const r = await adminCall({ bookingRef: PENDING_REF, action: 'mark-refunded', reason: '고객 요청' });

    expect(r.statusCode).toBe(200);
    expect(db._peek(`pending_bookings/${PENDING_REF}`)!.status).toBe('REFUNDED');
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);
  });

  it('🔴 admin dispatch-cancel — 환불 PENDING → CANCELED 는 유지, 좌석은 미해제', async () => {
    const db = await seedAdmin();
    refundHolder.r = PENDING_REFUND;

    const r = await adminCall({
      bookingRef: PENDING_REF, action: 'dispatch-cancel',
      cancelCategory: 'no_vehicle', reason: '폭설로 차량 운행 불가',
    });

    expect(r.statusCode).toBe(200);
    expect(db._peek(`pending_bookings/${PENDING_REF}`)!.status).toBe('CANCELED');
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);
  });

  it('🔴 admin dispatch-cancel — captureID 없음(PayPal 미호출·수동 환불 대기) → 좌석 미해제', async () => {
    const db = await seedAdmin({ captureID: null });

    const r = await adminCall({
      bookingRef: PENDING_REF, action: 'dispatch-cancel',
      cancelCategory: 'no_driver', reason: '기사 확보 실패',
    });

    expect(r.statusCode).toBe(200);
    expect(r.json.data.refundSource).toBe('manual-pending'); // 아직 환불 안 나갔다
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);
  });

  it('🔴 admin mark-refunded — captureID 없음(수동 입금 건) → 좌석 미해제', async () => {
    const db = await seedAdmin({ captureID: null });

    const r = await adminCall({ bookingRef: PENDING_REF, action: 'mark-refunded', reason: '고객 요청' });

    expect(r.statusCode).toBe(200);
    expect(r.json.data.refundSource).toBe('manual');
    expect(db._peek(AVAIL)!.slot_bookings[SLOT]).toBe(2);
  });
});
