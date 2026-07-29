/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * 회귀 잠금 (2026-07-29) — P0 인증 우회 코인 발급 경로.
 *
 * 🔴 사고 구조: /api/booking-processor 에는 인증이 **하나도 없었고** CORS 는 '*' 였다.
 *   그런데 요청 body 의 userId·amount 를 그대로 받아 loyalty earn 을 호출하면서
 *   **서버가 내부 서비스 토큰까지 대신 붙여줬다.**
 *   → 외부에서 `POST /api/booking-processor {userId, amount, orderID}` 한 방으로
 *     남의 uid 에 임의 금액만큼 코인을 발급할 수 있었다.
 *     코인은 redeem 표(2000=15% 할인쿠폰)로 실제 돈이 된다.
 *
 * 이 파일이 잠그는 것:
 *  1. 내부 서비스 토큰 없이는 호출 자체가 403 (fail-closed)
 *  2. 적립 근거는 요청 body 가 아니라 **PayPal capture 가 검증된 예약 문서**에서만 온다
 *  3. 검증 안 된 결제 / 캡처 없음 / 게스트(uid 없음) → 적립하지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const codeOf = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

// ── 1. 인증 게이트 (핸들러 실행) ──────────────────────────────────────────────
const bookingHolder: { d: any; exists: boolean } = { d: {}, exists: true };

vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: bookingHolder.exists, data: () => ({ ...bookingHolder.d }) }),
      }),
    }),
  }),
}));

const { default: handler } = await import('../../api/booking-processor.js');

function mockRes() {
  const out = { statusCode: 0, body: null as any };
  return {
    out,
    setHeader() {},
    status(c: number) { out.statusCode = c; return this; },
    json(b: any) { out.body = b; return this; },
    end() { return this; },
  };
}
async function call(headers: Record<string, string>, body: object) {
  const res = mockRes();
  await handler({ method: 'POST', headers, body } as any, res as any);
  return res.out;
}

beforeEach(() => {
  process.env.INTERNAL_API_TOKEN = 'secret-tok';
  bookingHolder.exists = true;
  bookingHolder.d = {
    paymentVerified: true, captureID: 'CAP-1', uid: 'u1', amountUSD: 9.06,
  };
});

describe('booking-processor — 인증 게이트', () => {
  it('토큰 없이 호출하면 403 (외부 호출 차단)', async () => {
    const r = await call({}, { orderID: 'CT-1', userId: 'victim', amount: 999 });
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('FORBIDDEN');
  });

  it('토큰이 틀리면 403', async () => {
    const r = await call({ 'x-internal-token': 'wrong' }, { orderID: 'CT-1' });
    expect(r.statusCode).toBe(403);
  });

  it('서버에 토큰이 설정 안 됐으면 전부 거부 (fail-closed)', async () => {
    process.env.INTERNAL_API_TOKEN = '';
    const r = await call({ 'x-internal-token': '' }, { orderID: 'CT-1' });
    expect(r.statusCode).toBe(403);
  });
});

// ── 2·3. 적립 근거 (소스 가드) ────────────────────────────────────────────────
describe('booking-processor — 적립 근거는 검증된 capture 뿐', () => {
  const code = codeOf('api/booking-processor.js');

  it('요청 body 의 userId 를 적립에 쓰지 않는다', () => {
    expect(code).not.toContain('userId: body.userId');
    expect(code).toContain('userId: ledgerUid');
  });

  it('금액도 예약 문서에서 읽는다', () => {
    expect(code).toContain('readVerifiedLedgerBasis');
    expect(code).toContain('ledger.amountUSD');
  });

  it('검증 실패 조건이 전부 fail-closed 다', () => {
    const fn = code.slice(code.indexOf('async function readVerifiedLedgerBasis'), code.indexOf('const CORS_HEADERS'));
    for (const guard of [
      'admin-or-test-order', 'booking-not-found', 'payment-not-verified',
      'no-captureID', 'no-verified-uid', 'invalid-amount',
      'fully-refunded-or-canceled',
    ]) {
      expect(fn, `가드 누락: ${guard}`).toContain(guard);
    }
  });

  it('PayPal capture 식별자를 원장에 남긴다 (대사 가능)', () => {
    expect(code).toContain('captureId: ledger.captureID');
    expect(codeOf('api/loyalty.js')).toContain('captureId: captureId || null');
  });
});

describe('capturePaypalOrder — 검증된 uid 저장', () => {
  const code = codeOf('api/capturePaypalOrder.js');

  it('예약 문서에 검증된 토큰 uid 를 남긴다', () => {
    expect(code).toContain('verifiedBuyerUid');
    expect(code).toContain('uid: verifiedBuyerUid || null');
  });

  it('uid 는 body 가 아니라 Authorization 헤더 검증에서 온다', () => {
    expect(code).toContain('verifyTokenUid(req.headers?.authorization)');
    expect(code).not.toContain('uid: body.userId');
  });
});

describe('호출처 — 내부 토큰 동봉', () => {
  it('모든 서버 호출처가 x-internal-token 을 보낸다', () => {
    for (const f of [
      'api/_shared/booking-processor-trigger.js',
      'api/admin-replay-booking-notifications.js',
      'api/admin-scan-suspect-bookings.js',
    ]) {
      expect(codeOf(f), `${f}: 토큰 미동봉 → 예약 후처리가 통째로 죽는다`)
        .toContain("'x-internal-token'");
    }
  });
});
