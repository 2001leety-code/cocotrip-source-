/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * F4 (2026-07-16) — PAYMENT.REFUND.FAILED / PAYMENT.REFUND.PENDING webhook 핸들러.
 *
 * 버그: 이 두 이벤트에 핸들러가 없어 'unsupported' 로 조용히 폐기 + 200 ack 로 PayPal 재시도까지
 *   차단됐다. PENDING 환불(eCheck)이 나중에 FAILED 로 뒤집혀도 우리 DB 는 CANCELED/REFUNDED 그대로
 *   = 고객은 "환불됨" 메일을 받았는데 돈은 안 갔고 아무도 모름(미환불 은폐).
 *   비대칭이 핵심: 성공(PAYMENT.CAPTURE.REFUNDED)은 처리되고 실패만 버려짐.
 *   ⚠️ PAYMENT.REFUND.COMPLETED 는 존재하지 않는다 — 완료는 PAYMENT.CAPTURE.REFUNDED 로 온다.
 *
 * fix: FAILED → refundID(1:1) 우선 매칭 → status REFUND_FAILED + 운영자 critical 알럿.
 *      PENDING → refundStatus 만 기록(status 불변).
 *      매칭: refundID 가 유일키. captureID 폴백은 cart 형제 공유 시 ambiguous(F6 동일 가드).
 *
 * 🔑 운영자: PayPal Developer Dashboard → Webhooks 에 두 이벤트 구독 추가해야 실제로 온다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const notifySpy = vi.fn(async () => ({ ok: true }));
const logSet = vi.fn(async () => undefined);
const bookingsSet = vi.fn(async () => undefined);
const bookingsUpdate = vi.fn(async () => undefined);
const pendingUpdate = vi.fn(async () => undefined);
let byRefundId: Array<{ id: string; data: any }>;
let byCaptureId: Array<{ id: string; data: any }>;

vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api.paypal.com' }),
}));
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => notifySpy(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn(async () => ({ ok: true })) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

function q(rows: Array<{ id: string; data: any }>) {
  return { size: rows.length, empty: rows.length === 0, docs: rows.map((r) => ({ id: r.id, data: () => r.data })) };
}
function makeDb() {
  return {
    collection: (name: string) => ({
      doc: (_id: string) => ({
        get: async () => ({ exists: false, data: () => undefined }),
        set: (...a: any[]) => (name === 'paypal_webhook_log' ? logSet(...a) : bookingsSet(...a)),
        update: (...a: any[]) => (name === 'pending_bookings' ? pendingUpdate(...a) : bookingsUpdate(...a)),
      }),
      where: (field: string) => ({
        get: async () => q(field === 'refundID' ? byRefundId : byCaptureId),
      }),
    }),
  };
}
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => makeDb() }));

const { default: handler } = await import('../../api/paypal-webhook.js');

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return { out, writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
}
async function fire(eventType: string) {
  const res = mockRes();
  const body = JSON.stringify({
    event_type: eventType,
    resource: {
      id: 'REFUND-1',
      status: eventType.endsWith('FAILED') ? 'FAILED' : 'PENDING',
      links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/CAP-1' }],
    },
  });
  const req = {
    method: 'POST',
    headers: {
      'paypal-transmission-id': `txn-${eventType}`,
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.paypal.com/cert',
      'paypal-transmission-sig': 'sig',
      'paypal-transmission-time': '2026-07-16T00:00:00Z',
    },
    body,
  };
  await handler(req as any, res as any);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

beforeEach(() => {
  notifySpy.mockClear(); logSet.mockClear(); bookingsSet.mockClear(); bookingsUpdate.mockClear(); pendingUpdate.mockClear();
  process.env.PAYPAL_WEBHOOK_ID = 'wh-test';
  delete process.env.PAYPAL_SANDBOX_CLIENT_ID;
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }), text: async () => '' })) as never;
  byRefundId = [{ id: 'CT-1', data: { bookingRef: 'CT-1', status: 'CANCELED', refundID: 'REFUND-1', captureID: 'CAP-1' } }];
  byCaptureId = [];
});

describe('F4 — PAYMENT.REFUND.FAILED: 환불 실패를 되돌려 은폐 차단', () => {
  it('refundID 1:1 매칭 → status REFUND_FAILED 기록 + 운영자 알럿 + 200 processed', async () => {
    const r = await fire('PAYMENT.REFUND.FAILED');
    expect(r.statusCode).toBe(200);
    expect(r.json.status).toBe('refund_failed');
    // bookings 에 REFUND_FAILED 가 기록됐는지 (set merge 또는 update 어느 쪽이든)
    const wrote = [...bookingsSet.mock.calls, ...bookingsUpdate.mock.calls]
      .some((c) => c[0]?.status === 'REFUND_FAILED');
    expect(wrote).toBe(true);                              // ★ 뮤테이션 실증
    expect(notifySpy).toHaveBeenCalled();                  // 운영자 critical 알럿
  });

  it('매칭 0건 → unmatched 로그 + 알럿 + 200 (돈 문제라 조용히 버리지 않음)', async () => {
    byRefundId = []; byCaptureId = [];
    const r = await fire('PAYMENT.REFUND.FAILED');
    expect(r.statusCode).toBe(200);
    expect(r.json.status).toBe('unmatched');
    expect(notifySpy).toHaveBeenCalled();
  });

  it('refundID 미매칭 + captureID 폴백 형제 2건 → ambiguous, 자동 마킹 금지 (F6 동일)', async () => {
    byRefundId = [];
    byCaptureId = [
      { id: 'ORD__L0', data: { captureID: 'CAP-1' } },
      { id: 'ORD__L1', data: { captureID: 'CAP-1' } },
    ];
    const r = await fire('PAYMENT.REFUND.FAILED');
    expect(r.json.status).toBe('ambiguous');
    const wroteStatus = [...bookingsSet.mock.calls, ...bookingsUpdate.mock.calls]
      .some((c) => c[0]?.status === 'REFUND_FAILED');
    expect(wroteStatus).toBe(false);
  });
});

describe('F4 — PAYMENT.REFUND.PENDING: 관측 기록만 (status 불변)', () => {
  it('refundStatus PENDING 기록, status 필드는 안 씀', async () => {
    const r = await fire('PAYMENT.REFUND.PENDING');
    expect(r.statusCode).toBe(200);
    expect(r.json.status).toBe('refund_pending_recorded');
    const calls = [...bookingsSet.mock.calls, ...bookingsUpdate.mock.calls];
    expect(calls.some((c) => c[0]?.refundStatus === 'PENDING')).toBe(true);
    expect(calls.some((c) => c[0]?.status != null)).toBe(false);   // ★ 종단 status 는 건드리지 않음
  });
});
