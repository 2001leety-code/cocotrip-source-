import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ rate: vi.fn(), llm: vi.fn(), key: vi.fn(), network: vi.fn() }));
vi.mock('../../api/_shared/ip-rate-limit.js', () => ({ checkIpRateLimit: effects.rate, getClientIp: () => 'offline-fixture' }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => ({}) }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: () => 'offline' } }));
vi.mock('../../api/_shared/llm/index.js', () => ({ createLlmModel: effects.llm, resolveLlmApiKey: effects.key }));
const { default: handler } = await import('../../api/ai-planner-quick.js');
const alias = 'https://cocotrip-source2026-git-feat-me-824aea-2001leety-3613s-projects.vercel.app';
const unique = 'cocotrip-source2026-6m89yf82f-2001leety-3613s-projects.vercel.app';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VERCEL_ENV', 'preview'); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_URL', unique);
  effects.rate.mockResolvedValue({ ok: false, status: 429, retryAfterSec: 60, error: 'offline limit' });
  for (const spy of [effects.llm, effects.key, effects.network]) spy.mockImplementation(() => { throw new Error('Unexpected provider/network access'); });
  vi.stubGlobal('fetch', effects.network);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function post(origin: string, body: Record<string, unknown> = {}) {
  const response = { statusCode: 0, headers: {} as Record<string, string>, body: '',
    writeHead(status: number, headers: Record<string, string>) { this.statusCode = status; Object.assign(this.headers, headers); },
    end(body: string) { this.body = body; } };
  await handler({ method: 'POST', headers: { origin, 'content-type': 'application/json' }, body }, response);
  expect(effects.llm).not.toHaveBeenCalled(); expect(effects.key).not.toHaveBeenCalled(); expect(effects.network).not.toHaveBeenCalled();
  return response;
}

describe('exact branch Preview origin, with all external effects mocked', () => {
  it.each([{}, { arrival_time: '09:00' }])('accepts the branch origin independently of arrival input %j', async body => {
    const response = await post(alias, body);
    expect(response.statusCode).toBe(429); // Allowed only as far as the mocked rate gate, never a real generation.
    expect(response.headers['Access-Control-Allow-Origin']).toBe(alias);
    expect(response.headers.Vary).toBe('Origin');
    expect(effects.rate).toHaveBeenCalledOnce();
  });
  it.each(['production', 'development', ''])('does not add this alias outside Vercel Preview (%s)', async deployment => {
    vi.stubEnv('VERCEL_ENV', deployment);
    const response = await post(alias);
    expect(response.statusCode).toBe(403);
    expect(response.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(effects.rate).not.toHaveBeenCalled();
  });
  it.each([alias + '.evil.example', alias + '/', alias.replace('https:', 'http:'), alias + ':443',
    alias.replace('https://', 'https://evil-'), 'https://unrelated.vercel.app'])('rejects non-exact origin %s before rate/provider access', async origin => {
    const response = await post(origin);
    expect(response.statusCode).toBe(403);
    expect(response.headers['Access-Control-Allow-Origin']).toBeUndefined();
    expect(effects.rate).not.toHaveBeenCalled();
  });
  it.each(['https://cocotripkr.com', 'https://www.cocotripkr.com', `https://${unique}`, 'https://cocotrip-preview-2026.vercel.app'])('preserves existing allow rule %s', async origin => {
    expect((await post(origin)).statusCode).toBe(429);
  });
});
