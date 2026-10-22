/**
 * refundPaypalCapture `outcomeUnknown` (2026-10-23) — 필드 추가만, 기존 code/status 는 그대로.
 *   true  = 돈이 움직였을 수 있다(5xx·파싱 실패·2xx+null·2xx+{}·타임아웃·네트워크) → 재시도·CONFIRMED 복구 금지
 *   false = 송신 전 실패 또는 PayPal 이 명시한 실패(FAILED/CANCELLED 본문, 4xx + 오류 name)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tokenHolder: { fn: () => Promise<{ accessToken: string; baseUrl: string }> } = {
  fn: async () => ({ accessToken: 'tok', baseUrl: 'https://api.sandbox.paypal.com' }),
};
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: () => tokenHolder.fn(),
}));

const { refundPaypalCapture } = await import('../../api/_shared/paypal-refund.js');

function mockFetch(httpStatus: number, json: () => Promise<unknown>) {
  global.fetch = vi.fn(async () => ({ ok: httpStatus >= 200 && httpStatus < 300, status: httpStatus, json })) as never;
}
const call = () => refundPaypalCapture({ captureID: 'CAP-1', idempotencyKey: 'k' });

beforeEach(() => {
  tokenHolder.fn = async () => ({ accessToken: 'tok', baseUrl: 'https://api.sandbox.paypal.com' });
});

describe('outcomeUnknown: true — 결과 미상', () => {
  const cases: [string, number, () => Promise<unknown>][] = [
    ['5xx', 503, async () => ({ name: 'INTERNAL_SERVER_ERROR', message: 'down' })],
    ['파싱 실패', 201, async () => { throw new SyntaxError('Unexpected token'); }],
    ['2xx + null', 201, async () => null],
    ['2xx + {}', 201, async () => ({})],
    ['2xx + 배열', 201, async () => []],
    ['2xx + 문자열', 201, async () => 'ok'],
    ['4xx 인데 오류 name 없음', 400, async () => ({})],
  ];
  for (const [label, status, json] of cases) {
    it(label, async () => {
      mockFetch(status, json);
      const r = await call();
      expect(r.ok).toBe(false);
      expect(r.code).toBe('PAYPAL_REFUND_FAILED');   // 기존 code 유지 (REFUND_REQUEST_INVALID 로 오분류 안 함)
      expect(r.status).toBe(502);
      expect(r.outcomeUnknown).toBe(true);
    });
  }

  it('타임아웃 → PAYPAL_REFUND_TIMEOUT, outcomeUnknown true', async () => {
    global.fetch = vi.fn(async () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; }) as never;
    const r = await call();
    expect(r.code).toBe('PAYPAL_REFUND_TIMEOUT');
    expect(r.outcomeUnknown).toBe(true);
  });

  it('네트워크(송신 후) → PAYPAL_NETWORK_ERROR, outcomeUnknown true', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') }); }) as never;
    const r = await call();
    expect(r.code).toBe('PAYPAL_NETWORK_ERROR');
    expect(r.outcomeUnknown).toBe(true);
  });
});

describe('outcomeUnknown: false — 확정 실패(돈 안 움직임)', () => {
  it('본문 status FAILED / CANCELLED', async () => {
    for (const status of ['FAILED', 'CANCELLED']) {
      mockFetch(201, async () => ({ id: 'R', status }));
      const r = await call();
      expect(r.code).toBe('PAYPAL_REFUND_FAILED');
      expect(r.outcomeUnknown).toBe(false);
    }
  });

  it('4xx + PayPal 오류 name', async () => {
    mockFetch(422, async () => ({ name: 'UNPROCESSABLE_ENTITY', message: 'CAPTURE_FULLY_REFUNDED' }));
    const r = await call();
    expect(r.code).toBe('PAYPAL_REFUND_FAILED');
    expect(r.outcomeUnknown).toBe(false);
  });

  it('송신 전 TypeError(cause 없음) → REFUND_REQUEST_INVALID, false', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('Invalid header value'); }) as never;
    const r = await call();
    expect(r.code).toBe('REFUND_REQUEST_INVALID');
    expect(r.outcomeUnknown).toBe(false);
  });

  it('토큰 실패 → PAYPAL_AUTH_FAILED, false', async () => {
    tokenHolder.fn = async () => { throw new Error('auth down'); };
    const r = await call();
    expect(r.code).toBe('PAYPAL_AUTH_FAILED');
    expect(r.outcomeUnknown).toBe(false);
  });
});

describe('성공 반환 형태 불변', () => {
  it('COMPLETED → { ok, final, refund, httpStatus } (outcomeUnknown 없음)', async () => {
    mockFetch(201, async () => ({ id: 'R', status: 'COMPLETED' }));
    expect(await call()).toEqual({ ok: true, final: true, refund: { id: 'R', status: 'COMPLETED' }, httpStatus: 201 });
  });
  it('PENDING → { ok, final:false, pending, refund, httpStatus }', async () => {
    mockFetch(201, async () => ({ id: 'R', status: 'PENDING' }));
    expect(await call()).toEqual({ ok: true, final: false, pending: true, refund: { id: 'R', status: 'PENDING' }, httpStatus: 201 });
  });
});
