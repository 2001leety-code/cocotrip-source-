/**
 * 통합 2026-10-17 — mood-parse-schedule 의 x-llm-mock 경로를 실제 체인으로 잠근다.
 *   실제 api/_shared/llm/index.js(createLlmModel + 킬스위치 가드) → 실제 mock.js(mood 고정 응답)
 *   → 실제 api/mood-parse-schedule.js 핸들러(인증·allowlist·정규화·서비스 추천).
 * 가짜로 바꾸는 것은 외부 경계뿐: Firebase 토큰 검증, Firestore(db), 런타임 플래그 읽기,
 * 사용량 레코더, 네이버 지오코딩/장소검색, Sentry. 모두 import 전에 vi.mock 으로 고정.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const collections: string[] = [];
  const db = {
    collection(name: string) {
      collections.push(name);
      if (name === 'mood_config') {
        return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ emails: ['ops@example.test'] }) }) }) };
      }
      if (name === 'mood_places') {
        return {
          get: async () => ({
            forEach(cb: (d: { id: string; data: () => object }) => void) {
              cb({ id: 'p1', data: () => ({ name: '신라호텔', address: '서울 중구 동호로 249', lat: 37.5559, lng: 127.0054, isDirector: false }) });
            },
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
  return {
    db,
    collections,
    initAdminDb: vi.fn(() => db),
    getRuntimeFlags: vi.fn(async () => ({ llm_kill_switch: false })),
    recordUsageFromResponse: vi.fn(),
    verifyUserToken: vi.fn(async () => ({ ok: true, email: 'ops@example.test', emailVerified: true })),
    geocodeAddress: vi.fn(async () => ({ ok: true, lat: 37.5, lng: 127.0 })),
    resolveCredentialCandidates: vi.fn(() => []),
    captureError: vi.fn(async () => {}),
  };
});

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: h.initAdminDb }));
vi.mock('../../api/_shared/runtime-flags.js', () => ({ getRuntimeFlags: h.getRuntimeFlags }));
vi.mock('../../api/_shared/apiUsageRecorder.js', () => ({ recordUsageFromResponse: h.recordUsageFromResponse }));
vi.mock('../../api/_shared/user-auth.js', () => ({ verifyUserToken: h.verifyUserToken, default: h.verifyUserToken }));
vi.mock('../../api/_shared/mood-route.js', () => ({ geocodeAddress: h.geocodeAddress }));
vi.mock('../../api/place-search.js', () => ({
  naverCoordToWgs84: () => null,
  resolveCredentialCandidates: h.resolveCredentialCandidates,
}));
vi.mock('../../api/_shared/sentry.js', () => ({ captureError: h.captureError }));

import handler from '../../api/mood-parse-schedule.js';
import { MOOD_PARSE_FIXTURE } from '../../api/_shared/llm/mock.js';
import { resolveLlmApiKey, resolveLlmProvider } from '../../api/_shared/llm/index.js';

function call(headers: Record<string, string>) {
  const req = { method: 'POST', headers: { authorization: 'Bearer t', ...headers }, body: { text: '■ 9:30 신라호텔 픽업\n■ 오후 3시 인천공항 T2 드랍' } };
  const out: { status?: number; body?: any } = {};
  const res = {
    writeHead(s: number) { out.status = s; return res; },
    end(b?: string) { out.body = b ? JSON.parse(b) : undefined; return res; },
  };
  return Promise.resolve(handler(req as any, res as any)).then(() => out);
}

const saved: Record<string, string | undefined> = {};
const KEYS = ['LLM_PROVIDER', 'LLM_PROVIDER_MOOD', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'LLM_KILL_SWITCH'];
beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  // claude 공급자 + 키 없음: mock 컨텍스트가 아니면 어댑터가 클라이언트 생성에서 실패한다 → 유료 경로 0 증명.
  process.env.LLM_PROVIDER = 'claude';
  h.collections.length = 0;
  vi.clearAllMocks();
  h.getRuntimeFlags.mockImplementation(async () => ({ llm_kill_switch: false }));
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('mood fixture shape', () => {
  it('is non-empty, uses only handler-allowed actions, and does not pre-set handler-owned fields', () => {
    expect(MOOD_PARSE_FIXTURE.stops.length).toBeGreaterThan(0);
    for (const s of MOOD_PARSE_FIXTURE.stops) {
      expect(['pickup', 'dropoff', 'via', 'arrive']).toContain(s.action);
      expect(Object.keys(s).sort()).toEqual(['action', 'addressHint', 'dateHint', 'order', 'personOrPlace', 'rawText', 'timeHint']);
    }
    const raw = JSON.stringify(MOOD_PARSE_FIXTURE);
    expect(raw).not.toMatch(/needsConfirm|serviceGuess|"lat"|"lng"/);
  });
});

describe('x-llm-mock: real adapter -> real mock -> real handler', () => {
  it('returns a schema-correct parse with needsConfirm set by the handler, and settles usage fire-and-forget', async () => {
    const out = await call({ 'x-llm-mock': '1' });
    expect(out.status).toBe(200);
    const b = out.body;
    expect(b.ok).toBe(true);
    expect(b.needsConfirm).toBe(true);
    expect(['airport', 'vehicle', 'manager']).toContain(b.serviceGuess);
    expect(b.serviceGuess).toBe('airport');
    expect(b.hasAirport).toBe(true);
    expect(b.hasDirector).toBe(false);
    expect(b.airportCodeGuess).toBe('ICN');
    expect(b.airportDirectionGuess).toBe('sending');
    expect(b.truncated).toBe(false);
    expect(b.flights).toEqual([]);
    expect(b.dates).toEqual([]);
    expect(b.stops.map((s: any) => s.action)).toEqual(['pickup', 'arrive', 'dropoff']);
    expect(b.stops.map((s: any) => s.timeHint)).toEqual(['09:30', '11:00', '15:00']);
    expect(b.stops.map((s: any) => s.label)).toEqual(['신라호텔', '강남 코엑스', '인천공항 T2']);
    expect(b.stops[0]).toMatchObject({ matchedFromPlacebook: true, geocodeOk: true, lat: 37.5559, lng: 127.0054, isAirport: false });
    expect(b.stops[1]).toMatchObject({ matchedFromPlacebook: false, geocodeOk: true, searchGuessed: false });
    expect(b.stops[2]).toMatchObject({ isAirport: true, geocodeOk: true });
    for (const s of b.stops) expect(Object.keys(s)).toEqual(expect.arrayContaining(['order', 'label', 'address', 'lat', 'lng', 'action', 'matchedFromPlacebook', 'geocodeOk', 'searchGuessed', 'date', 'timeHint', 'isAirport']));

    // 지오코딩: 주소록 매칭된 stop 1 은 건너뛰고, 나머지는 addressHint > personOrPlace 로.
    expect(h.geocodeAddress.mock.calls.map((c: any[]) => c[0])).toEqual(['서울 강남구 영동대로 513', '인천공항 T2']);
    expect(h.resolveCredentialCandidates).not.toHaveBeenCalled();

    // DB: 핸들러 db + 어댑터 킬스위치 db. mock 은 일일 상한(llm_guard) 카운터를 건드리지 않는다.
    expect(h.initAdminDb).toHaveBeenCalledWith('mood-parse-schedule');
    expect(h.initAdminDb).toHaveBeenCalledWith('llm');
    expect(h.getRuntimeFlags).toHaveBeenCalledTimes(1);
    expect(h.getRuntimeFlags).toHaveBeenCalledWith(h.db);
    expect(h.collections).toEqual(['mood_config', 'mood_places']);
    expect(h.collections).not.toContain('llm_guard');

    // 사용량 레코더: 동적 import + then — 응답 후 정산되는 fire-and-forget.
    await vi.waitFor(() => expect(h.recordUsageFromResponse).toHaveBeenCalledTimes(1));
    const [stage, model, response] = h.recordUsageFromResponse.mock.calls[0] as any[];
    expect(stage).toBe('mood-parse');
    expect(model).toBe('mock:mood');
    expect(response.usageMetadata.promptTokenCount).toBeGreaterThan(0);
    expect(response.usageMetadata.candidatesTokenCount).toBeGreaterThan(0);
    expect(h.captureError).not.toHaveBeenCalled();
  });

  it('kill switch blocks even the mock provider (real guard in chain) -> AI_PARSE_FAILED, no usage settlement', async () => {
    h.getRuntimeFlags.mockImplementation(async () => ({ llm_kill_switch: true }));
    const out = await call({ 'x-llm-mock': '1' });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: false, code: 'AI_PARSE_FAILED' });
    expect(h.captureError).toHaveBeenCalledTimes(1);
    expect((h.captureError.mock.calls[0] as any[])[0].code).toBe('LLM_DISABLED');
    await Promise.resolve();
    expect(h.recordUsageFromResponse).not.toHaveBeenCalled();
  });

  it('without the header the request is NOT mocked (claude without key fails, fail-soft)', async () => {
    const out = await call({});
    expect(out.body).toMatchObject({ ok: false, code: 'AI_PARSE_FAILED' });
    expect(String((h.captureError.mock.calls[0] as any[])[0].message)).toMatch(/ANTHROPIC_API_KEY/);
    expect(h.recordUsageFromResponse).not.toHaveBeenCalled();
  });
});

describe('default provider (LLM_PROVIDER unset) and NO keys', () => {
  beforeEach(() => {
    // 기본 공급자(gemini) + GEMINI/ANTHROPIC 키 모두 없음. LLM_PROVIDER=claude 우회 금지.
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_PROVIDER_MOOD;
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('mock header -> key resolved inside mock context -> nonempty stops, needsConfirm true, no paid path', async () => {
    const out = await call({ 'x-llm-mock': '1' });
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    expect(out.body.code).toBeUndefined();
    expect(out.body.stops.length).toBeGreaterThan(0);
    expect(out.body.stops.length).toBe(MOOD_PARSE_FIXTURE.stops.length);
    expect(out.body.needsConfirm).toBe(true);
    expect(out.body.serviceGuess).toBe('airport');
    // 킬스위치 가드는 그대로 1회 평가, 일일 상한 카운터(llm_guard)는 mock 이라 미접촉.
    expect(h.getRuntimeFlags).toHaveBeenCalledTimes(1);
    expect(h.collections).toEqual(['mood_config', 'mood_places']);
    await vi.waitFor(() => expect(h.recordUsageFromResponse).toHaveBeenCalledTimes(1));
    expect((h.recordUsageFromResponse.mock.calls[0] as any[])[1]).toBe('mock:mood');
    expect(h.captureError).not.toHaveBeenCalled();
    // 요청 범위 컨텍스트가 새지 않는다 — 핸들러 밖에서는 여전히 gemini/키 없음.
    expect(resolveLlmProvider('mood')).toBe('gemini');
    expect(() => resolveLlmApiKey('mood')).toThrow(/GEMINI_API_KEY/);
  });

  it('no header -> AI_NOT_CONFIGURED before any LLM guard or placebook read', async () => {
    const out = await call({});
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: false, code: 'AI_NOT_CONFIGURED' });
    expect(h.getRuntimeFlags).not.toHaveBeenCalled();
    expect(h.collections).toEqual(['mood_config']);
    expect(h.captureError).not.toHaveBeenCalled();
    expect(h.recordUsageFromResponse).not.toHaveBeenCalled();
  });

  it('header value other than "1" is not a mock request -> AI_NOT_CONFIGURED', async () => {
    const out = await call({ 'x-llm-mock': 'true' });
    expect(out.body).toMatchObject({ ok: false, code: 'AI_NOT_CONFIGURED' });
    expect(h.getRuntimeFlags).not.toHaveBeenCalled();
  });

  it('mock header + kill switch -> AI_PARSE_FAILED (LLM_DISABLED), no usage', async () => {
    h.getRuntimeFlags.mockImplementation(async () => ({ llm_kill_switch: true }));
    const out = await call({ 'x-llm-mock': '1' });
    expect(out.body).toMatchObject({ ok: false, code: 'AI_PARSE_FAILED' });
    expect((h.captureError.mock.calls[0] as any[])[0].code).toBe('LLM_DISABLED');
    await Promise.resolve();
    expect(h.recordUsageFromResponse).not.toHaveBeenCalled();
  });

  it('mock header + env kill switch -> AI_PARSE_FAILED (LLM_DISABLED)', async () => {
    process.env.LLM_KILL_SWITCH = '1';
    const out = await call({ 'x-llm-mock': '1' });
    expect(out.body).toMatchObject({ ok: false, code: 'AI_PARSE_FAILED' });
    expect((h.captureError.mock.calls[0] as any[])[0].code).toBe('LLM_DISABLED');
  });

  it('mock header does not bypass auth / email / allowlist gates', async () => {
    h.verifyUserToken.mockResolvedValueOnce({ ok: false, status: 401, error: 'no token' } as any);
    expect((await call({ 'x-llm-mock': '1' })).body.code).toBe('AUTH_REQUIRED');
    h.verifyUserToken.mockResolvedValueOnce({ ok: true, email: 'ops@example.test', emailVerified: false } as any);
    expect((await call({ 'x-llm-mock': '1' })).body.code).toBe('EMAIL_UNVERIFIED');
    h.verifyUserToken.mockResolvedValueOnce({ ok: true, email: 'stranger@example.test', emailVerified: true } as any);
    expect((await call({ 'x-llm-mock': '1' })).body.code).toBe('NOT_ALLOWED');
    expect(h.getRuntimeFlags).not.toHaveBeenCalled();
    expect(h.recordUsageFromResponse).not.toHaveBeenCalled();
  });
});

describe('auth semantics unchanged by the mock header', () => {
  it('unauthenticated -> 401 before any DB/LLM work', async () => {
    h.verifyUserToken.mockResolvedValueOnce({ ok: false, status: 401, error: 'no token' } as any);
    const out = await call({ 'x-llm-mock': '1' });
    expect(out.status).toBe(401);
    expect(out.body.code).toBe('AUTH_REQUIRED');
    expect(h.initAdminDb).not.toHaveBeenCalled();
    expect(h.getRuntimeFlags).not.toHaveBeenCalled();
  });

  it('unverified email -> 403 EMAIL_UNVERIFIED', async () => {
    h.verifyUserToken.mockResolvedValueOnce({ ok: true, email: 'ops@example.test', emailVerified: false } as any);
    const out = await call({ 'x-llm-mock': '1' });
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('EMAIL_UNVERIFIED');
    expect(h.getRuntimeFlags).not.toHaveBeenCalled();
  });

  it('not on the allowlist -> 403 NOT_ALLOWED, no LLM guard, no usage', async () => {
    h.verifyUserToken.mockResolvedValueOnce({ ok: true, email: 'stranger@example.test', emailVerified: true } as any);
    const out = await call({ 'x-llm-mock': '1' });
    expect(out.status).toBe(403);
    expect(out.body.code).toBe('NOT_ALLOWED');
    expect(h.collections).toEqual(['mood_config']);
    expect(h.getRuntimeFlags).not.toHaveBeenCalled();
    expect(h.recordUsageFromResponse).not.toHaveBeenCalled();
  });
});
