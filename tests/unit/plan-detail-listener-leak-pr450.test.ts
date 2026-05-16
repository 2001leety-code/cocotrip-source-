/**
 * PR #450 — Audit W-H16 regression slot.
 *
 * Pre-fix: src/pages/PlanDetailPage/index.tsx's onSnapshot effect
 * depended on the full Firebase User object:
 *
 *   useEffect(() => { ... onSnapshot(...) ... }, [planId, token, user, authLoading]);
 *
 * Firebase User objects can re-render with the same uid but a different
 * reference — especially after PR #449 added 50-minute periodic +
 * visibility-driven token refresh, every refresh could swap the user
 * reference. The effect would tear down the onSnapshot subscription and
 * immediately re-subscribe → leaked listener handles + redundant
 * Firestore reads on every refresh tick.
 *
 * Post-fix:
 *   const uid = user?.uid ?? null;
 *   useEffect(() => { ... use uid in closure ... }, [planId, token, uid, authLoading]);
 *
 * The effect now re-runs only when identity actually changes (logout,
 * different user). Behaviour preserved — owner-check still uses uid
 * (which is what `user.uid` was anyway).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/index.tsx'),
  'utf8',
);

describe('PR #450 W-H16 — onSnapshot effect deps use uid (stable string), not user (object ref)', () => {
  it('hoists `const uid = user?.uid ?? null` once', () => {
    expect(src).toMatch(/const\s+uid\s*=\s*user\?\.uid\s*\?\?\s*null/);
  });

  it('onSnapshot effect deps array uses uid, NOT user', () => {
    // The dep array literal after the Firestore listener useEffect must
    // contain `uid` and must NOT contain `user` (bare identifier).
    // Find the effect block by anchoring on `onSnapshot(`.
    const effectStart = src.indexOf('const unsub = onSnapshot(');
    expect(effectStart).toBeGreaterThan(-1);
    // Find the closing `}, [...]);` of this effect by searching forward.
    const depArrayMatch = src.slice(effectStart).match(/\}\s*,\s*\[(.*?)\]\s*\)\s*;/);
    expect(depArrayMatch, 'dep array must terminate the effect').not.toBeNull();
    const deps = depArrayMatch![1];
    // The dep array must include uid as a token (not part of an identifier).
    expect(deps).toMatch(/\buid\b/);
    // And must NOT include the bare `user` token (would re-run on every
    // user-object reference change).
    expect(deps).not.toMatch(/\buser\b/);
    // Other expected stable deps:
    expect(deps).toMatch(/\bplanId\b/);
    expect(deps).toMatch(/\btoken\b/);
    expect(deps).toMatch(/\bauthLoading\b/);
  });

  it('owner-check inside the snapshot callback uses uid (not user.uid via object ref)', () => {
    // The ownerCheck line should reference `uid` (the hoisted const), not
    // re-read `user.uid` inside the closure (would be stale if user ref
    // changes between renders).
    expect(src).toMatch(/const\s+ownerCheck\s*=\s*!!\(\s*uid\s+&&\s+data\.uid\s*===\s*uid\s*\)/);
  });

  it('cleanup return-unsub still in place (no listener leak path)', () => {
    expect(src).toMatch(/return\s*\(\s*\)\s*=>\s*unsub\(\)/);
  });
});

describe('PR #450 W-H16 — onSnapshot effect still wired correctly', () => {
  it('imports onSnapshot from firebase/firestore', () => {
    expect(src).toMatch(/import\s*\{[^}]*onSnapshot[^}]*\}\s*from\s*['"]firebase\/firestore['"]/);
  });

  it('subscribes to `plans/{planId}` doc', () => {
    expect(src).toMatch(/onSnapshot\(\s*doc\(\s*db\s*,\s*['"]plans['"]\s*,\s*planId\s*\)/);
  });

  it('still gates on !planId and authLoading early', () => {
    expect(src).toMatch(/if\s*\(\s*!planId\s*\)\s*\{[^}]*setError\(\s*['"]notfound['"]/);
    expect(src).toMatch(/if\s*\(\s*authLoading\s*\)\s*return/);
  });
});
