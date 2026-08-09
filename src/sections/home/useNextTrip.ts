import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';

/**
 * Next upcoming saved plan, if signed in. Same query MobileHome used, kept so a
 * returning traveller still lands on their trip instead of the pitch.
 *
 * Its own module rather than a local function in `index.tsx`, because that file
 * exports a component and mixing a non-component export into it breaks fast
 * refresh (react-refresh/only-export-components).
 *
 * The result carries the uid it was read for, and only a result whose uid
 * matches the signed-in one reaches the screen. Storing the trip on its own
 * leaked it across an account switch: inside one SPA session, A signing out and
 * B signing in makes `user` B immediately while the state still holds A's row.
 * A successful, non-empty query for B was the only thing that closed that
 * window — so a slow query kept A's title on screen for its whole duration, an
 * empty one until it resolved, and a failed one forever, because the catch
 * below deliberately does not touch state. A successful empty read is recorded
 * as that uid's null so it is a real answer, not an absence of one.
 *
 * Pinned by `tests/unit/home-next-trip-account-switch.component.test.tsx`.
 */
export type NextTrip = { title: string; dday: number; date: string };

export function useNextTrip(): NextTrip | null {
  const { user } = useAuth();
  const uid = user?.uid || null;
  const [result, setResult] = useState<{ uid: string; trip: NextTrip | null } | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'plans'), where('uid', '==', uid)));
        const now = Date.now();
        let nearest: NextTrip | null = null;
        snap.forEach((d) => {
          const data = d.data();
          const sd = data.input?.startDate;
          if (!sd) return;
          const dday = Math.ceil((new Date(sd).getTime() - now) / 86400000);
          if (dday >= 0 && (!nearest || dday < nearest.dday)) {
            nearest = { title: data.itinerary?.tour_title || 'Korea Trip', dday, date: sd };
          }
        });
        if (!cancelled) setResult({ uid, trip: nearest });
      } catch { /* silent — the home page must render without Firestore */ }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  // Derived, not reset inside the effect: signing out has to hide the strip
  // immediately, and a synchronous setState in an effect body just to clear
  // state is a cascading render (react-hooks/set-state-in-effect).
  return result && result.uid === uid ? result.trip : null;
}
