/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * F1 (2026-07-16) — admin mark-refunded 금액 검증 (behavior test, mutation-proof).
 *
 * 버그: 운영자가 refundedKRW 에 '50,000'(한국식 콤마)·'abc'·{} 같은 비숫자를 보내면
 *   Number() 가 NaN 을 만들고, **NaN 과의 모든 비교는 false** 라 기존 money 가드 2개
 *   (REFUND_EXCEEDS_ORIGINAL / REFUND_ORIGINAL_UNKNOWN)가 둘 다 조용히 통과한다.
 *   → refundUSD=null → refundPaypalCapture 가 amount 를 생략 → PayPal capture **전액 환불**.
 *   부분환불 의도가 전액환불로 집행된다(직접 자금 손실).
 *
 * 이 파일은 핸들러를 **실행**한다 — booking-refund-security.test.ts 의 소스 정규식 가드는
 *   가드가 죽은 코드여도 통과하므로(vacuous) 실동작을 증명하지 못한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authHolder: { result: any } = { result: { ok: true, email: 'admin@cocotrip.kr', uid: 'admin1' } };
const refundSpy = vi.fn(async () => ({ ok: true, refund: { id: 'RF-1', status: 'COMPLETED' } }));
const auditAdd = vi.fn(async () => undefined);
const pendingUpdate = vi.fn(async () => undefined);
const bookingsSet = vi.fn(async () => undefined);

vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: async () => authHolder.result }));
vi.mock('../../api/_shared/paypal-refund.js', () => ({ refundPaypalCapture: (...a: any[]) => refundSpy(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => undefined) }));
vi.mock('../../api/_send-email.js', () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock('../../api/_shared/manual-payment-emails.js', () => ({ buildManualPaymentEmail: () => ({ subject: '', html: '', text: '' }) }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn(async () => ({ ok: true, bookingId: 'b1' })) }));
vi.mock('../../api/_shared/cors.js', () => ({ buildAdminJsonCors: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL' } }));

// pending_bookings/{ref} = CONFIRMED 원결제 ₩1,000,000 / $714.29. 테스트가 holder 로 오버라이드.
const pendingHolder: { d: any } = { d: {} };
const bookingHolder: { d: any } = { d: {} };

function makeDb() {
  return {
    collection: (name: string) => ({
      add: (...a: any[]) => auditAdd(...a),
      doc: (id: string) => ({
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

beforeEach(() => {
  authHolder.result = { ok: true, email: 'admin@cocotrip.kr', uid: 'admin1' };
  refundSpy.mockClear(); refundSpy.mockResolvedValue({ ok: true, refund: { id: 'RF-1', status: 'COMPLETED' } });
  auditAdd.mockClear(); pendingUpdate.mockClear(); bookingsSet.mockClear();
  pendingHolder.d = { status: 'CONFIRMED', priceKRW: 1000000, customerEmail: 'cust@x.com', paypalTransactionId: 'PPTXN-1' };
  bookingHolder.d = { amountKRW: 1000000, amountUSD: '714.29', captureID: 'CAP-1', currency: 'USD' };
});

describe('F1 — mark-refunded 비숫자 refundedKRW 는 fail-closed (전액환불 방지)', () => {
  // 문자열/객체/배열/특수값. 전부 Number() 가 NaN 이거나 <=0 이 되어 부분환불로 성립 불가.
  it.each([
    ['50,000 (한국식 콤마)', '50,000'],
    ['비숫자 문자열', 'abc'],
    ['원 붙은 문자열', '50000원'],
    ['빈 객체', {}],
    ['배열', []],
    ['빈 문자열', ''],
    ['오버플로 Infinity', '1e999'],
    ['0', 0],
    ['음수', -1],
    ['실제 NaN', NaN],
  ])('%s → 400 REFUND_AMOUNT_INVALID, PayPal·DB 미터치', async (_label, bad) => {
    const r = await call({ bookingRef: 'CT-20260716-001', action: 'mark-refunded', refundedKRW: bad });
    expect(r.statusCode).toBe(400);
    expect(r.json.code).toBe('REFUND_AMOUNT_INVALID');
    expect(refundSpy).not.toHaveBeenCalled();      // ★ 뮤테이션 실증: 가드 삭제 시 refundSpy 가 refundUSD:null 로 호출됨
    expect(pendingUpdate).not.toHaveBeenCalled();
    expect(bookingsSet).not.toHaveBeenCalled();
    expect(auditAdd).not.toHaveBeenCalled();        // ★ 감사로그 NaN 오염 방지 (가드가 initAdminDb 전)
  });

  it('정상 부분환불 (500000) → refundPaypalCapture 가 유한 refundUSD 로 호출됨', async () => {
    const r = await call({ bookingRef: 'CT-20260716-001', action: 'mark-refunded', refundedKRW: 500000 });
    expect(r.statusCode).toBe(200);
    expect(refundSpy).toHaveBeenCalledTimes(1);
    const usd = refundSpy.mock.calls[0][0].refundUSD;
    expect(usd).toBe('357.14');
    expect(Number.isFinite(Number(usd))).toBe(true);   // ★ NaN 이 흘러가면 이 단언이 잡음
  });

  it('금액 미지정 (전액환불 의도) → 회귀 없음: refundUSD=null 로 정상 전액환불', async () => {
    const r = await call({ bookingRef: 'CT-20260716-001', action: 'mark-refunded' });
    expect(r.statusCode).toBe(200);
    expect(refundSpy).toHaveBeenCalledTimes(1);
    expect(refundSpy.mock.calls[0][0].refundUSD).toBeNull();
  });
});

// 기존 booking-refund-security.test.ts 의 소스-정규식 가드(vacuous, 가드 삭제해도 통과)를
// 대체하는 행위 테스트. 정규식은 코드 텍스트만 확인해 실동작을 증명하지 못한다.
describe('과환불/원금부재 가드 — 행위 (소스 정규식 대체)', () => {
  it('환불액 > 원금 → 400 REFUND_EXCEEDS_ORIGINAL, PayPal 미터치', async () => {
    const r = await call({ bookingRef: 'CT-20260716-001', action: 'mark-refunded', refundedKRW: 2000000 });
    expect(r.statusCode).toBe(400);
    expect(r.json.code).toBe('REFUND_EXCEEDS_ORIGINAL');
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('원금 정보 완전 부재(bookings 없음, priceKRW 없음) + 부분환불 → 400 REFUND_ORIGINAL_UNKNOWN', async () => {
    pendingHolder.d = { status: 'CONFIRMED', customerEmail: 'cust@x.com', paypalTransactionId: 'PPTXN-1' }; // priceKRW 없음
    bookingHolder.d = { captureID: 'CAP-1', currency: 'USD' }; // amountKRW 없음 → originalKRW=0
    const r = await call({ bookingRef: 'CT-20260716-001', action: 'mark-refunded', refundedKRW: 500000 });
    expect(r.statusCode).toBe(400);
    expect(r.json.code).toBe('REFUND_ORIGINAL_UNKNOWN');
    expect(refundSpy).not.toHaveBeenCalled();
  });
});

// F3c-lite (옵션 B, 2026-07-16): admin 환불이 PENDING 으로 돌아오면 REFUNDED 종단은 유지하되
//   운영자 알럿으로 관측한다. FAILED 뒤집힘은 F4 webhook 이 REFUND_FAILED 로 치유.
describe('F3c-lite — admin 환불 PENDING 관측', () => {
  it('PayPal 이 PENDING 반환 → 200 유지 + 운영자 알럿(notify) 발화', async () => {
    refundSpy.mockResolvedValueOnce({ ok: true, final: false, pending: true, refund: { id: 'RF-P', status: 'PENDING' } });
    const notifyMod = await import('../../api/_shared/notify.js');
    const notifySpy = notifyMod.notify as ReturnType<typeof vi.fn>;
    notifySpy.mockClear();
    const r = await call({ bookingRef: 'CT-20260716-001', action: 'mark-refunded', refundedKRW: 500000 });
    expect(r.statusCode).toBe(200);
    // 알럿 중 하나에 PENDING 경고가 포함돼야 한다 (기존 '환불 완료' 텔레그램과 별개)
    const pendingAlert = notifySpy.mock.calls.some((c: any[]) => String(c[1]).includes('PENDING'));
    expect(pendingAlert).toBe(true);                       // ★ 관측 알럿
  });
});

describe('F1b — 원금(originalKRW) 이 NaN 이면 부분환불 검증 불가 → fail-closed', () => {
  it.each([
    ['콤마 문자열', '1,000,000'],
    ['비숫자', 'garbage'],
  ])('amountKRW=%s (손상) + 유효 부분환불 500000 → 400, PayPal 미터치', async (_l, badKrw) => {
    // amountKRW 가 truthy 손상 문자열이면 originalKRW=NaN → NaN 비교 전부 false 라
    //   기존 EXCEEDS/UNKNOWN 가드가 통과 → refundUSD=null → 전액환불. priceKRW 폴백은 안 탄다(|| 단락).
    bookingHolder.d = { amountKRW: badKrw, amountUSD: '714.29', captureID: 'CAP-1', currency: 'USD' };
    const r = await call({ bookingRef: 'CT-20260716-001', action: 'mark-refunded', refundedKRW: 500000 });
    expect(r.statusCode).toBe(400);
    expect(r.json.code).toBe('REFUND_ORIGINAL_UNKNOWN');
    expect(refundSpy).not.toHaveBeenCalled();   // ★ 뮤테이션 실증: isFinite 확장 삭제 시 전액환불이 나감
  });
});
