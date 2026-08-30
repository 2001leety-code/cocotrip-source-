import { ArrowRight, Mail, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Header } from '@/sections/Header';
import { Footer } from '@/sections/Footer';
import { pickAccountDeletionCopy } from './accountDeletionCopy';

const SUPPORT_EMAIL = 'cocotripkr@gmail.com';
const REQUEST_SUBJECT = '[CocoTrip] Account deletion request';
const REQUEST_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(REQUEST_SUBJECT)}`;

export default function AccountDeletion() {
  const { language, t, changeLanguage } = useLanguage();
  const copy = pickAccountDeletionCopy(language);

  usePageMeta({
    title: copy.title,
    description: copy.lede,
    robots: 'noindex, nofollow',
  });

  return (
    <div className="ec-root min-h-screen">
      <Header language={language} t={t} onLanguageChange={changeLanguage} />

      <main>
        <section className="border-b border-ec-line">
          <div className="ec-container-wide py-10 md:py-14">
            <p className="ec-eyebrow">{copy.eyebrow}</p>
            <h1 className="ec-h2 mt-4 max-w-[24ch] text-[clamp(26px,3.4vw,40px)]">{copy.title}</h1>
            <p className="ec-body ec-measure mt-5">{copy.lede}</p>
          </div>
        </section>

        <section className="border-b border-ec-line bg-ec-sunken">
          <div className="ec-container-wide py-10 md:py-14">
            <div className="max-w-3xl rounded-ec-md border border-ec-line-2 bg-ec-raised p-5 md:p-7">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-ec-brand" aria-hidden />
                <h2 className="ec-h3">{copy.howTitle}</h2>
              </div>
              <ol className="mt-5 space-y-3 pl-5 text-[15px] leading-7 text-ec-ink-2">
                {copy.steps.map((step) => <li key={step} className="list-decimal pl-1">{step}</li>)}
              </ol>
              <a
                href={REQUEST_MAILTO}
                className="ec-btn ec-btn-primary mt-6 min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ec-brand"
              >
                {copy.cta}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <p className="ec-body-sm mt-5 text-ec-ink-2">{copy.signInNote}</p>
            </div>
          </div>
        </section>

        <section className="border-b border-ec-line">
          <div className="ec-container-wide grid gap-8 py-10 md:grid-cols-2 md:py-14">
            <div className="border-t border-ec-line pt-5">
              <h2 className="ec-h3">{copy.scopeTitle}</h2>
              <p className="ec-body-sm mt-3 text-ec-ink-2">{copy.scopeBody}</p>
              <Link
                to="/privacy"
                className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-semibold text-ec-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ec-brand"
              >
                {copy.privacyLink}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
            <div className="border-t border-ec-line pt-5">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-ec-brand" aria-hidden />
                <h2 className="ec-h3">{copy.safetyTitle}</h2>
              </div>
              <p className="ec-body-sm mt-3 text-ec-ink-2">{copy.safetyBody}</p>
            </div>
          </div>
        </section>
      </main>

      <Footer t={t} />
    </div>
  );
}
