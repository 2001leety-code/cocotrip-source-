/* eslint-disable @typescript-eslint/no-explicit-any -- @sentry/node 모킹 스캐폴딩. */
/**
 * 서버 Sentry 가 요청 본문을 이벤트에 싣지 않는다 (2026-10-23, 후속 ②a 리뷰 P1).
 * 게스트 예약 관리 토큰은 POST 본문(manageToken)으로만 오므로, 본문이 오류 이벤트에 붙으면 토큰이 샌다.
 * 잠그는 것: requestDataIntegration({ include: { data: false } }) +
 *   httpIntegration({ ignoreIncomingRequestBody }) 가 /api/booking-manage · /api/cancelBooking · /api/modifyBooking(②b)
 *   에서만 true.
 *   기존 옵션(sendDefaultPii:false, tracesSampleRate) 유지.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sentryMock = vi.hoisted(() => ({
  init: vi.fn<(opts: any) => void>(),
  requestDataIntegration: vi.fn<(opts: any) => any>((opts: any) => ({ name: 'RequestData', opts })),
  httpIntegration: vi.fn<(opts: any) => any>((opts: any) => ({ name: 'Http', opts })),
  captureException: vi.fn<(err: any) => void>(),
  withScope: vi.fn<(fn: (scope: any) => void) => void>((fn) => fn({ setTag: () => {}, setExtra: () => {} })),
}));
vi.mock('@sentry/node', () => sentryMock);

const savedDsn = process.env.SENTRY_DSN;

beforeEach(() => {
  vi.resetModules();
  process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
  for (const fn of Object.values(sentryMock)) fn.mockClear();
});
afterEach(() => {
  if (savedDsn === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = savedDsn;
});

async function initOptions() {
  const { captureError } = await import('../../api/_shared/sentry.js');
  await captureError(new Error('boom'), { route: '/api/cancelBooking', method: 'POST' });
  expect(sentryMock.init).toHaveBeenCalledTimes(1);
  return sentryMock.init.mock.calls[0][0];
}

describe('api/_shared/sentry.js — request body never attached', () => {
  it('requestDataIntegration excludes the body', async () => {
    const opts = await initOptions();
    expect(sentryMock.requestDataIntegration).toHaveBeenCalledWith({ include: { data: false } });
    expect(opts.integrations).toContainEqual({ name: 'RequestData', opts: { include: { data: false } } });
  });

  it('httpIntegration skips incoming bodies on the two manage-token routes only', async () => {
    const opts = await initOptions();
    const http = opts.integrations.find((i: any) => i.name === 'Http');
    expect(http).toBeTruthy();
    const ignore = http.opts.ignoreIncomingRequestBody;
    expect(typeof ignore).toBe('function');
    expect(ignore('/api/booking-manage')).toBe(true);
    expect(ignore('https://cocotripkr.com/api/cancelBooking')).toBe(true);
    expect(ignore('/api/cancelBooking?x=1')).toBe(true);
    expect(ignore('/api/tours')).toBe(false);
    expect(ignore('/api/capturePaypalOrder')).toBe(false);
    expect(ignore('/api/cancelBookingLegacy')).toBe(false);
    // ②b — 날짜 변경도 본문에 게스트 관리 토큰이 온다.
    expect(ignore('/api/modifyBooking')).toBe(true);
    expect(ignore('https://cocotripkr.com/api/modifyBooking?x=1')).toBe(true);
    expect(ignore('/api/modifyBookingX')).toBe(false);
  });

  it('existing options are kept', async () => {
    const opts = await initOptions();
    expect(opts.sendDefaultPii).toBe(false);
    expect(typeof opts.tracesSampleRate).toBe('number');
    expect(opts.dsn).toBe('https://public@example.ingest.sentry.io/1');
    expect(sentryMock.captureException).toHaveBeenCalledTimes(1);
  });
});
