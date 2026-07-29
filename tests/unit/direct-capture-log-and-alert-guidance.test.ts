/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * 마지막 보정 2건 (2026-07-29).
 *
 * 1. PayPal-direct capture ack 경로의 processed 로그
 *    이 분기만 오류를 삼키는 logWebhookEvent() 를 쓰고 곧바로 200 을 반환했다.
 *    로그가 조용히 실패하면 PayPal 재전송 때 상단 멱등 확인이 헛돌아 **매번 다시 처리**된다.
 *    → logWebhookEventStrict + 실패 시 503. 이 분기는 문서를 **읽기만** 하므로
 *      재전송해도 상태·적립·메일이 중복되지 않고 processed 로그만 수렴한다.
 *
 * 2. 격리 알림에서 강제 재시도 권유 제거
 *    "자동 재시도 없음 — 수동 확인 필요" 바로 아래에 강제 재시도 URL 을 항상 붙였다.
 *    운영자가 그대로 실행하면 outcome_unknown 은 메일이 두 번 가고,
 *    failed_permanent 는 원인이 그대로라 또 실패한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createFakeFirestore, FieldValue as FakeFieldValue } from '../helpers/fake-firestore.js';
import { RETRY_DOC_STATUS, OUTCOME } from '../../api/_shared/processor-outcome.js';
import { operatorGuidance } from '../../api/_shared/booking-processor-trigger.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ── 1. PayPal-direct capture ack ────────────────────────────────────────────
const notifySpy = vi.fn(async () => ({ ok: true }));
const confirmBookingAsPaid = vi.fn(async () => ({ ok: true, bookingId: 'B1' }));
let db: any;
let failProcessedLog = false;

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

const ORDER = '5O190127TN364715T';
const savedEnv = { ...process.env };

/** memo 에 bookingRef 가 없고 supplementary_data 로만 주문을 식별하는 실제 PayPal-direct 이벤트. */
const DIRECT_CAPTURE = {
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource: {
    id: 'CAP-9',
    amount: { value: '9.90', currency_code: 'USD' },
    supplementary_data: { related_ids: { order_id: ORDER } },
  },
};

function seedDirect() {
  const base = createFakeFirestore({
    [`bookings/${ORDER}`]: {
      bookingRef: 'CT-20260729-777', orderID: ORDER, captureID: 'CAP-9',
      status: 'CONFIRMED', paymentVerified: true, amountUSD: 9.9,
      paypalEnvironment: 'live',
    },
  });
  return {
    ...base,
    collection: (name: string) => {
      const col = base.collection(name);
      if (name !== 'paypal_webhook_log') return col;
      return {
        ...col,
        doc: (id: string) => ({
          ...col.doc(id),
          set: async (data: any, o: any) => {
            if (failProcessedLog && data && data.status === 'processed') {
              throw new Error('log write down');
            }
            return col.doc(id).set(data, o);
          },
        }),
      };
    },
    __get: base.__get,
    __dump: base.__dump,
  };
}

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return { out, writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
}

async function fire(eventId = 'txn-direct') {
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
    body: JSON.stringify(DIRECT_CAPTURE),
  } as any, res as any);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

beforeEach(() => {
  notifySpy.mockClear();
  confirmBookingAsPaid.mockClear();
  failProcessedLog = false;
  process.env.PAYPAL_WEBHOOK_ID = 'LIVE-WH-ID';
  process.env.VERCEL_ENV = 'production';
  delete process.env.PAYPAL_ENV;
  db = seedDirect();
  global.fetch = vi.fn(async () => ({
    ok: true, status: 200,
    json: async () => ({ verification_status: 'SUCCESS' }),
    text: async () => '',
  })) as never;
});
afterEach(() => {
  for (const k of ['VERCEL_ENV', 'PAYPAL_ENV', 'PAYPAL_WEBHOOK_ID']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('1. PayPal-direct capture ack — processed 로그를 삼키지 않는다', () => {
  it('예약 존재 + 로그 성공 → HTTP 200 already_confirmed', async () => {
    const r = await fire();
    expect(r.statusCode).toBe(200);
    expect(r.json.status).toBe('already_confirmed');
    expect(db.__get('paypal_webhook_log/txn-direct')!.status).toBe('processed');
    expect(db.__get('paypal_webhook_log/txn-direct')!.detail.reason)
      .toBe('already_confirmed_via_capture_endpoint');
  });

  it('🔴 예약 존재 + processed 로그 실패 → HTTP 503', async () => {
    failProcessedLog = true;
    const r = await fire();
    expect(r.statusCode).toBe(503);
    expect(r.json.reason).toBe('processed_log_write_failed');
    expect(db.__get('paypal_webhook_log/txn-direct')).toBeUndefined();
  });

  it('실패 후 재전송 → HTTP 200, processed 정확히 1개', async () => {
    failProcessedLog = true;
    expect((await fire()).statusCode).toBe(503);

    failProcessedLog = false;
    const retry = await fire();
    expect(retry.statusCode).toBe(200);

    const logs = Object.keys(db.__dump()).filter((k) => k.startsWith('paypal_webhook_log/'));
    expect(logs).toHaveLength(1);
    expect(db.__get('paypal_webhook_log/txn-direct')!.status).toBe('processed');
  });

  it('재전송으로 예약·적립·메일이 중복되지 않는다 (이 분기는 읽기 전용)', async () => {
    const before = JSON.stringify(db.__get(`bookings/${ORDER}`));
    failProcessedLog = true;
    await fire();
    failProcessedLog = false;
    await fire();
    await fire();   // 세 번째 = 상단 멱등 차단

    // 예약 문서가 한 글자도 바뀌지 않았다.
    expect(JSON.stringify(db.__get(`bookings/${ORDER}`))).toBe(before);
    // 확정 재실행도 없었다(이 분기는 confirmBookingAsPaid 를 호출하지 않는다).
    expect(confirmBookingAsPaid).not.toHaveBeenCalled();
  });

  it('세 번째 전송은 멱등으로 차단된다', async () => {
    await fire();
    const again = await fire();
    expect(again.json.idempotent).toBe(true);
  });

  it('🔴 잠금: processed 를 non-strict logWebhookEvent 로 쓰는 경로가 0개', () => {
    const src = read('api/paypal-webhook.js');
    const lines = src.split('\n');
    const offenders: number[] = [];
    lines.forEach((line, i) => {
      if (!/status:\s*'processed'/.test(line)) return;
      // 이 processed 를 쓰는 호출이 strict 인지 transaction 인지 위로 훑어 확인한다.
      const window = lines.slice(Math.max(0, i - 8), i).join('\n');
      const strict = /logWebhookEventStrict\(/.test(window) || /tx\.set\(logRef/.test(window);
      if (!strict) offenders.push(i + 1);
    });
    expect(offenders, `non-strict processed 경로: ${offenders.join(', ')}`).toHaveLength(0);
  });
});

// ── 2. 알림 문구 ────────────────────────────────────────────────────────────
describe('2. 격리 알림에 강제 재시도 권유가 없다', () => {
  const REPLAY = 'admin-replay-booking-notifications';

  it('retryable 알림에만 재시도 안내가 있다', () => {
    const lines = operatorGuidance({
      orderID: 'ORD-1',
      result: { docStatus: RETRY_DOC_STATUS.PENDING, outcome: OUTCOME.RETRYABLE },
    }).join('\n');
    expect(lines).toContain('5분 cron 이 자동 재시도');
    expect(lines).toContain(REPLAY);
  });

  it('🔴 manual 알림에 강제 재시도 URL 이 없다', () => {
    const lines = operatorGuidance({
      orderID: 'ORD-1',
      result: { docStatus: RETRY_DOC_STATUS.MANUAL, outcome: OUTCOME.MANUAL },
    }).join('\n');
    expect(lines).not.toContain(REPLAY);
    expect(lines).not.toContain('자동 재시도.');
    // 메일 실제 발송 여부를 먼저 확인하라는 안내 + 재실행 금지 문구
    expect(lines).toContain('확인메일이 실제로 발송됐는지');
    expect(lines).toContain('재실행하지 마세요');
  });

  it('🔴 permanent 알림에 강제 재시도 URL 이 없다', () => {
    const lines = operatorGuidance({
      orderID: 'ORD-1',
      result: { docStatus: RETRY_DOC_STATUS.PERMANENT, outcome: OUTCOME.FAILED_PERMANENT },
    }).join('\n');
    expect(lines).not.toContain(REPLAY);
    // 원인을 먼저 고치라는 안내
    expect(lines).toContain('amountUSD');
    expect(lines).toContain('captureID');
    expect(lines).toContain('관리자 화면');
  });

  it('알림 조립부가 상태별 안내를 그대로 쓴다 (URL 을 따로 덧붙이지 않는다)', () => {
    const src = read('api/_shared/booking-processor-trigger.js');
    expect(src).toContain('...operatorGuidance({ orderID, result })');
    // 조립부에 강제 재시도 URL 리터럴이 남아 있으면 상태와 무관하게 다시 붙는다.
    const assembly = src.slice(src.indexOf('const msg = ['), src.indexOf(".filter(Boolean).join('\\n')"));
    expect(assembly).not.toContain('admin-replay-booking-notifications');
  });

  it('outcome_unknown 상태면 booking-processor 를 다시 호출하지 않는다', async () => {
    const { triggerBookingProcessor } = await import('../../api/_shared/booking-processor-trigger.js');
    const retryDb = createFakeFirestore({});
    const calls: string[] = [];
    global.fetch = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          outcome: 'manual_intervention',
          data: { outcome: 'manual_intervention', stepStatus: { email: 'outcome_unknown' } },
        }),
      };
    }) as never;

    const r = await triggerBookingProcessor({
      db: retryDb as never, siteUrl: 'https://x', payload: { orderID: 'ORD-1' }, source: 'unit-test',
    });
    expect(r.manual).toBe(true);
    expect(calls).toHaveLength(1);   // 자체적으로 재호출하지 않는다

    // 저장된 status 가 pending 이 아니므로 sweep 쿼리(status=='pending')에 잡히지 않는다.
    const doc = retryDb.__get('pending_processor_retries/ORD-1')!;
    expect(doc.status).toBe(RETRY_DOC_STATUS.MANUAL);
    expect(doc.status).not.toBe(RETRY_DOC_STATUS.PENDING);
  });
});
