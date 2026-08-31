import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REQUIRED_ADMIN_SOURCES,
  runApiHealthCheck,
  validateAdminOpsPayload,
  validateErrorPayload,
} from '../../scripts/api-health-check.mjs';

const healthySources = () => REQUIRED_ADMIN_SOURCES.map((key) => ({ key, ok: true, count: 0 }));
const payload = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    partialErrors: [],
    sources: healthySources(),
    ...overrides,
  },
});

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const healthEnv = {
  FIREBASE_WEB_API_KEY: 'fake-web-key',
  HEALTH_CHECK_EMAIL: 'health@example.test',
  HEALTH_CHECK_PASSWORD: 'fake-password',
};

const EXPECTED_ADMIN_SOURCES = [
  'bookings',
  'pending_bookings',
  'mood_bookings',
  'charter_inquiries',
  'pending_free_claims',
  'cs_tickets',
  'payment_reviews',
  'decision_queue',
  'runtime_flags',
  'pending_processor_retries',
  'pending_email_retries',
  'pending_ai_planner_retries',
].sort();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('API health 현재 운영 계약', () => {
  it('필수 원본 계약은 이름까지 정확히 12개로 고정한다', () => {
    expect(REQUIRED_ADMIN_SOURCES).toHaveLength(12);
    expect([...REQUIRED_ADMIN_SOURCES].sort()).toEqual(EXPECTED_ADMIN_SOURCES);
  });

  it('필수 원본 12개가 모두 건강하면 건수가 0이어도 통과한다', () => {
    expect(validateAdminOpsPayload(payload())).toEqual({ ok: true, reason: '' });
  });

  it('HTTP 200 응답이어도 partialErrors가 있으면 실패한다', () => {
    const result = validateAdminOpsPayload(payload({ partialErrors: ['bookings'] }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('source failure: bookings');
  });

  it('필수 원본이 누락·중복되면 실패한다', () => {
    const missing = healthySources().slice(1);
    expect(validateAdminOpsPayload(payload({ sources: missing })).ok).toBe(false);

    const duplicated = [...healthySources().slice(1), healthySources()[1]];
    expect(validateAdminOpsPayload(payload({ sources: duplicated })).ok).toBe(false);
  });

  it('원본 하나라도 ok:false면 실패한다', () => {
    const sources = healthySources();
    sources[5] = { ...sources[5], ok: false };
    const result = validateAdminOpsPayload(payload({ sources }));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('source not healthy: cs_tickets');
  });

  it('예상하지 않은 원본 키와 응답 속 개인정보를 오류 문구에 반사하지 않는다', () => {
    const secretText = 'customer@example.com / booking-123 / KRW 999999';
    const sources = [...healthySources(), { key: secretText, ok: false }];
    const result = validateAdminOpsPayload(payload({ sources, error: secretText }));
    expect(result.ok).toBe(false);
    expect(result.reason).not.toContain(secretText);
    expect(result.reason).not.toContain('999999');
  });

  it('보안·NOT_FOUND 계약은 HTTP 상태뿐 아니라 ok:false와 code가 정확해야 한다', () => {
    expect(validateErrorPayload({ ok: false, code: 'AUTH_REQUIRED' }, 'AUTH_REQUIRED').ok).toBe(true);
    expect(validateErrorPayload({ ok: true, code: 'AUTH_REQUIRED' }, 'AUTH_REQUIRED').ok).toBe(false);
    expect(validateErrorPayload({ ok: false, code: 'OTHER' }, 'AUTH_REQUIRED').ok).toBe(false);
  });

  it('현재 계약 전체를 통과하며 토큰·이메일·비밀번호·응답 본문을 로그에 남기지 않는다', async () => {
    const secretToken = 'secret-id-token';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) return jsonResponse({ idToken: secretToken });
      if (url.endsWith('/api/admin-ai-ops-center?limit=1')) return jsonResponse(payload());
      if (url.endsWith('/api/my-bookings')) {
        return jsonResponse({ ok: false, code: 'AUTH_REQUIRED', error: healthEnv.HEALTH_CHECK_EMAIL }, 401);
      }
      if (url.includes('/api/plan-status?')) return jsonResponse({ ok: false, code: 'NOT_FOUND' }, 404);
      if (url.endsWith('/sw.js')) {
        return new Response('addEventListener("push" showNotification notificationclick', { status: 200 });
      }
      if (init?.method === 'HEAD') return new Response('', { status: 200 });
      throw new Error(`unexpected test URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runApiHealthCheck({ env: healthEnv, baseUrl: 'https://test.invalid' })).resolves.toBeUndefined();
    const adminCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/api/admin-ai-ops-center'));
    expect(adminCall?.[1]?.headers).toEqual({ Authorization: `Bearer ${secretToken}` });

    const printed = log.mock.calls.flat().join(' ');
    for (const secret of [secretToken, ...Object.values(healthEnv), 'AUTH_REQUIRED']) {
      expect(printed).not.toContain(secret);
    }
  });

  it('부분 장애는 HTTP 200이어도 전체 검사를 실패시키고 알려진 원본 키만 노출한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('identitytoolkit.googleapis.com')) return jsonResponse({ idToken: 'secret-id-token' });
      if (url.endsWith('/api/admin-ai-ops-center?limit=1')) {
        return jsonResponse(payload({
          partialErrors: ['bookings'],
          error: 'customer@example.com / booking-123 / KRW 999999',
        }));
      }
      throw new Error('the runner must stop at the failed admin probe');
    }));

    await expect(runApiHealthCheck({ env: healthEnv, baseUrl: 'https://test.invalid' }))
      .rejects.toThrow('admin-ai-ops-center: source failure: bookings');
  });

  it('필수 Secret이 하나라도 없으면 네트워크 호출 전에 실패한다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(runApiHealthCheck({
      env: { ...healthEnv, HEALTH_CHECK_PASSWORD: '' },
      baseUrl: 'https://test.invalid',
    })).rejects.toThrow('HEALTH_CHECK_PASSWORD secret is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
