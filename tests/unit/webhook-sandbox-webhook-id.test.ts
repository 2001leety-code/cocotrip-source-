/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * PAYPAL_SANDBOX_WEBHOOK_ID (2026-07-16) — 샌드박스 이벤트 서명 검증에 샌드박스 웹훅 ID 사용.
 *
 * 갭: 웹훅은 live/sandbox 가 **각자 다른 Webhook ID** 를 갖는데(대시보드에서 별도 등록),
 *   핸들러는 PAYPAL_WEBHOOK_ID(live) 하나로 양쪽 검증을 시도했다. sandbox verify 호출에
 *   live ID 를 보내면 PayPal 이 FAILURE 를 반환 → 샌드박스 웹훅 이벤트 전부 verify_failed 로
 *   폐기 = 샌드박스 e2e(eCheck 환불 PENDING→FAILED 관찰)가 원천 불가능.
 *
 * fix: sandbox 재시도에는 PAYPAL_SANDBOX_WEBHOOK_ID 를 사용(미설정 시 기존처럼 live ID 폴백).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 🔴 2026-07-29: resolveIsSandbox 는 **모킹하지 않는다**. sandbox 폴백이 실제 환경 게이트
//   뒤로 옮겨졌으므로, 그 게이트가 진짜로 작동하는지 env 로 확인해야 의미가 있다.
vi.mock('../../api/_shared/paypal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api.paypal.com' }),
}));
vi.mock('../../api/_shared/notify.js', () => ({ notify: vi.fn(async () => ({ ok: true })) }));
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
  process.env.PAYPAL_WEBHOOK_ID = 'LIVE-WH-ID';
  process.env.PAYPAL_SANDBOX_WEBHOOK_ID = 'SBX-WH-ID';
  process.env.PAYPAL_SANDBOX_CLIENT_ID = 'sbx-client';
  // sandbox 폴백이 열리는 유일한 조합 = 프리뷰 배포 + PAYPAL_ENV=sandbox.
  process.env.VERCEL_ENV = 'preview';
  process.env.PAYPAL_ENV = 'sandbox';
  // 1차(live) 검증 = FAILURE, 2차(sandbox) 검증 = SUCCESS — 각 호출의 요청 body 를 기록.
  global.fetch = vi.fn(async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body);
    verifyBodies.push(body);
    const status = verifyBodies.length === 1 ? 'FAILURE' : 'SUCCESS';
    return { ok: true, status: 200, json: async () => ({ verification_status: status }), text: async () => '' };
  }) as never;
});

describe('샌드박스 웹훅 ID 분리', () => {
  it('sandbox 재검증은 PAYPAL_SANDBOX_WEBHOOK_ID 로 요청한다 (live ID 재사용 금지)', async () => {
    const r = await fire();
    expect(verifyBodies).toHaveLength(2);
    expect(verifyBodies[0].webhook_id).toBe('LIVE-WH-ID');   // 1차 live
    expect(verifyBodies[1].webhook_id).toBe('SBX-WH-ID');    // ★ 2차 sandbox — 뮤테이션 실증 지점
    // sandbox 검증이 SUCCESS 로 통과했으므로 verify_failed 가 아니라 정상 디스패치(unsupported)여야 한다.
    expect(r.json.status).toBe('unsupported');
  });

  it('PAYPAL_SANDBOX_WEBHOOK_ID 미설정 → 기존처럼 live ID 로 폴백 (회귀 없음)', async () => {
    delete process.env.PAYPAL_SANDBOX_WEBHOOK_ID;
    await fire();
    expect(verifyBodies[1].webhook_id).toBe('LIVE-WH-ID');
  });
});

/**
 * 🔴 2026-07-29 P0 — 운영은 샌드박스 웹훅을 절대 받지 않는다.
 *   이전엔 PAYPAL_SANDBOX_CLIENT_ID 만 있으면 **운영에서도** sandbox 로 재검증했다.
 *   운영 배포가 가짜 돈 웹훅을 받아 운영 예약을 환불처리할 수 있는 경로였다.
 */
describe('환경 게이트 — 운영에서 sandbox 폴백 금지', () => {
  it('VERCEL_ENV=production 이면 sandbox 재검증을 아예 시도하지 않는다', async () => {
    process.env.VERCEL_ENV = 'production';
    const r = await fire();
    expect(verifyBodies).toHaveLength(1);                 // ★ live 1회로 끝
    expect(verifyBodies[0].webhook_id).toBe('LIVE-WH-ID');
    expect(r.json.error).toBe('signature verification failed');
  });

  it('운영에 PAYPAL_ENV=sandbox 가 잘못 들어가도 sandbox 웹훅을 처리하지 않는다', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.PAYPAL_ENV = 'sandbox';                   // 운영자 설정 실수
    const r = await fire();
    expect(verifyBodies).toHaveLength(1);
    expect(r.json.ok).toBe(false);
    expect(r.json.acked).toBe(true);                      // 200 ack 로 재시도 storm 은 막는다
  });

  it('반대 방향 — 프리뷰 sandbox 배포에서 live 이벤트는 통과하지 못한다', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.PAYPAL_ENV = 'sandbox';
    // 두 검증 모두 FAILURE (live 서명이 sandbox webhook id 와 맞지 않는 상황)
    global.fetch = vi.fn(async (_url: unknown, init: any) => {
      verifyBodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ verification_status: 'FAILURE' }), text: async () => '' };
    }) as never;
    const r = await fire();
    expect(r.json.error).toBe('signature verification failed');
  });

  it('PAYPAL_ENV 미설정 프리뷰도 sandbox 폴백을 열지 않는다', async () => {
    process.env.VERCEL_ENV = 'preview';
    delete process.env.PAYPAL_ENV;
    await fire();
    expect(verifyBodies).toHaveLength(1);
  });
});
