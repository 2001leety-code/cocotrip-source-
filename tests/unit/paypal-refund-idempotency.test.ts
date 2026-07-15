/**
 * refundPaypalCapture — 이중환불 방어 (P1, 2026-07-15). **행위 테스트.**
 *
 * 기존 refund 테스트(payment-integrity-pr425.test.ts)는 전부 **소스 정규식**이라 헤더가 실제로
 * 나가는지 증명하지 못한다. 여기서는 fetch 를 가로채 **실제 요청**을 관찰한다.
 *
 * ## 왜 이 방어가 필요한가 (가상의 위험이 아니다)
 * 1. 이 helper 엔 타임아웃이 없었다 → PayPal 이 환불을 처리했는데 우리만 에러로 보는 창이 열린다.
 * 2. cancelBooking 은 환불 실패 시 예약을 CONFIRMED 로 되돌려 **사용자 재시도를 허용**한다.
 * 3. admin mark-refunded 는 PayPal 실패 시 Firestore 를 안 건드려 status 가 CONFIRMED 로 남는다.
 * → 1번 창에서 2·3번 재시도 = 고객에게 두 번 환불(직접 자금 손실).
 *
 * ## captureID 를 키로 쓰면 안 되는 이유 (이것도 실제 구조)
 * cart 자식 예약 N개가 하나의 captureID 를 공유한다(_shared/cart-capture.js 의
 * `captureID: base.captureID`). 각 자식은 `${orderID}__${lineId}` 로 자기 문서·자기 status 를
 * 가지므로 라인별 개별 취소 = 같은 capture 에 서로 다른 금액의 **정당한** 환불 2회다.
 * captureID 키면 두 번째가 첫 번째 응답으로 캐시 반환돼 돈은 안 나가는데 CANCELED 로 확정된다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api.sandbox.paypal.com' }),
}));

const { refundPaypalCapture } = await import('../../api/_shared/paypal-refund.js');

type Call = { url: string; init: { headers: Record<string, string>; body: string } };
let calls: Call[];

function mockPaypal(resp: Record<string, unknown> = { id: 'REF-1', status: 'COMPLETED' }, httpOk = true, httpStatus = 201) {
  global.fetch = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as Call['init'] });
    return { ok: httpOk, status: httpStatus, json: async () => resp };
  }) as never;
}

const lastHeaders = () => calls[calls.length - 1].init.headers;
const lastBody = () => JSON.parse(calls[calls.length - 1].init.body);

beforeEach(() => {
  calls = [];
  mockPaypal();
});

describe('🔴 멱등키 — 없으면 환불 자체를 거부(fail-closed)', () => {
  it('idempotencyKey 누락 → PayPal 호출 0, NO_IDEMPOTENCY_KEY', async () => {
    const r = await refundPaypalCapture({ captureID: 'CAP-1' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('NO_IDEMPOTENCY_KEY');
    // 🔴 핵심: 키 없이 돈을 움직이지 않는다. 조용히 진행하면 재시도가 이중환불이 된다.
    expect(calls).toHaveLength(0);
  });

  it.each([null, '', 123, {}])('idempotencyKey=%s (비문자열/빈값) → 거부 + 호출 0', async (k) => {
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: k as unknown as string });
    expect(r.code).toBe('NO_IDEMPOTENCY_KEY');
    expect(calls).toHaveLength(0);
  });

  it('captureID 누락 → 키가 있어도 거부 + 호출 0', async () => {
    const r = await refundPaypalCapture({ idempotencyKey: 'bk-1' });
    expect(r.code).toBe('NO_CAPTURE_ID');
    expect(calls).toHaveLength(0);
  });
});

describe('🔴 PayPal-Request-Id 헤더가 실제로 나간다', () => {
  it('헤더에 refund: prefix + 호출자 키가 담긴다', async () => {
    await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'booking-abc' });
    expect(lastHeaders()['PayPal-Request-Id']).toBe('refund:booking-abc');
  });

  it('🔴 prefix 는 helper 가 강제한다 — capture 에 쓴 키를 refund 에 재사용 금지(PayPal 명시)', async () => {
    // 호출자가 capture 용 키(orderID)를 그대로 넘겨도 refund 네임스페이스로 격리된다.
    await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: '5O190127TN364715T' });
    expect(lastHeaders()['PayPal-Request-Id']).toBe('refund:5O190127TN364715T');
    expect(lastHeaders()['PayPal-Request-Id']).not.toBe('5O190127TN364715T');
  });

  it('같은 키로 재시도 → 같은 헤더 (멱등이 성립하는 조건)', async () => {
    await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'booking-abc' });
    await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'booking-abc' });
    expect(calls).toHaveLength(2);
    expect(calls[0].init.headers['PayPal-Request-Id']).toBe(calls[1].init.headers['PayPal-Request-Id']);
  });

  it('🔴 다른 예약(같은 captureID) → 다른 키 = 각각 별개 환불 (cart 라인별 취소)', async () => {
    // cart 자식들은 captureID 를 공유하지만 bookingID 는 다르다. 둘 다 정당한 환불이다.
    await refundPaypalCapture({ captureID: 'CAP-SHARED', idempotencyKey: 'ORDER__line-a', refundUSD: '10.00' });
    await refundPaypalCapture({ captureID: 'CAP-SHARED', idempotencyKey: 'ORDER__line-b', refundUSD: '20.00' });
    expect(calls[0].init.headers['PayPal-Request-Id']).toBe('refund:ORDER__line-a');
    expect(calls[1].init.headers['PayPal-Request-Id']).toBe('refund:ORDER__line-b');
    expect(calls[0].init.headers['PayPal-Request-Id']).not.toBe(calls[1].init.headers['PayPal-Request-Id']);
  });
});

describe('통화 — 하드코딩 USD 제거', () => {
  it('currency 전달 → 그 통화로 부분환불', async () => {
    await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k', refundUSD: '9.90', currency: 'KRW' });
    expect(lastBody().amount).toEqual({ value: '9.90', currency_code: 'KRW' });
  });

  it('currency 없음(레거시 booking 문서) → USD 폴백', async () => {
    await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k', refundUSD: '9.90' });
    expect(lastBody().amount.currency_code).toBe('USD');
  });

  it('전액환불은 amount 자체를 생략한다 (기존 동작 보존)', async () => {
    await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(lastBody().amount).toBeUndefined();
    expect(lastBody().note_to_payer).toBe('CocoTrip full refund');
  });
});

describe('타임아웃 — 멱등키가 필요한 바로 그 창', () => {
  it('AbortSignal 이 요청에 붙는다 (무한 대기 금지)', async () => {
    await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect((calls[0].init as unknown as { signal?: unknown }).signal).toBeDefined();
  });

  it('🔴 타임아웃 → PAYPAL_REFUND_TIMEOUT + "결과 미상" 을 분명히 한다', async () => {
    global.fetch = vi.fn(async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }) as never;
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.ok).toBe(false);
    // 타임아웃을 일반 네트워크 에러와 구분한다 — "환불 안 됨" 이 아니라 "결과 모름" 이다.
    expect(r.code).toBe('PAYPAL_REFUND_TIMEOUT');
    expect(r.error).toMatch(/retry with same key/);
  });

  it('일반 네트워크 에러는 기존 코드 유지 (회귀 없음)', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNRESET'); }) as never;
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.code).toBe('PAYPAL_NETWORK_ERROR');
  });
});

describe('성공/실패 판정 — 기존 계약 보존', () => {
  it.each(['COMPLETED', 'PENDING'])('status=%s → ok:true', async (s) => {
    mockPaypal({ id: 'REF-1', status: s });
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.ok).toBe(true);
    expect(r.refund.id).toBe('REF-1');
  });

  it('status=DECLINED → ok:false PAYPAL_REFUND_FAILED', async () => {
    mockPaypal({ status: 'DECLINED', message: 'nope' });
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PAYPAL_REFUND_FAILED');
  });

  it('HTTP 4xx + 빈 body → 에러에 HTTP status 가 남는다 (이전엔 unknown 뿐이라 진단 불가)', async () => {
    mockPaypal({}, false, 422);
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTP 422/);
  });
});
