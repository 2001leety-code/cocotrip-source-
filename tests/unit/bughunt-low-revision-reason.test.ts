/**
 * 버그헌트 LOG — log-revision-reason 쓰기 IDOR 회귀 슬롯.
 *
 * Pre-fix: 핸들러가 Bearer 토큰을 audit log 용으로만 추출(검증 실패해도 진행)하고
 * plan 소유권 검사 없이 planRef.update 로 revisionReasons 에 arrayUnion 했다 →
 * 미인증 사용자가 임의 planId 만 알면 남의 plan 문서에 reason 메타를 무제한 append
 * 가능(문서 비대화 + 운영 학습데이터 오염).
 *
 * Fix: plan 의 uid/accessToken 과 인증된 auth.uid / 요청 token 을 대조해
 * **owner 또는 유효 token 보유자만** 쓰게 한다. uid·accessToken 둘 다 없는
 * legacy 게스트 plan 만 하위호환으로 익명 허용. 비소유자 쓰기 = 403.
 *
 * 인증 방식 (recalc-transit.js 패턴):
 *   - isOwner            : verified Bearer uid === plan.uid (로그인 소유자)
 *   - hasToken           : plan.accessToken === 요청 token(body.token / x-plan-token 헤더)
 *   - unprotectedGuestPlan: !plan.uid && !plan.accessToken (legacy 게스트 → 익명 허용)
 *
 * Strategy: firebase-admin/auth(dynamic import) 와 _shared/firebase-admin.js 를
 * mock 하고 실제 핸들러를 구동해, plan 문서별로 403/200 게이트를 행동으로 검증한다.
 * 향후 리팩터가 소유권 게이트를 제거하면 이 테스트가 발화한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- mutable Firestore fake -------------------------------------------------
// 테스트마다 planDoc 을 갈아끼워 plan 문서 구조(uid/accessToken)를 제어.
let planDoc: { exists: boolean; data: Record<string, unknown> } = { exists: false, data: {} };
const updateMock = vi.fn(async () => undefined);

function fakeDb() {
  const fake: any = {};
  fake.collection = () => fake;
  fake.doc = () => fake;
  fake.get = async () => ({ exists: planDoc.exists, data: () => planDoc.data });
  fake.update = updateMock;
  return fake;
}

vi.mock('../../api/_shared/firebase-admin.js', () => ({
  initAdminDb: () => fakeDb(),
}));
vi.mock('../../api/_shared/sentry.js', () => ({
  captureError: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'TS',
    arrayUnion: (x: unknown) => ({ __arrayUnion: x }),
  },
}));

// dynamic import('firebase-admin/auth') + ('firebase-admin/app') 제어.
// verifyIdToken 은 token 문자열을 그대로 uid 로 환원(테스트 단순화).
const verifyIdTokenMock = vi.fn(async (token: string) => {
  if (token === 'BAD') throw new Error('invalid token');
  return { uid: token };
});
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ verifyIdToken: verifyIdTokenMock }),
}));
vi.mock('firebase-admin/app', () => ({
  getApps: () => [{ name: '[DEFAULT]' }],
}));

// --- res / req helpers ------------------------------------------------------
type MockRes = {
  statusCode?: number;
  headers: Record<string, string>;
  body: string;
  writeHead: (status: number, headers?: Record<string, string>) => MockRes;
  end: (s?: string | Buffer) => MockRes;
};

function makeRes(): MockRes {
  const res = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      res.statusCode = status;
      if (headers) Object.assign(res.headers, headers);
      return res;
    },
    end(s?: string | Buffer) {
      if (s != null) res.body = typeof s === 'string' ? s : s.toString('utf8');
      return res;
    },
  };
  return res;
}

function req(opts: {
  body?: Record<string, unknown>;
  auth?: string;
  planTokenHeader?: string;
} = {}) {
  const headers: Record<string, string> = { host: 'unit.test' };
  if (opts.auth) headers.authorization = opts.auth;
  if (opts.planTokenHeader) headers['x-plan-token'] = opts.planTokenHeader;
  return {
    method: 'POST',
    url: '/api/log-revision-reason',
    headers,
    body: { planId: 'plan_x', reason: 'restaurant', ...(opts.body || {}) },
  };
}

async function callHandler(r: ReturnType<typeof req>) {
  const handler = (await import('../../api/log-revision-reason.js')).default;
  const res = makeRes();
  await handler(r as any, res as any);
  return res;
}

// --- tests ------------------------------------------------------------------
describe('버그헌트 LOW — log-revision-reason 쓰기 IDOR 게이트', () => {
  beforeEach(() => {
    updateMock.mockClear();
    verifyIdTokenMock.mockClear();
  });

  it('owner(verified uid === plan.uid) → 200 + revisionReasons append', async () => {
    planDoc = { exists: true, data: { uid: 'alice', accessToken: null } };
    const res = await callHandler(req({ auth: 'Bearer alice' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, logged: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('비소유자(uid 보유 plan 인데 다른 uid) → 403 FORBIDDEN, 쓰기 안 함', async () => {
    planDoc = { exists: true, data: { uid: 'alice', accessToken: null } };
    const res = await callHandler(req({ auth: 'Bearer mallory' }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('미인증(토큰 없음) + owned plan → 403, 쓰기 안 함 (핵심 IDOR 차단)', async () => {
    planDoc = { exists: true, data: { uid: 'alice', accessToken: null } };
    const res = await callHandler(req({}));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('검증 실패 토큰(BAD) + owned plan → uid 미추출 → 403', async () => {
    planDoc = { exists: true, data: { uid: 'alice', accessToken: null } };
    const res = await callHandler(req({ auth: 'Bearer BAD' }));
    expect(res.statusCode).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('게스트 plan + 올바른 accessToken(body.token) → 200, 쓰기 함', async () => {
    planDoc = { exists: true, data: { uid: null, accessToken: 'tok-123' } };
    const res = await callHandler(req({ body: { token: 'tok-123' } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, logged: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('게스트 plan + 올바른 accessToken(x-plan-token 헤더) → 200', async () => {
    planDoc = { exists: true, data: { uid: null, accessToken: 'tok-123' } };
    const res = await callHandler(req({ planTokenHeader: 'tok-123' }));
    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('게스트 plan + 틀린 accessToken → 403, 쓰기 안 함', async () => {
    planDoc = { exists: true, data: { uid: null, accessToken: 'tok-123' } };
    const res = await callHandler(req({ body: { token: 'wrong' } }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('게스트 plan + accessToken 미전달 → 403 (남의 게스트 plan 무단 쓰기 차단)', async () => {
    planDoc = { exists: true, data: { uid: null, accessToken: 'tok-123' } };
    const res = await callHandler(req({}));
    expect(res.statusCode).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('legacy 게스트 plan(uid·accessToken 둘 다 없음) → 익명 허용 200 (하위호환)', async () => {
    planDoc = { exists: true, data: { uid: null, accessToken: null } };
    const res = await callHandler(req({}));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, logged: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('owner 가 token 도 같이 보내도 200 (owner 경로 보존)', async () => {
    planDoc = { exists: true, data: { uid: 'alice', accessToken: null } };
    const res = await callHandler(req({ auth: 'Bearer alice', body: { token: 'irrelevant' } }));
    expect(res.statusCode).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('존재하지 않는 plan → 404 (게이트 이전 단계 보존)', async () => {
    planDoc = { exists: false, data: {} };
    const res = await callHandler(req({ auth: 'Bearer alice' }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false, code: 'PLAN_NOT_FOUND' });
    expect(updateMock).not.toHaveBeenCalled();
  });
});
