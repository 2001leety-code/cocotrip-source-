/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * PayPal 웹훅 확정 좌석 해제 (2026-08-09) — PR #1270 이 닫지 못한 마지막 환불 경로.
 *
 * 결함: #1270 은 `cancelBooking` / `admin-booking-action`(mark-refunded·dispatch-cancel)에만
 *   `releaseSlotForCanceledOrder` 를 배선했다. 그런데 **환불의 상당수는 우리 코드를 거치지 않는다** —
 *   운영자가 PayPal 대시보드에서 직접 환불하면 우리가 아는 유일한 통로가 이 웹훅
 *   (`PAYMENT.CAPTURE.REFUNDED`)이다. 그 경로에는 좌석 해제가 없어서 예약은 REFUNDED 로
 *   바뀌는데 `slot_bookings[slotId]` 는 그대로 남았다 → 그 좌석은 영원히 다시 팔리지 않는다(매출손실).
 *
 * 해제 조건은 **fail-closed** — 하나라도 어긋나면 좌석을 건드리지 않는다:
 *   1. `PAYMENT.CAPTURE.REFUNDED` 만 (`PAYMENT.SALE.REFUNDED` 레거시 NVP 는 order 스냅샷이 없다).
 *   2. 환불 resource 가 `COMPLETED` — PENDING(eCheck)·FAILED·상태없음은 아직 돈이 안 갔다.
 *   3. 원장 판정이 전액(`REFUNDED`) — 부분환불은 예약이 살아있을 수 있다.
 *   4. 되돌리는 양 = 확정 원장(`slot_confirmed`)이 증명하는 만큼. 증거 없으면 미변경 + 운영자 알림.
 *      (기록 없이 pax 를 빼면 다른 손님의 확정석을 지운다 = 오버부킹.)
 *   5. 어떤 슬롯인지는 서버 스냅샷(`paypal_order_snapshots/{orderID}.slotBooking`)만이 근거.
 *      bookings 문서의 클라이언트 출처 필드는 신뢰하지 않는다.
 *   6. cart 형제가 captureID 를 공유하면 라인별 귀속 불가 → 이미 ambiguous 로 조기 반환.
 *
 * 실제 PayPal·Firestore 는 호출하지 않는다(전 의존 모듈 mock).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeFirestore, FieldValue as FakeFieldValue } from '../helpers/fake-firestore.js';

const notifySpy = vi.fn(async () => ({ ok: true }));
let db: ReturnType<typeof createFakeFirestore>;
/** capture 조회(fetchAuthoritativeCaptureStatus)가 돌려줄 권위 상태. */
let captureStatus: string | null;

vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api.paypal.com' }),
  resolveIsSandbox: () => false,
}));
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => notifySpy(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn(async () => ({ ok: true })) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: FakeFieldValue }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));

const { default: handler } = await import('../../api/paypal-webhook.js');

const AVAIL = 'tour_availability/T1/dates/2026-09-01';

/** 좌석 확정까지 끝난 정상 주문 한 건. 슬롯 근거는 서버 스냅샷에만 있다. */
function baseSeed(overrides: Record<string, any> = {}) {
  return {
    'bookings/ORD-1': {
      bookingRef: 'CT-1',
      orderID: 'ORD-1',
      captureID: 'CAP-1',
      status: 'CONFIRMED',
      paypalEnvironment: 'live',
      amountUSD: 100,
      capturedExchangeRate: 1400,
      // 🔴 클라이언트 출처 필드 — 해제 근거로 쓰이면 안 된다(엉뚱한 슬롯을 99석 깎는다).
      tourId: 'EVIL-TOUR',
      tourSlotId: 'EVIL-SLOT',
      bookingDate: '2030-01-01',
      passengers: 99,
    },
    'paypal_order_snapshots/ORD-1': {
      slotBooking: {
        tourId: 'T1', tourSlotId: 'S1', bookingDate: '2026-09-01', slotCapacity: 10, passengers: 2,
      },
    },
    [AVAIL]: {
      tourId: 'T1',
      date: '2026-09-01',
      status: 'available',
      slot_bookings: { S1: 5, S2: 7 },
      slot_confirmed: { S1: { 'ORD-1': { count: 2, at: '2026-08-01T00:00:00.000Z', releasedAt: null } } },
    },
    ...overrides,
  };
}

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return { out, writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
}

async function fire(opts: {
  eventType?: string;
  refundStatus?: string | null;
  eventId?: string;
  refundId?: string;
  amount?: string;
  captureId?: string;
} = {}) {
  const resource: Record<string, any> = {
    id: opts.refundId || 'REFUND-1',
    amount: { value: opts.amount || '100.00', currency_code: 'USD' },
    links: [{ rel: 'up', href: `https://api.paypal.com/v2/payments/captures/${opts.captureId || 'CAP-1'}` }],
  };
  // refundStatus === null 은 "상태 필드가 아예 없는 이벤트" (unknown) 를 뜻한다.
  if (opts.refundStatus !== null) resource.status = opts.refundStatus || 'COMPLETED';

  const res = mockRes();
  const req = {
    method: 'POST',
    headers: {
      'paypal-transmission-id': opts.eventId || 'txn-1',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.paypal.com/cert',
      'paypal-transmission-sig': 'sig',
      'paypal-transmission-time': '2026-08-09T00:00:00Z',
    },
    body: JSON.stringify({ event_type: opts.eventType || 'PAYMENT.CAPTURE.REFUNDED', resource }),
  };
  await handler(req as any, res as any);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

const seats = () => db.__get(AVAIL)?.slot_bookings;
const ledger = () => db.__get(AVAIL)?.slot_confirmed?.S1?.['ORD-1'];

beforeEach(() => {
  notifySpy.mockClear();
  process.env.PAYPAL_WEBHOOK_ID = 'wh-test';
  delete process.env.PAYPAL_SANDBOX_CLIENT_ID;
  captureStatus = 'REFUNDED';
  db = createFakeFirestore(baseSeed());
  global.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('verify-webhook-signature')) {
      return { ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }), text: async () => '' };
    }
    if (u.includes('/v2/payments/captures/')) {
      return { ok: captureStatus !== null, status: 200, json: async () => ({ status: captureStatus }), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  }) as never;
});

describe('PAYMENT.CAPTURE.REFUNDED — 전액 완료 환불에서만 확정 좌석 해제', () => {
  it('전액 + COMPLETED → 원장이 증명하는 만큼(2석)만 차감 + 원장 tombstone', async () => {
    const r = await fire();
    expect(r.statusCode).toBe(200);
    expect(r.json.status).toBe('refunded');
    expect(r.json.bookingStatus).toBe('REFUNDED');
    expect(r.json.slotReleased).toBe(true);

    expect(seats()!.S1).toBe(3);        // 5 - 2 (원장 count), pax·bookings 필드가 아니다
    expect(seats()!.S2).toBe(7);        // 다른 슬롯은 병합으로 보존
    expect(ledger()!.count).toBe(0);    // tombstone — 두 번째 해제를 막는 증거
    expect(ledger()!.releasedAt).toBeTruthy();
  });

  it('bookings 문서의 클라이언트 슬롯 필드는 근거가 아니다 — 스냅샷 슬롯만 건드린다', async () => {
    await fire();
    // EVIL-TOUR/EVIL-SLOT 로는 아무 문서도 만들지 않았다.
    const touched = Object.keys(db.__dump()).filter((p) => p.includes('EVIL'));
    expect(touched).toEqual([]);
    expect(seats()!.S1).toBe(3);        // 99 가 아니다
  });
});

describe('해제하면 안 되는 경우 — 좌석 미변경 (fail-closed)', () => {
  it('부분환불(PARTIALLY_REFUNDED) → 예약은 갱신하되 좌석은 그대로', async () => {
    captureStatus = 'PARTIALLY_REFUNDED';
    const r = await fire({ amount: '40.00' });
    expect(r.json.status).toBe('refunded');
    expect(r.json.bookingStatus).toBe('PARTIALLY_REFUNDED');
    expect(r.json.slotReleased).toBe(false);
    expect(seats()!.S1).toBe(5);
    expect(ledger()!.count).toBe(2);
  });

  it('환불 resource 가 PENDING(eCheck) → 나중에 FAILED 로 뒤집힐 수 있어 좌석 보류', async () => {
    const r = await fire({ refundStatus: 'PENDING' });
    expect(r.json.slotReleased).toBe(false);
    expect(seats()!.S1).toBe(5);
    expect(ledger()!.count).toBe(2);
  });

  it('환불 resource 가 FAILED → 돈이 안 갔다, 좌석 보류', async () => {
    const r = await fire({ refundStatus: 'FAILED' });
    expect(r.json.slotReleased).toBe(false);
    expect(seats()!.S1).toBe(5);
  });

  it('환불 resource 에 status 자체가 없음(unknown) → 단정 금지, 좌석 보류', async () => {
    const r = await fire({ refundStatus: null });
    expect(r.json.slotReleased).toBe(false);
    expect(seats()!.S1).toBe(5);
  });

  it('PAYMENT.SALE.REFUNDED(레거시) → order 스냅샷 규약 밖, 좌석 보류', async () => {
    const r = await fire({ eventType: 'PAYMENT.SALE.REFUNDED' });
    expect(r.json.status).toBe('refunded');
    expect(r.json.slotReleased).toBe(false);
    expect(seats()!.S1).toBe(5);
  });

  it('스냅샷 바인딩 없음(비슬롯 상품) → 좌석 미변경 + 알림 홍수 없음', async () => {
    db.__delete('paypal_order_snapshots/ORD-1');
    const r = await fire();
    expect(r.json.status).toBe('refunded');
    expect(r.json.slotReleased).toBe(false);
    expect(seats()!.S1).toBe(5);
    // 비슬롯 상품의 정상 상태라 좌석 관련 운영자 알림은 없어야 한다.
    const texts = notifySpy.mock.calls.map((c: any[]) => String(c[1]));
    expect(texts.some((t) => t.includes('좌석'))).toBe(false);
  });

  it('스냅샷은 있는데 확정 원장 없음 → 좌석 미변경 + 운영자 알림 (남의 좌석 삭제 방지)', async () => {
    db.__patch(AVAIL, { slot_confirmed: undefined });
    const r = await fire();
    expect(r.json.slotReleased).toBe(false);
    expect(seats()!.S1).toBe(5);        // pax(2)를 임의로 빼지 않는다
    const texts = notifySpy.mock.calls.map((c: any[]) => String(c[1]));
    expect(texts.some((t) => t.includes('좌석 해제 보류'))).toBe(true);
  });

  it('cart 형제가 captureID 공유 → ambiguous 조기 반환, 어떤 좌석도 건드리지 않음', async () => {
    db.__set('bookings/ORD-2', {
      bookingRef: 'CT-2', orderID: 'ORD-2', captureID: 'CAP-1', parentOrderID: 'ORD-1',
      status: 'CONFIRMED', paypalEnvironment: 'live', amountUSD: 50,
    });
    db.__delete('bookings/ORD-1');
    db.__set('bookings/ORD-1__L0', {
      bookingRef: 'CT-1', orderID: 'ORD-1', captureID: 'CAP-1', parentOrderID: 'ORD-1',
      status: 'CONFIRMED', paypalEnvironment: 'live', amountUSD: 50,
    });
    const r = await fire();
    expect(r.json.status).toBe('ambiguous');
    expect(seats()!.S1).toBe(5);
    expect(ledger()!.count).toBe(2);
  });

  it('cart 자식 단건(parentOrderID) → 라인별 귀속 불가, 좌석 보류', async () => {
    db.__patch('bookings/ORD-1', { parentOrderID: 'PARENT-1' });
    const r = await fire();
    expect(r.json.status).toBe('refunded');
    expect(r.json.slotReleased).toBe(false);
    expect(seats()!.S1).toBe(5);
    expect(ledger()!.count).toBe(2);
  });
});

describe('멱등 — 재전송·중복·이미 해제된 주문에서 2회 차감 금지', () => {
  it('같은 eventId 재전송 → 핸들러 최상단 멱등 가드, 좌석은 1회만 차감', async () => {
    await fire();
    expect(seats()!.S1).toBe(3);
    const again = await fire();
    // eventId 가 이미 processed → 환불 원장·좌석 코드에 도달조차 하지 않는다.
    expect(again.json.idempotent).toBe(true);
    expect(seats()!.S1).toBe(3);
    expect(ledger()!.count).toBe(0);
  });

  it('다른 eventId + 같은 refundId 재전송 → duplicate_refund, 좌석 불변', async () => {
    await fire();
    const again = await fire({ eventId: 'txn-2' });
    expect(again.json.status).toBe('duplicate_refund');
    expect(seats()!.S1).toBe(3);
  });

  it('cancelBooking 이 먼저 해제한 뒤 웹훅 도착 → 원장 tombstone 이 2회 차감을 막는다', async () => {
    // cancelBooking 경로가 남긴 상태: 좌석은 이미 3, 원장은 count 0.
    db.__patch(AVAIL, {
      slot_bookings: { S1: 3, S2: 7 },
      slot_confirmed: { S1: { 'ORD-1': { count: 0, releasedAt: '2026-08-09T00:00:00.000Z' } } },
    });
    const r = await fire({ refundId: 'REFUND-2' });
    expect(r.json.status).toBe('refunded');
    expect(r.json.slotReleased).toBe(false);
    expect(seats()!.S1).toBe(3);        // 1 로 내려가지 않는다
  });
});
