/**
 * CocoTripKR — GDPR Cookie Consent Banner
 * Minimal EU-compliant cookie notice
 * Shows once, stores consent in localStorage
 */
import { useState, useEffect } from 'react';
import { Cookie, X } from 'lucide-react';

const STORAGE_KEY = 'cocotrip_cookie_consent';

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

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
              We use cookies to improve your experience. By continuing to use this site, you agree to our{' '}
              <a href="/privacy" className="text-purple-400 underline hover:text-purple-300">Privacy Policy</a>.
              To request data deletion, contact us at{' '}
              <a href="mailto:cocotripkr@gmail.com" className="text-purple-400 underline hover:text-purple-300">cocotripkr@gmail.com</a>.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={accept}
                className="px-4 py-1.5 text-xs font-bold text-white rounded-xl transition-all hover:scale-105"
                style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}
              >
                Accept
              </button>
              <button
                onClick={dismiss}
                className="px-3 py-1.5 text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          <button onClick={dismiss} className="text-white/20 hover:text-white/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
