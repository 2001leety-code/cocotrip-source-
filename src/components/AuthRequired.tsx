import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle, signInWithApple, signInWithLine, handleRedirectResult } from '@/lib/firebase';
import { useLanguage } from '@/hooks/useLanguage';

const TEXT = {
  ko: {
    title: '로그인이 필요합니다',
    desc: '소셜 로그인으로 간편하게 시작하세요.',
    benefits: ['🗺️ 나만의 맞춤 여행 일정 저장', '📋 예약 내역 및 이용 기록 관리', '💬 24/7 고객 지원 이용'],
    google: '구글로 시작하기',
    apple: 'Apple로 시작하기',
    line: 'LINE으로 시작하기',
    loading: '로그인 중...',
    privacy: '로그인 시 개인정보 처리방침에 동의하게 됩니다.',
    lineUnavailable: 'LINE 로그인 설정이 진행 중입니다. 잠시 후 다시 시도해주세요.',
  },
  en: {
    title: 'Sign in to continue',
    desc: 'Get started quickly with your social account.',
    benefits: ['🗺️ Save your personalized itineraries', '📋 Manage bookings & travel history', '💬 Access 24/7 customer support'],
    google: 'Continue with Google',
    apple: 'Continue with Apple',
    line: 'Continue with LINE',
    loading: 'Signing in...',
    privacy: 'By signing in, you agree to our Privacy Policy.',
    lineUnavailable: 'LINE sign-in is being configured. Please try again shortly.',
  },
  ja: {
    title: 'ログインしてください',
    desc: 'ソーシャルアカウントで簡単に始められます。',
    benefits: ['🗺️ カスタム旅程の保存', '📋 予約履歴の管理', '💬 24時間カスタマーサポート'],
    google: 'Googleで続ける',
    apple: 'Appleで続ける',
    line: 'LINEで続ける',
    loading: 'ログイン中...',
    privacy: 'ログインすると、プライバシーポリシーに同意したことになります。',
    lineUnavailable: 'LINEログインは設定中です。しばらくしてからお試しください。',
  },
  zh: {
    title: '请登录以继续',
    desc: '使用社交账号快速开始。',
    benefits: ['🗺️ 保存您的定制行程', '📋 管理预订和旅行记录', '💬 享受24/7客服支持'],
    google: '使用Google登录',
    apple: '使用Apple登录',
    line: '使用LINE登录',
    loading: '登录中...',
    privacy: '登录即表示您同意我们的隐私政策。',
    lineUnavailable: 'LINE 登录正在配置中，请稍后重试。',
  },
};

export function AuthRequired({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { language } = useLanguage();
  const text = TEXT[language as keyof typeof TEXT] ?? TEXT.en;
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [lineLoading, setLineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirectChecking, setRedirectChecking] = useState(true);

  // signInWithRedirect 후 돌아왔을 때 결과를 처리
  // getRedirectResult()가 완료되면 onAuthStateChanged가 자동으로 user를 업데이트함
  // → redirectChecking을 user가 확정된 후 해제해야 로그인 화면이 깜빡이지 않음
  useEffect(() => {
    handleRedirectResult()
      .then((redirectUser) => {
        // redirect 로그인 성공 시 onAuthStateChanged가 곧 발火 — 별도 처리 불필요
        if (redirectUser) console.log('[AuthRequired] redirect login success:', redirectUser.email);
      })
      .catch(console.error)
      .finally(() => setRedirectChecking(false));
  }, []);

  const handleGoogle = useCallback(async () => {
    setError(null);
    setGoogleLoading(true);
    try { await signInWithGoogle(); } catch (e) { setError(e instanceof Error ? e.message : 'Login failed'); }
    finally { setGoogleLoading(false); }
  }, []);

  const handleApple = useCallback(async () => {
    setError(null);
    setAppleLoading(true);
    try { await signInWithApple(); } catch (e) { setError(e instanceof Error ? e.message : 'Login failed'); }
    finally { setAppleLoading(false); }
  }, []);

  const handleLine = useCallback(async () => {
    setError(null);
    setLineLoading(true);
    try {
      await signInWithLine();
    } catch (e) {
      // Provider 미등록 (Firebase Console 설정 안 됨) → graceful 메시지로 안내
      const msg = e instanceof Error ? e.message : 'Login failed';
      const lower = msg.toLowerCase();
      if (lower.includes('operation-not-allowed') || lower.includes('unauthorized')) {
        setError(text.lineUnavailable);
      } else {
        setError(msg);
      }
    } finally { setLineLoading(false); }
  }, [text.lineUnavailable]);

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
      <div className="min-h-screen flex items-center justify-center p-6"
        style={{ background: 'linear-gradient(160deg, #0c1220 0%, #0f2244 60%, #0a1628 100%)' }}>
        <div className="w-full max-w-sm rounded-2xl p-8 text-center"
          style={{ background: 'rgba(15,18,32,0.95)', border: '1px solid rgba(124,92,252,0.15)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
          {/* Icon */}
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', boxShadow: '0 4px 20px rgba(124,92,252,0.3)' }}>
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-1.5">{text.title}</h1>
          <p className="text-sm text-white/50 mb-5">{text.desc}</p>

          {/* Benefits */}
          <div className="text-left space-y-2.5 mb-6 p-4 rounded-xl" style={{ background: 'rgba(124,92,252,0.06)', border: '1px solid rgba(124,92,252,0.1)' }}>
            {text.benefits.map((b, i) => (
              <p key={i} className="text-[13px] text-white/70 leading-snug">{b}</p>
            ))}
          </div>

          {/* Google Button */}
          <button
            onClick={handleGoogle}
            disabled={googleLoading || appleLoading || lineLoading}
            className="w-full py-3.5 rounded-xl font-bold transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-3 mb-2.5 hover:scale-[1.02]"
            style={{ background: '#fff', color: '#1a1a2e', boxShadow: '0 2px 12px rgba(255,255,255,0.1)' }}
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {googleLoading ? text.loading : text.google}
          </button>

          {/* Apple Button */}
          <button
            onClick={handleApple}
            disabled={googleLoading || appleLoading || lineLoading}
            className="w-full py-3.5 rounded-xl font-bold transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-3 mb-2.5 hover:scale-[1.02]"
            style={{ background: '#000', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            {appleLoading ? text.loading : text.apple}
          </button>

          {/* LINE Button — 외국인 VIP 타겟 (일본·대만·태국·인도네시아 사용자) */}
          <button
            onClick={handleLine}
            disabled={googleLoading || appleLoading || lineLoading}
            className="w-full py-3.5 rounded-xl font-bold transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-3 mb-3 hover:scale-[1.02]"
            style={{ background: '#06C755', color: '#fff' }}
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
            </svg>
            {lineLoading ? text.loading : text.line}
          </button>

          {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
          <p className="text-[11px] text-white/55 mt-4">{text.privacy}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
