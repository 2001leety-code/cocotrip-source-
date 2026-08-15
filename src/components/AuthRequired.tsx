import { useState, useCallback, useEffect, lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { signInWithGoogle, signInWithLine, handleRedirectResult } from '@/lib/firebase';
import { useLanguage } from '@/hooks/useLanguage';
import '@/styles/editorial-auth-required.css';
// P317 (2026-05-30): lazy-load phone sign-in modal (firebase phone auth) —
// keep it out of eager bundles; the chunk loads only when the user opens it.
const PhoneSignInModal = lazy(() =>
  import('@/components/PhoneSignInModal').then((m) => ({ default: m.PhoneSignInModal })),
);

const TEXT = {
  ko: {
    account: 'CocoTrip 계정',
    title: '로그인이 필요합니다',
    desc: '소셜 로그인으로 간편하게 시작하세요.',
    benefits: ['나만의 맞춤 여행 일정 저장', '예약 내역 및 이용 기록 관리', '평일 10~18시 고객 지원 이용'],
    methods: '로그인 방법 선택',
    google: '구글로 시작하기',
    line: 'LINE으로 계속',
    phone: '전화번호로 계속',
    loading: '로그인 중...',
    checking: '계정을 확인하고 있습니다.',
    previewError: '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    privacy: '로그인 시 개인정보 처리방침에 동의하게 됩니다.',
  },
  en: {
    account: 'CocoTrip account',
    title: 'Sign in to continue',
    desc: 'Get started quickly with your social account.',
    benefits: ['Save your personalized itineraries', 'Manage bookings & travel history', 'Weekday support, 10am–6pm KST'],
    methods: 'Choose a sign-in method',
    google: 'Continue with Google',
    line: 'Continue with LINE',
    phone: 'Continue with phone',
    loading: 'Signing in...',
    checking: 'Checking your account.',
    previewError: 'Sign-in failed. Please try again in a moment.',
    privacy: 'By signing in, you agree to our Privacy Policy.',
  },
  ja: {
    account: 'CocoTripアカウント',
    title: 'ログインしてください',
    desc: 'ソーシャルアカウントで簡単に始められます。',
    benefits: ['カスタム旅程の保存', '予約履歴の管理', '平日10時~18時のカスタマーサポート'],
    methods: 'ログイン方法を選択',
    google: 'Googleで続ける',
    line: 'LINEで続ける',
    phone: '電話番号で続ける',
    loading: 'ログイン中...',
    checking: 'アカウントを確認しています。',
    previewError: 'ログインに失敗しました。しばらくしてからもう一度お試しください。',
    privacy: 'ログインすると、プライバシーポリシーに同意したことになります。',
  },
  zh: {
    account: 'CocoTrip账户',
    title: '请登录以继续',
    desc: '使用社交账号快速开始。',
    benefits: ['保存您的定制行程', '管理预订和旅行记录', '工作日10-18点客服支持'],
    methods: '选择登录方式',
    google: '使用Google登录',
    line: '使用LINE登录',
    phone: '使用电话号码登录',
    loading: '登录中...',
    checking: '正在检查您的账户。',
    previewError: '登录失败，请稍后重试。',
    privacy: '登录即表示您同意我们的隐私政策。',
  },
};

type AuthLanguage = keyof typeof TEXT;
type AuthFixture = 'signed-out' | 'loading' | 'error';

function getAuthFixture(): AuthFixture | null {
  if (!import.meta.env.DEV) return null;
  const fixture = new URLSearchParams(window.location.search).get('__authFixture');
  return fixture === 'signed-out' || fixture === 'loading' || fixture === 'error' ? fixture : null;
}

export function AuthRequired({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { language } = useLanguage();
  const copyLanguage = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as AuthLanguage;
  const text = TEXT[copyLanguage] || TEXT.en;
  const fixture = getAuthFixture();
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
    if (fixture) return;

    let active = true;
    handleRedirectResult()
      .then((redirectUser) => {
        // redirect 로그인 성공 시 onAuthStateChanged가 곧 발火 — 별도 처리 불필요
        if (redirectUser) console.log('[AuthRequired] redirect login success:', redirectUser.email);
      })
      .catch(console.error)
      .finally(() => {
        if (active) setRedirectChecking(false);
      });

    return () => {
      active = false;
    };
  }, [fixture]);

  const handleGoogle = useCallback(async () => {
    if (fixture) return;
    setError(null);
    setGoogleLoading(true);
    try { await signInWithGoogle(); } catch (e) { setError(e instanceof Error ? e.message : 'Login failed'); }
    finally { setGoogleLoading(false); }
  }, [fixture]);

  // LINE OIDC (PR #396): Identity Platform + Firebase OIDC provider 등록 후 작동.
  // 미등록 시 auth/operation-not-allowed 에러 → 일반 에러 메시지 노출.
  const handleLine = useCallback(async () => {
    if (fixture) return;
    setError(null);
    setLineLoading(true);
    try { await signInWithLine(); } catch (e) { setError(e instanceof Error ? e.message : 'LINE login failed'); }
    finally { setLineLoading(false); }
  }, [fixture]);

  const handlePhone = useCallback(() => {
    if (fixture) return;
    setError(null);
    setPhoneModalOpen(true);
  }, [fixture]);

  const visibleLoading = fixture === 'loading' || (!fixture && (loading || redirectChecking));
  const visibleUser = fixture ? null : user;
  const visibleError = fixture === 'error' ? text.previewError : error;

  // Firebase auth 초기화 OR redirect 처리 중엔 스피너 표시
  if (visibleLoading) {
    return (
      <main
        className="auth-required-shell auth-required-shell--loading ec-root"
        data-testid="auth-required-shell"
        data-state="loading"
        lang={copyLanguage}
        aria-busy="true"
      >
        <div className="auth-required-loading" role="status" aria-live="polite">
          <span className="auth-required-spinner" aria-hidden="true" />
          <span>{text.checking}</span>
        </div>
      </main>
    );
  }

  if (!visibleUser) {
    return (
      <main
        className="auth-required-shell ec-root"
        data-testid="auth-required-shell"
        data-state={visibleError ? 'error' : 'signed-out'}
        lang={copyLanguage}
        aria-labelledby="auth-required-title"
      >
        <div className="auth-required-layout">
          <section className="auth-required-introduction">
            <p className="auth-required-account ec-eyebrow">{text.account}</p>
            <h1 id="auth-required-title" className="auth-required-title">{text.title}</h1>
            <p className="auth-required-description">{text.desc}</p>
            <ul className="auth-required-benefits">
              {text.benefits.map((benefit, index) => (
                <li key={benefit}>
                  <span className="auth-required-benefit-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="auth-required-card" aria-labelledby="auth-required-methods-title">
            <div className="auth-required-card-heading">
              <span className="auth-required-card-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM5 21a7 7 0 0114 0" />
                </svg>
              </span>
              <div>
                <p className="ec-eyebrow">{text.account}</p>
                <h2 id="auth-required-methods-title">{text.methods}</h2>
              </div>
            </div>

            <div className="auth-required-actions">
              <button
                type="button"
                onClick={handleGoogle}
                disabled={googleLoading}
                className="auth-required-action auth-required-action--google"
              >
                <svg className="auth-required-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span>{googleLoading ? text.loading : text.google}</span>
              </button>

              {LINE_ENABLED && (
                <button
                  type="button"
                  onClick={handleLine}
                  disabled={lineLoading}
                  className="auth-required-action auth-required-action--line"
                >
                  <svg className="auth-required-provider-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M12 2C6.477 2 2 5.78 2 10.444c0 4.18 3.553 7.683 8.354 8.348.325.07.768.214.88.491.1.252.066.647.032.901l-.142.852c-.044.252-.2.987.865.538 1.066-.449 5.751-3.387 7.844-5.797C20.97 14.171 22 12.434 22 10.444 22 5.78 17.523 2 12 2zM8.072 13.108H6.116c-.286 0-.518-.232-.518-.519V8.781c0-.287.232-.519.518-.519.286 0 .519.232.519.519v3.29h1.437c.287 0 .519.232.519.518 0 .287-.232.519-.519.519zm2.057 0c-.287 0-.519-.232-.519-.519V8.781c0-.287.232-.519.519-.519.286 0 .518.232.518.519v3.808c0 .287-.232.519-.518.519zm4.575 0c-.215 0-.4-.13-.477-.323L13.014 10.7v1.889c0 .287-.232.519-.518.519-.287 0-.519-.232-.519-.519V8.781c0-.222.142-.42.355-.493.213-.075.45-.012.595.156.018.022 1.227 1.658 1.255 1.694l1.226 2.103V8.781c0-.287.232-.519.519-.519.286 0 .518.232.518.519v3.808c0 .287-.232.519-.518.519zm3.158-2.434c.287 0 .519.232.519.518 0 .287-.232.519-.519.519h-1.437v.879h1.437c.287 0 .519.232.519.518 0 .287-.232.519-.519.519H16.31c-.286 0-.518-.232-.518-.519V8.781c0-.287.232-.519.518-.519h1.956c.286 0 .518.232.518.519 0 .286-.232.518-.518.518H16.83v.876h1.437z"/>
                  </svg>
                  <span>{lineLoading ? text.loading : text.line}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handlePhone}
                className="auth-required-action auth-required-action--phone"
              >
                <svg className="auth-required-provider-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.95.68l1.5 4.49a1 1 0 01-.5 1.21l-2.26 1.13a11 11 0 005.52 5.52l1.13-2.26a1 1 0 011.21-.5l4.49 1.5a1 1 0 01.68.95V19a2 2 0 01-2 2h-1C9.72 21 3 14.28 3 6V5z" />
                </svg>
                <span>{text.phone}</span>
              </button>
            </div>

            {visibleError && <p className="auth-required-error" role="alert">{visibleError}</p>}
            <p className="auth-required-privacy">{text.privacy}</p>
          </section>
        </div>

        {phoneModalOpen && (
          <Suspense fallback={null}>
            <PhoneSignInModal
              language={copyLanguage}
              onClose={() => setPhoneModalOpen(false)}
            />
          </Suspense>
        )}
      </main>
    );
  }

  return <>{children}</>;
}
