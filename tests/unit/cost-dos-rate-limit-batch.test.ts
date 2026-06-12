/* eslint-disable @typescript-eslint/no-explicit-any -- 핸들러 모킹 스캐폴딩. */
/**
 * 무인증 고비용 엔드포인트 IP rate-limit 배선 (2026-06-12 비용 헌트 후속, PR #911 미러).
 * place-search(Naver)·recalc-transit(ODsay)·translate-plan(Gemini) — 무인증 + 외부 API 비용 →
 * 무한호출 비용 폭주 차단.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENDPOINTS = [
  { file: 'api/place-search.js', collection: 'place_search_rate_limits' },
  { file: 'api/recalc-transit.js', collection: 'recalc_transit_rate_limits' },
  { file: 'api/translate-plan.js', collection: 'translate_plan_rate_limits' },
];

describe('비용 DoS — IP rate-limit 배선 (소스 가드)', () => {
  for (const e of ENDPOINTS) {
    const src = readFileSync(resolve(process.cwd(), e.file), 'utf8');
    it(`${e.file} 가 checkIpRateLimit + ${e.collection} 적용`, () => {
      expect(src).toMatch(/import \{[^}]*checkIpRateLimit[^}]*\} from '\.\/_shared\/ip-rate-limit\.js'/);
      expect(src).toMatch(/checkIpRateLimit\(/);
      expect(src).toContain(e.collection);
      expect(src).toMatch(/RATE_LIMITED/);
    });
  }
});

// 행동 검증 — translate-plan(res.status().json 스타일)이 429 를 비용작업 전 반환하는지.
const checkIpRateLimitMock = vi.fn();
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({
  checkIpRateLimit: (...a: any[]) => checkIpRateLimitMock(...a),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => ({}) }));
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent: () => { throw new Error('Gemini reached — rate-limit not before cost'); } }; } },
}));

function makeRes(): any {
  const res: any = {
    statusCode: undefined, headers: {}, body: '',
    setHeader(k: string, v: string) { res.headers[k] = v; },
    status(s: number) { res.statusCode = s; return res; },
    json(o: any) { res.body = JSON.stringify(o); return res; },
    writeHead(s: number, h?: any) { res.statusCode = s; if (h) Object.assign(res.headers, h); return res; },
    end(s?: string) { if (s != null) res.body = s; return res; },
  };
  return res;
}

describe('translate-plan — 429 가 Gemini 호출 전 (status().json 스타일)', () => {
  it('rate-limit 초과 → 429 RATE_LIMITED + Retry-After', async () => {
    checkIpRateLimitMock.mockResolvedValueOnce({ ok: false, status: 429, retryAfterSec: 1800, error: 'Too many translations' });
    const handler = (await import('../../api/translate-plan.js')).default;
    const res = makeRes();
    await handler({ method: 'POST', headers: { host: 'unit.test' }, body: { plan: {}, targetLang: 'en' } } as any, res as any);
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body).code).toBe('RATE_LIMITED');
    expect(res.headers['Retry-After']).toBe('1800');
  });
});
