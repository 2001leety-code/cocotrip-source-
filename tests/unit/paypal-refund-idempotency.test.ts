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

const tokenHolder: { fn: () => Promise<{ accessToken: string; baseUrl: string }> } = {
  fn: async () => ({ accessToken: 'tok', baseUrl: 'https://api.sandbox.paypal.com' }),
};
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: () => tokenHolder.fn(),
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
  tokenHolder.fn = async () => ({ accessToken: 'tok', baseUrl: 'https://api.sandbox.paypal.com' });
  mockPaypal();
});

// 🔴 적대적 리뷰(2026-07-15) 지적: 20초 signal 이 refund POST 에만 붙어 있어서 그 **앞의**
// getPaypalAccessToken() 이 멈추면 서버리스가 죽을 때까지 대기했다 = "무한 대기 금지" 가 절반만 참.
// 토큰 타임아웃은 paypal.js(TOKEN_TIMEOUT_MS)로 들어갔고, 여기서는 그 실패가 **결과 미상이 아님**을
// 고정한다 — 환불 요청이 나가기 전이라 돈은 확실히 안 움직였다.
describe('토큰 단계 실패 — 환불 요청 전이라 결과 미상 아님', () => {
  it('토큰 타임아웃 → PAYPAL_AUTH_FAILED, refund POST 0회', async () => {
    tokenHolder.fn = async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PAYPAL_AUTH_FAILED');
    // 🔴 돈이 움직이지 않았다 — refund 엔드포인트를 아예 안 쳤다.
    expect(calls).toHaveLength(0);
    // 결과 미상(재시도 시 이중환불 위험)이 아니므로 REFUND_TIMEOUT 으로 분류하면 안 된다.
    expect(r.code).not.toBe('PAYPAL_REFUND_TIMEOUT');
  });

  it('자격증명 미설정 → PAYPAL_AUTH_FAILED, refund POST 0회', async () => {
    tokenHolder.fn = async () => { throw new Error('PayPal credentials not configured'); };
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.code).toBe('PAYPAL_AUTH_FAILED');
    expect(calls).toHaveLength(0);
  });
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

// F1c (2026-07-16) — refundUSD 백스톱. 호출자가 NaN/0/음수를 흘려도 helper 에서 fail-closed.
// amount 없는 body = capture 전액환불이라, 잘못된 숫자가 조용히 전액환불로 승격되는 것을 막는다.
describe('F1c — refundUSD 유한성 백스톱 (helper fail-closed, 미래 호출자까지 방어)', () => {
  it.each([
    ['비숫자 문자열', 'abc'],
    ['실제 NaN', NaN],
    ['Infinity', Infinity],
    ['0', 0],
    ['음수', -1],
    ['빈 객체', {}],
  ])('잘못된 refundUSD=%s → REFUND_AMOUNT_INVALID, fetch 0회 (돈 안 움직임)', async (_l, bad) => {
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k', refundUSD: bad as never });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('REFUND_AMOUNT_INVALID');
    expect(calls).toHaveLength(0);   // ★ 뮤테이션 실증: 백스톱 삭제 시 amount 생략 = 전액환불 요청이 나감
  });

  it('refundUSD 미지정 (전액환불 의도) → fetch 호출 + amount 생략 (회귀 없음)', async () => {
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.ok).toBe(true);
    expect(lastBody().amount).toBeUndefined();
  });

  it('정상 refundUSD="357.14" → fetch 호출 + amount.value 전달', async () => {
    await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k', refundUSD: '357.14' });
    expect(lastBody().amount.value).toBe('357.14');
  });
});

// F5 (2026-07-16) — 송신 전 확정실패 vs 송신 후 미상 분리.
// 요청 생성 단계의 동기 throw(헤더 ByteString 위반 등)는 바이트가 나가기 전이라 돈이 확실히 안 움직였다.
// 타임아웃/소켓단절(미상)과 성격이 정반대다. 판별자 = e.cause (송신 전=undefined / 송신 후=Error).
describe('F5 — 송신 전 확정실패(REFUND_REQUEST_INVALID) vs 송신 후 미상(NETWORK_ERROR)', () => {
  it('송신 전 TypeError(cause 없음) → REFUND_REQUEST_INVALID (돈 안 움직임)', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('Cannot convert argument to a ByteString'); }) as never;
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('REFUND_REQUEST_INVALID');
    expect(r.error).toMatch(/no money moved/);
  });

  it('송신 후 TypeError(cause 있음) → PAYPAL_NETWORK_ERROR (미상 유지, 회귀 없음)', async () => {
    global.fetch = vi.fn(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNRESET') }); }) as never;
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.code).toBe('PAYPAL_NETWORK_ERROR');
  });

  it('🔴 실제 non-ASCII 멱등키 → undici Headers 가 던짐 → REFUND_REQUEST_INVALID', async () => {
    // 모킹된 status 로 뭉개지 않고 실제 Headers 생성자로 ByteString 검증을 트리거한다.
    global.fetch = vi.fn(async (_url: unknown, init: any) => {
      new Headers(init.headers);  // 비-ASCII 헤더 값이면 여기서 TypeError(cause 없음)
      return { ok: true, status: 201, json: async () => ({ id: 'R', status: 'COMPLETED' }) };
    }) as never;
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: '예약123' });
    expect(r.code).toBe('REFUND_REQUEST_INVALID');
  });
});

// F3 (2026-07-16) — PENDING 은 COMPLETED 와 다르다. 이전엔 둘 다 ok:true 로 뭉개 호출자가
// PENDING(비종단, eCheck 등)을 REFUNDED 로 확정했다. final 플래그로 종단 성공만 표시한다.
// ok:true 는 **유지**한다(기존 계약 보존) — final 로만 구분.
describe('F3 — 환불 상태: COMPLETED 만 final, PENDING 은 비종단, 미지의 값은 fail-safe', () => {
  it('COMPLETED → ok:true, final:true', async () => {
    mockPaypal({ id: 'R', status: 'COMPLETED' });
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.ok).toBe(true);
    expect(r.final).toBe(true);
  });

  it('PENDING → ok:true, final:false, pending:true (종단 아님)', async () => {
    mockPaypal({ id: 'R', status: 'PENDING' });
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.ok).toBe(true);
    expect(r.final).toBe(false);
    expect(r.pending).toBe(true);
  });

  it.each(['CANCELLED', 'FAILED', 'SOME_NEW_STATUS'])('미지/실패 status=%s → ok:false (열린 enum fail-safe)', async (s) => {
    mockPaypal({ id: 'R', status: s });
    const r = await refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('PAYPAL_REFUND_FAILED');
  });
});
