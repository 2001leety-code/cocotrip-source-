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
  it('Login-required gate still rejects missing userId (user-keying needs userId)', () => {
    expect(src).toMatch(/Login required/);
    expect(src).toMatch(/AUTH_REQUIRED/);
  });

  it('rate-limit check still wrapped in try/catch graceful-degrade', () => {
    expect(src).toMatch(/rate-limit check error \(allowing\)/);
  });
});

describe('PR #448 W-H14 — checkRateLimit signature still threads ip (forward-compat for IP-as-signal)', () => {
  it('checkRateLimit still accepts an ip param (so future signal-only IP logging can wire up)', () => {
    // Even though we ignore the ip arg for capping, accept it so callers
    // don't need a refactor when we add the multi-user-per-IP detection.
    expect(src).toMatch(/async\s+function\s+checkRateLimit\s*\(\s*userId\s*,\s*_?ip\s*\)/);
  });
});
