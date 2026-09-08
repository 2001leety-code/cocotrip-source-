import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import type { Language } from '@/i18n';
import { WHATSAPP_SUPPORT_START, WHATSAPP_SUPPORT_STOP, WHATSAPP_SUPPORT_URL, whatsappSupportCopy } from '@/lib/whatsappSupportCopy';

export default function WhatsAppSupportPage() {
  const { language, changeLanguage } = useLanguage();
  const copy = whatsappSupportCopy[language] || whatsappSupportCopy.en;
  const consentId = useId();
  const [consentedLanguage, setConsentedLanguage] = useState<Language | null>(null);
  const consented = consentedLanguage === language;
  usePageMeta({ title: copy.title, description: copy.description });

  return <main className="min-h-screen bg-bg-base px-4 pb-28 pt-6 text-slate-100">
    <div className="mx-auto max-w-xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="inline-flex min-h-[44px] items-center rounded-xl px-3 text-sm font-semibold text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">{copy.back}</Link>
        <label className="flex min-h-[44px] items-center gap-2 text-xs text-slate-300">
          {copy.language}
          <select value={language} onChange={event => { setConsentedLanguage(null); changeLanguage(event.target.value as Language); }} className="min-h-[44px] rounded-xl border border-white/20 bg-bg-card px-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
            <option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option>
          </select>
        </label>
      </div>
      <section className="rounded-2xl border border-white/10 bg-bg-card p-5">
        <p className="text-xs font-semibold text-violet-200">{copy.duration}</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-3 text-sm leading-7 text-slate-200">{copy.scope}</p>
        <p className="mt-3 text-sm font-semibold leading-7 text-slate-100">{copy.history}</p>
        <p className="mt-2 text-sm leading-6 text-slate-200">{copy.privacyBoundary}</p>
        <details className="mt-2 rounded-xl border border-white/10">
          <summary className="min-h-[44px] cursor-pointer rounded-xl px-3 py-3 text-xs font-semibold text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">{copy.more}</summary>
          <p className="px-3 pb-3 text-xs leading-6 text-slate-300">{copy.transport}</p>
        </details>
        <div className="mt-5 rounded-xl border border-white/15 p-4">
          <h2 className="text-sm font-semibold">{copy.stopTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">{copy.stop}</p>
          <code className="mt-2 block break-words text-sm font-semibold text-violet-200">{WHATSAPP_SUPPORT_STOP}</code>
        </div>
        <p className="mt-4 text-sm leading-7 text-slate-200">{copy.instruction}</p>
        <code className="mt-2 block break-words text-xs text-slate-300">{WHATSAPP_SUPPORT_START}</code>
        <label htmlFor={consentId} className="mt-5 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-white/20 p-3 text-sm leading-6">
          <input id={consentId} type="checkbox" checked={consented} onChange={event => setConsentedLanguage(event.target.checked ? language : null)} className="mt-1 h-5 w-5 shrink-0 accent-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300" />
          <span>{copy.consent}</span>
        </label>
        <a role="link" href={consented ? WHATSAPP_SUPPORT_URL : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!consented} tabIndex={consented ? 0 : -1}
          onClick={event => { if (!consented) event.preventDefault(); }}
          className={`mt-3 flex min-h-[48px] items-center justify-center rounded-xl px-4 py-3 text-center text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${consented ? 'bg-violet-600 text-white hover:bg-violet-500' : 'cursor-not-allowed border border-white/15 text-slate-400'}`}>
          {copy.open}
        </a>
        {!consented && <p className="mt-2 text-xs leading-5 text-slate-300">{copy.unchecked}</p>}
        <p className="mt-4 text-xs leading-6 text-slate-300">{copy.manual}</p>
      </section>
    </div>
  </main>;
}
