/**
 * 2026-10-24 (유입·전환 점검) — 게스트 무료 3문답의 서버 집행 잠금.
 *   - 서버 상수(api/_shared/guest-chat-limit.js)와 클라이언트 게이트(src/hooks/useChatSession.ts)가 같은 값.
 *   - api/chat.js: 게스트만 서명 쿠키 sessionId 기준 KST 일 한도(키 guest-session:<sessionId>:<YYYY-MM-DD>),
 *     기존 checkRateLimit 트랜잭션 안에서 read→cap→increment, 초과 시 429 + GUEST_FREE_LIMIT. 로그인 경로 불변.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GUEST_FREE_QUESTIONS } from '../../api/_shared/guest-chat-limit.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const chat = read('api/chat.js');
const body = chat.slice(chat.indexOf('async function checkRateLimit'), chat.indexOf('\n}\n', chat.indexOf('async function checkRateLimit')));

describe('guest free questions — server constant matches the client gate', () => {
  it('both are 3', () => {
    expect(GUEST_FREE_QUESTIONS).toBe(3);
    const client = /export const GUEST_FREE_QUESTIONS = (\d+);/.exec(read('src/hooks/useChatSession.ts'));
    expect(client && Number(client[1])).toBe(GUEST_FREE_QUESTIONS);
  });
});

describe('api/chat.js — guest session daily limit inside the existing rate-limit transaction', () => {
  it('imports the shared constant', () => {
    expect(chat).toMatch(/import \{ GUEST_FREE_QUESTIONS \} from '\.\/_shared\/guest-chat-limit\.js';/);
  });
  it('guest-only key guest-session:<sessionId>:<dayKey>, read in the same transaction before any write', () => {
    expect(body).toMatch(/const guestSessionRef = isGuest && guestSessionId\s*\?\s*counterDb\.collection\('chat_rate_limits'\)\.doc\(`guest-session:\$\{guestSessionId\}:\$\{dayKey\}`\)/);
    expect(body.indexOf('tx.get(guestSessionRef)')).toBeGreaterThan(-1);
    expect(body.indexOf('tx.get(guestSessionRef)')).toBeLessThan(body.indexOf('tx.set('));
  });
  it('over the limit → GUEST_FREE_LIMIT (before the IP cap); allowed → incremented with the other counters', () => {
    expect(body).toMatch(/guestSessionCount >= GUEST_FREE_QUESTIONS\) \{\s*return \{ allowed: false, code: 'GUEST_FREE_LIMIT'/);
    expect(body.indexOf("'GUEST_FREE_LIMIT'")).toBeLessThan(body.indexOf('dailyCount >= dailyMax'));
    expect(body).toMatch(/if \(guestSessionRef\) tx\.set\(guestSessionRef, \{ c: guestSessionCount \+ 1/);
  });
  it('the caller passes the session only for guests (signed-in path unchanged) and answers 429 with the code', () => {
    expect(chat).toMatch(/await checkRateLimit\(uid, ip, uid \? '' : sessionId\)/);
    expect(chat).toMatch(/res\.writeHead\(429, \{ \.\.\.JSON_CORS, 'Retry-After': String\(rl\.retryAfter\) \}\);\s*return res\.end\(JSON\.stringify\(_err\('Too many requests\. Please wait\.', rl\.code\)\)\);/);
  });
});
