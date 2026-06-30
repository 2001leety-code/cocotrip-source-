import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';
import { setUpRecaptchaVerifier, signInWithPhone, verifyPhoneCode } from '@/lib/firebase';
// 국가번호 SSOT — PhoneSignInModal(로그인 전화인증) + BookingInfoForm(예약폼 국가번호) 공유.
// 동일 배열 import 로 전환했을 뿐 동작 무변경 (회귀 0).
import { COUNTRIES, DEFAULT_DIAL_BY_LANG, flagOf } from '@/lib/country-dials';

// PR #390 (2026-05-13): Firebase Phone Auth 2-step modal — 외국인 sign-in 옵션
// 일환. LINE OIDC 는 Identity Platform 업그레이드 필요로 보류, Phone 우선 활성.
//
// reCAPTCHA: invisible 모드 — Firebase 가 hidden div 에 widget 주입. unmount 시
// verifier.clear() 로 cleanup.
//
// 흐름: phone 입력(E.164) → SMS 발송 → 코드 입력 → confirm → Firestore user 저장
// (saveUserToFirestore 가 firebase.js 내부에서 자동 호출).

const TEXT = {
  ko: {
    title: '전화번호로 로그인',
    countryLabel: '국가',
    step1Label: '전화번호',
    step1Placeholder: '1012345678',
    step1Hint: '국가 코드 자동 적용 (예: +82 1012345678)',
    step1Submit: 'SMS 인증코드 받기',
    step1Loading: '전송 중...',
    step2Label: '인증코드 (6자리)',
    step2Placeholder: '123456',
    step2Hint: 'SMS 로 받은 6자리 코드를 입력하세요',
    step2Submit: '로그인',
    step2Loading: '확인 중...',
    step2Back: '← 번호 변경',
    cancel: '닫기',
    errInvalidPhone: '전화번호 숫자 8-14자리를 입력하세요',
    errInvalidCode: '인증코드가 올바르지 않거나 만료되었습니다',
  },
  en: {
    title: 'Sign in with phone',
    countryLabel: 'Country',
    step1Label: 'Phone number',
    step1Placeholder: '2025550123',
    step1Hint: 'Country code auto-applied (e.g. +1 2025550123)',
    step1Submit: 'Send SMS code',
    step1Loading: 'Sending...',
    step2Label: 'Verification code (6 digits)',
    step2Placeholder: '123456',
    step2Hint: 'Enter the 6-digit code from your SMS',
    step2Submit: 'Sign in',
    step2Loading: 'Verifying...',
    step2Back: '← Change number',
    cancel: 'Close',
    errInvalidPhone: 'Enter 8-14 digit phone number',
    errInvalidCode: 'Invalid or expired verification code',
  },
  ja: {
    title: '電話番号でログイン',
    countryLabel: '国',
    step1Label: '電話番号',
    step1Placeholder: '901234567',
    step1Hint: '国番号は自動で付きます（例: +81 901234567）',
    step1Submit: 'SMS認証コードを送信',
    step1Loading: '送信中...',
    step2Label: '認証コード（6桁）',
    step2Placeholder: '123456',
    step2Hint: 'SMSで受信した6桁のコードを入力してください',
    step2Submit: 'ログイン',
    step2Loading: '確認中...',
    step2Back: '← 番号を変更',
    cancel: '閉じる',
    errInvalidPhone: '電話番号の数字8-14桁を入力してください',
    errInvalidCode: '認証コードが正しくないか期限切れです',
  },
  zh: {
    title: '使用电话号码登录',
    countryLabel: '国家',
    step1Label: '电话号码',
    step1Placeholder: '13812345678',
    step1Hint: '自动添加国家代码（例如 +86 13812345678）',
    step1Submit: '发送短信验证码',
    step1Loading: '发送中...',
    step2Label: '验证码（6位）',
    step2Placeholder: '123456',
    step2Hint: '请输入短信收到的6位验证码',
    step2Submit: '登录',
    step2Loading: '验证中...',
    step2Back: '← 更改号码',
    cancel: '关闭',
    errInvalidPhone: '请输入8-14位数字电话号码',
    errInvalidCode: '验证码无效或已过期',
  },
} as const;

const RECAPTCHA_CONTAINER_ID = 'phone-recaptcha-container';
// E.164: `+` 다음 국가코드(1~3자리) + 가입자 번호. 합계 8~15 자리.
const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;
// PR #399 (2026-05-13): 국가 select dropdown — CocoTrip 외국인 핵심 타겟 + 주요 국가.
// COUNTRIES / DEFAULT_DIAL_BY_LANG 는 src/lib/country-dials.ts 로 추출(SSOT, BookingInfoForm 공유).
// 동작·배열 무변경 — import 출처만 모듈로.

interface Props {
  language: 'ko' | 'en' | 'ja' | 'zh';
  onClose: () => void;
  onSuccess?: () => void;
}

export function PhoneSignInModal({ language, onClose, onSuccess }: Props) {
  const text = TEXT[language] ?? TEXT.en;
  const [step, setStep] = useState<1 | 2>(1);
  // PR #399: 국가 dial code (E.164 prefix) — default 는 사용자 언어 기반.
  // 사용자가 dropdown 으로 변경 가능 (외국인은 본인 국가 dial 선택).
  const [dialCode, setDialCode] = useState<string>(() => DEFAULT_DIAL_BY_LANG[language] ?? '1');
  // PR #399: nationalNumber 만 입력 (국가 코드 분리). 합쳐서 E.164 검증.
  const [nationalNumber, setNationalNumber] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  // reCAPTCHA verifier 는 mount 시 1회 설정. unmount/재open 시 cleanup.
  useEffect(() => {
    try {
      verifierRef.current = setUpRecaptchaVerifier(RECAPTCHA_CONTAINER_ID);
    } catch (e) {
      console.error('[PhoneSignInModal] verifier setup failed:', e);
    }
    return () => {
      try { verifierRef.current?.clear(); } catch { /* ignore cleanup errors */ }
      verifierRef.current = null;
    };
  }, []);

  const handleSendCode = useCallback(async () => {
    setError(null);
    // PR #399: dialCode + nationalNumber → E.164 조합 후 검증.
    // 사용자가 nationalNumber 의 leading 0 (예: 한국 010..., 일본 090...) 입력해도
    // strip — 국제 표준에서 leading 0 제외.
    const trimmedNumber = nationalNumber.replace(/^0+/, '');
    const phone = `+${dialCode}${trimmedNumber}`;
    if (!PHONE_E164_REGEX.test(phone)) {
      setError(text.errInvalidPhone);
      return;
    }
    if (!verifierRef.current) {
      setError(text.errInvalidPhone);
      return;
    }
    setLoading(true);
    try {
      confirmationRef.current = await signInWithPhone(phone, verifierRef.current);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : text.errInvalidPhone);
    } finally {
      setLoading(false);
    }
  }, [dialCode, nationalNumber, text.errInvalidPhone]);

  const handleVerifyCode = useCallback(async () => {
    setError(null);
    if (!/^\d{6}$/.test(code) || !confirmationRef.current) {
      setError(text.errInvalidCode);
      return;
    }
    setLoading(true);
    try {
      await verifyPhoneCode(confirmationRef.current, code);
      onSuccess?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : text.errInvalidCode);
    } finally {
      setLoading(false);
    }
  }, [code, text.errInvalidCode, onSuccess, onClose]);

  const handleBack = useCallback(() => {
    setStep(1);
    setCode('');
    setError(null);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: '#0f1220', border: '1px solid rgba(124,92,252,0.25)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-4">{text.title}</h2>

        {step === 1 && (
          <div className="space-y-3">
            {/* PR #399: 국가 select + 번호 input 분리 — 외국인 진입 장벽 ↓ */}
            <label className="block text-xs text-white/70" htmlFor="country-select">
              {text.countryLabel}
            </label>
            <select
              id="country-select"
              value={dialCode}
              onChange={(e) => setDialCode(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-white/10 text-white border border-white/15 focus:border-purple-400 outline-none appearance-none cursor-pointer"
              disabled={loading}
              style={{ backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23ffffff\' stroke-width=\'2\'><polyline points=\'6 9 12 15 18 9\'/></svg>")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center', paddingRight: '32px' }}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.dial} style={{ background: '#0f1220', color: '#fff' }}>
                  {flagOf(c.code)} {c.name[language] ?? c.name.en} (+{c.dial})
                </option>
              ))}
            </select>
            <label className="block text-xs text-white/70 pt-1" htmlFor="phone-input">
              {text.step1Label}
            </label>
            <div className="flex items-center gap-2">
              <span className="px-3 py-2.5 rounded-lg bg-white/5 text-white/70 text-sm border border-white/10 shrink-0">
                +{dialCode}
              </span>
              <input
                id="phone-input"
                type="tel"
                autoComplete="tel-national"
                inputMode="tel"
                value={nationalNumber}
                onChange={(e) => setNationalNumber(e.target.value.replace(/\D/g, ''))}
                placeholder={text.step1Placeholder}
                className="flex-1 px-3 py-2.5 rounded-lg bg-white/10 text-white border border-white/15 focus:border-purple-400 outline-none"
                disabled={loading}
              />
            </div>
            <p className="text-[11px] text-white/45">{text.step1Hint}</p>
            <button
              type="button"
              onClick={handleSendCode}
              disabled={loading || !nationalNumber}
              className="w-full py-3 rounded-xl font-bold transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', color: '#fff' }}
            >
              {loading ? text.step1Loading : text.step1Submit}
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <label className="block text-xs text-white/70" htmlFor="code-input">
              {text.step2Label}
            </label>
            <input
              id="code-input"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder={text.step2Placeholder}
              className="w-full px-3 py-2.5 rounded-lg bg-white/10 text-white border border-white/15 focus:border-purple-400 outline-none tracking-widest text-center text-lg"
              disabled={loading}
            />
            <p className="text-[11px] text-white/45">{text.step2Hint}</p>
            <button
              type="button"
              onClick={handleVerifyCode}
              disabled={loading || code.length !== 6}
              className="w-full py-3 rounded-xl font-bold transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)', color: '#fff' }}
            >
              {loading ? text.step2Loading : text.step2Submit}
            </button>
            <button
              type="button"
              onClick={handleBack}
              disabled={loading}
              className="w-full py-2 text-xs text-white/60 hover:text-white/90 disabled:opacity-50"
            >
              {text.step2Back}
            </button>
          </div>
        )}

        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}

        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="w-full mt-3 py-2 text-xs text-white/55 hover:text-white/80 disabled:opacity-50"
        >
          {text.cancel}
        </button>

        {/* invisible reCAPTCHA target — Firebase 가 widget 주입. 시각 노출 X. */}
        <div id={RECAPTCHA_CONTAINER_ID} />
      </div>
    </div>
  );
}

export default PhoneSignInModal;
