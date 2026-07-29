/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * PayPal 웹훅 — **단일 환경 검증** (2026-07-29 P0).
 *
 * 🔴 직전 구조의 결함: 프리뷰 샌드박스 배포도 **live 서명을 먼저 검증**했고, 성공하면
 *   live 이벤트를 그대로 처리했다. 운영→샌드박스 방향만 막은 반쪽 차단이었다.
 *
 * 이제:
 *   resolveIsSandbox()===true  → sandbox Webhook ID + sandbox API 로만 **1회**
 *   resolveIsSandbox()===false → live Webhook ID + live API 로만 **1회**
 *   폴백 없음. 다른 환경의 Webhook ID 는 요청 본문에 한 번도 들어가지 않는다.
 *
 * ⚠️ 이 테스트는 "두 검증을 모두 실패시켜서 막혔다" 고 주장하지 않는다.
 *    상대 환경 서명을 **SUCCESS 로 응답**해도 거부되는지를 본다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const notifySpy = vi.fn(async () => ({ ok: true }));
const logSet = vi.fn(async () => undefined);

// resolveIsSandbox 는 모킹하지 않는다 — 게이트가 env 로 실제 작동해야 의미가 있다.
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
      doc: () => ({
        get: async () => ({ exists: false, data: () => undefined }),
        set: (...a: any[]) => logSet(...a),
        update: async () => undefined,
      }),
      where: () => ({ get: async () => ({ size: 0, empty: true, docs: [] }) }),
    }),
  }),
}));

const { default: handler } = await import('../../api/paypal-webhook.js');

type VerifyCall = { url: string; webhookId: string };
let calls: VerifyCall[];
const savedEnv = { ...process.env };

function mockRes() {
  const out = { statusCode: 0, body: '' };
  return { out, writeHead(c: number) { out.statusCode = c; }, end(b?: string) { out.body = b || ''; } };
}

/**
 * 지정한 환경의 검증 요청에만 SUCCESS 를 준다.
 * `respondSuccessFor: 'live'` = live API 로 오는 요청은 성공 → 그런데도 sandbox 배포가
 * 거부해야 진짜 단일 환경 검증이다.
 */
function mockVerify(respondSuccessFor: 'live' | 'sandbox' | 'both') {
  global.fetch = vi.fn(async (url: unknown, init: any) => {
    const u = String(url);
    const body = JSON.parse(init.body);
    calls.push({ url: u, webhookId: body.webhook_id });
    const isSandboxApi = u.includes('sandbox.paypal.com');
    const success = respondSuccessFor === 'both'
      || (respondSuccessFor === 'sandbox' ? isSandboxApi : !isSandboxApi);
    return {
      ok: true, status: 200,
      json: async () => ({ verification_status: success ? 'SUCCESS' : 'FAILURE' }),
      text: async () => '',
    };
  }) as never;
}

async function fire() {
  const res = mockRes();
  const req = {
    method: 'POST',
    headers: {
      'paypal-transmission-id': `txn-${calls.length}-${Math.floor(1)}`,
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://api.paypal.com/cert',
      'paypal-transmission-sig': 'sig',
      'paypal-transmission-time': '2026-07-29T00:00:00Z',
    },
    body: JSON.stringify({ event_type: 'SOME.UNRELATED.EVENT', resource: {} }),
  };
  await handler(req as any, res as any);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

beforeEach(() => {
  calls = [];
  notifySpy.mockClear();
  logSet.mockClear();
  process.env.PAYPAL_WEBHOOK_ID = 'LIVE-WH-ID';
  process.env.PAYPAL_SANDBOX_WEBHOOK_ID = 'SBX-WH-ID';
  process.env.PAYPAL_SANDBOX_CLIENT_ID = 'sbx-client';
});
afterEach(() => {
  for (const k of ['VERCEL_ENV', 'PAYPAL_ENV', 'PAYPAL_WEBHOOK_ID', 'PAYPAL_SANDBOX_WEBHOOK_ID', 'PAYPAL_SANDBOX_CLIENT_ID']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('Production — live 만 검증한다', () => {
  beforeEach(() => { process.env.VERCEL_ENV = 'production'; });

  it('🔴 Sandbox 서명을 SUCCESS 로 응답해도 거부한다', async () => {
    mockVerify('sandbox');                       // sandbox API 는 성공을 준다
    const r = await fire();
    expect(r.json.error).toBe('signature verification failed');
    expect(calls).toHaveLength(1);               // sandbox 로 물어보지도 않았다
    expect(calls[0].url).not.toContain('sandbox');
  });

  it('Live 서명만 성공 → 정상 처리', async () => {
    mockVerify('live');
    const r = await fire();
    expect(r.json.status).toBe('unsupported');   // 검증 통과 후 이벤트 디스패치까지 갔다
    expect(calls).toHaveLength(1);
  });

  it('검증 API 호출이 정확히 1회이고 sandbox Webhook ID 가 본문에 없다', async () => {
    mockVerify('both');
    await fire();
    expect(calls).toHaveLength(1);
    expect(calls.map((c) => c.webhookId)).toEqual(['LIVE-WH-ID']);
    expect(calls.some((c) => c.webhookId === 'SBX-WH-ID')).toBe(false);
  });

  it('PAYPAL_ENV=sandbox 를 잘못 넣어도 live 로만 검증한다', async () => {
    process.env.PAYPAL_ENV = 'sandbox';
    mockVerify('both');
    await fire();
    expect(calls).toHaveLength(1);
    expect(calls[0].webhookId).toBe('LIVE-WH-ID');
    expect(calls[0].url).not.toContain('sandbox');
  });
});

describe('Preview Sandbox — sandbox 만 검증한다', () => {
  beforeEach(() => {
    process.env.VERCEL_ENV = 'preview';
    process.env.PAYPAL_ENV = 'sandbox';
  });

  it('🔴 Live 서명을 SUCCESS 로 응답해도 거부한다 (반대 방향)', async () => {
    mockVerify('live');                          // live API 는 성공을 준다
    const r = await fire();
    expect(r.json.error).toBe('signature verification failed');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('sandbox');   // live 로 물어보지도 않았다
  });

  it('Sandbox 서명만 성공 → 정상 처리', async () => {
    mockVerify('sandbox');
    const r = await fire();
    expect(r.json.status).toBe('unsupported');
    expect(calls).toHaveLength(1);
  });

  it('검증 API 호출이 정확히 1회이고 live Webhook ID 가 본문에 없다', async () => {
    mockVerify('both');
    await fire();
    expect(calls).toHaveLength(1);
    expect(calls.map((c) => c.webhookId)).toEqual(['SBX-WH-ID']);
    expect(calls.some((c) => c.webhookId === 'LIVE-WH-ID')).toBe(false);
  });

  it('PAYPAL_SANDBOX_WEBHOOK_ID 가 없으면 live ID 로 대체하지 않고 거부한다', async () => {
    delete process.env.PAYPAL_SANDBOX_WEBHOOK_ID;
    mockVerify('both');
    const r = await fire();
    expect(r.statusCode).toBe(503);
    expect(calls).toHaveLength(0);               // 검증 시도조차 안 한다
    expect(notifySpy).toHaveBeenCalled();        // 운영자에게 구성 누락 알림
  });
});

describe('검증 실패 로그는 unverified 로 남는다', () => {
  it('서명 실패 시 paypalEnvironment=unverified', async () => {
    process.env.VERCEL_ENV = 'production';
    mockVerify('sandbox');                       // live 는 실패
    await fire();
    const logged = logSet.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const verifyFailed = logged.find((d) => d.status === 'verify_failed');
    expect(verifyFailed).toBeTruthy();
    expect(verifyFailed!.paypalEnvironment).toBe('unverified');
  });

  it('검증 통과 후 로그에는 실제 환경이 찍힌다', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.PAYPAL_ENV = 'sandbox';
    mockVerify('sandbox');
    await fire();
    const logged = logSet.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(logged.some((d) => d.paypalEnvironment === 'sandbox')).toBe(true);
  });
});
