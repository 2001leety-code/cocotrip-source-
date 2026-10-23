/**
 * 공용 HMAC 서명(api/_shared/hmac-sign.js, 2026-10-23 추출) + chat-session-auth 호환.
 * 잠그는 것: 비밀 폴백 순서·32자 하한 · 형식→서명→파싱 순서 · 비밀 분리(목적별 env) ·
 *   chat 세션 쿠키가 추출 전과 같은 형식(base64url(JSON).HMAC)으로 왕복.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createSignedToken, verifySignedToken, signingSecret } from '../../api/_shared/hmac-sign.js';
import { createChatSessionToken, parseChatSessionToken } from '../../api/_shared/chat-session-auth.js';

const KEYS = ['CHAT_SESSION_SIGNING_SECRET', 'BOOKING_MANAGE_SIGNING_SECRET', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'FIREBASE_PRIVATE_KEY'];
const saved: Record<string, string | undefined> = {};
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('signingSecret', () => {
  it('purpose env → GOOGLE_SERVICE_ACCOUNT_KEY → FIREBASE_PRIVATE_KEY', () => {
    process.env.FIREBASE_PRIVATE_KEY = C;
    expect(signingSecret('X_SECRET')).toBe(C);
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = B;
    expect(signingSecret('X_SECRET')).toBe(B);
    process.env.X_SECRET = A;
    expect(signingSecret('X_SECRET')).toBe(A);
    delete process.env.X_SECRET;
  });

  it('throws below 32 chars, with the label in the message', () => {
    process.env.FIREBASE_PRIVATE_KEY = 'short';
    expect(() => signingSecret('X_SECRET', 'chat session signing')).toThrow('chat session signing secret unavailable');
  });
});

describe('createSignedToken / verifySignedToken', () => {
  const OPTS = { secretEnv: 'BOOKING_MANAGE_SIGNING_SECRET' };

  it('round-trips the payload', () => {
    process.env.BOOKING_MANAGE_SIGNING_SECRET = A;
    const token = createSignedToken({ a: 1 }, OPTS);
    expect(verifySignedToken(token, OPTS)).toEqual({ ok: true, payload: { a: 1 } });
  });

  it('format → FORMAT, tampered payload or signature → SIGNATURE, missing secret → INVALID (never throws)', () => {
    process.env.BOOKING_MANAGE_SIGNING_SECRET = A;
    const token = createSignedToken({ a: 1 }, OPTS);
    const [p, s] = token.split('.');
    expect(verifySignedToken('nodot', OPTS)).toMatchObject({ ok: false, code: 'FORMAT' });
    expect(verifySignedToken(`${p}.`, OPTS)).toMatchObject({ ok: false, code: 'FORMAT' });
    const other = Buffer.from(JSON.stringify({ a: 2 })).toString('base64url');
    expect(verifySignedToken(`${other}.${s}`, OPTS)).toMatchObject({ ok: false, code: 'SIGNATURE' });
    expect(verifySignedToken(`${p}.${s.slice(0, -1)}${s.endsWith('A') ? 'B' : 'A'}`, OPTS)).toMatchObject({ ok: false, code: 'SIGNATURE' });
    delete process.env.BOOKING_MANAGE_SIGNING_SECRET;
    expect(verifySignedToken(token, OPTS)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('a non-object payload with a valid signature is FORMAT', () => {
    process.env.BOOKING_MANAGE_SIGNING_SECRET = A;
    const token = createSignedToken([1, 2], OPTS);
    expect(verifySignedToken(token, OPTS)).toMatchObject({ ok: false, code: 'FORMAT' });
  });

  it('purpose secrets are separate — a chat-signed token does not verify as a booking token', () => {
    process.env.CHAT_SESSION_SIGNING_SECRET = A;
    process.env.BOOKING_MANAGE_SIGNING_SECRET = B;
    const chat = createSignedToken({ a: 1 }, { secretEnv: 'CHAT_SESSION_SIGNING_SECRET' });
    expect(verifySignedToken(chat, OPTS)).toMatchObject({ ok: false, code: 'SIGNATURE' });
  });
});

describe('chat-session-auth compatibility', () => {
  it('cookie format unchanged: base64url(JSON) + "." + HMAC-SHA256(base64url) with CHAT_SESSION_SIGNING_SECRET', () => {
    process.env.CHAT_SESSION_SIGNING_SECRET = A;
    const nowMs = 1_800_000_000_000;
    const { token, sessionId } = createChatSessionToken({ ownerType: 'guest', ownerId: 'g1', nowMs });
    const [p, s] = token.split('.');
    expect(s).toBe(createHmac('sha256', A).update(p, 'utf8').digest('base64url'));
    expect(JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))).toMatchObject({ v: 1, sid: sessionId, typ: 'guest', sub: 'g1', iat: nowMs });
    expect(parseChatSessionToken(token, nowMs + 1000)).toMatchObject({ ok: true, sessionId, ownerType: 'guest', ownerId: 'g1' });
  });

  it('a token signed by the pre-extraction code path (same HMAC) still parses', () => {
    process.env.FIREBASE_PRIVATE_KEY = C;
    const nowMs = 1_800_000_000_000;
    const payload = { v: 1, sid: `sess_${'x'.repeat(32)}`, typ: 'user', sub: 'uid1', iat: nowMs, exp: nowMs + 60_000 };
    const enc = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const legacy = `${enc}.${createHmac('sha256', C).update(enc, 'utf8').digest('base64url')}`;
    expect(parseChatSessionToken(legacy, nowMs)).toMatchObject({ ok: true, ownerType: 'user', ownerId: 'uid1' });
  });

  it('expired / tampered chat tokens fail; missing secret on create throws the same message', () => {
    process.env.CHAT_SESSION_SIGNING_SECRET = A;
    const nowMs = 1_800_000_000_000;
    const { token } = createChatSessionToken({ ownerType: 'user', ownerId: 'u', nowMs, maxAgeSec: 10 });
    expect(parseChatSessionToken(token, nowMs + 11_000)).toEqual({ ok: false });
    expect(parseChatSessionToken(`${token}x`, nowMs)).toEqual({ ok: false });
    delete process.env.CHAT_SESSION_SIGNING_SECRET;
    expect(() => createChatSessionToken({ ownerType: 'user', ownerId: 'u' })).toThrow('chat session signing secret unavailable');
  });
});
