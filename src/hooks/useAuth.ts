import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '@/lib/firebase-auth';
import { AUTH_PROFILE_EVENT } from '@/lib/connectEmail';

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
        const message = e?.message;
        setError(message === null || message === undefined ? 'Auth listener error' : message);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // 구글 연결(linkWithPopup + reload)은 같은 User 객체에 email 을 채우고 onAuthStateChanged 를 울리지 않는다.
  // 프로필 갱신 이벤트로 다시 렌더해 user.email 을 읽는 화면이 새로고침 없이 갱신되게 한다.
  const [, setProfileVersion] = useState(0);
  useEffect(() => {
    const bump = () => setProfileVersion((v) => v + 1);
    window.addEventListener(AUTH_PROFILE_EVENT, bump);
    return () => window.removeEventListener(AUTH_PROFILE_EVENT, bump);
  }, []);

  // PR #449 (W-H17): proactive token refresh — periodic + visibility-driven.
  useEffect(() => {
    if (!user) return undefined;

    // 50-minute periodic refresh (Firebase tokens expire at 60min).
    const intervalId = window.setInterval(() => {
      user.getIdToken(true).catch((e) => {
        // Best-effort — next API call's authFetch will retry refresh
        // and the user sees no disruption unless creds are truly revoked.
        const message = e?.message;
        console.warn('[useAuth] periodic token refresh failed:', message === null || message === undefined ? e : message);
      });
    }, 50 * 60 * 1000);

    // Foreground refresh — tab becomes visible after being hidden long
    // enough for the token to have expired.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        user.getIdToken(true).catch((e) => {
          const message = e?.message;
          console.warn('[useAuth] foreground token refresh failed:', message === null || message === undefined ? e : message);
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
