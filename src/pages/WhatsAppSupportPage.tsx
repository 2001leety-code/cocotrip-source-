import '@/styles/home-dope.css';
import '@/styles/home-dope-static.css';
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import type { Language } from '@/i18n';
import { WHATSAPP_SUPPORT_START, WHATSAPP_SUPPORT_STOP, WHATSAPP_SUPPORT_URL, whatsappSupportCopy } from '@/lib/whatsappSupportCopy';

/** The number already inside WHATSAPP_SUPPORT_URL, shown as "+82 10-8714-0611". */
const SUPPORT_DIGITS = new URL(WHATSAPP_SUPPORT_URL).pathname.slice(1);
const SUPPORT_NUMBER = `+${SUPPORT_DIGITS.slice(0, 2)} ${SUPPORT_DIGITS.slice(2, 4)}-${SUPPORT_DIGITS.slice(4, 8)}-${SUPPORT_DIGITS.slice(8)}`;

// 2026-10-11: Home 어휘(하늘 히어로 + 패스 카드 1장). 동의 전 링크 비활성·언어 변경 시 동의 해제는 그대로.
export default function WhatsAppSupportPage() {
  const { language, changeLanguage } = useLanguage();
  const copy = whatsappSupportCopy[language] || whatsappSupportCopy.en;
  const consentId = useId();
  const [consentedLanguage, setConsentedLanguage] = useState<Language | null>(null);
  const consented = consentedLanguage === language;
  const [, serifWord = '', rest = copy.title] = copy.title.match(/^(WhatsApp)\s*(.*)$/) || [];
  usePageMeta({ title: copy.title, description: copy.description });

  return <main className="ec-root home-dope home-dope--static min-h-screen pb-28">
    <section className="home-dope-hero" lang={language}>
      {/* Poster-only sky (no video, no toggle): this page is a consent step, not a showcase. */}
      <div className="home-dope-sky" aria-hidden="true" />
      <div className="home-dope-hero__inner">
        <div className="home-dope-hero__copy">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <Link to="/" className="home-dope-textlink">{copy.back}</Link>
            <label className="flex min-h-[44px] items-center gap-2 text-xs text-white/80">
              {copy.language}
              <select value={language} onChange={event => { setConsentedLanguage(null); changeLanguage(event.target.value as Language); }} className="min-h-[44px] rounded-xl border border-white/30 bg-bg-card px-2 text-sm text-white">
                <option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option>
              </select>
            </label>
          </div>
          <p className="ec-eyebrow home-dope-eyebrow">{copy.duration}</p>
          <h1 className="home-dope-h1" aria-label={copy.title}>
            {serifWord && <span aria-hidden="true" className="home-dope-h1__line"><span className="is-serif">{serifWord}</span></span>}
            <span aria-hidden="true" className="home-dope-h1__line"><span className="is-sans">{rest}</span></span>
          </h1>
          <p className="home-dope-lede">{copy.description}</p>
        </div>

        <div className="home-dope-pass-wrap">
          <div className="home-dope-pass" data-collapsed="false">
            <div className="home-dope-pass__body">
              <div className="home-dope-pass__head">
                <p className="home-dope-pass__title">
                  <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
                  {copy.linksTitle}
                </p>
              </div>

              <div className="home-dope-pass__cycle">
                <div className="text-sm leading-7">
                  <p className="m-0">{copy.scope}</p>
                  <p className="m-0 font-semibold">{copy.history}</p>
                  <p className="m-0">{copy.privacyBoundary}</p>
                  <details className="rounded-xl border border-white/20">
                    <summary className="min-h-[44px] cursor-pointer rounded-xl px-3 py-3 text-xs font-semibold">{copy.more}</summary>
                    <p className="m-0 px-3 pb-3 text-xs leading-6 text-white/80">{copy.transport}</p>
                  </details>
                  <div className="rounded-xl border border-white/20 p-4">
                    <h2 className="text-sm font-semibold">{copy.stopTitle}</h2>
                    <p className="m-0 mt-2 leading-6 text-white/80">{copy.stop}</p>
                    <code className="mt-2 block break-words font-semibold text-ec-brand">{WHATSAPP_SUPPORT_STOP}</code>
                  </div>
                  <p className="m-0">{copy.instruction}</p>
                  <code className="block break-words text-xs text-white/80">{WHATSAPP_SUPPORT_START}</code>
                </div>
              </div>

              <div>
                <p className="home-dope-pass__label">WhatsApp</p>
                <p className="home-dope-pass__value ec-figure">{SUPPORT_NUMBER}</p>
              </div>

              <div className="home-dope-pass__cta">
                <label htmlFor={consentId} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-white/30 p-3 text-sm leading-6">
                  <input id={consentId} type="checkbox" checked={consented} onChange={event => setConsentedLanguage(event.target.checked ? language : null)} className="mt-1 h-5 w-5 shrink-0 accent-violet-300" />
                  <span>{copy.consent}</span>
                </label>
                <a role="link" href={consented ? WHATSAPP_SUPPORT_URL : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!consented} tabIndex={consented ? 0 : -1}
                  onClick={event => { if (!consented) event.preventDefault(); }}
                  className={`home-dope-btn min-h-[48px] w-full ${consented ? 'home-dope-btn--primary' : 'home-dope-btn--ghost cursor-not-allowed opacity-60'}`}>
                  {copy.open}
                </a>
                {!consented && <p className="m-0 text-xs leading-5 text-white/80">{copy.unchecked}</p>}
                <p className="m-0 text-xs leading-6 text-white/80">{copy.manual}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>;
}
