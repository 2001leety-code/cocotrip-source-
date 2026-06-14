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

  it('owner-check uses a stable viewer uid param (not user.uid via object ref)', () => {
    // PR #450 invariant: ownerCheck must compare against a STABLE identity
    // (the hoisted `uid` const), never re-read `user.uid` inside the closure
    // (would be stale if the user object ref changes between renders).
    //
    // feat/guest-anon-auth-pii (2026-06-15): ownerCheck moved into a
    // `handleSnap(data, viewerUid)` helper so the login/legacy path can pass
    // the hoisted `uid` while the isolated guest-anon path passes the
    // anonymous uid. The invariant (stable identity, no user-object re-read)
    // is unchanged — only the parameter name.
    expect(src).toMatch(/const\s+ownerCheck\s*=\s*!!\(\s*viewerUid\s*&&\s+data\.uid\s*===\s*viewerUid\s*\)/);
    // login/legacy path must feed the hoisted stable `uid` into handleSnap.
    expect(src).toMatch(/handleSnap\(\s*snap\.data\(\)[^,]*,\s*uid\s*\)/);
    // never re-read the user object's uid inside the snapshot closure.
    expect(src).not.toMatch(/data\.uid\s*===\s*user\.uid/);
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
