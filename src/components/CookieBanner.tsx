/**
 * CocoTripKR — GDPR Cookie Consent Banner
 * Minimal EU-compliant cookie notice
 * Shows once, stores consent in localStorage
 *
 * Korea Editorial Concierge (2026-08-10): paper card, hairline, solid CTA.
 * Consent logic below is untouched — it is the legal boundary, not styling.
 */
import { useState, useEffect } from 'react';
import { Cookie, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { readConsent, setConsent } from '@/lib/consent';

const SUPPORT_EMAIL = 'cocotripkr@gmail.com';
/** 처리방침 제6조(개인정보의 국외 이전) — Privacy.tsx 의 `article-${index + 1}` 앵커. */
const PROVIDERS_HREF = '/privacy#article-6';

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

  const linkCls = 'text-ec-brand underline underline-offset-2 hover:text-ec-brand-hover';

  return (
    <div
      className="ec-root ec-no-print fixed bottom-[calc(56px+env(safe-area-inset-bottom))] md:bottom-0 left-0 right-0 z-[10001] p-3 sm:p-4"
      role="region"
      aria-label={cb?.title || 'Cookie notice'}
    >
      <div className="max-w-2xl mx-auto bg-ec-raised border border-ec-line rounded-ec-md shadow-ec-overlay p-4">
        <div className="flex items-start gap-3">
          <Cookie className="w-5 h-5 text-ec-ink-3 mt-0.5 shrink-0 hidden sm:block" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-ec-ink-2">
              {/* 2026-11-21 처리방침: "계속 쓰면 동의로 간주" 금지 — '동의'를 눌러야 통계가 켜진다(lib/consent.ts).
                  통계 업체·나라 = 처리방침 제6조(국외 이전) 표. */}
              <span className="sm:hidden">
                {cb?.bodyShort || 'Visit analytics turn on only after you press Accept.'}{' '}
                <a href="/privacy" className={linkCls}>{footer?.privacy || 'Privacy Policy'}</a>
                {' · '}
                <a href={PROVIDERS_HREF} className={linkCls}>{cb?.providersLink || 'Privacy Policy Article 6'}</a>
              </span>
              <span className="hidden sm:inline">
                {cb?.bodyBefore || 'We use cookies. Visit analytics (GA4, PostHog) turn on only after you press Accept. Booking and payment work either way. See our '}
                <a href="/privacy" className={linkCls}>{footer?.privacy || 'Privacy Policy'}</a>
                {cb?.bodyMiddle || '; the analytics companies and their countries are listed in '}
                <a href={PROVIDERS_HREF} className={linkCls}>{cb?.providersLink || 'Privacy Policy Article 6'}</a>
                {cb?.bodyProviders || '. To request data deletion, contact us at '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className={linkCls}>{SUPPORT_EMAIL}</a>
                {cb?.bodyAfter || '.'}
              </span>
            </p>
            {/* Mobile-friendly tap targets — buttons hit 44px height (WCAG 2.5.5) */}
            <div className="flex items-center gap-2 mt-3">
              <button onClick={accept} className="ec-btn ec-btn-primary ec-btn-sm min-h-[44px]">
                {cb?.accept || 'Accept'}
              </button>
              <button onClick={dismiss} className="ec-btn ec-btn-quiet ec-btn-sm min-h-[44px]">
                {cb?.dismiss || 'Dismiss'}
              </button>
            </div>
          </div>
          <button
            onClick={dismiss}
            aria-label={t.a11y?.close || cb?.dismiss || 'Close'}
            className="min-w-[44px] min-h-[44px] -mt-2 -mr-2 flex items-center justify-center rounded-ec-sm text-ec-ink-3 transition-colors duration-ec-base ease-ec-standard hover:text-ec-ink hover:bg-ec-page"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
