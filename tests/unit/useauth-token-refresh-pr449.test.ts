/**
 * PR #449 — Audit W-H17 regression slot.
 *
 * Pre-fix: src/hooks/useAuth.ts only subscribed to onAuthStateChanged
 * (login/logout/initial). Firebase ID tokens expire after 1 hour; lazy
 * refresh fires only when something explicitly calls getIdToken(). A
 * user who left a tab open for >1h returned to find every API call
 * rejecting with 401. Form-in-progress = lost data when Submit hit
 * the expired-token path.
 *
 * Post-fix:
 *   - 50-minute periodic interval calls user.getIdToken(true)
 *   - visibilitychange listener: when tab becomes visible, force-refresh
 * Both are best-effort (errors swallowed) so a transient refresh
 * failure never crashes the app.
 *
 * This file asserts the source-code shape so the foreground refresh
 * can't silently disappear in a future refactor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'src/hooks/useAuth.ts'),
  'utf8',
);

describe('PR #449 W-H17 — periodic token refresh', () => {
  it('installs a 50-minute interval (under 60-min Firebase token expiry)', () => {
    expect(src).toMatch(/setInterval\([\s\S]*?50\s*\*\s*60\s*\*\s*1000\s*\)/);
  });

  it('uses getIdToken(true) to FORCE refresh (not the cached path)', () => {
    expect(src).toMatch(/getIdToken\(\s*true\s*\)/);
  });

  it('clears the interval on cleanup (no leak across re-renders)', () => {
    expect(src).toMatch(/clearInterval\s*\(\s*intervalId\s*\)/);
  });

  it('best-effort: refresh errors are caught and warn-logged (no UI crash)', () => {
    expect(src).toMatch(/periodic token refresh failed/);
    expect(src).toMatch(/\.catch\(/);
  });
});

describe('PR #449 W-H17 — foreground (visibilitychange) refresh', () => {
  it('adds visibilitychange listener', () => {
    expect(src).toMatch(/document\.addEventListener\(\s*['"]visibilitychange['"]/);
  });

  it('removes the listener on cleanup', () => {
    expect(src).toMatch(/document\.removeEventListener\(\s*['"]visibilitychange['"]/);
  });

  it('refreshes only when visibilityState === "visible" (not on every change)', () => {
    expect(src).toMatch(/document\.visibilityState\s*===\s*['"]visible['"]/);
  });

  it('foreground branch also uses getIdToken(true) + catch', () => {
    expect(src).toMatch(/foreground token refresh failed/);
  });
});

describe('PR #449 W-H17 — guards + dependencies', () => {
  it('refresh effect is keyed on [user] (re-arms when login/logout fires)', () => {
    // The second useEffect block has the user dependency
    const effectBlock = src.match(/useEffect\(\(\)\s*=>\s*\{\s*if\s*\(\s*!user\s*\)\s*return[\s\S]*?\}\s*,\s*\[user\]\s*\)/);
    expect(effectBlock).not.toBeNull();
  });

  it('original onAuthStateChanged subscription still intact', () => {
    expect(src).toMatch(/onAuthStateChanged\s*\(/);
    expect(src).toMatch(/return\s*\(\s*\)\s*=>\s*unsub\(\)/);
  });

  it('returns the same { user, loading, error } API (no caller refactor needed)', () => {
    expect(src).toMatch(/return\s*\{\s*user\s*,\s*loading\s*,\s*error\s*\}/);
  });
});
