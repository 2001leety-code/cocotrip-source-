/**
 * /api/admin-posthog-funnel — 순서형 동일인 5단계 퍼널 핸들러 (2026-08-24).
 *
 * PostHog 를 실제로 부르지 않는다 — global.fetch 를 mock 해서 핸들러의 인증 분기 ·
 * 503/500 에러 매핑 · 응답 조립(semanticsVersion, generatedAt, windowStart/windowEnd,
 * latestEventAt, steps) 만 검증한다. HogQL 문자열 자체의 상세 검증은
 * ordered-funnel-query.test.ts 가 담당한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const authHolder: { result: unknown } = { result: { ok: true, email: 'admin@cocotrip.kr', uid: 'u1' } };
vi.mock('../../api/_shared/admin-auth.js', () => ({ verifyAdminToken: async () => authHolder.result }));

const { default: handler } = await import('../../api/admin-posthog-funnel.js');

function mockRes() {
  const out = { statusCode: 0, body: '', headers: {} as Record<string, string> };
  return { out, writeHead(c: number, h: Record<string, string>) { out.statusCode = c; out.headers = h; }, end(b?: string) { out.body = b || ''; } };
}

async function call(req: Record<string, unknown>) {
  const res = mockRes();
  await handler(req, res);
  return { ...res.out, json: res.out.body ? JSON.parse(res.out.body) : null };
}

const REQ = { method: 'GET', headers: {}, url: '/api/admin-posthog-funnel?days=30' };

/** 정상 응답: 1차 호출(funnel SQL) → 5열, 2차 호출(latest SQL) → 최근 이벤트. */
function fetchOkSequence(counts: number[], latest: string | null = '2026-08-24T10:00:00Z') {
  let n = 0;
  return vi.fn(async () => {
    n += 1;
    const results = n === 1 ? [counts] : [[latest]];
    return { ok: true, json: async () => ({ results }) };
  });
}

beforeEach(() => {
  authHolder.result = { ok: true, email: 'admin@cocotrip.kr', uid: 'u1' };
  process.env.POSTHOG_PERSONAL_API_KEY = 'sk-test-secret-token';
  process.env.POSTHOG_PROJECT_ID = 'proj-1';
});

afterEach(() => {
  delete process.env.POSTHOG_PERSONAL_API_KEY;
  delete process.env.POSTHOG_PROJECT_ID;
  vi.unstubAllGlobals();
});

describe('메서드/인증', () => {
  it('OPTIONS → 200 프리플라이트', async () => {
    const r = await call({ method: 'OPTIONS', headers: {} });
    expect(r.statusCode).toBe(200);
  });

  it('POST → 405', async () => {
    const r = await call({ method: 'POST', headers: {}, url: '/api/admin-posthog-funnel' });
    expect(r.statusCode).toBe(405);
  });

  it('verifyAdminToken 실패 → 그 status 그대로, PostHog 호출 없음', async () => {
    authHolder.result = { ok: false, status: 403, error: 'Not admin' };
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await call(REQ);
    expect(r.statusCode).toBe(403);
    expect(r.json.code).toBe('AUTH_FAILED');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('PostHog 미설정 → 503', () => {
  it('키/프로젝트ID 없음 → POSTHOG_DISABLED, PostHog 호출 없음', async () => {
    delete process.env.POSTHOG_PERSONAL_API_KEY;
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const r = await call(REQ);
    expect(r.statusCode).toBe(503);
    expect(r.json.code).toBe('POSTHOG_DISABLED');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('정상 응답 조립', () => {
  it('semanticsVersion·generatedAt·window*·latestEventAt·steps 를 모두 채운다', async () => {
    vi.stubGlobal('fetch', fetchOkSequence([100, 80, 40, 35, 30]));
    const r = await call(REQ);
    expect(r.statusCode).toBe(200);
    const d = r.json.data;
    expect(d.semanticsVersion).toBe('ordered-same-person-v1');
    expect(typeof d.generatedAt).toBe('string');
    expect(typeof d.windowStart).toBe('string');
    expect(typeof d.windowEnd).toBe('string');
    expect(d.latestEventAt).toBe('2026-08-24T10:00:00.000Z');
    expect(d.days).toBe(30);
    expect(d.steps.map((s: { id: string }) => s.id)).toEqual([
      'wizard_seen', 'preview_success', 'payment_started', 'payment_completed', 'planner_complete',
    ]);
    expect(d.steps.map((s: { count: number }) => s.count)).toEqual([100, 80, 40, 35, 30]);
    expect(d.steps.every((s: { label: string }) => typeof s.label === 'string' && s.label.length > 0)).toBe(true);
  });

  it('기간 내 이벤트 없음 → latestEventAt null', async () => {
    vi.stubGlobal('fetch', fetchOkSequence([0, 0, 0, 0, 0], null));
    const r = await call(REQ);
    expect(r.json.data.latestEventAt).toBeNull();
  });

  it('두 쿼리 모두 planType=ai-planner-full 필터를 보내고, plan_generated 는 아예 없다', async () => {
    const f = fetchOkSequence([10, 8, 4, 3, 2]);
    vi.stubGlobal('fetch', f);
    await call(REQ);
    const bodies = f.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body).query.query);
    expect(bodies.some((b: string) => b.includes("properties.planType = 'ai-planner-full'"))).toBe(true);
    expect(bodies.every((b: string) => !b.includes('plan_generated'))).toBe(true);
  });

  it('days 파라미터가 window 계산에 반영된다 (7일 요청 → windowEnd-windowStart ≈ 7일)', async () => {
    vi.stubGlobal('fetch', fetchOkSequence([5, 4, 3, 2, 1]));
    const r = await call({ method: 'GET', headers: {}, url: '/api/admin-posthog-funnel?days=7' });
    const d = r.json.data;
    expect(d.days).toBe(7);
    const spanMs = new Date(d.windowEnd).getTime() - new Date(d.windowStart).getTime();
    expect(Math.round(spanMs / (24 * 60 * 60 * 1000))).toBe(7);
  });

  it('API 키가 응답 본문 어디에도 노출되지 않는다', async () => {
    vi.stubGlobal('fetch', fetchOkSequence([10, 8, 4, 3, 2]));
    const r = await call(REQ);
    expect(r.body).not.toContain('sk-test-secret-token');
  });
});

describe('불변식 위반 → 200 대신 500 (허위 데이터 표시 금지)', () => {
  it('기형 결과(열 부족) → FUNNEL_MALFORMED_RESULT', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ results: [[1, 2]] }) })));
    const r = await call(REQ);
    expect(r.statusCode).toBe(500);
    expect(r.json.code).toBe('FUNNEL_MALFORMED_RESULT');
  });

  it('다운스트림 > 업스트림(비단조) → FUNNEL_INVALID_NONMONOTONIC', async () => {
    vi.stubGlobal('fetch', fetchOkSequence([10, 20, 5, 4, 3]));
    const r = await call(REQ);
    expect(r.statusCode).toBe(500);
    expect(r.json.code).toBe('FUNNEL_INVALID_NONMONOTONIC');
  });
});

describe('PostHog HTTP/네트워크 실패 → 500 POSTHOG_QUERY_FAILED', () => {
  it('PostHog 가 4xx/5xx 를 반환 → 500, 원문 에러 대신 매핑된 메시지', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, text: async () => '{"detail":"nope"}' })));
    const r = await call(REQ);
    expect(r.statusCode).toBe(500);
    expect(r.json.code).toBe('POSTHOG_QUERY_FAILED');
    expect(r.json.error).not.toContain('sk-test-secret-token');
  });

  it('fetch 자체가 throw → 500 POSTHOG_QUERY_FAILED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const r = await call(REQ);
    expect(r.statusCode).toBe(500);
    expect(r.json.code).toBe('POSTHOG_QUERY_FAILED');
  });
});
