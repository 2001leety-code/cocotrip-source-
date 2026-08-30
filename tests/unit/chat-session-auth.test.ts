import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHAT_SESSION_COOKIE,
  createChatSessionToken,
  parseChatSessionToken,
  readCookie,
} from '../../api/_shared/chat-session-auth.js';

const SECRET = 'test-chat-secret-that-is-long-enough';
const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);

describe('chat session signed ownership token', () => {
  beforeEach(() => {
    process.env.CHAT_SESSION_SIGNING_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.CHAT_SESSION_SIGNING_SECRET;
  });

  it('round-trips a guest-owned session without exposing the signing secret', () => {
    const issued = createChatSessionToken({
      ownerType: 'guest',
      ownerId: 'guest-owner-123',
      sessionId: 'sess_abcdefghijklmnopqrstuvwxyz123456',
      nowMs: NOW,
    });

    expect(issued.token).not.toContain(SECRET);
    expect(parseChatSessionToken(issued.token, NOW + 1_000)).toMatchObject({
      ok: true,
      ownerType: 'guest',
      ownerId: 'guest-owner-123',
      sessionId: 'sess_abcdefghijklmnopqrstuvwxyz123456',
    });
  });

  it('rejects tampering, expiry, and a token signed with another secret', () => {
    const issued = createChatSessionToken({
      ownerType: 'user',
      ownerId: 'firebase-user-1',
      sessionId: 'sess_abcdefghijklmnopqrstuvwxyz654321',
      nowMs: NOW,
      maxAgeSec: 60,
    });

    expect(parseChatSessionToken(`${issued.token}x`, NOW + 1_000).ok).toBe(false);
    expect(parseChatSessionToken(issued.token, NOW + 61_000).ok).toBe(false);
    process.env.CHAT_SESSION_SIGNING_SECRET = 'different-chat-secret-long-enough';
    expect(parseChatSessionToken(issued.token, NOW + 1_000).ok).toBe(false);
  });

  it('reads only the exact HttpOnly cookie name from a Cookie header', () => {
    const req = {
      headers: {
        cookie: `other=1; ${CHAT_SESSION_COOKIE}=signed.value; last=2`,
      },
    };
    expect(readCookie(req, CHAT_SESSION_COOKIE)).toBe('signed.value');
    expect(readCookie(req, 'missing')).toBe('');
  });
});
