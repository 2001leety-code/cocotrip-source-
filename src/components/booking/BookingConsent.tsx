// BookingConsent — 예약(결제) 직전 공통 동의 패널 (트립닷컴 벤치마크).
//
// 두 부분:
//   (a) 전화 SMS 인증 — 폼에 입력된 전화번호로 SMS 코드 발송 → 6자리 확인.
//       기존 Firebase Phone Auth 재사용 (PhoneSignInModal 과 동일한 lib/firebase helper).
//       인증 완료 시 onVerified(true) 콜백 + "인증됨" 배지. 전화번호가 바뀌면 인증 reset.
//   (b) 약관 동의 체크박스 — "개인정보 처리방침 및 이용약관에 동의합니다" (4언어).
//       기존 /privacy · /terms 페이지 링크만 (새 법무 문구 작성 X). onTermsChange(bool).
//
// ⚠️ 결제 로직 무관 — 이 컴포넌트는 입력·검증 UI 만 제공. 게이트(인증·동의 필수)는
//    호출처(TourBookingDialog / CharterWizard)의 검증 조건에서 처리.
//
// SMS 는 새 인증 시스템 추가 X — signInWithPhone/verifyPhoneCode/setUpRecaptchaVerifier 재사용.
// reCAPTCHA 는 invisible (Firebase 가 hidden div 에 widget 주입). 인스턴스마다 고유 container id.

import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { Link } from 'react-router-dom';
import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';
import { setUpRecaptchaVerifier, signInWithPhone, verifyPhoneCode } from '@/lib/firebase';
import { isValidInternationalPhone } from '@/lib/phone-validation';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

const TEXT: Record<Lang, {
  smsTitle: string;
  sendCode: string;
  sending: string;
  resend: string;
  codeLabel: string;
  codePlaceholder: string;
  verify: string;
  verifying: string;
  verified: string;
  enterPhoneFirst: string;
  errInvalidPhone: string;
  errInvalidCode: string;
  termsAgree: string;
  privacyLink: string;
  termsLink: string;
  view: string;
}> = {
  ko: {
    smsTitle: '휴대폰 인증',
    sendCode: 'SMS 인증코드 받기',
    sending: '전송 중...',
    resend: '코드 재전송',
    codeLabel: '인증코드 (6자리)',
    codePlaceholder: '123456',
    verify: '인증 확인',
    verifying: '확인 중...',
    verified: '인증됨',
    enterPhoneFirst: '먼저 위에 휴대폰 번호를 입력해주세요',
    errInvalidPhone: '올바른 휴대폰 번호를 입력해주세요 (국가코드 포함, 예: +82 10...)',
    errInvalidCode: '인증코드가 올바르지 않거나 만료되었습니다',
    termsAgree: '개인정보 처리방침 및 이용약관에 동의합니다',
    privacyLink: '개인정보 처리방침',
    termsLink: '이용약관',
    view: '보기',
  },
  en: {
    smsTitle: 'Phone verification',
    sendCode: 'Send SMS code',
    sending: 'Sending...',
    resend: 'Resend code',
    codeLabel: 'Verification code (6 digits)',
    codePlaceholder: '123456',
    verify: 'Verify',
    verifying: 'Verifying...',
    verified: 'Verified',
    enterPhoneFirst: 'Please enter your phone number above first',
    errInvalidPhone: 'Enter a valid phone number (with country code, e.g. +1 555...)',
    errInvalidCode: 'Invalid or expired verification code',
    termsAgree: 'I agree to the Privacy Policy and Terms of Service',
    privacyLink: 'Privacy Policy',
    termsLink: 'Terms of Service',
    view: 'View',
  },
  ja: {
    smsTitle: '電話番号認証',
    sendCode: 'SMS認証コードを送信',
    sending: '送信中...',
    resend: 'コードを再送信',
    codeLabel: '認証コード（6桁）',
    codePlaceholder: '123456',
    verify: '認証する',
    verifying: '確認中...',
    verified: '認証済み',
    enterPhoneFirst: '先に上記の電話番号を入力してください',
    errInvalidPhone: '有効な電話番号を入力してください（国番号付き、例: +81 90...）',
    errInvalidCode: '認証コードが正しくないか期限切れです',
    termsAgree: 'プライバシーポリシーおよび利用規約に同意します',
    privacyLink: 'プライバシーポリシー',
    termsLink: '利用規約',
    view: '見る',
  },
  zh: {
    smsTitle: '手机验证',
    sendCode: '发送短信验证码',
    sending: '发送中...',
    resend: '重新发送验证码',
    codeLabel: '验证码（6位）',
    codePlaceholder: '123456',
    verify: '验证',
    verifying: '验证中...',
    verified: '已验证',
    enterPhoneFirst: '请先在上方输入手机号码',
    errInvalidPhone: '请输入有效的手机号码（含国家代码，例如 +86 138...）',
    errInvalidCode: '验证码无效或已过期',
    termsAgree: '我同意隐私政策和服务条款',
    privacyLink: '隐私政策',
    termsLink: '服务条款',
    view: '查看',
  },
};

/** 입력 전화번호 → E.164 정규화. 선행 + 없으면 그대로(국내형) 두되 Firebase 는 E.164 필요 →
 *  + 없는 순수 숫자는 한국 기본(+82) 가정 후 leading 0 strip. + 있으면 비숫자만 제거. */
function toE164(raw: string): string {
  const trimmed = (raw || '').trim();
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '');
  }
  // 국내 입력(010...) → +82 + leading 0 제거. 국제 표준 prefix 가정.
  const digits = trimmed.replace(/\D/g, '').replace(/^0+/, '');
  return `+82${digits}`;
}

/** 🔴 reCAPTCHA container id 충돌 방지용 모듈 레벨 카운터.
 *  useId() 결과의 콜론(`:r1:`)을 정규식으로 제거하면 짧은 ID(`r1`)가 되어 같은 페이지에
 *  BookingConsent 가 2개면 container id 가 겹칠 수 있다 (예: `:r1:`→`r1`, `:r:1:`→`r1`).
 *  useId 의 콜론을 안전한 문자(`_`)로 *치환*해 고유성을 보존하고, 인스턴스마다 단조 증가
 *  카운터를 추가로 붙여 두 인스턴스가 절대 같은 id 를 안 갖도록 이중 보장. */
let recaptchaIdSeq = 0;

interface Props {
  /** 폼에 입력된 전화번호 (E.164 또는 국내형). 비면 SMS 발송 비활성. */
  phone: string;
  /** SMS 인증 성공/리셋 시 호출 (true=인증완료, false=리셋). */
  onVerified: (verified: boolean) => void;
  /** 약관 동의 체크박스 현재 값. */
  termsAgreed: boolean;
  /** 약관 동의 토글 시 호출. */
  onTermsChange: (agreed: boolean) => void;
  language: Lang;
  /** 약관 동의 체크박스 숨김 (default false). SMS 인증 UI 는 항상 렌더.
   *  BookingInfoForm 약관카드가 약관 SSOT 일 때 이중노출 방지용 — termsAgreed 는 BookingInfoForm 이 set. */
  hideTermsCheckbox?: boolean;
}

export function BookingConsent({ phone, onVerified, termsAgreed, onTermsChange, language, hideTermsCheckbox = false }: Props) {
  const t = TEXT[language] || TEXT.en; // nullish 대신 || — language 빈/미지원이면 영어.
  // 🔴 reCAPTCHA container 고유 id — 같은 페이지에 BookingConsent 가 2개여도 절대 충돌 X.
  //   (a) useId 결과의 콜론을 *제거*하지 않고 안전 문자(`_`)로 치환 → useId 고유성 보존
  //       (`:r1:` vs `:r2:` 가 `_r1_` vs `_r2_` 로 유지 — 제거 시 `r1`/`r2` 로 짧아져 충돌 위험).
  //   (b) 모듈 카운터 suffix 추가 → 만에 하나 정규화가 겹쳐도 인스턴스마다 유일.
  //   mount 당 1회 고정 (useRef) — 재렌더에도 안정, verifier setup/cleanup id 일관.
  const rawId = useId();
  const instanceSeqRef = useRef<number | null>(null);
  if (instanceSeqRef.current === null) instanceSeqRef.current = ++recaptchaIdSeq;
  const safeRawId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const recaptchaContainerId = `booking-consent-recaptcha-${safeRawId}-${instanceSeqRef.current}`;

  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [code, setCode] = useState('');
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  // reCAPTCHA verifier 는 mount 시 1회 설정. unmount 시 cleanup.
  useEffect(() => {
    try {
      verifierRef.current = setUpRecaptchaVerifier(recaptchaContainerId);
    } catch (e) {
      console.error('[BookingConsent] verifier setup failed:', e);
    }
    return () => {
      try { verifierRef.current?.clear(); } catch { /* ignore cleanup errors */ }
      verifierRef.current = null;
    };
    // recaptchaContainerId 는 useId 기반 stable — mount 당 1회.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 전화번호가 바뀌면 기존 인증 무효화 (다른 번호로 결제 우회 방지).
  // ⚠️ 비교는 E.164 정규화 값 기준 — raw 문자열(공백·하이픈 등 표기 변동)로는 리셋하지 않는다.
  //   (이전 버그: raw phone 비교 → SMS 코드 입력 중 전화칸 공백 하나만 바뀌어도
  //    confirmationRef 가 날아가 "인증 확인"이 errInvalidCode 로 실패. 실제 번호가 같으면 세션 유지.)
  const lastE164Ref = useRef(toE164(phone));
  useEffect(() => {
    const curE164 = toE164(phone);
    if (lastE164Ref.current !== curE164) {
      lastE164Ref.current = curE164;
      if (verified || step === 'code') {
        setVerified(false);
        setStep('idle');
        setCode('');
        setError(null);
        confirmationRef.current = null;
        onVerified(false);
      }
    }
  }, [phone, verified, step, onVerified]);

  const handleSendCode = useCallback(async () => {
    setError(null);
    if (!isValidInternationalPhone(phone)) {
      setError(t.errInvalidPhone);
      return;
    }
    if (!verifierRef.current) {
      setError(t.errInvalidPhone);
      return;
    }
    setLoading(true);
    try {
      confirmationRef.current = await signInWithPhone(toE164(phone), verifierRef.current);
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errInvalidPhone);
    } finally {
      setLoading(false);
    }
  }, [phone, t.errInvalidPhone]);

  const handleVerifyCode = useCallback(async () => {
    setError(null);
    if (!/^\d{6}$/.test(code) || !confirmationRef.current) {
      setError(t.errInvalidCode);
      return;
    }
    setLoading(true);
    try {
      await verifyPhoneCode(confirmationRef.current, code);
      setVerified(true);
      setStep('idle');
      onVerified(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.errInvalidCode);
    } finally {
      setLoading(false);
    }
  }, [code, t.errInvalidCode, onVerified]);

  const phonePresent = phone.trim().length > 0;

  return (
    <div className="space-y-4">
      {/* (a) 전화 SMS 인증 */}
      <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-white/55 uppercase tracking-wider font-semibold">
            {t.smsTitle}
          </span>
          {verified && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded-full px-2 py-0.5">
              ✓ {t.verified}
            </span>
          )}
        </div>

        {!verified && (
          <>
            {!phonePresent && (
              <p className="text-[11px] text-white/45">{t.enterPhoneFirst}</p>
            )}

            {phonePresent && step === 'idle' && (
              <button
                type="button"
                onClick={handleSendCode}
                disabled={loading}
                className="w-full py-2.5 rounded-lg text-[13px] font-bold text-white transition-all disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
              >
                {loading ? t.sending : t.sendCode}
              </button>
            )}

            {phonePresent && step === 'code' && (
              <div className="space-y-2">
                <label className="block text-[11px] text-white/55" htmlFor={`${recaptchaContainerId}-code`}>
                  {t.codeLabel}
                </label>
                <input
                  id={`${recaptchaContainerId}-code`}
                  type="text"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={t.codePlaceholder}
                  className="w-full px-3 py-2 rounded-lg text-white text-center text-base tracking-widest outline-none"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={loading || code.length !== 6}
                  className="w-full py-2.5 rounded-lg text-[13px] font-bold text-white transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
                >
                  {loading ? t.verifying : t.verify}
                </button>
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={loading}
                  className="w-full py-1.5 text-[11px] text-white/55 hover:text-white/80 disabled:opacity-50"
                >
                  {t.resend}
                </button>
              </div>
            )}
          </>
        )}

        {error && <p className="text-[12px] text-red-400 mt-2">{error}</p>}

        {/* invisible reCAPTCHA target — Firebase 가 widget 주입. 시각 노출 X. */}
        <div id={recaptchaContainerId} />
      </div>

      {/* (b) 약관 동의 체크박스 — hideTermsCheckbox 시 숨김(BookingInfoForm 약관카드가 SSOT). SMS 는 위에서 항상 렌더. */}
      {!hideTermsCheckbox && (
      <label className="flex items-start gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={termsAgreed}
          onChange={(e) => onTermsChange(e.target.checked)}
          className="mt-0.5 w-4 h-4 shrink-0 accent-[#B668FC] cursor-pointer"
        />
        <span className="text-[12px] text-white/75 leading-snug">
          {t.termsAgree}
          <span className="block mt-1 text-[11px] text-white/45">
            <Link
              to="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="underline hover:text-white/70"
            >
              {t.privacyLink}
            </Link>
            {' · '}
            <Link
              to="/terms"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="underline hover:text-white/70"
            >
              {t.termsLink}
            </Link>
            {` (${t.view})`}
          </span>
        </span>
      </label>
      )}
    </div>
  );
}

export default BookingConsent;
