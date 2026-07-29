/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * PayPal 웹훅 — **일시 장애를 200 으로 인정하지 않기** (2026-07-29 P0).
 *
 * 🔴 PayPal 은 200 을 받으면 재전송하지 않는다. 그래서 "일시 장애"를 200 으로 응답하면
 *   그 사이 들어온 결제·환불 이벤트가 **영구히 유실**된다. 이전 코드가 그랬다:
 *     · initAdminDb() 실패 → 200
 *     · 환경 확인 Firestore 조회 실패가 environment_mismatch 와 같은 결과로 합쳐짐 → 200
 *     · confirmBookingAsPaid() 실패 → 200 (결제는 됐고 예약은 미확정인 상태가 영구 고착)
 *     · REFUND.PENDING/FAILED 저장 실패를 catch 로 숨기고 processed → 은폐
 *     · PayPal 검증 API 429/5xx 를 "서명 실패"로 분류 → 200
 *
 * 계약:
 *   2xx  = 확인된 격리(금액 불일치·환경 불일치·중복·식별 불가·멱등 재처리)
 *   5xx  = 판단 불가 또는 저장 실패 (Firestore·PayPal API 장애·확정/상태 저장 실패)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore, FieldValue as FakeFieldValue } from '../helpers/fake-firestore.js';

const notifySpy = vi.fn(async () => ({ ok: true }));
const confirmBookingAsPaid = vi.fn(async () => ({ ok: true, bookingId: 'B1' }));
let db: any;

vi.mock('../../api/_shared/paypal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api-m.paypal.com' }),
}));
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => notifySpy(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({
  confirmBookingAsPaid: (...a: any[]) => confirmBookingAsPaid(...a),
}));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: FakeFieldValue }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));

const { default: handler } = await import('../../api/paypal-webhook.js');

const savedEnv = { ...process.env };
let verifyStatus: { httpStatus?: number; verification?: string; throwNetwork?: boolean };

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return { out, writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
}

async function fire(event: object, eventId = 'txn-1') {
  const res = mockRes();
  await handler({
    method: 'POST',
    headers: {
      'paypal-transmission-id': eventId,
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.paypal.com/cert',
      'paypal-transmission-sig': 'sig',
      'paypal-transmission-time': '2026-07-29T00:00:00Z',
    },
    body: JSON.stringify(event),
  } as any, res as any);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

const CAPTURE_EVENT = {
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: { id: 'TX-1', note_to_payee: 'CT-20260729-001', amount: { value: '100.00', currency_code: 'USD' } },
};
const REFUND_PENDING = {
  event_type: 'PAYMENT.REFUND.PENDING',
  resource: { id: 'RF-1', links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/CAP-1' }] },
};
const REFUND_FAILED = {
  event_type: 'PAYMENT.REFUND.FAILED',
  resource: { id: 'RF-2', links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/CAP-1' }] },
};

function seed() {
  return createFakeFirestore({
    'bookings/ORD-1': {
      bookingRef: 'CT-20260729-001', captureID: 'CAP-1', paypalEnvironment: 'live',
      status: 'CONFIRMED', amountUSD: 100,
    },
    'pending_bookings/CT-20260729-001': {
      priceUSD: 100, priceKRW: 143000, status: 'PENDING', paypalEnvironment: 'live',
    },
  });
}

beforeEach(() => {
  notifySpy.mockClear();
  confirmBookingAsPaid.mockClear();
  confirmBookingAsPaid.mockImplementation(async () => ({ ok: true, bookingId: 'B1' }));
  process.env.PAYPAL_WEBHOOK_ID = 'LIVE-WH-ID';
  process.env.VERCEL_ENV = 'production';
  delete process.env.PAYPAL_ENV;
  verifyStatus = { verification: 'SUCCESS' };
  db = seed();
  global.fetch = vi.fn(async () => {
    if (verifyStatus.throwNetwork) throw new Error('socket hang up');
    if (verifyStatus.httpStatus) {
      return { ok: false, status: verifyStatus.httpStatus, json: async () => ({}), text: async () => 'err' };
    }
    return { ok: true, status: 200, json: async () => ({ verification_status: verifyStatus.verification }), text: async () => '' };
  }) as never;
});
afterEach(() => {
  for (const k of ['VERCEL_ENV', 'PAYPAL_ENV', 'PAYPAL_WEBHOOK_ID']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('저장소·외부 API 장애 → 5xx (PayPal 재전송)', () => {
  it('Firestore 초기화 실패 → 503', async () => {
    db = null;
    const r = await fire(CAPTURE_EVENT);
    expect(r.statusCode).toBe(503);
    expect(r.json.status).toBe('retryable');
  });

  it('🔴 환경 확인 조회 실패 → 503, environment_mismatch 로 기록하지 않는다', async () => {
    const base = seed();
    db = {
      ...base,
      collection: (name: string) => {
        const col = base.collection(name);
        if (name !== 'bookings' && name !== 'pending_bookings') return col;
        return {
          ...col,
          doc: (id: string) => ({ ...col.doc(id), get: async () => { throw new Error('firestore down'); } }),
        };
      },
    };
    // 환불 경로로 검사한다 — 이 경로에서는 첫 doc.get 이 곧 환경 검사다.
    const r = await fire(REFUND_FAILED);
    expect(r.statusCode).toBe(503);
    expect(r.json.reason).toBe('environment_check_unavailable');
    expect(base.__get('paypal_webhook_log/txn-1')).toBeUndefined();
    expect(base.__get('bookings/ORD-1')!.status).toBe('CONFIRMED');
  });

  it('PayPal 검증 API 500 → 5xx, 상태 변경 없음', async () => {
    verifyStatus = { httpStatus: 500 };
    const r = await fire(CAPTURE_EVENT);
    expect(r.statusCode).toBe(503);
    expect(confirmBookingAsPaid).not.toHaveBeenCalled();
    expect(db.__get('paypal_webhook_log/txn-1')!.status).toBe('verify_unavailable');
  });

  it('PayPal 검증 API 503 / 429 → 5xx', async () => {
    for (const st of [503, 429]) {
      db = seed();
      verifyStatus = { httpStatus: st };
      const r = await fire(CAPTURE_EVENT, `txn-${st}`);
      expect(r.statusCode, `status ${st}`).toBe(503);
    }
  });

  it('검증 API 네트워크 장애 → 5xx', async () => {
    verifyStatus = { throwNetwork: true };
    const r = await fire(CAPTURE_EVENT);
    expect(r.statusCode).toBe(503);
  });

  it('🔴 confirmBookingAsPaid 저장 실패 → 5xx, processed 기록 없음', async () => {
    confirmBookingAsPaid.mockImplementation(async () => ({ ok: false, code: 'WRITE_FAILED', error: 'firestore down' }));
    const r = await fire(CAPTURE_EVENT);
    expect(r.statusCode).toBe(503);
    expect(r.json.reason).toBe('confirm_booking_failed');
    expect(db.__get('paypal_webhook_log/txn-1')!.status).toBe('confirm_failed');
    expect(db.__get('paypal_webhook_log/txn-1')!.status).not.toBe('processed');
  });

  it('processed 로그 저장 실패 → 5xx (조용히 삼키지 않는다)', async () => {
    const base = seed();
    db = {
      ...base,
      collection: (name: string) => {
        const col = base.collection(name);
        if (name !== 'paypal_webhook_log') return col;
        return {
          ...col,
          doc: (id: string) => ({
            ...col.doc(id),
            set: async (data: any, o: any) => {
              if (data && data.status === 'processed') throw new Error('log write down');
              return col.doc(id).set(data, o);
            },
          }),
        };
      },
    };
    const r = await fire(CAPTURE_EVENT);
    expect(r.statusCode).toBe(503);
    expect(r.json.reason).toBe('processed_log_write_failed');
  });
});

describe('환불 상태 변경은 transaction — 부분 성공이 없다', () => {
  it('🔴 REFUND.PENDING 저장 실패 → 예약·로그 모두 미변경 + 5xx', async () => {
    db.__beforeCommit = async () => { throw new Error('firestore down'); };
    const r = await fire(REFUND_PENDING);
    expect(r.statusCode).toBe(503);
    expect(db.__get('bookings/ORD-1')!.refundStatus).toBeUndefined();
    expect(db.__get('paypal_webhook_log/txn-1')).toBeUndefined();
  });

  it('🔴 REFUND.FAILED 커밋 실패 → 두 저장소 모두 미변경 + 5xx', async () => {
    db.__beforeCommit = async () => { throw new Error('firestore down'); };
    const r = await fire(REFUND_FAILED);
    expect(r.statusCode).toBe(503);
    expect(db.__get('bookings/ORD-1')!.status).toBe('CONFIRMED');
    expect(db.__get('pending_bookings/CT-20260729-001')!.status).toBe('PENDING');
    expect(db.__get('paypal_webhook_log/txn-1')).toBeUndefined();
  });

  it('실패 후 같은 웹훅을 재전송하면 정확히 한 번만 반영된다', async () => {
    db.__beforeCommit = async () => { throw new Error('firestore down'); };
    expect((await fire(REFUND_FAILED)).statusCode).toBe(503);

    db.__beforeCommit = null;
    const retry = await fire(REFUND_FAILED);
    expect(retry.statusCode).toBe(200);
    expect(db.__get('bookings/ORD-1')!.status).toBe('REFUND_FAILED');
    expect(db.__get('pending_bookings/CT-20260729-001')!.status).toBe('REFUND_FAILED');
    expect(db.__get('paypal_webhook_log/txn-1')!.status).toBe('processed');

    // 세 번째 전송 — 멱등 차단
    const third = await fire(REFUND_FAILED);
    expect(third.json.idempotent).toBe(true);
  });

  it('두 저장소가 함께 바뀐다 (한쪽만 바뀐 상태 없음)', async () => {
    const r = await fire(REFUND_FAILED);
    expect(r.statusCode).toBe(200);
    const b = db.__get('bookings/ORD-1')!;
    const p = db.__get('pending_bookings/CT-20260729-001')!;
    expect(b.refundStatus).toBe('FAILED');
    expect(p.refundStatus).toBe('FAILED');
  });

  it('PENDING 은 종단 status 를 건드리지 않는다', async () => {
    const r = await fire(REFUND_PENDING);
    expect(r.statusCode).toBe(200);
    expect(db.__get('bookings/ORD-1')!.refundStatus).toBe('PENDING');
    expect(db.__get('bookings/ORD-1')!.status).toBe('CONFIRMED');
  });
});

describe('확인된 격리는 계속 2xx', () => {
  it('환경 불일치 → 200, 데이터 미변경', async () => {
    db.__set('bookings/ORD-1', { ...db.__get('bookings/ORD-1'), paypalEnvironment: 'sandbox' });
    db.__set('pending_bookings/CT-20260729-001', {
      ...db.__get('pending_bookings/CT-20260729-001'), paypalEnvironment: 'sandbox',
    });
    const r = await fire(CAPTURE_EVENT);
    expect(r.statusCode).toBe(200);
    expect(r.json.status).toBe('environment_mismatch');
    expect(confirmBookingAsPaid).not.toHaveBeenCalled();
  });

  it('금액 불일치 → 200 격리', async () => {
    db.__set('pending_bookings/CT-20260729-001', {
      priceUSD: 5, status: 'PENDING', paypalEnvironment: 'live',
    });
    const r = await fire(CAPTURE_EVENT);
    expect(r.statusCode).toBe(200);
    expect(r.json.status).toBe('amount_mismatch');
  });

  it('서명이 실제로 거절되면 200 ack (재시도 storm 차단)', async () => {
    verifyStatus = { verification: 'FAILURE' };
    const r = await fire(CAPTURE_EVENT);
    expect(r.statusCode).toBe(200);
    expect(r.json.acked).toBe(true);
    expect(db.__get('paypal_webhook_log/txn-1')!.paypalEnvironment).toBe('unverified');
  });

  it('중복 웹훅 → 200 idempotent', async () => {
    await fire(CAPTURE_EVENT);
    const again = await fire(CAPTURE_EVENT);
    expect(again.statusCode).toBe(200);
    expect(again.json.idempotent).toBe(true);
    expect(confirmBookingAsPaid).toHaveBeenCalledTimes(1);
  });

  it('식별 불가(capture id 없음) → 200 unmatched', async () => {
    const r = await fire({ event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { amount: { value: '1.00' } } });
    expect(r.statusCode).toBe(200);
    expect(r.json.status).toBe('unmatched');
  });
});
