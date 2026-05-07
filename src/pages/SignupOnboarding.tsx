import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { db } from '@/lib/firebase';

// 닉네임: 한글/영문/숫자 2~20자 — DB 인덱싱·표시 호환성을 위해 특수문자 배제.
const NICKNAME_RE = /^[A-Za-z0-9가-힣]{2,20}$/;
// 휴대폰: 국제 포맷 (+ 국가코드, 숫자, 공백/하이픈 허용). 선택 입력이므로 빈 문자열 통과.
const PHONE_RE = /^\+?[0-9][0-9\s\-]{6,19}$/;

const COUNTRY_CODES = [
  'KR', 'US', 'JP', 'CN', 'SG', 'TH', 'VN', 'MY', 'PH', 'OTHER',
] as const;
type CountryCode = (typeof COUNTRY_CODES)[number] | '';

export default function SignupOnboarding() {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const tt = (t as unknown as { signup?: Record<string, string> }).signup ?? {};

  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState<CountryCode>('');
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 초기 로딩 중 또는 미로그인은 AuthRequired 가 처리 — 여기선 user.uid 만 가드
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6]">
        <div className="w-8 h-8 border-2 border-[#0f3460] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user?.uid) {
    return null;
  }

  const validateNickname = (value: string): boolean => {
    if (!NICKNAME_RE.test(value)) {
      setNicknameError(tt.signupNicknameError ?? 'Invalid nickname');
      return false;
    }
    setNicknameError(null);
    return true;
  };

  const validatePhone = (value: string): boolean => {
    // 선택 — 빈 문자열 OK
    if (!value.trim()) {
      setPhoneError(null);
      return true;
    }
    if (!PHONE_RE.test(value.trim())) {
      setPhoneError(tt.signupPhoneError ?? 'Invalid phone');
      return false;
    }
    setPhoneError(null);
    return true;
  };

  const canSubmit =
    !submitting &&
    NICKNAME_RE.test(nickname) &&
    (!phone.trim() || PHONE_RE.test(phone.trim())) &&
    agreePrivacy &&
    agreeTerms;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const nicknameOk = validateNickname(nickname);
    const phoneOk = validatePhone(phone);
    if (!nicknameOk || !phoneOk || !agreePrivacy || !agreeTerms) return;

    setSubmitting(true);
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          nickname: nickname.trim(),
          phone: phone.trim() || null,
          countryCode: countryCode || null,
          agreedAt: serverTimestamp(),
          needsOnboarding: false,
        },
        { merge: true }
      );
      navigate('/mypage');
    } catch (err) {
      console.error('[SignupOnboarding] save failed:', err);
      setSubmitError(tt.signupSubmitError ?? 'Save failed.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(160deg, #0c1220 0%, #0f2244 60%, #0a1628 100%)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8"
        style={{
          background: 'rgba(15,18,32,0.95)',
          border: '1px solid rgba(124,92,252,0.15)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <h1 className="text-xl font-bold text-white mb-2 text-center">
          {tt.signupOnboardingTitle ?? 'Welcome!'}
        </h1>
        <p className="text-sm text-white/60 mb-6 text-center">
          {tt.signupOnboardingSub ?? ''}
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Nickname (required) */}
          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1.5">
              {tt.signupNicknameLabel ?? 'Nickname'} <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => {
                setNickname(e.target.value);
                if (nicknameError) setNicknameError(null);
              }}
              onBlur={() => nickname && validateNickname(nickname)}
              placeholder={tt.signupNicknamePlaceholder ?? ''}
              maxLength={20}
              className="w-full px-3 py-2.5 rounded-lg bg-white/5 border text-white placeholder-white/30 outline-none focus:border-violet-400"
              style={{ borderColor: nicknameError ? '#f87171' : 'rgba(255,255,255,0.1)' }}
              required
            />
            {nicknameError && <p className="text-xs text-rose-400 mt-1">{nicknameError}</p>}
          </div>

          {/* Phone (optional) */}
          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1.5">
              {tt.signupPhoneLabel ?? 'Phone'}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError) setPhoneError(null);
              }}
              onBlur={() => validatePhone(phone)}
              placeholder={tt.signupPhonePlaceholder ?? ''}
              maxLength={20}
              className="w-full px-3 py-2.5 rounded-lg bg-white/5 border text-white placeholder-white/30 outline-none focus:border-violet-400"
              style={{ borderColor: phoneError ? '#f87171' : 'rgba(255,255,255,0.1)' }}
            />
            <p className="text-[11px] text-white/45 mt-1">{tt.signupPhoneHint ?? ''}</p>
            {phoneError && <p className="text-xs text-rose-400 mt-1">{phoneError}</p>}
          </div>

          {/* Country (optional) */}
          <div>
            <label className="block text-sm font-semibold text-white/80 mb-1.5">
              {tt.signupCountryLabel ?? 'Country'}
            </label>
            <select
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value as CountryCode)}
              className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white outline-none focus:border-violet-400"
            >
              <option value="" className="bg-[#0f2244]">
                {tt.signupCountryPlaceholder ?? 'Select'}
              </option>
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code} className="bg-[#0f2244]">
                  {tt[`signupCountry${code}`] ?? code}
                </option>
              ))}
            </select>
          </div>

          {/* Agreements */}
          <div className="space-y-2.5 pt-2">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={agreePrivacy}
                onChange={(e) => setAgreePrivacy(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-violet-500"
              />
              <span className="text-[13px] text-white/75 leading-snug">
                {tt.signupAgreePrivacy ?? 'I agree to the Privacy Policy'}{' '}
                <span className="text-rose-400">{tt.signupAgreeRequired ?? '(required)'}</span>
                {' '}
                <Link to="/privacy" target="_blank" className="text-violet-300 underline">
                  {tt.signupViewLink ?? 'View'}
                </Link>
              </span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-violet-500"
              />
              <span className="text-[13px] text-white/75 leading-snug">
                {tt.signupAgreeTerms ?? 'I agree to the Terms of Service'}{' '}
                <span className="text-rose-400">{tt.signupAgreeRequired ?? '(required)'}</span>
                {' '}
                <Link to="/terms" target="_blank" className="text-violet-300 underline">
                  {tt.signupViewLink ?? 'View'}
                </Link>
              </span>
            </label>
          </div>

          {submitError && <p className="text-sm text-rose-400">{submitError}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 rounded-xl font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #7C5CFC, #EA537E)',
              color: '#fff',
            }}
          >
            {submitting
              ? (tt.signupSubmitting ?? 'Submitting...')
              : (tt.signupSubmitBtn ?? 'Continue')}
          </button>
        </form>
      </div>
    </div>
  );
}
