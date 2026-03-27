import type { ReactNode } from 'react';
import { useMemo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle } from '@/lib/firebase';

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL ?? '').trim().toLowerCase();

export function AdminRoute({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user, loading, error } = useAuth();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const isAdmin = useMemo(() => {
    if (!user?.email) return false;
    if (!ADMIN_EMAIL) return false;
    return user.email.toLowerCase() === ADMIN_EMAIL;
  }, [user?.email]);

  const handleGoogleLogin = useCallback(async () => {
    setLoginError(null);
    setLoginLoading(true);
    try {
      await signInWithGoogle();
      navigate('/admin');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '로그인에 실패했습니다.';
      setLoginError(msg);
    } finally {
      setLoginLoading(false);
    }
  }, [navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6] text-[#0f3460]">
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6] p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow p-6">
          <h1 className="text-xl font-bold text-[#1a1a2e] mb-4">Admin Access</h1>
          <p className="text-sm text-gray-600 mb-6">
            관리자 페이지는 Google 로그인 후에만 접근할 수 있습니다.
          </p>
          <button
            onClick={handleGoogleLogin}
            disabled={loginLoading}
            className="w-full py-3 rounded-xl bg-[#0f3460] text-white font-bold hover:bg-[#1a1a2e] transition-colors disabled:opacity-50"
          >
            {loginLoading ? '로그인 중...' : '구글로 시작하기'}
          </button>
          {(loginError || error) ? (
            <p className="text-sm text-red-500 mt-4">{loginError ?? error}</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6] p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow p-6">
          <h1 className="text-xl font-bold text-[#1a1a2e] mb-4">Access denied</h1>
          <p className="text-sm text-gray-600">
            관리자 권한이 없습니다. 현재 계정: <span className="font-semibold">{user.email}</span>
          </p>
          {!ADMIN_EMAIL ? (
            <p className="text-sm text-red-500 mt-3">
              VITE_ADMIN_EMAIL 환경변수가 설정되지 않았습니다.
            </p>
          ) : null}
          <button
            onClick={() => navigate('/')}
            className="mt-6 w-full py-3 rounded-xl bg-white border border-gray-200 text-[#0f3460] font-bold hover:bg-gray-50 transition-colors"
          >
            홈으로
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

