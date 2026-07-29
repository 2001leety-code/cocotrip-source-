/**
 * CocoTripKR — GDPR Cookie Consent Banner
 * Minimal EU-compliant cookie notice
 * Shows once, stores consent in localStorage
 */
import { useState, useEffect } from 'react';
import { Cookie, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { readConsent, setConsent } from '@/lib/consent';

const SUPPORT_EMAIL = 'cocotripkr@gmail.com';

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const { t } = useLanguage();
  const cb = (t as Record<string, unknown>).cookieBanner as Record<string, string> | undefined;
  const footer = (t as Record<string, unknown>).footer as Record<string, string> | undefined;

  useEffect(() => {
    if (readConsent() === 'unset') {
      // slight delay so it doesn't flash on page load
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  // 🔴 2026-07-30: 저장은 lib/consent.ts 를 거친다. 여기서 localStorage 를 직접 쓰면
  //   "배너는 저장했는데 분석 도구는 그 값을 안 본다" 는 지금 문제가 그대로 남는다.
  //   setConsent 가 같은 탭에도 알려서, 수락하는 순간 GA4·PostHog 가 켜진다.
  const accept = () => {
    setConsent('accepted');
    setVisible(false);
  };

  const dismiss = () => {
    setConsent('dismissed');   // 닫기 = 거부로 본다(더 안전한 쪽)
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-[calc(56px+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 z-[10001] p-2 sm:p-4 animate-in slide-in-from-bottom duration-500"
      style={{ animation: 'slideUp 0.4s ease-out' }}
    >
      <div className="max-w-lg mx-auto bg-[#1a1b2e]/95 backdrop-blur-xl border border-white/10 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 shadow-2xl">
        <div className="flex items-start gap-2 sm:gap-3">
          <Cookie className="w-5 h-5 text-purple-400 mt-0.5 shrink-0 hidden sm:block" />
          <div className="flex-1 min-w-0">
            <p className="text-xs sm:text-sm text-white/80 leading-snug sm:leading-relaxed">
              <span className="sm:hidden">
                {cb?.bodyShort || 'We use cookies. See our '}
                <a href="/privacy" className="text-purple-400 underline hover:text-purple-300">{footer?.privacy || 'Privacy Policy'}</a>
                {cb?.bodyShortAfter || ''}
              </span>
              <span className="hidden sm:inline">
                {cb?.bodyBefore || 'We use cookies to improve your experience. By continuing to use this site, you agree to our '}
                <a href="/privacy" className="text-purple-400 underline hover:text-purple-300">{footer?.privacy || 'Privacy Policy'}</a>
                {cb?.bodyMiddle || '. To request data deletion, contact us at '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-purple-400 underline hover:text-purple-300">{SUPPORT_EMAIL}</a>
                {cb?.bodyAfter || '.'}
              </span>
            </p>
            {/* Mobile-friendly tap targets — buttons hit ~44px height (WCAG 2.5.5) */}
            <div className="flex items-center gap-2 mt-2 sm:mt-3">
              <button
                onClick={accept}
                className="min-h-[44px] px-5 py-2.5 text-xs font-bold text-white rounded-xl transition-all hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
              >
                {cb?.accept ?? 'Accept'}
              </button>
              <button
                onClick={dismiss}
                className="min-h-[44px] px-4 py-2.5 text-xs text-white/70 hover:text-white/90 transition-colors"
              >
                {cb?.dismiss ?? 'Dismiss'}
              </button>
            </div>
          </div>
          <button
            onClick={dismiss}
            aria-label={t.a11y?.close ?? cb?.dismiss ?? 'Close'}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-white/70 hover:text-white/90 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
