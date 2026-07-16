/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * F6 (2026-07-16) — PAYMENT.CAPTURE.REFUNDED webhook 이 cart 형제의 공유 captureID 를 처리하는 방식.
 *
 * 버그: cart 자식 예약 N개가 하나의 captureID 를 공유한다(cart-capture.js). refund webhook 은
 *   `bookings.where('captureID','==',captureId).limit(1)` 로 **1건만** 골라 REFUNDED 로 마킹했다.
 *   Firestore equality 쿼리는 암묵 __name__ ASC 정렬이라 항상 첫 라인(__L0)이 희생된다 →
 *   실제 환불된 라인은 CONFIRMED 로 남고 엉뚱한 라인이 환불처리된다(기록 오류).
 *
 * fix: size>1 이면 captureID 만으로 특정 불가 → 자동 마킹 금지 + ambiguous 로그 + 운영자 알럿 + 200.
 *
 * 행위 테스트 — 서명 검증을 SUCCESS 로 모킹하고 handler 를 실제 실행한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const notifySpy = vi.fn(async () => ({ ok: true }));
const logSet = vi.fn(async () => undefined);
const bookingsSet = vi.fn(async () => undefined);
let siblings: string[]; // bookings sharing the captureID

vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api.paypal.com' }),
}));
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => notifySpy(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn(async () => ({ ok: true })) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));

function makeDb() {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (name === 'paypal_webhook_log') return { exists: false, data: () => undefined };
          if (name === 'bookings') return { exists: false, data: () => undefined }; // bookings/{captureId} 없음 → captureID 필드 매칭으로
          return { exists: false, data: () => undefined };
        },
        set: (...a: any[]) => (name === 'paypal_webhook_log' ? logSet(...a) : bookingsSet(...a)),
        update: async () => undefined,
      }),
      where: () => ({
        get: async () => ({
          size: siblings.length,
          empty: siblings.length === 0,
          docs: siblings.map((id) => ({ id, data: () => ({ bookingRef: id, amountKRW: 100000, captureID: 'CAP-1' }) })),
        }),
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

const EVENT = {
  event_type: 'PAYMENT.CAPTURE.REFUNDED',
  resource: {
    amount: { value: '50.00', currency_code: 'USD' },
    links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/CAP-1' }],
  },
};

async function fireRefund() {
  const res = mockRes();
  const body = JSON.stringify(EVENT);
  const req = {
    method: 'POST',
    headers: {
      'paypal-transmission-id': 'txn-1',
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
  notifySpy.mockClear(); logSet.mockClear(); bookingsSet.mockClear();
  process.env.PAYPAL_WEBHOOK_ID = 'wh-test';
  delete process.env.PAYPAL_SANDBOX_CLIENT_ID;
  // 서명 검증 fetch → SUCCESS
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }), text: async () => '' })) as never;
});

describe('F6 — cart 형제 공유 captureID 는 자동 마킹 금지', () => {
  it('형제 2건 공유 → bookings 미터치 + ambiguous 로그 + 운영자 알럿 + 200', async () => {
    siblings = ['ORD__L0', 'ORD__L1'];
    const r = await fireRefund();
    expect(r.statusCode).toBe(200);
    expect(r.json.status).toBe('ambiguous');
    expect(bookingsSet).not.toHaveBeenCalled();          // ★ 뮤테이션 실증: 임의 형제 마킹 금지
    // ambiguous 로그가 남았는지 (paypal_webhook_log.set 에 status:'ambiguous')
    const loggedAmbiguous = logSet.mock.calls.some((c) => c[0]?.status === 'ambiguous');
    expect(loggedAmbiguous).toBe(true);
    expect(notifySpy).toHaveBeenCalled();                // 운영자 알럿
  });

  it('단건(형제 1) → 기존대로 REFUNDED 기록 (회귀 없음)', async () => {
    siblings = ['ORD-SINGLE'];
    const r = await fireRefund();
    expect(r.statusCode).toBe(200);
    expect(r.json.status).not.toBe('ambiguous');
    expect(bookingsSet).toHaveBeenCalled();              // 정상 마킹
  });
});
