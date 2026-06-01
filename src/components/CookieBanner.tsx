/**
 * CocoTripKR — GDPR Cookie Consent Banner
 * Minimal EU-compliant cookie notice
 * Shows once, stores consent in localStorage
 */
import { useState, useEffect } from 'react';
import { Cookie, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

const STORAGE_KEY = 'cocotrip_cookie_consent';
const SUPPORT_EMAIL = 'cocotripkr@gmail.com';

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const { t } = useLanguage();
  const cb = (t as Record<string, unknown>).cookieBanner as Record<string, string> | undefined;
  const footer = (t as Record<string, unknown>).footer as Record<string, string> | undefined;

  useEffect(() => {
    const consent = localStorage.getItem(STORAGE_KEY);
    if (!consent) {
      // slight delay so it doesn't flash on page load
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = () => {
    localStorage.setItem(STORAGE_KEY, 'accepted');
    setVisible(false);
  };

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'dismissed');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9999] p-4 animate-in slide-in-from-bottom duration-500"
      style={{ animation: 'slideUp 0.4s ease-out' }}
    >
      <div className="max-w-lg mx-auto bg-[#1a1b2e]/95 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <Cookie className="w-5 h-5 text-purple-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/80 leading-relaxed">
              {cb?.bodyBefore ?? 'We use cookies to improve your experience. By continuing to use this site, you agree to our '}
              <a href="/privacy" className="text-purple-400 underline hover:text-purple-300">{footer?.privacy ?? 'Privacy Policy'}</a>
              {cb?.bodyMiddle ?? '. To request data deletion, contact us at '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-purple-400 underline hover:text-purple-300">{SUPPORT_EMAIL}</a>
              {cb?.bodyAfter ?? '.'}
            </p>
            {/* Mobile-friendly tap targets — buttons hit ~44px height (WCAG 2.5.5) */}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={accept}
                className="min-h-[44px] px-5 py-2.5 text-xs font-bold text-white rounded-xl transition-all hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
              >
                {cb?.accept ?? 'Accept'}
              </button>
              <button
                onClick={dismiss}
                className="min-h-[44px] px-4 py-2.5 text-xs text-white/70 hover:text-white transition-colors"
              >
                {cb?.dismiss ?? 'Dismiss'}
              </button>
            </div>
          </div>
          <button
            onClick={dismiss}
            aria-label={t.a11y?.close ?? cb?.dismiss ?? 'Close'}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-white/70 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
