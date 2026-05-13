import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle, handleRedirectResult, db } from '@/lib/firebase';
import { useLanguage } from '@/hooks/useLanguage';
import { PhoneSignInModal } from '@/components/PhoneSignInModal';

const TEXT = {
  ko: {
    title: '로그인이 필요합니다',
    desc: '소셜 로그인으로 간편하게 시작하세요.',
    benefits: ['🗺️ 나만의 맞춤 여행 일정 저장', '📋 예약 내역 및 이용 기록 관리', '💬 24/7 고객 지원 이용'],
    google: '구글로 시작하기',
    phone: '전화번호로 계속',
    loading: '로그인 중...',
    privacy: '로그인 시 개인정보 처리방침에 동의하게 됩니다.',
  },
  en: {
    title: 'Sign in to continue',
    desc: 'Get started quickly with your social account.',
    benefits: ['🗺️ Save your personalized itineraries', '📋 Manage bookings & travel history', '💬 Access 24/7 customer support'],
    google: 'Continue with Google',
    phone: 'Continue with phone',
    loading: 'Signing in...',
    privacy: 'By signing in, you agree to our Privacy Policy.',
  },
  ja: {
    title: 'ログインしてください',
    desc: 'ソーシャルアカウントで簡単に始められます。',
    benefits: ['🗺️ カスタム旅程の保存', '📋 予約履歴の管理', '💬 24時間カスタマーサポート'],
    google: 'Googleで続ける',
    phone: '電話番号で続ける',
    loading: 'ログイン中...',
    privacy: 'ログインすると、プライバシーポリシーに同意したことになります。',
  },
  zh: {
    title: '请登录以继续',
    desc: '使用社交账号快速开始。',
    benefits: ['🗺️ 保存您的定制行程', '📋 管理预订和旅行记录', '💬 享受24/7客服支持'],
    google: '使用Google登录',
    phone: '使用电话号码登录',
    loading: '登录中...',
    privacy: '登录即表示您同意我们的隐私政策。',
  },
};

export function AuthRequired({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { language } = useLanguage();
  const location = useLocation();
  const text = TEXT[language as keyof typeof TEXT] ?? TEXT.en;
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirectChecking, setRedirectChecking] = useState(true);
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  // PR-E: 신규 가입자 needsOnboarding 체크 — null=미확인, false=완료, true=리다이렉트 필요
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

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

  // PR-E: 로그인 직후 users/{uid}.needsOnboarding 1회 fetch — true면 /onboarding 리다이렉트
  // 단, 이미 /onboarding 에 있으면 무한 루프 방지를 위해 skip
  useEffect(() => {
    if (!user?.uid) {
      setNeedsOnboarding(null);
      return;
    }
    if (location.pathname === '/onboarding') {
      setNeedsOnboarding(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;
        const flag = snap.exists() && snap.data()?.needsOnboarding === true;
        setNeedsOnboarding(flag);
      } catch (e) {
        // 네트워크 오류 시 안전하게 false 처리 — 정상 진입 허용 (기존 회원 영향 없음)
        if (!cancelled) setNeedsOnboarding(false);
        console.warn('[AuthRequired] onboarding flag check failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid, location.pathname]);

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
            disabled={googleLoading}
            className="w-full py-3.5 rounded-xl font-bold transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-3 mb-3 hover:scale-[1.02]"
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

          {/* Phone Number Button (PR #390): Google 아래 보조 옵션. LINE OIDC 는
              Identity Platform 업그레이드 필요로 후속 PR. */}
          <button
            onClick={() => { setError(null); setPhoneModalOpen(true); }}
            className="w-full py-3 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-2 mb-3 hover:scale-[1.02]"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.49a1 1 0 01-.5 1.21l-2.26 1.13a11 11 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z" />
            </svg>
            {text.phone}
          </button>

          {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
          <p className="text-[11px] text-white/55 mt-4">{text.privacy}</p>
        </div>

        {phoneModalOpen && (
          <PhoneSignInModal
            language={(language as 'ko' | 'en' | 'ja' | 'zh') in TEXT ? (language as 'ko' | 'en' | 'ja' | 'zh') : 'en'}
            onClose={() => setPhoneModalOpen(false)}
          />
        )}
      </div>
    );
  }

  // PR-E: needsOnboarding 체크 미완료(null) — 짧은 스피너 (보통 ~수십 ms)
  if (needsOnboarding === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6]">
        <div className="w-8 h-8 border-2 border-[#0f3460] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  // PR-E: needsOnboarding=true → /onboarding 으로 리다이렉트 (신규 가입자만)
  if (needsOnboarding) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
