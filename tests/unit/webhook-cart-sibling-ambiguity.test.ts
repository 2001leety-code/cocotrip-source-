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

import { createFakeFirestore, FieldValue as FakeFieldValue } from '../helpers/fake-firestore.js';

const notifySpy = vi.fn(async () => ({ ok: true }));
let siblings: string[]; // bookings sharing the captureID
// 🔴 2026-07-29: 손으로 만든 doc 목 대신 **낙관적 동시성까지 흉내내는 가짜 Firestore** 를 쓴다.
//   환불 처리가 transaction 안으로 들어가면서 runTransaction 없는 목으로는 쓰기를 검증할 수
//   없게 됐다. 이제 스파이 호출 여부가 아니라 **문서 내용**을 직접 확인한다(더 강한 검증).
let db: ReturnType<typeof createFakeFirestore>;

vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api.paypal.com' }),
  resolveIsSandbox: () => false,
}));
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => notifySpy(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn(async () => ({ ok: true })) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: FakeFieldValue }));

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));

function seedSiblings(ids: string[]) {
  const seed: Record<string, unknown> = {};
  for (const id of ids) {
    seed[`bookings/${id}`] = { bookingRef: id, amountKRW: 100000, captureID: 'CAP-1', status: 'CONFIRMED' };
  }
  return createFakeFirestore(seed);
}

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
  notifySpy.mockClear();
  process.env.PAYPAL_WEBHOOK_ID = 'wh-test';
  delete process.env.PAYPAL_SANDBOX_CLIENT_ID;
  // 서명 검증 fetch → SUCCESS
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }), text: async () => '' })) as never;
});

describe('F6 — cart 형제 공유 captureID 는 자동 마킹 금지', () => {
  it('형제 2건 공유 → bookings 미터치 + ambiguous 로그 + 운영자 알럿 + 200', async () => {
    siblings = ['ORD__L0', 'ORD__L1'];
    db = seedSiblings(siblings);
    const r = await fireRefund();
    expect(r.statusCode).toBe(200);
    expect(r.json.status).toBe('ambiguous');
    // ★ 뮤테이션 실증: 임의 형제를 환불처리하지 않는다.
    for (const id of siblings) {
      expect(db.__get(`bookings/${id}`)!.status).toBe('CONFIRMED');
      expect(db.__get(`bookings/${id}`)!.refundedUSDTotal).toBeUndefined();
    }
    expect(db.__get('paypal_webhook_log/txn-1')!.status).toBe('ambiguous');
    expect(notifySpy).toHaveBeenCalled();                // 운영자 알럿
  });

  it('단건(형제 1) → 기존대로 환불 기록 (회귀 없음)', async () => {
    siblings = ['ORD-SINGLE'];
    db = seedSiblings(siblings);
    const r = await fireRefund();
    expect(r.statusCode).toBe(200);
    expect(r.json.status).not.toBe('ambiguous');
    const doc = db.__get('bookings/ORD-SINGLE')!;
    expect(doc.refundedUSDTotal).toBe(50);
    // 원결제 ₩100,000 중 $50(≈₩71,500) → 부분환불.
    expect(doc.status).toBe('PARTIALLY_REFUNDED');
    expect(db.__get('paypal_webhook_log/txn-1')!.status).toBe('processed');
  });

  it('같은 환불 이벤트를 다시 받아도 누계가 늘지 않는다', async () => {
    siblings = ['ORD-SINGLE'];
    db = seedSiblings(siblings);
    await fireRefund();
    await fireRefund();
    expect(db.__get('bookings/ORD-SINGLE')!.refundedUSDTotal).toBe(50);
  });
});
