/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러/Firestore 모킹 스캐폴딩 (course-share.test 패턴). */
/**
 * /api/preview-lead — 무료 미리보기 이탈 회복 리드 캡처 회귀 (2026-08-19).
 *
 * 잠금:
 *   1. POST 전용(GET 405) / OPTIONS preflight 200.
 *   2. 입력 검증 — 이메일 형식·길이상한 400 BAD_EMAIL, source 화이트리스트 밖 400 BAD_SOURCE.
 *   3. IP rate-limit 초과 429 (Retry-After 헤더 포함), Firestore 쓰기 없음.
 *   4. 수신거부(marketing_optout) 이메일 → 200 {ok:true} 이지만 **저장 안 함**(상태 안 흘림).
 *   5. 정상 저장 — 문서 id = sha256(정규화 이메일), 응답 바디에 이메일 절대 미포함.
 *   6. 재방문 — createdAtMs/recoveryEmailSentAtMs/convertedAtMs 보존, lastSeenAtMs 만 갱신.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const rateLimitMock = vi.fn();
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: (...a: any[]) => rateLimitMock(...a),
  getClientIp: () => '1.2.3.4',
}));

const isOptedOutMock = vi.fn();
vi.mock('../../api/_shared/marketing-optout.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, isMarketingOptedOut: (...a: any[]) => isOptedOutMock(...a) };
});

vi.mock('../../api/_shared/sentry.js', () => ({ captureError: async () => {} }));

const docs = new Map<string, any>();
vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => ({
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: docs.has(`${c}/${id}`), data: () => docs.get(`${c}/${id}`) }),
        set: async (d: any) => { docs.set(`${c}/${id}`, d); },
      }),
    }),
  }),
}));

import handler from '../../api/preview-lead.js';

function mockRes() {
  const r: any = { headers: null as any, status: 0, body: '' };
  r.writeHead = (s: number, h: any) => { r.status = s; r.headers = h; };
  r.end = (b?: string) => { r.body = b || ''; return r; };
  return r;
}
const parse = (r: any) => JSON.parse(r.body || '{}');
const docIdFor = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

beforeEach(() => {
  docs.clear();
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({ ok: true });
  isOptedOutMock.mockReset();
  isOptedOutMock.mockResolvedValue(false);
});

describe('POST /api/preview-lead', () => {
  const body = { email: 'Traveler@Example.com', language: 'en', source: 'planner_paywall' };

  it('non-POST → 405 METHOD_NOT_ALLOWED', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} } as any, res);
    expect(res.status).toBe(405);
    expect(parse(res).code).toBe('METHOD_NOT_ALLOWED');
  });

  it('OPTIONS preflight → 200', async () => {
    const res = mockRes();
    await handler({ method: 'OPTIONS', headers: {} } as any, res);
    expect(res.status).toBe(200);
  });

  it('invalid email format → 400 BAD_EMAIL, no write', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: { ...body, email: 'not-an-email' } } as any, res);
    expect(res.status).toBe(400);
    expect(parse(res).code).toBe('BAD_EMAIL');
    expect(docs.size).toBe(0);
  });

  it('email over length cap → 400 BAD_EMAIL', async () => {
    const longEmail = `${'a'.repeat(250)}@b.com`; // 256 chars > 254 cap
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: { ...body, email: longEmail } } as any, res);
    expect(res.status).toBe(400);
    expect(parse(res).code).toBe('BAD_EMAIL');
  });

  it('unknown source → 400 BAD_SOURCE', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: { ...body, source: 'homepage_footer' } } as any, res);
    expect(res.status).toBe(400);
    expect(parse(res).code).toBe('BAD_SOURCE');
  });

  it('rate-limited → 429 with Retry-After, no write', async () => {
    rateLimitMock.mockResolvedValueOnce({ ok: false, status: 429, retryAfterSec: 3600, error: 'too many' });
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body } as any, res);
    expect(res.status).toBe(429);
    expect(res.headers['Retry-After']).toBe('3600');
    expect(docs.size).toBe(0);
  });

  it('rate-limit runs on the preview_lead_rate_limits collection at 10/hour', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body } as any, res);
    expect(rateLimitMock).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'preview_lead_rate_limits',
      maxRequests: 10,
    }));
  });

  it('opted-out email → 200 {ok:true}, does NOT store, does not leak opt-out status', async () => {
    isOptedOutMock.mockResolvedValueOnce(true);
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body } as any, res);
    expect(res.status).toBe(200);
    expect(parse(res)).toEqual({ ok: true });
    expect(docs.size).toBe(0);
  });

  it('happy path — stores doc keyed by sha256(email), response never echoes the email', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body } as any, res);
    expect(res.status).toBe(200);
    expect(parse(res)).toEqual({ ok: true });
    expect(res.body).not.toContain('traveler@example.com');
    expect(res.body).not.toContain('Traveler@Example.com');

    const stored = docs.get(`preview_leads/${docIdFor(body.email)}`);
    expect(stored).toBeTruthy();
    expect(stored.emailLower).toBe('traveler@example.com');
    expect(stored.language).toBe('en');
    expect(stored.source).toBe('planner_paywall');
    expect(stored.consent).toBe(true);
    expect(typeof stored.consentAtMs).toBe('number');
    expect(typeof stored.createdAtMs).toBe('number');
    expect(typeof stored.lastSeenAtMs).toBe('number');
    expect(stored.recoveryEmailSentAtMs).toBeNull();
    expect(stored.convertedAtMs).toBeNull();
  });

  it('language defaults to en when omitted or not in the 4-lang whitelist', async () => {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: { email: 'x@y.com', source: 'planner_paywall' } } as any, res);
    expect(docs.get(`preview_leads/${docIdFor('x@y.com')}`).language).toBe('en');

    const res2 = mockRes();
    await handler({ method: 'POST', headers: {}, body: { email: 'z@y.com', source: 'planner_paywall', language: 'fr' } } as any, res2);
    expect(docs.get(`preview_leads/${docIdFor('z@y.com')}`).language).toBe('en');
  });

  it('revisit preserves createdAtMs/consentAtMs/recoveryEmailSentAtMs/convertedAtMs, bumps lastSeenAtMs', async () => {
    const key = `preview_leads/${docIdFor(body.email)}`;
    docs.set(key, {
      emailLower: 'traveler@example.com', language: 'ko', source: 'planner_paywall',
      consent: true, consentAtMs: 1000, createdAtMs: 1000, lastSeenAtMs: 1000,
      recoveryEmailSentAtMs: 2000, convertedAtMs: 3000,
    });
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body } as any, res);
    expect(res.status).toBe(200);
    const stored = docs.get(key);
    expect(stored.createdAtMs).toBe(1000);
    expect(stored.consentAtMs).toBe(1000);
    expect(stored.recoveryEmailSentAtMs).toBe(2000);
    expect(stored.convertedAtMs).toBe(3000);
    expect(stored.lastSeenAtMs).toBeGreaterThan(1000);
    expect(stored.language).toBe('en'); // this submission's language
  });
});
