/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * 배차 실패 취소 (2026-07-28) — action='dispatch-cancel' 동작 테스트.
 *
 * 운영자가 차량·기사를 못 구했을 때 누르는 버튼. 우리 귀책이므로 취소정책(24h 바이너리)과
 * 무관하게 **항상 전액 환불**이고, 사유가 필수다(입력한 문장이 고객 이메일에 그대로 실린다).
 *
 * 잠그는 것:
 *  1. 사유·분류 없이 집행되지 않는다 (빈 사유로 고객에게 나가는 것 방지)
 *  2. 부분환불이 불가능하다 — refundUSD 를 넘기지 않아 capture 전액이 환불된다
 *  3. CONFIRMED 아닌 건은 거부 (재클릭으로 두 번째 환불이 나가는 것 방지)
 *  4. PayPal 환불이 실패하면 상태를 CANCELED 로 쓰지 않는다
 *     ("취소됐는데 돈은 안 온" 상태 금지)
 *  5. 멱등키가 예약당 고정 — 타임아웃 재클릭이 두 번 환불되지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authHolder: { result: any } = { result: { ok: true, email: 'admin@cocotrip.kr', uid: 'admin1' } };
const refundSpy = vi.fn(async () => ({ ok: true, refund: { id: 'RF-1', status: 'COMPLETED' } }) as any);
const auditAdd = vi.fn(async () => undefined);
const pendingUpdate = vi.fn(async () => undefined);
const bookingsSet = vi.fn(async () => undefined);
const sendEmailSpy = vi.fn(async () => undefined);

vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: async () => authHolder.result }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: (...a: any[]) => refundSpy(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => undefined) }));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: (...a: any[]) => sendEmailSpy(...a) }));
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({
  buildManualPaymentEmail: (_kind: string, b: any) => ({ subject: 's', html: String(b?.refundReason || ''), text: '' }),
}));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn(async () => ({ ok: true, bookingId: 'b1' })) }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } }));

const pendingHolder: { d: any } = { d: {} };
const bookingHolder: { d: any } = { d: {} };

function makeDb() {
  return {
    collection: (name: string) => ({
      add: (...a: any[]) => auditAdd(...a),
      doc: () => ({
        get: async () => {
          if (name === 'pending_bookings') return { exists: true, data: () => ({ ...pendingHolder.d }) };
          if (name === 'bookings') return { exists: true, data: () => ({ ...bookingHolder.d }) };
          return { exists: false, data: () => undefined };
        },
        update: (...a: any[]) => pendingUpdate(...a),
        set: (...a: any[]) => bookingsSet(...a),
      }),
    }),
  };
}
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => makeDb() }));

const { default: handler } = await import('../../api/admin-booking-action.js');

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return { out, writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
}
async function call(body: object) {
  const res = mockRes();
  await handler({ method: 'POST', url: '/api/admin-booking-action', headers: { host: 'unit.test' }, body } as any, res as any);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

const OK_BODY = {
  bookingRef: 'CT-20260728-001',
  action: 'dispatch-cancel',
  cancelCategory: 'no_vehicle',
  reason: '당일 폭설로 배정 차량 운행 불가',
};

beforeEach(() => {
  authHolder.result = { ok: true, email: 'admin@cocotrip.kr', uid: 'admin1' };
  refundSpy.mockClear();
  refundSpy.mockResolvedValue({ ok: true, refund: { id: 'RF-1', status: 'COMPLETED' } } as any);
  auditAdd.mockClear(); pendingUpdate.mockClear(); bookingsSet.mockClear(); sendEmailSpy.mockClear();
  pendingHolder.d = {
    status: 'CONFIRMED', priceKRW: 1000000, customerEmail: 'cust@x.com',
    paypalTransactionId: 'PPTXN-1', language: 'ko',
  };
  bookingHolder.d = { captureID: 'CAP-1', amountKRW: 1000000, amountUSD: '714.29', currency: 'USD' };
});

describe('dispatch-cancel — 입력 검증', () => {
  it('사유 분류가 없거나 허용값이 아니면 400', async () => {
    for (const cancelCategory of [undefined, '', 'whatever']) {
      const r = await call({ ...OK_BODY, cancelCategory });
      expect(r.statusCode).toBe(400);
      expect(r.json.code).toBe('MISSING_CANCEL_CATEGORY');
    }
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('사유 문장이 비면 400 — 빈 사유로 고객 메일이 나가지 않는다', async () => {
    for (const reason of [undefined, '', '   ']) {
      const r = await call({ ...OK_BODY, reason });
      expect(r.statusCode).toBe(400);
      expect(r.json.code).toBe('MISSING_REASON');
    }
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('CONFIRMED 아닌 건은 거부 — 재클릭 이중환불 영구 방어선', async () => {
    for (const status of ['CANCELED', 'REFUNDED', 'AWAITING_VERIFICATION']) {
      pendingHolder.d = { ...pendingHolder.d, status };
      const r = await call(OK_BODY);
      expect(r.statusCode).toBe(400);
      expect(r.json.code).toBe('INVALID_STATUS');
    }
    expect(refundSpy).not.toHaveBeenCalled();
  });
});

describe('dispatch-cancel — 환불 집행', () => {
  it('전액 환불로만 나간다 (refundUSD 미지정 = capture 전액)', async () => {
    const r = await call(OK_BODY);
    expect(r.statusCode).toBe(200);
    expect(refundSpy).toHaveBeenCalledTimes(1);
    const arg = (refundSpy.mock.calls[0] as any[])[0];
    expect(arg.refundUSD).toBeNull();
    expect(arg.captureID).toBe('CAP-1');
  });

  it('부분환불 인자를 보내도 무시된다 (금액 조작 불가)', async () => {
    await call({ ...OK_BODY, refundedKRW: 1000 });
    const arg = (refundSpy.mock.calls[0] as any[])[0];
    expect(arg.refundUSD).toBeNull();
  });

  it('멱등키는 예약당 고정 — 타임아웃 재클릭이 두 번 환불되지 않는다', async () => {
    await call(OK_BODY);
    const arg = (refundSpy.mock.calls[0] as any[])[0];
    expect(arg.idempotencyKey).toBe('CT-20260728-001:dispatch-cancel');
  });

  it('PayPal 환불 실패 시 CANCELED 를 쓰지 않는다', async () => {
    refundSpy.mockResolvedValue({ ok: false, status: 502, code: 'PAYPAL_ERROR', error: 'boom' } as any);
    const r = await call(OK_BODY);
    expect(r.statusCode).toBe(502);
    expect(pendingUpdate).not.toHaveBeenCalled();
    expect(bookingsSet).not.toHaveBeenCalled();
  });
});

describe('dispatch-cancel — 기록과 고객 안내', () => {
  it('상태·사유·귀책이 두 컬렉션에 함께 기록된다', async () => {
    await call(OK_BODY);
    const written = (pendingUpdate.mock.calls[0] as any[])[0];
    expect(written.status).toBe('CANCELED');
    expect(written.cancelCategory).toBe('no_vehicle');
    expect(written.cancelFault).toBe('operator');
    expect(written.dispatchFailed).toBe(true);
    expect(written.refundPercent).toBe(100);
    expect(written.refundedKRW).toBe(1000000);
    expect(written.canceledReason).toContain('당일 폭설');
    // bookings 쪽에도 같은 내용이 머지된다 — 고객 마이페이지가 읽는 곳.
    expect((bookingsSet.mock.calls[0] as any[])[0].status).toBe('CANCELED');
  });

  it('운영자가 쓴 사유가 분류 라벨과 함께 고객 안내에 실린다', async () => {
    await call(OK_BODY);
    expect(sendEmailSpy).toHaveBeenCalled();
    const mail = (sendEmailSpy.mock.calls[0] as any[])[0];
    expect(mail.html).toContain('차량 미확보');      // 고객 언어(ko) 라벨
    expect(mail.html).toContain('당일 폭설');        // 운영자 문장 원문
  });

  it('captureID 가 없으면 수동 환불 대기로 표시된다 (조용히 성공 처리하지 않음)', async () => {
    bookingHolder.d = { amountKRW: 500000 };
    const r = await call(OK_BODY);
    expect(r.statusCode).toBe(200);
    expect(refundSpy).not.toHaveBeenCalled();
    expect(r.json.data.refundSource).toBe('manual-pending');
  });
});
