import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '@/lib/firebase';

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

  return { user, loading, error };
}

