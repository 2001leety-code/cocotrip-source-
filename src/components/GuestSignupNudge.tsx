import type { Language } from '@/i18n';

/**
 * 게스트 → 회원 전환 넛지 (2026-08-19, funnel audit 후속).
 *
 * 결제 성공 오버레이의 주 CTA(View Booking)는 /my-plans?tab=bookings 로 가는데
 * 그 경로가 로그인 게이트(AuthRequired) 다. 게스트 결제(uid=null)는 이유도 모른 채
 * 로그인 벽을 만난다. 이 컴포넌트는 그 앞에서 "결제와 같은 이메일로 가입하면
 * 이 예약이 자동으로 연결된다"고 설명하고 구글 로그인 버튼을 준다.
 *
 * 순수 표시 컴포넌트 — firebase 를 직접 import 하지 않는다(테스트 용이성).
 * 로그인 실행은 onGoogleLogin prop 으로 부모(PayPalBookingButton)가 주입한다.
 *
 * ⚠️ 정직한 문구: "무조건 연결된다"고 약속하지 않는다 — /api/my-bookings.js 의
 * payerEmail 폴백 조회는 **가입 이메일이 결제 이메일과 같을 때만** 동작한다
 * (다른 이메일로 가입하면 이 예약은 안 붙는다).
 */
interface Props {
  language: Language;
  email?: string | null;
  onGoogleLogin: () => void;
  authLoading: boolean;
  authError: string | null;
}

const NUDGE_LABELS: Record<Language, { title: string; body: (email?: string | null) => string; cta: string; loading: string }> = {
  ko: {
    title: '가입하고 이 예약을 마이페이지에서 확인하세요',
    body: (email) =>
      `결제에 사용한 이메일과 같은 구글 계정으로 가입하면 이 예약이 자동으로 연결돼요${email ? ` (${email})` : ''}. 가입 시 쿠폰 3장도 드려요.`,
    cta: '구글로 계속하기',
    loading: '연결 중...',
  },
  en: {
    title: 'Sign up to see this booking in My Page',
    body: (email) =>
      `Sign up with the Google account that uses the same email as your payment${email ? ` (${email})` : ''}, and this booking links to your account automatically. You'll also get 3 sign-up coupons.`,
    cta: 'Continue with Google',
    loading: 'Connecting...',
  },
  ja: {
    title: '会員登録してこの予約をマイページで確認',
    body: (email) =>
      `お支払いに使ったメールと同じGoogleアカウントで登録すると、この予約が自動的にアカウントに連携されます${email ? `（${email}）` : ''}。登録特典として3枚のクーポンもプレゼントします。`,
    cta: 'Googleで続ける',
    loading: '接続中...',
  },
  zh: {
    title: '注册后即可在"我的"页面查看此预订',
    body: (email) =>
      `使用与付款邮箱相同的Google账号注册${email ? `（${email}）` : ''}，此预订会自动关联到您的账户。注册还可获得3张优惠券。`,
    cta: '使用Google继续',
    loading: '连接中...',
  },
};

export function GuestSignupNudge({ language, email, onGoogleLogin, authLoading, authError }: Props) {
  const t = NUDGE_LABELS[language] || NUDGE_LABELS.en;
  return (
    <div className="bg-white/[0.04] border border-[#7C5CFC]/25 rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-white/90">{t.title}</p>
        <p className="text-xs text-white/55 mt-1 leading-relaxed">{t.body(email)}</p>
      </div>
      <button
        type="button"
        onClick={onGoogleLogin}
        disabled={authLoading}
        style={{ opacity: authLoading ? 0.6 : 1 }}
        className="w-full min-h-[40px] rounded-xl bg-white text-[#1a1a1a] text-sm font-semibold flex items-center justify-center gap-2 disabled:cursor-not-allowed"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
        {authLoading ? t.loading : t.cta}
      </button>
      {authError && <p className="text-xs text-red-400 text-center">{authError}</p>}
    </div>
  );
}
