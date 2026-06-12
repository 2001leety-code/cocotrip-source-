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

describe('reviews 공개 list — PII 화이트리스트 (소스 가드)', () => {
  const reviewsSrc = readFileSync(resolve(process.cwd(), 'api/reviews.js'), 'utf8');
  it('list 가 안전 필드만 화이트리스트 (full doc 스프레드 대신 명시 직렬화)', () => {
    // 무인증 list 가 driverChatId/driverName/reporterUid/bookingId 노출하던 전체 스프레드 → 화이트리스트.
    expect(reviewsSrc).toMatch(/authorName:\s*x\.authorName/);
    expect(reviewsSrc).toMatch(/rating:\s*x\.rating/);
    expect(reviewsSrc).toMatch(/createdAt:\s*x\.createdAt/);
  });
});
