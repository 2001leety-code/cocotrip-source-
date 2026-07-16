/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * F2 (2026-07-16) — cancelBooking 이 환불 **결과 미상**을 "환불 안 됨"으로 단정하던 버그.
 *
 * 이전 !ok 분기: best-effort `ref.update({status:'CONFIRMED', cancelClaimedAt: delete})`.
 *   문제 1) 타임아웃(PAYPAL_REFUND_TIMEOUT)·소켓단절(PAYPAL_NETWORK_ERROR)은 **결과 미상**이다
 *          — PayPal 이 환불을 처리했을 수 있다. 이를 CONFIRMED 로 되돌리면 사용자가 재시도 →
 *          멱등키 보존기간 밖이면 **이중환불**(직접 손실).
 *   문제 2) 무조건 update = webhook(PAYMENT.CAPTURE.REFUNDED, t≈3s)이 먼저 쓴 REFUNDED 를
 *          우리 복구(t≈21s)가 **덮어쓴다**. webhook 은 eventId 멱등 + 200 이라 재전송 없음 = 영구 clobber.
 *
 * fix: OUTCOME_UNKNOWN 은 REFUND_UNKNOWN + 텔레그램 알럿 + 202. 확정실패만 CONFIRMED 복구.
 *   두 경로 모두 **CAS**(status==='CANCELING' 일 때만 write) — webhook 이 이겼으면 건드리지 않는다.
 *
 * 행위 테스트 — 핸들러를 실행하고 stateful Firestore 모킹으로 CAS 를 실제로 흉내낸다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authHolder: { r: any } = { r: { ok: true, email: 'cust@x.com', uid: 'u1' } };
const refundHolder: { r: any; onCall?: () => void } = { r: { ok: true, refund: { id: 'RF-1', status: 'COMPLETED' } } };
const alertSpy = vi.fn(async () => ({ ok: true }));
let bookingState: any;
let txUpdates: any[];
let plainUpdates: any[];

vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: async () => authHolder.r }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({
  refundPaypalCapture: async () => { if (refundHolder.onCall) refundHolder.onCall(); return refundHolder.r; },
}));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: (...a: any[]) => alertSpy(...a) }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperator: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({ buildManualPaymentEmail: () => ({ subject: '', html: '', text: '' }) }));
vi.mock('../../api/_shared/pricing.js', () => ({ productDisplayLabel: (x: string) => x }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } }));

function makeDb() {
  const bookingsDoc = {
    get: async () => ({ exists: true, data: () => ({ ...bookingState }) }),
    update: async (patch: any) => { plainUpdates.push(patch); Object.assign(bookingState, patch); },
  };
  return {
    collection: (name: string) => ({
      doc: () => (name === 'users'
        ? { get: async () => ({ exists: true, data: () => ({ tier: 'Bronze' }) }) }
        : bookingsDoc),
    }),
    runTransaction: async (fn: any) => fn({
      get: async () => ({ exists: true, data: () => ({ ...bookingState }) }),
      update: (_ref: any, patch: any) => { txUpdates.push(patch); Object.assign(bookingState, patch); },
    }),
  };
}
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => makeDb() }));

const { default: handler } = await import('../../api/cancelBooking.js');

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return { out, writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
}
async function cancel() {
  const res = mockRes();
  await handler({ method: 'POST', url: '/api/cancelBooking', headers: { host: 'unit.test' }, body: { bookingID: 'CT-1', reason: 'change of plans' } } as any, res as any);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

beforeEach(() => {
  authHolder.r = { ok: true, email: 'cust@x.com', uid: 'u1' };
  refundHolder.r = { ok: true, refund: { id: 'RF-1', status: 'COMPLETED' } };
  refundHolder.onCall = undefined;
  alertSpy.mockClear();
  txUpdates = []; plainUpdates = [];
  // 100% 환불 창(먼 미래 tourDate). captureID 존재. AI 플래너 아님.
  bookingState = {
    userEmail: 'cust@x.com', status: 'CONFIRMED', captureID: 'CAP-1',
    productType: 'airport-pickup', tourDate: '2099-12-31', tourTime: '10:00',
    amountUSD: '100.00', amountKRW: 143000, currency: 'USD',
  };
});

describe('F2 — 미상 결과는 CONFIRMED 로 단정하지 않는다', () => {
  it('PAYPAL_REFUND_TIMEOUT → status REFUND_UNKNOWN (CONFIRMED 아님) + 알럿 + 202', async () => {
    refundHolder.r = { ok: false, code: 'PAYPAL_REFUND_TIMEOUT', error: 'timed out', status: 502 };
    const r = await cancel();
    expect(bookingState.status).toBe('REFUND_UNKNOWN');            // ★ 뮤테이션 실증
    expect(txUpdates.some((u) => u.status === 'CONFIRMED')).toBe(false);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(r.statusCode).toBe(202);
    expect(r.json.code).toBe('REFUND_PENDING_VERIFICATION');
  });

  it('PAYPAL_NETWORK_ERROR(미상) → REFUND_UNKNOWN + 알럿 + 202', async () => {
    refundHolder.r = { ok: false, code: 'PAYPAL_NETWORK_ERROR', error: 'ECONNRESET', status: 502 };
    const r = await cancel();
    expect(bookingState.status).toBe('REFUND_UNKNOWN');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(r.statusCode).toBe(202);
  });

  it('PAYPAL_REFUND_FAILED(확정 실패) → CONFIRMED 복구(재시도 허용), 알럿 없음, 502', async () => {
    refundHolder.r = { ok: false, code: 'PAYPAL_REFUND_FAILED', error: 'declined', status: 502 };
    const r = await cancel();
    expect(bookingState.status).toBe('CONFIRMED');                 // ★ 오격리 방지
    expect(alertSpy).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(502);
  });

  it('REFUND_REQUEST_INVALID(F5, 송신 전) → CONFIRMED 복구, REFUND_UNKNOWN 아님', async () => {
    refundHolder.r = { ok: false, code: 'REFUND_REQUEST_INVALID', error: 'no money moved', status: 500 };
    const r = await cancel();
    expect(bookingState.status).toBe('CONFIRMED');                 // ★ F5→F2 인터락 증명
    expect(alertSpy).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(500);
  });

  it('🔴 webhook 이 먼저 REFUNDED 를 썼으면 미상 복구가 덮지 않는다 (CAS)', async () => {
    // refund 호출 도중 webhook 이 t≈3s 에 REFUNDED 를 씀 (CANCELING 선점 이후).
    refundHolder.r = { ok: false, code: 'PAYPAL_REFUND_TIMEOUT', error: 'timed out', status: 502 };
    refundHolder.onCall = () => { bookingState.status = 'REFUNDED'; };
    await cancel();
    expect(bookingState.status).toBe('REFUNDED');                  // ★ CAS 뮤테이션 실증: 덮어쓰지 않음
    expect(txUpdates.some((u) => u.status === 'REFUND_UNKNOWN')).toBe(false);
  });

  it('성공(COMPLETED) → CANCELED 확정 (회귀 없음)', async () => {
    const r = await cancel();
    expect(bookingState.status).toBe('CANCELED');
    expect(r.statusCode).toBe(200);
  });

  // F3c-lite (옵션 B, 2026-07-16): PENDING 은 종단 유지(CANCELED) + 관측 알럿.
  //   비종단 REFUND_PENDING 상태로 바꾸는 strict 버전은 eCheck 가 API 에서 영구 PENDING 으로 남으면
  //   정상 경로가 퇴행하는 리스크 → 샌드박스 실측 전엔 관측만. FAILED 뒤집힘은 F4 webhook 이 치유.
  it('성공이지만 PENDING(eCheck) → CANCELED 유지 + 관측 알럿 발화', async () => {
    refundHolder.r = { ok: true, final: false, pending: true, refund: { id: 'RF-1', status: 'PENDING' } };
    const r = await cancel();
    expect(r.statusCode).toBe(200);
    expect(bookingState.status).toBe('CANCELED');          // 옵션 B: 종단 유지
    expect(bookingState.refundStatus).toBe('PENDING');     // 기록은 남음
    expect(alertSpy).toHaveBeenCalledTimes(1);             // ★ 관측 알럿 (빈도 측정 = F3c strict 게이트 데이터)
  });
});

// F7/F8 보호조치 (2026-07-16): cart 자식 예약(parentOrderID 보유)은 형제와 captureID 를 공유하므로
//   여기서 개별 환불하면 refundRatio=1.0 → refundUSD=null → capture **전액환불**(카트 전체)이 된다.
//   현재는 child doc 에 userEmail 이 없어 위 소유자 가드(403)가 우연히 막고 있지만, 그건 설계가 아니라
//   필드 누락 사고다. "카트가 My Bookings 에 안 떠요" 를 고치려 userEmail 한 줄만 추가하면 이 전액환불
//   경로가 무장된다. parentOrderID 를 명시적으로 거부해 그 사고를 원천 차단한다(capture 단위 환불 원장은 P1 밖).
describe('F7/F8 보호조치 — cart 자식(parentOrderID)은 개별 환불 거부', () => {
  it('parentOrderID 보유 booking → 409 CART_CHILD_REFUND_UNSUPPORTED, PayPal 미터치', async () => {
    bookingState.parentOrderID = 'CART-PARENT-1';
    const r = await cancel();
    expect(r.statusCode).toBe(409);
    expect(r.json.code).toBe('CART_CHILD_REFUND_UNSUPPORTED');
    expect(bookingState.status).toBe('CONFIRMED');   // 상태 미변경
  });
});
