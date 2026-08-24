/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러 모킹 스캐폴딩. */
/**
 * ai-planner-quick — 비용 DoS rate-limit 회귀 (2026-06-12 비용/남용 헌트).
 * 무인증 + Gemini 호출 엔드포인트 → per-IP rate-limit 으로 무한호출 비용폭주 차단.
 * rate-limit 이 Gemini 호출 "전에" 작동(429)하는지 박제.
 */
import { describe, it, expect, vi } from 'vitest';

const checkIpRateLimitMock = vi.fn();
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: (...a: any[]) => checkIpRateLimitMock(...a),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => ({}) }));
// Gemini 호출은 rate-limit 차단 시 도달 안 함 — 호출되면 테스트 실패시키도록 throw.
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent: () => { throw new Error('Gemini reached — rate-limit not enforced before cost'); } }; } },
}));

function makeRes(): any {
  const res: any = { statusCode: undefined, headers: {}, body: '', writeHead(s: number, h?: any) { res.statusCode = s; if (h) Object.assign(res.headers, h); return res; }, end(s?: string) { if (s != null) res.body = s; return res; } };
  return res;
}

describe('ai-planner-quick — 비용 DoS rate-limit', () => {
  it('rate-limit 초과 → 429 (Gemini 호출 전 차단)', async () => {
    checkIpRateLimitMock.mockResolvedValueOnce({ ok: false, status: 429, retryAfterSec: 1800, error: 'Too many plan previews' });
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', host: 'unit.test' }, body: { destination: 'Seoul' } } as any, res as any);
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body).code).toBe('RATE_LIMITED');
    expect(res.headers['Retry-After']).toBe('1800');
  });
  it('rate-limit collection 이 quick_plan_rate_limits 로 호출됨', async () => {
    checkIpRateLimitMock.mockReset();
    checkIpRateLimitMock.mockResolvedValueOnce({ ok: false, status: 429, retryAfterSec: 60, error: 'x' });
    const handler = (await import('../../api/ai-planner-quick.js')).default;
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', host: 'unit.test' }, body: {} } as any, makeRes() as any);
    expect(checkIpRateLimitMock).toHaveBeenCalledWith(expect.objectContaining({ collection: 'quick_plan_rate_limits' }));
  });
});
