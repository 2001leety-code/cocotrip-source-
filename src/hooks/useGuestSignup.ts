// 게스트 → 회원 전환 넛지(GuestSignupNudge)의 Google 로그인 핸들러 (2026-08-19 PayPalBookingButton → 2026-10-24 공용 훅).
//   결제 흐름의 loading/error 와는 별개 상태 — 결제 로직에 영향 없음(추가 UI 전용).
//   성공 시 useAuth 의 onAuthStateChanged 가 user 를 채워 넛지가 자동으로 사라진다.
import { useCallback, useState } from 'react';
import { signInWithGoogle } from '@/lib/firebase-auth';

export function useGuestSignup() {
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const handleGuestSignup = useCallback(async () => {
    setSignupError(null);
    setSignupLoading(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setSignupError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setSignupLoading(false);
    }
  }, []);
  return { signupLoading, signupError, handleGuestSignup };
}
