/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * booking-processor Step 3 — 텔레그램 채널별 멱등 (2026-10-23).
 * claim(bookings 문서 id) → claimed 일 때만 전송 → sent=완료 기록 / rejected·skipped=선점 해제 / unknown=격리.
 * 잠그는 것: 재진입 시 완료 채널 미전송 · 동시 실행 1회 · 한 채널 실패가 다른 채널 완료 보존 ·
 *   unknown 재전송 없음 · 선점 저장소 불능 시 전송 없음.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';

const dispatchAlert = vi.fn<(b: any) => Promise<any>>(async () => ({ ok: true, delivery: 'sent' }));
const paymentAlert = vi.fn<(b: any) => Promise<any>>(async () => ({ ok: true, delivery: 'sent' }));
let db: ReturnType<typeof createFakeFirestore>;

vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => ({ ok: true, delivery: 'sent' })) }));
vi.mock('../../api/_telegram.js', () => ({
  sendDispatchAlert: (b: any) => dispatchAlert(b),
  sendBookingPaymentAlert: (b: any) => paymentAlert(b),
  sendErrorAlert: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../api/_shared/telegram-throttle.js', () => ({ throttledTelegramAlert: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api/_google-sheets.js', () => ({
  appendBooking: vi.fn(async () => ({ appendedRow: '시트1!A2' })),
  updateBookingStatus: vi.fn(async () => true),
}));
vi.mock('../../api/_send-email.js', () => ({
  sendBookingConfirmation: vi.fn(async () => undefined),
  buildDefaultConfirmationEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('../../api/_ai-employees.js', () => ({
  generateConfirmationEmail: vi.fn(async () => ({ subject: 's', html: 'h', text: 't' })),
  generateVoucherText: vi.fn(async () => 'voucher'),
}));
vi.mock('../../api/_generate-voucher.js', () => ({ generateVoucherPDF: vi.fn(async () => null) }));
vi.mock('../../api/_create-wallet-pass.js', () => ({ createWalletPass: vi.fn(async () => null) }));
vi.mock('../../api/_exchange-rate.js', () => ({ getUsdToKrwRaw: vi.fn(async () => 1430) }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => db }));

const { default: handler } = await import('../../api/booking-processor.js');

const ORDER = 'ORD-TG-1';
const PATH = `bookings/${ORDER}`;
const savedEnv = { ...process.env };

async function run() {
  const out = { statusCode: 0, body: null as any };
  const res = {
    setHeader() {},
    status(c: number) { out.statusCode = c; return this; },
    json(b: any) { out.body = b; return this; },
    end() { return this; },
  };
  await handler({
    method: 'POST',
    headers: { 'x-internal-token': 'secret-tok' },
    body: { orderID: ORDER, payerEmail: 'buyer@example.com', payerName: 'Buyer', amount: '9.90', product: 'charter', tourDate: '2026-08-01' },
  } as any, res as any);
  return out;
}
const telegramStep = (r: any) => String(r.body?.data?.steps?.telegram);

beforeEach(() => {
  process.env.INTERNAL_API_TOKEN = 'secret-tok';
  process.env.VERCEL_ENV = 'preview';
  process.env.VERCEL_URL = 'preview-host.vercel.app';
  dispatchAlert.mockReset(); dispatchAlert.mockResolvedValue({ ok: true, delivery: 'sent' });
  paymentAlert.mockReset(); paymentAlert.mockResolvedValue({ ok: true, delivery: 'sent' });
  db = createFakeFirestore({
    [PATH]: { paymentVerified: true, captureID: 'CAP-1', amountUSD: 9.9, amountKRW: 14454, capturedExchangeRate: 1460, bookingRef: 'CT-TG-1' },
  });
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => '' })) as never;
});
afterEach(() => {
  for (const k of ['VERCEL_ENV', 'VERCEL_URL', 'INTERNAL_API_TOKEN']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('booking-processor telegram — per-channel idempotency', () => {
  it('re-entry: completed channels are not sent again', async () => {
    const first = await run();
    expect(telegramStep(first)).toBe('ok');
    expect(db.__get(PATH)).toMatchObject({ telegramDispatchSentAtState: 'completed', telegramPaymentSentAtState: 'completed' });
    const second = await run();
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    expect(paymentAlert).toHaveBeenCalledTimes(1);
    expect(telegramStep(second)).toMatch(/^skip: dispatch=skip:already_completed payment=skip:already_completed$/);
  });

  it('two concurrent runs send each channel exactly once', async () => {
    await Promise.all([run(), run()]);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    expect(paymentAlert).toHaveBeenCalledTimes(1);
  });

  it('one channel rejected keeps the other channel completed; only the rejected one is retried', async () => {
    paymentAlert.mockResolvedValueOnce({ ok: false, delivery: 'rejected', error: 'chat not found' });
    const first = await run();
    expect(telegramStep(first)).toBe('partial: dispatch=sent payment=rejected');
    expect(db.__get(PATH)).toMatchObject({ telegramDispatchSentAtState: 'completed' });
    expect(db.__get(PATH)).not.toHaveProperty('telegramPaymentSentAtState');   // released
    await run();
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    expect(paymentAlert).toHaveBeenCalledTimes(2);
  });

  it('unknown delivery is quarantined and never re-sent', async () => {
    paymentAlert.mockResolvedValueOnce({ ok: false, delivery: 'unknown', error: 'HTTP 502' });
    await run();
    expect(db.__get(PATH)).toMatchObject({ telegramPaymentSentAtState: 'outcome_unknown' });
    const second = await run();
    expect(paymentAlert).toHaveBeenCalledTimes(1);
    expect(telegramStep(second)).toContain('payment=skip:outcome_unknown');
  });

  it('claim store unavailable → nothing is sent', async () => {
    db.__beforeCommit = async () => { throw new Error('firestore down'); };
    const r = await run();
    expect(dispatchAlert).not.toHaveBeenCalled();
    expect(paymentAlert).not.toHaveBeenCalled();
    expect(telegramStep(r)).toContain('store_unavailable');
  });
});
