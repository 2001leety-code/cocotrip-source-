/**
 * PR #448 — Audit W-H14 regression slot.
 *
 * Pre-fix: api/chat.js bucketed the daily Gemini-call cap on `ip:${ip}:${dayKey}`.
 * Vercel functions sit behind a NAT, and the `x-forwarded-for` IP collapses
 * to a shared address for users on the same coffee shop, corporate proxy,
 * or mobile-carrier NAT. One heavy user could drain the 50/day cap and
 * silently lock every other user behind the same IP. In worst cases the
 * Vercel edge itself reused a small pool of egress IPs, bucketing ALL
 * chat traffic into one counter.
 *
 * Post-fix: `userId` is already mandatory (chat.js handler ~L312 returns
 * 401 if missing), so user-id IS the real abuse-attribution unit. The
 * daily-cap doc key is now `usr:${userId}:${dayKey}`. NAT-immune.
 *
 * The 5/5min sliding window still keys on user only (unchanged) — that
 * was already correct.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'api/chat.js'),
  'utf8',
);

describe('PR #448 W-H14 — daily cap is user-keyed, not IP-keyed', () => {
  it('uses doc key `usr:${userId}:${dayKey}` for daily counter (NAT-immune)', () => {
    expect(src).toMatch(/doc\(\s*`usr:\$\{userId\}:\$\{dayKey\}`\s*\)/);
  });

  it('no longer uses `ip:${ip}:${dayKey}` doc key (the W-H14 regression line)', () => {
    expect(src).not.toMatch(/doc\(\s*`ip:\$\{ip\}:\$\{dayKey\}`\s*\)/);
  });

  it('error code reflects the user-level cap (RATE_LIMIT_USER_DAILY, not RATE_LIMIT_IP)', () => {
    expect(src).toMatch(/RATE_LIMIT_USER_DAILY/);
    // The old IP code must be gone — keeping it would let callers/UI think the
    // cap is IP-keyed when it's actually user-keyed.
    expect(src).not.toMatch(/RATE_LIMIT_IP\b/);
  });

  it('daily cap constant renamed to RATE_USER_DAILY_MAX (signals the keying)', () => {
    expect(src).toMatch(/RATE_USER_DAILY_MAX\s*=\s*50/);
    expect(src).not.toMatch(/RATE_IP_DAILY_MAX/);
  });
});

describe('PR #448 W-H14 — sliding-window per-user cap preserved', () => {
  it('keeps 5/5min user sliding window unchanged (the existing burst guard)', () => {
    expect(src).toMatch(/RATE_USER_WINDOW_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
    expect(src).toMatch(/RATE_USER_MAX\s*=\s*5/);
    expect(src).toMatch(/doc\(\s*`u:\$\{userId\}`\s*\)/);
  });
});

describe('PR #448 W-H14 — handler-level invariants', () => {
  // 2026-08-18 퍼널 감사 1번: 로그인 벽 제거 — 401 AUTH_REQUIRED 게이트는
  // 의도적으로 삭제됐다(게스트 허용). userId 는 원래 클라이언트가 보내는
  // 미검증 값이라 그 게이트는 방어가 아니었고, 실방어는 레이트리밋이다.
  // 게스트는 IP 키 일 15건 — 가짜 uid 당 50건이던 종전 구멍보다 좁다.
  it('the 401 Login-required gate is gone on purpose (guests are allowed)', () => {
    expect(src).not.toMatch(/Login required/);
  });

  it('logged-in users still cap on uid (50/day), guests on hashed IP (15/day)', () => {
    expect(src).toMatch(/RATE_GUEST_DAILY_MAX\s*=\s*15/);
    expect(src).toMatch(/RATE_LIMIT_GUEST_DAILY/);
    expect(src).toMatch(/hashIp\(ip\)/);
  });

  it('rate-limit check still wrapped in try/catch graceful-degrade', () => {
    expect(src).toMatch(/rate-limit check error \(allowing\)/);
  });
});

describe('PR #448 W-H14 — checkRateLimit signature still threads ip', () => {
  it('checkRateLimit accepts an ip param (now used as the guest rate key)', () => {
    expect(src).toMatch(/async\s+function\s+checkRateLimit\s*\(\s*userId\s*,\s*_?ip\s*\)/);
  });
});
