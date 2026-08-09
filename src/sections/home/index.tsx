import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { pickHomeCopy, type HomeLang } from './homeCopy';
import { useNextTrip } from './useNextTrip';
import { EditorialHero } from './EditorialHero';
import { CapabilityLedger } from './CapabilityLedger';
import { ServiceModules } from './ServiceModules';
import { ItinerarySpecimen } from './ItinerarySpecimen';
import { ClosingSections } from './ClosingSections';

/**
 * Home — Korea Editorial Concierge (2026-08-10).
 *
 * One responsive tree for every breakpoint. It replaces a three-way fork
 * (desktop sections + MobileHome + MobileHomeV2) where the same content had
 * drifted into three visual languages; the old components stay on disk because
 * other pages and tests still reference them, and are retired with their pages
 * in the next PR.
 *
 * Section order is the reading order of the argument:
 *   claim → what it is built from → what you can buy → proof → who says so → act.
 */

const SPECIMEN_ID = 'sample-day';

export function HomeEditorial() {
  const { language } = useLanguage();
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as HomeLang;
  const copy = pickHomeCopy(lang);
  const nextTrip = useNextTrip();

  return (
    <main className="ec-root">
      {/* Continuation strip — only for a signed-in traveller with a dated plan.
          A quiet rule above the pitch, not a card competing with the hero. */}
      {nextTrip && (
        <div className="border-b border-ec-line bg-ec-raised">
          <Link
            to="/my-plans"
            className="ec-container-wide flex min-h-[56px] items-center gap-3 text-[14px]"
          >
            <span className="ec-eyebrow shrink-0">{copy.resume.label}</span>
            <span className="ec-figure shrink-0 text-[13px] text-ec-brand">
              {nextTrip.dday === 0 ? 'D-0' : `D-${nextTrip.dday}`}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium text-ec-ink">{nextTrip.title}</span>
            <span className="hidden shrink-0 items-center gap-1 font-semibold text-ec-brand sm:flex">
              {copy.resume.cta}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>
        </div>
      )}

      <EditorialHero copy={copy} lang={lang} specimenId={SPECIMEN_ID} />
      <CapabilityLedger copy={copy} />
      <ServiceModules copy={copy} lang={lang} />
      <ItinerarySpecimen copy={copy} lang={lang} id={SPECIMEN_ID} />
      <ClosingSections copy={copy} />
    </main>
  );
}

export default HomeEditorial;
