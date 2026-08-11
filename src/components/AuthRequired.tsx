import { useState, useCallback, useEffect, lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle, signInWithLine, handleRedirectResult } from '@/lib/firebase';
import { useLanguage } from '@/hooks/useLanguage';
// P317 (2026-05-30): lazy-load phone sign-in modal (firebase phone auth) —
// keep it out of eager bundles; the chunk loads only when the user opens it.
const PhoneSignInModal = lazy(() =>
  import('@/components/PhoneSignInModal').then((m) => ({ default: m.PhoneSignInModal })),
);

const TEXT = {
  ko: {
    title: '로그인이 필요합니다',
    desc: '소셜 로그인으로 간편하게 시작하세요.',
    benefits: ['🗺️ 나만의 맞춤 여행 일정 저장', '📋 예약 내역 및 이용 기록 관리', '💬 평일 10~18시 고객 지원 이용'],
    google: '구글로 시작하기',
    line: 'LINE으로 계속',
    phone: '전화번호로 계속',
    loading: '로그인 중...',
    privacy: '로그인 시 개인정보 처리방침에 동의하게 됩니다.',
  },
  en: {
    title: 'Sign in to continue',
    desc: 'Get started quickly with your social account.',
    benefits: ['🗺️ Save your personalized itineraries', '📋 Manage bookings & travel history', '💬 Weekday support, 10am–6pm KST'],
    google: 'Continue with Google',
    line: 'Continue with LINE',
    phone: 'Continue with phone',
    loading: 'Signing in...',
    privacy: 'By signing in, you agree to our Privacy Policy.',
  },
  ja: {
    title: 'ログインしてください',
    desc: 'ソーシャルアカウントで簡単に始められます。',
    benefits: ['🗺️ カスタム旅程の保存', '📋 予約履歴の管理', '💬 平日10時~18時のカスタマーサポート'],
    google: 'Googleで続ける',
    line: 'LINEで続ける',
    phone: '電話番号で続ける',
    loading: 'ログイン中...',
    privacy: 'ログインすると、プライバシーポリシーに同意したことになります。',
  },
  zh: {
    title: '请登录以继续',
    desc: '使用社交账号快速开始。',
    benefits: ['🗺️ 保存您的定制行程', '📋 管理预订和旅行记录', '💬 工作日10-18点客服支持'],
    google: '使用Google登录',
    line: '使用LINE登录',
    phone: '使用电话号码登录',
    loading: '登录中...',
    privacy: '登录即表示您同意我们的隐私政策。',
  },
};

export function AuthRequired({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { language } = useLanguage();
  const text = TEXT[language as keyof typeof TEXT] ?? TEXT.en;
  const [googleLoading, setGoogleLoading] = useState(false);
  const [lineLoading, setLineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirectChecking, setRedirectChecking] = useState(true);
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);

  // PR #403 (2026-05-13): LINE 버튼 feature flag — Email permission 심사 통과 전까지 숨김.
  // 운영자 Vercel env 에 `VITE_LINE_OIDC_ENABLED=true` 등록 시 노출. 기본값 = 숨김.
  // 배경: LINE Login channel 의 email permission 신청 ~1주일 심사. 그 전까지 LINE 로그인 시
  // email scope 거부 → Firebase 가 임의 uid 부여 → 사용자 식별/CS 연결 어려움. UX 차원 차단.
  // 심사 통과 후 운영자가 env 만 변경 → 재배포 → LINE 버튼 즉시 노출 (코드 변경 X).
  const LINE_ENABLED = import.meta.env.VITE_LINE_OIDC_ENABLED === 'true';

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

  // LINE OIDC (PR #396): Identity Platform + Firebase OIDC provider 등록 후 작동.
  // 미등록 시 auth/operation-not-allowed 에러 → 일반 에러 메시지 노출.
  const handleLine = useCallback(async () => {
    setError(null);
    setLineLoading(true);
    try { await signInWithLine(); } catch (e) { setError(e instanceof Error ? e.message : 'LINE login failed'); }
    finally { setLineLoading(false); }
  }, []);

  // Firebase auth 초기화 OR redirect 처리 중엔 스피너 표시
  if (loading || redirectChecking) {
    return (
      <div className="cocotrip-mobile-auth min-h-screen flex items-center justify-center bg-[#faf9f6]">
        <div className="w-8 h-8 border-2 border-[#0f3460] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }


  if (!user) {
    return (
      <div className="cocotrip-mobile-auth min-h-screen flex items-center justify-center p-6"
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

          {/* LINE Button (PR #396): Google 아래 보조 옵션. 일본/대만/홍콩 사용자.
              Identity Platform 업그레이드 + Firebase OIDC provider 등록 후 작동.
              PR #403: Email permission 심사 통과 전까지 숨김 (VITE_LINE_OIDC_ENABLED env flag). */}
          {LINE_ENABLED && (
            <button
              onClick={handleLine}
              disabled={lineLoading}
              className="w-full py-3 rounded-xl font-medium transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2 mb-3 hover:scale-[1.02]"
              style={{ background: '#06C755', color: '#fff', boxShadow: '0 2px 12px rgba(6,199,85,0.25)' }}
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 5.78 2 10.444c0 4.18 3.553 7.683 8.354 8.348.325.07.768.214.88.491.1.252.066.647.032.901l-.142.852c-.044.252-.2.987.865.538 1.066-.449 5.751-3.387 7.844-5.797C20.97 14.171 22 12.434 22 10.444 22 5.78 17.523 2 12 2zM8.072 13.108H6.116c-.286 0-.518-.232-.518-.519V8.781c0-.287.232-.519.518-.519.286 0 .519.232.519.519v3.29h1.437c.287 0 .519.232.519.518 0 .287-.232.519-.519.519zm2.057 0c-.287 0-.519-.232-.519-.519V8.781c0-.287.232-.519.519-.519.286 0 .518.232.518.519v3.808c0 .287-.232.519-.518.519zm4.575 0c-.215 0-.4-.13-.477-.323L13.014 10.7v1.889c0 .287-.232.519-.518.519-.287 0-.519-.232-.519-.519V8.781c0-.222.142-.42.355-.493.213-.075.45-.012.595.156.018.022 1.227 1.658 1.255 1.694l1.226 2.103V8.781c0-.287.232-.519.519-.519.286 0 .518.232.518.519v3.808c0 .287-.232.519-.518.519zm3.158-2.434c.287 0 .519.232.519.518 0 .287-.232.519-.519.519h-1.437v.879h1.437c.287 0 .519.232.519.518 0 .287-.232.519-.519.519H16.31c-.286 0-.518-.232-.518-.519V8.781c0-.287.232-.519.518-.519h1.956c.286 0 .518.232.518.519 0 .286-.232.518-.518.518H16.83v.876h1.437z"/>
              </svg>
              {lineLoading ? text.loading : text.line}
            </button>
          )}

          {/* Phone Number Button (PR #390): Google + LINE 아래 보조 옵션. */}
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
          <Suspense fallback={null}>
            <PhoneSignInModal
              language={(language as 'ko' | 'en' | 'ja' | 'zh') in TEXT ? (language as 'ko' | 'en' | 'ja' | 'zh') : 'en'}
              onClose={() => setPhoneModalOpen(false)}
            />
          </Suspense>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
