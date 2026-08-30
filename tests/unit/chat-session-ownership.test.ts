import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyIdentity = vi.fn();
vi.mock('../../api/_shared/user-auth.js', () => ({
  verifyFirebaseIdentityToken: (...args: unknown[]) => verifyIdentity(...args),
}));

const {
  CHAT_SESSION_COOKIE,
  authorizeChatSessionRead,
  checkChatPollRateLimit,
  resolveChatSessionForPost,
} = await import('../../api/_shared/chat-session-auth.js');

function responseRecorder() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
  };
}

function cookieHeader(setCookie: string) {
  return setCookie.split(';')[0];
}

describe('chat session ownership resolution', () => {
  beforeEach(() => {
    process.env.CHAT_SESSION_SIGNING_SECRET = 'test-chat-secret-that-is-long-enough';
    verifyIdentity.mockReset();
    verifyIdentity.mockImplementation(async (req: { headers?: Record<string, string> }) => {
      const header = req.headers && req.headers.authorization;
      if (header === 'Bearer user-one-token') return { ok: true, uid: 'user-one' };
      if (header === 'Bearer user-two-token') return { ok: true, uid: 'user-two' };
      return { ok: false, status: 401, error: 'bad token' };
    });
  });

  afterEach(() => {
    delete process.env.CHAT_SESSION_SIGNING_SECRET;
  });

  it('issues a server-owned guest session and rejects a guessed sessionId', async () => {
    const issuedRes = responseRecorder();
    const issued = await resolveChatSessionForPost({ headers: {} }, issuedRes);
    expect(issued).toMatchObject({ ok: true, ownerType: 'guest', uid: null });

    const setCookie = issuedRes.headers.get('set-cookie') || '';
    expect(setCookie).toContain(`${CHAT_SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const readReq = { headers: { cookie: cookieHeader(setCookie) } };
    const allowed = await authorizeChatSessionRead(readReq, responseRecorder(), issued.sessionId);
    expect(allowed).toMatchObject({ ok: true, ownerType: 'guest' });

    const guessed = await authorizeChatSessionRead(
      readReq,
      responseRecorder(),
      'sess_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
    );
    expect(guessed).toMatchObject({ ok: false, status: 403, code: 'SESSION_FORBIDDEN' });
  });

  it('binds a signed-in session to verified Firebase uid and denies a different uid', async () => {
    const issuedRes = responseRecorder();
    const issued = await resolveChatSessionForPost(
      { headers: { authorization: 'Bearer user-one-token' } },
      issuedRes,
    );
    expect(issued).toMatchObject({ ok: true, ownerType: 'user', uid: 'user-one' });
    const cookie = cookieHeader(issuedRes.headers.get('set-cookie') || '');

    const ownerRead = await authorizeChatSessionRead(
      { headers: { authorization: 'Bearer user-one-token', cookie } },
      responseRecorder(),
      issued.sessionId,
    );
    expect(ownerRead).toMatchObject({ ok: true, uid: 'user-one' });

    const otherRead = await authorizeChatSessionRead(
      { headers: { authorization: 'Bearer user-two-token', cookie } },
      responseRecorder(),
      issued.sessionId,
    );
    expect(otherRead).toMatchObject({ ok: false, status: 403, code: 'SESSION_FORBIDDEN' });
  });

  it('does not downgrade an invalid Firebase bearer token to a guest', async () => {
    const result = await resolveChatSessionForPost(
      { headers: { authorization: 'Bearer forged-token' } },
      responseRecorder(),
    );
    expect(result).toMatchObject({ ok: false, status: 401 });
  });
});
describe('chat poll server rate limit', () => {
  it('allows 30 polls per minute for one owner and rejects the 31st', async () => {
    let stored: Record<string, number> | null = null;
    const db = {
      collection: () => ({ doc: () => ({ id: 'rate-doc' }) }),
      runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        get: async () => ({
          exists: !!stored,
          data: () => stored,
        }),
        set: (_ref: unknown, value: Record<string, number>) => { stored = value; },
      }),
    };

    for (let i = 0; i < 30; i++) {
      await expect(checkChatPollRateLimit(db, 'user:one', 1_000)).resolves.toMatchObject({ ok: true });
    }
    await expect(checkChatPollRateLimit(db, 'user:one', 1_000)).resolves.toMatchObject({
      ok: false,
      status: 429,
    });
  });
});
