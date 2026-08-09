import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { pickHomeCopy, type HomeLang } from './homeCopy';
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

/** Next upcoming saved plan, if signed in. Same query MobileHome used, kept so
 *  a returning traveller still lands on their trip instead of the pitch. */
function useNextTrip() {
  const { user } = useAuth();
  const [nextTrip, setNextTrip] = useState<{ title: string; dday: number; date: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'plans'), where('uid', '==', user.uid)));
        const now = Date.now();
        let nearest: { title: string; dday: number; date: string } | null = null;
        snap.forEach((d) => {
          const data = d.data();
          const sd = data.input?.startDate;
          if (!sd) return;
          const dday = Math.ceil((new Date(sd).getTime() - now) / 86400000);
          if (dday >= 0 && (!nearest || dday < nearest.dday)) {
            nearest = { title: data.itinerary?.tour_title || 'Korea Trip', dday, date: sd };
          }
        });
        if (!cancelled) setNextTrip(nearest);
      } catch { /* silent — the home page must render without Firestore */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Derived, not reset inside the effect: signing out has to hide the strip
  // immediately, and a synchronous setState in an effect body just to clear
  // state is a cascading render (react-hooks/set-state-in-effect).
  return user ? nextTrip : null;
}

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
