/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * PAYPAL_SANDBOX_WEBHOOK_ID (2026-07-16) — 샌드박스 이벤트 서명 검증에 샌드박스 웹훅 ID 사용.
 *
 * 원래 갭: 웹훅은 live/sandbox 가 **각자 다른 Webhook ID** 를 갖는데(대시보드에서 별도 등록),
 *   핸들러는 PAYPAL_WEBHOOK_ID(live) 하나로 양쪽 검증을 시도했다. sandbox verify 호출에
 *   live ID 를 보내면 PayPal 이 FAILURE 를 반환 → 샌드박스 웹훅 이벤트 전부 폐기.
 *
 * 🔴 2026-07-29 갱신 — **단일 환경 검증**으로 바뀌었다.
 *   샌드박스 배포는 sandbox ID 로만, 운영 배포는 live ID 로만 검증한다. 폴백이 없다.
 *   그래서 "sandbox ID 미설정 시 live ID 로 폴백" 은 더 이상 안전한 동작이 아니다 —
 *   다른 환경의 자격으로 검증을 시도하는 것 자체가 이번에 막으려는 행위다.
 *   (양방향 차단 전반은 tests/unit/webhook-single-environment.test.ts 가 담당한다.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const notifySpy = vi.fn(async () => ({ ok: true }));

vi.mock('../../api/_shared/paypal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPaypalAccessToken: async (isSandbox: boolean) => ({
    accessToken: 'tok',
    baseUrl: isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com',
  }),
}));
vi.mock('../../api/_shared/notify.js', () => ({ notify: (...a: any[]) => notifySpy(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/booking-confirm.js', () => ({ confirmBookingAsPaid: vi.fn(async () => ({ ok: true })) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS' } }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({
    collection: () => ({
      doc: () => ({ get: async () => ({ exists: false, data: () => undefined }), set: async () => undefined, update: async () => undefined }),
      where: () => ({ get: async () => ({ size: 0, empty: true, docs: [] }) }),
    }),
  }),
}));

const { default: handler } = await import('../../api/paypal-webhook.js');

let verifyBodies: any[];
const savedEnv = { ...process.env };

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return { out, writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
}

async function fire() {
  const res = mockRes();
  const req = {
    method: 'POST',
    headers: {
      'paypal-transmission-id': 'txn-sbx-1',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
      'paypal-transmission-sig': 'sig',
      'paypal-transmission-time': '2026-07-16T00:00:00Z',
    },
    body: JSON.stringify({ event_type: 'SOME.UNRELATED.EVENT', resource: {} }),
  };
  await handler(req as any, res as any);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

beforeEach(() => {
  verifyBodies = [];
  notifySpy.mockClear();
  process.env.PAYPAL_WEBHOOK_ID = 'LIVE-WH-ID';
  process.env.PAYPAL_SANDBOX_WEBHOOK_ID = 'SBX-WH-ID';
  process.env.PAYPAL_SANDBOX_CLIENT_ID = 'sbx-client';
  process.env.VERCEL_ENV = 'preview';
  process.env.PAYPAL_ENV = 'sandbox';
  global.fetch = vi.fn(async (url: unknown, init: any) => {
    verifyBodies.push({ url: String(url), ...JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ verification_status: 'SUCCESS' }), text: async () => '' };
  }) as never;
});
afterEach(() => {
  for (const k of ['VERCEL_ENV', 'PAYPAL_ENV', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_SANDBOX_WEBHOOK_ID', 'PAYPAL_SANDBOX_CLIENT_ID']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('샌드박스 웹훅 ID 분리', () => {
  it('샌드박스 배포는 PAYPAL_SANDBOX_WEBHOOK_ID + sandbox API 로 검증한다', async () => {
    const r = await fire();
    expect(verifyBodies).toHaveLength(1);
    expect(verifyBodies[0].webhook_id).toBe('SBX-WH-ID');
    expect(verifyBodies[0].url).toContain('sandbox.paypal.com');
    expect(r.json.status).toBe('unsupported');   // 검증 통과 후 디스패치까지 갔다
  });

  it('live Webhook ID 는 요청 본문에 한 번도 들어가지 않는다', async () => {
    await fire();
    expect(verifyBodies.some((b) => b.webhook_id === 'LIVE-WH-ID')).toBe(false);
  });

  it('🔴 PAYPAL_SANDBOX_WEBHOOK_ID 미설정 → live ID 로 대체하지 않고 503 으로 거부', async () => {
    delete process.env.PAYPAL_SANDBOX_WEBHOOK_ID;
    const r = await fire();
    expect(r.statusCode).toBe(503);
    expect(verifyBodies).toHaveLength(0);        // 검증 시도조차 안 한다
    expect(notifySpy).toHaveBeenCalled();        // 운영자에게 구성 누락 알림
  });

  it('운영 배포는 live ID + live API 로만 검증한다', async () => {
    process.env.VERCEL_ENV = 'production';
    await fire();
    expect(verifyBodies).toHaveLength(1);
    expect(verifyBodies[0].webhook_id).toBe('LIVE-WH-ID');
    expect(verifyBodies[0].url).not.toContain('sandbox');
  });
});
