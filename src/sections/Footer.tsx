import { Phone, Mail, MapPin, CreditCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CookieSettings } from '@/components/CookieSettings';
import type { Translations } from '@/i18n';

/**
 * Common shell footer — Korea Editorial Concierge (2026-08-10).
 *
 * One responsive footer replaces the previous mobile/desktop fork (two markup
 * trees, two colour systems, the same content). Links, routes and the legal
 * block are unchanged; the registration numbers are the point of the section,
 * so they get the layout weight rather than a decorative brand lockup.
 */

interface FooterProps {
  t: Translations;
}

const LEGAL_LINKS = [
  { to: '/about', key: 'about' },
  { to: '/terms', key: 'terms' },
  { to: '/privacy', key: 'privacy' },
  { to: '/travel-terms', key: 'travelTerms' },
] as const;

export function Footer({ t }: FooterProps) {
  const f = t.footer;

  return (
    <footer className="ec-root ec-no-print bg-ec-sunken border-t border-ec-line pb-20 md:pb-0">
      <div className="ec-container-wide py-12 md:py-16">

        {/* ── Row 1: identity + contact + links ── */}
        <div className="grid gap-10 md:grid-cols-12">

          {/* Identity + registration. The numbers are the trust signal. */}
          <div className="md:col-span-5">
            <div className="flex items-center gap-2">
              <img src="/icons/icon-192.png" alt="" aria-hidden width={28} height={28} className="h-7 w-7 rounded-ec-sm" />
              <span className="text-[18px] font-bold tracking-[-0.02em] text-ec-ink">COCOTRIP</span>
            </div>
            <p className="ec-body-sm mt-2">{f.tagline}</p>

            <dl className="mt-6 space-y-2 text-[13px] text-ec-ink-2">
              <div className="flex gap-2">
                <dt className="sr-only">CEO</dt>
                <dd>{f.ceo}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 pt-0.5"><MapPin className="w-4 h-4 text-ec-ink-3" aria-hidden /></dt>
                <dd>{f.address}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 pt-0.5"><Mail className="w-4 h-4 text-ec-ink-3" aria-hidden /></dt>
                <dd>{f.email}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="sr-only">Business registration</dt>
                <dd className="ec-figure text-[13px] font-medium text-ec-ink-2">{f.businessNo}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="sr-only">Tour operator registration</dt>
                <dd className="ec-figure text-[13px] font-medium text-ec-ink-2">{f.tourNo}</dd>
              </div>
            </dl>
          </div>

          {/* Customer service */}
          <div className="md:col-span-4">
            <p className="ec-eyebrow">{f.cs}</p>
            <hr className="ec-rule mt-3 mb-4" />
            <a
              href="tel:+821087140611"
              className="ec-figure inline-flex min-h-[44px] items-center gap-2 text-[24px] text-ec-ink transition-colors duration-ec-base ease-ec-standard hover:text-ec-brand"
            >
              <Phone className="w-5 h-5" aria-hidden />
              {f.phone}
            </a>
            <p className="ec-body-sm mt-2">{f.hours}</p>
            <p className="mt-4 flex items-center gap-2 text-[13px] text-ec-ink-2">
              <CreditCard className="w-4 h-4 text-ec-ink-3" aria-hidden />
              <span>{f.payment}</span>
            </p>
            <a
              href="https://wa.me/821087140611"
              target="_blank"
              rel="noopener noreferrer"
              className="ec-btn ec-btn-secondary ec-btn-sm min-h-[44px] mt-5"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              <span>WhatsApp</span>
            </a>
          </div>

          {/* Quick links */}
          <div className="md:col-span-3">
            <p className="ec-eyebrow">{f.quickLinks}</p>
            <hr className="ec-rule mt-3 mb-1" />
            <nav>
              <Link to="/planner" className="flex items-center min-h-[44px] text-[14px] text-ec-ink-2 border-b border-ec-line transition-colors duration-ec-base ease-ec-standard hover:text-ec-ink">{t.nav.planner || 'Trip Planner'}</Link>
              <Link to="/tours" className="flex items-center min-h-[44px] text-[14px] text-ec-ink-2 border-b border-ec-line transition-colors duration-ec-base ease-ec-standard hover:text-ec-ink">{t.nav.tours || 'Tours'}</Link>
              <Link to="/charter" className="flex items-center min-h-[44px] text-[14px] text-ec-ink-2 border-b border-ec-line transition-colors duration-ec-base ease-ec-standard hover:text-ec-ink">{t.nav.charter || 'Charter'}</Link>
              {/* 외부 블로그 — 권위 전달 목적이라 nofollow 금지 */}
              <Link to="/guide" className="flex items-center min-h-[44px] text-[14px] text-ec-ink-2 border-b border-ec-line transition-colors duration-ec-base ease-ec-standard hover:text-ec-ink">{f.blog || 'Korea Travel Blog'}</Link>
            </nav>
          </div>
        </div>

        {/* ── Row 2: legal + copyright ── */}
        <hr className="ec-rule mt-12 mb-6" />
        <div className="flex flex-col-reverse gap-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] text-ec-ink-3">{f.copyright}</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="inline-flex items-center min-h-[44px] text-[13px] text-ec-ink-2 transition-colors duration-ec-base ease-ec-standard hover:text-ec-ink"
              >
                {f[l.key]}
              </Link>
            ))}
            {/* 🔴 P1-1: 동의를 **바꿀 수 있는** 상시 진입점. 배너는 한 번 닫으면 다시 안 뜬다. */}
            <CookieSettings className="inline-flex items-center min-h-[44px] text-[13px] text-ec-ink-2 transition-colors duration-ec-base ease-ec-standard hover:text-ec-ink" />
          </div>
        </div>
      </div>
    </footer>
  );
}
