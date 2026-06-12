/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩. */
/**
 * loyalty/reviews 보안 회귀 (2026-06-12 인증/PII 버그헌트).
 *   1. loyalty earn: 서비스 토큰 게이트 — 외부 무인증 호출로 코인 minting(→할인) 차단 (CRITICAL)
 *   2. reviews 공개 list: PII 화이트리스트 — 기사 Telegram chatId/실명·신고자 uid 미노출 (HIGH)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const initAdminDbMock = vi.fn(() => ({ collection: () => ({ doc: () => ({}) }) }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: (...a: any[]) => initAdminDbMock(...a) }));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'TS', delete: () => 'DEL', arrayUnion: (x: any) => ({ arrayUnion: x }) } }));
const verifyUserTokenMock = vi.fn();
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: (...a: any[]) => verifyUserTokenMock(...a) }));

function makeRes(): any {
  const res: any = { statusCode: undefined, body: '', writeHead(s: number) { res.statusCode = s; return res; }, end(s?: string) { if (s != null) res.body = s; return res; } };
  return res;
}
function req(body: object, headers: Record<string, string> = {}) {
  return { method: 'POST', url: '/api/loyalty', headers: { host: 'unit.test', ...headers }, body };
}

describe('loyalty earn — 서비스 토큰 게이트 (CRITICAL: 무인증 코인 minting 차단)', () => {
  const ENV = process.env.INTERNAL_API_TOKEN;
  beforeEach(() => { initAdminDbMock.mockReset(); initAdminDbMock.mockReturnValue({ collection: () => ({ doc: () => ({}) }) }); });
  afterEach(() => { if (ENV === undefined) delete process.env.INTERNAL_API_TOKEN; else process.env.INTERNAL_API_TOKEN = ENV; });

  it('토큰 헤더 없이 earn → 403 (외부 minting 차단)', async () => {
    process.env.INTERNAL_API_TOKEN = 'secret123';
    const handler = (await import('../../api/loyalty.js')).default;
    const res = makeRes();
    await handler(req({ action: 'earn', userId: 'anyuid', amountUSD: 99999 }) as any, res as any);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('FORBIDDEN');
  });
  it('틀린 토큰 → 403', async () => {
    process.env.INTERNAL_API_TOKEN = 'secret123';
    const handler = (await import('../../api/loyalty.js')).default;
    const res = makeRes();
    await handler(req({ action: 'earn', userId: 'anyuid', amountUSD: 99999 }, { 'x-internal-token': 'wrong' }) as any, res as any);
    expect(res.statusCode).toBe(403);
  });
  it('INTERNAL_API_TOKEN 미설정 → earn 403 (fail-closed, fail-open 아님)', async () => {
    delete process.env.INTERNAL_API_TOKEN;
    const handler = (await import('../../api/loyalty.js')).default;
    const res = makeRes();
    await handler(req({ action: 'earn', userId: 'anyuid', amountUSD: 99999 }, { 'x-internal-token': 'anything' }) as any, res as any);
    expect(res.statusCode).toBe(403);
  });
});

describe('loyalty 클라이언트 액션 — IDOR fix (body.userId 신뢰 종료, auth.uid 강제)', () => {
  // earn 외 액션(spend/use-coupon/earn-share/redeem-coupon)이 body.userId 를 신뢰하면
  // 공격자가 피해자 uid 로 코인 탈취/쿠폰 소각 가능. fix: verifyUserToken 의 auth.uid 만 사용.
  let lastUsersDocId: string | undefined;
  function captureDb(): any {
    return {
      collection: (name: string) => ({
        doc: (id: string) => {
          if (name === 'users') lastUsersDocId = id;
          return { collection: () => ({ doc: () => ({}) }) };
        },
      }),
      runTransaction: async () => ({}), // 콜백 미실행 — identity 해소만 검증
    };
  }
  beforeEach(() => {
    initAdminDbMock.mockReset(); initAdminDbMock.mockReturnValue(captureDb());
    verifyUserTokenMock.mockReset(); lastUsersDocId = undefined;
  });

  it('인증 없이 redeem-coupon → 401 AUTH_REQUIRED (이전엔 body.userId 로 타인 코인 교환)', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: false, status: 401, error: 'Authorization Bearer token required' });
    const handler = (await import('../../api/loyalty.js')).default;
    const res = makeRes();
    await handler(req({ action: 'redeem-coupon', userId: 'VICTIM_UID', coins: 500 }) as any, res as any);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe('AUTH_REQUIRED');
  });

  it('유효 토큰: body.userId(피해자) 무시 → auth.uid 본인 문서만 대상', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: true, uid: 'REAL_UID', email: 'me@x.com' });
    const handler = (await import('../../api/loyalty.js')).default;
    const res = makeRes();
    // coins=999 = invalid tier → 400. identity 해소(auth.uid)는 그 전에 통과 = 캡처됨.
    await handler(req({ action: 'redeem-coupon', userId: 'VICTIM_UID', coins: 999 }, { authorization: 'Bearer t' }) as any, res as any);
    expect(lastUsersDocId).toBe('REAL_UID');       // body.userId='VICTIM_UID' 무시
    expect(lastUsersDocId).not.toBe('VICTIM_UID');
    expect(res.statusCode).toBe(400);              // INVALID_TIER (액션까지 도달 = identity OK)
  });

  it('spend 도 인증 필수 → 401 (무인증 타인 코인 차감 차단)', async () => {
    verifyUserTokenMock.mockResolvedValue({ ok: false, status: 401, error: 'x' });
    const handler = (await import('../../api/loyalty.js')).default;
    const res = makeRes();
    await handler(req({ action: 'spend', userId: 'VICTIM_UID', coins: 100 }) as any, res as any);
    expect(res.statusCode).toBe(401);
  });

  it('earn 은 토큰 게이트 유지 — verifyUserToken 경로 안 탐(body.userId=대상 게스트 uid)', async () => {
    process.env.INTERNAL_API_TOKEN = 'secret123';
    const handler = (await import('../../api/loyalty.js')).default;
    const res = makeRes();
    await handler(req({ action: 'earn', userId: 'guest', amountUSD: 10 }, { 'x-internal-token': 'secret123' }) as any, res as any);
    expect(verifyUserTokenMock).not.toHaveBeenCalled();
    delete process.env.INTERNAL_API_TOKEN;
  });
});

describe('reviews 공개 list — PII 화이트리스트 (소스 가드)', () => {
  const reviewsSrc = readFileSync(resolve(process.cwd(), 'api/reviews.js'), 'utf8');
  it('list 가 안전 필드만 화이트리스트 (full doc 스프레드 대신 명시 직렬화)', () => {
    // 무인증 list 가 driverChatId/driverName/reporterUid/bookingId 노출하던 전체 스프레드 → 화이트리스트.
    expect(reviewsSrc).toMatch(/authorName:\s*x\.authorName/);
    expect(reviewsSrc).toMatch(/rating:\s*x\.rating/);
    expect(reviewsSrc).toMatch(/createdAt:\s*x\.createdAt/);
  });
});
