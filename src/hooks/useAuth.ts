import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '@/lib/firebase';

/**
 * Firebase Auth wrapper.
 *
 * PR #449 (Audit W-H17 — 2026-05-16): proactive token refresh.
 *
 * Pre-fix: this hook only subscribed to onAuthStateChanged (login/logout
 * events). Firebase ID tokens expire after 1 hour; lazy refresh fires
 * only when something explicitly calls getIdToken(). A user who left
 * the tab open for >1h returned to find every API call rejecting
 * with 401 — they were "logged in" in the UI but every request hit
 * authFetch's expired-token path. Worst case: a user filling out a
 * form for an hour pressed Submit, got 401, and lost the data.
 *
 * Post-fix:
 *   - 50-minute interval calls user.getIdToken(true) (forces refresh
 *     under the 1h expiry)
 *   - visibilitychange listener: when the tab becomes visible (user
 *     returns from another tab / wakes laptop), force a refresh so
 *     the next API call uses a fresh token
 * Both are best-effort (errors swallowed) — the hook never crashes
 * the app on a transient refresh failure.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        setUser(u);
        setLoading(false);
      },
      (e) => {
        setError(e?.message ?? 'Auth listener error');
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // PR #449 (W-H17): proactive token refresh — periodic + visibility-driven.
  useEffect(() => {
    if (!user) return undefined;

    // 50-minute periodic refresh (Firebase tokens expire at 60min).
    const intervalId = window.setInterval(() => {
      user.getIdToken(true).catch((e) => {
        // Best-effort — next API call's authFetch will retry refresh
        // and the user sees no disruption unless creds are truly revoked.
        console.warn('[useAuth] periodic token refresh failed:', e?.message ?? e);
      });
    }, 50 * 60 * 1000);

    // Foreground refresh — tab becomes visible after being hidden long
    // enough for the token to have expired.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        user.getIdToken(true).catch((e) => {
          console.warn('[useAuth] foreground token refresh failed:', e?.message ?? e);
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user]);

  return { user, loading, error };
}
