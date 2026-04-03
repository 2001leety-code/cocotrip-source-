import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle, handleRedirectResult } from '@/lib/firebase';
import { useLanguage } from '@/hooks/useLanguage';

const TEXT = {
  ko: { title: '로그인이 필요합니다', desc: '이 서비스를 이용하려면 소셜 로그인이 필요합니다.', google: '구글로 시작하기', apple: 'Apple로 시작하기', loading: '로그인 중...' },
  en: { title: 'Login Required', desc: 'Please sign in to use this service.', google: 'Continue with Google', apple: 'Continue with Apple', loading: 'Signing in...' },
  ja: { title: 'ログインが必要です', desc: 'このサービスを利用するにはログインが必要です。', google: 'Googleで続ける', apple: 'Appleで続ける', loading: 'ログイン中...' },
  zh: { title: '需要登录', desc: '请登录以使用此服务。', google: '使用Google登录', apple: '使用Apple登录', loading: '登录中...' },
};

export function AuthRequired({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { language } = useLanguage();
  const text = TEXT[language as keyof typeof TEXT] ?? TEXT.en;
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirectChecking, setRedirectChecking] = useState(true);

  // signInWithRedirect 후 돌아왔을 때 결과를 처리
  useEffect(() => {
    handleRedirectResult()
      .catch(console.error)
      .finally(() => setRedirectChecking(false));
  }, []);

  const handleGoogle = useCallback(async () => {
    setError(null);
    setGoogleLoading(true);
    try { await signInWithGoogle(); } catch (e) { setError(e instanceof Error ? e.message : 'Login failed'); }
    finally { setGoogleLoading(false); }
  }, []);

  // Firebase auth 초기화 OR redirect 처리 중엔 스피너 표시
  if (loading || redirectChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6]">
        <div className="w-8 h-8 border-2 border-[#0f3460] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }


  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6] p-6">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-[#0f3460]/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[#0f3460]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[#1a1a2e] mb-2">{text.title}</h1>
          <p className="text-sm text-gray-500 mb-6">{text.desc}</p>
          <button
            onClick={handleGoogle}
            disabled={googleLoading}
            className="w-full py-3 rounded-xl bg-white border border-gray-200 text-[#1a1a2e] font-bold hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-3 mb-3"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {googleLoading ? text.loading : text.google}
          </button>
          {/* Apple 로그인 임시 비활성화 */}
          {error && <p className="text-sm text-red-500 mt-4">{error}</p>}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
