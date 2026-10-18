import '@/styles/home-dope.css';
import '@/styles/home-dope-static.css';
import { useLocation } from 'react-router-dom';
import { ArrowRight, Plane } from 'lucide-react';

import { usePageMeta } from '@/hooks/usePageMeta';
import { buildLinkHubDestination } from '@/lib/linkInBio';
import { useLanguage } from '@/hooks/useLanguage';
import { whatsappSupportCopy } from '@/lib/whatsappSupportCopy';
import { SkyLayer } from '@/sections/home/SkyLayer';
import { pickHomeCopy } from '@/sections/home/homeCopy';

/**
 * SNS 프로필의 "link in bio" 목적지 (2026-08-17).
 *
 * Instagram·TikTok 은 프로필 링크를 API 로 못 바꾼다. 그래서 바이오에는 이 한 곳만
 * 고정해 두고, 어디로 보낼지는 우리가 웹에서 바꾼다.
 *
 * 헤더·푸터를 쓰지 않는다. SNS 에서 넘어온 사람은 한 화면에서 한 번 더 누르고 끝나야 하고,
 * 전역 내비게이션은 그 한 번을 방해한다.
 *
 * `seoRoutes.ts` 목록에 없으므로 자동으로 noindex 다 — 검색에 노출될 이유가 없는 허브다.
 */

type Destination = {
  path: string;
  content: string;
  title: string;
  subtitle: string;
  primary?: boolean;
};

const DESTINATIONS: Destination[] = [
  {
    path: '/planner',
    content: 'planner',
    title: 'Build my Korea plan — free',
    subtitle: 'A day-by-day itinerary in minutes. No signup.',
    primary: true,
  },
  {
    path: '/tours',
    content: 'tours',
    title: 'Private tours',
    subtitle: 'Seoul, Busan, Gyeongju, DMZ and more, with your own guide.',
  },
  {
    path: '/charter',
    content: 'charter',
    title: 'Charter a vehicle',
    subtitle: 'Airport pickup or a full day with a driver.',
  },
];

/** Eyebrow only; every other string on the hub is the existing English copy. */
const EYEBROW: Record<string, string> = {
  ko: 'CocoTrip · 채널 안내',
  en: 'CocoTrip · Links',
  ja: 'CocoTrip · リンク',
  zh: 'CocoTrip · 链接',
};

/** Pass chips: the place names the tours subtitle already lists. */
const CHIPS = ['Seoul', 'Busan', 'Gyeongju', 'DMZ'];

/**
 * 2026-10-11: Home 의 어휘(하늘 히어로 + 패스 카드)로 다시 입혔다. 패스는 순환하지 않는
 * 정적 카드다. 모든 href 는 그대로 `buildLinkHubDestination` 을 거친다(UTM 유지).
 */
export default function LinksPage() {
  const { search } = useLocation();
  const { language } = useLanguage();
  const supportCopy = whatsappSupportCopy[language];
  const sky = pickHomeCopy(language).hero.sky;
  const [planner, tours] = DESTINATIONS;
  const href = (destination: Destination) =>
    buildLinkHubDestination(destination.path, search, destination.content);

  usePageMeta({
    title: 'CocoTrip — Korea trips planned in minutes',
    description:
      'Plan a Korea trip in minutes with a free AI itinerary, or book a private tour or charter vehicle.',
    ogImage: '/hero-hanok-real.webp',
  });

  return (
    <main className="ec-root home-dope home-dope--static min-h-screen">
      <section className="home-dope-hero">
        <SkyLayer playLabel={sky.play} pauseLabel={sky.pause} />

        <div className="home-dope-hero__inner">
          <div className="home-dope-hero__copy">
            <p className="ec-eyebrow home-dope-eyebrow">{EYEBROW[language] || EYEBROW.en}</p>
            <h1 className="home-dope-h1" lang="en" aria-label="Korea trips planned in minutes">
              <span aria-hidden="true" className="home-dope-h1__line">
                <span className="is-serif">Korea trips</span>
              </span>
              <span aria-hidden="true" className="home-dope-h1__line">
                <span className="is-sans">planned in minutes</span>
              </span>
            </h1>
            <p className="home-dope-lede" lang="en">
              Plan a Korea trip in minutes with a free AI itinerary, or book a private tour or charter vehicle.
            </p>
            <div className="home-dope-hero__cta" lang="en">
              <a href={href(planner)} className="home-dope-btn home-dope-btn--primary">
                {planner.title}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a href={href(tours)} className="home-dope-btn home-dope-btn--ghost">
                {tours.title}
              </a>
            </div>
          </div>

          <div className="home-dope-pass-wrap">
            <div className="home-dope-pass" data-collapsed="false">
              <div className="home-dope-pass__body">
                <div className="home-dope-pass__head">
                  <p className="home-dope-pass__title">
                    <Plane className="h-4 w-4 shrink-0" aria-hidden />
                    CocoTrip
                  </p>
                  <div className="home-dope-pass__controls">
                    <span className="home-dope-sample">@cocotripkr</span>
                  </div>
                </div>

                <div className="home-dope-pass__cycle" lang="en">
                  <div>
                    <ul className="home-dope-pass__chips">
                      {CHIPS.map((chip) => <li key={chip}>{chip}</li>)}
                    </ul>
                    <nav aria-label="CocoTrip links">
                      <ol className="home-dope-pass__stops">
                        {DESTINATIONS.map((destination, i) => (
                          <li key={destination.content}>
                            <a href={href(destination)}>
                              <span className="ec-figure">{String(i + 1).padStart(2, '0')}</span> {destination.title}
                              <span className="block text-[12px] opacity-80">{destination.subtitle}</span>
                            </a>
                          </li>
                        ))}
                      </ol>
                    </nav>
                  </div>
                </div>

                <p className="home-dope-pass__start" lang="en">WhatsApp · Email</p>

                <div className="home-dope-pass__cta">
                  <a href="/whatsapp-support" className="home-dope-btn home-dope-btn--primary">
                    {supportCopy.linksTitle}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </a>
                  <p className="m-0 text-[13px] leading-5 opacity-80">{supportCopy.linksSubtitle}</p>
                  <a href="mailto:cocotripkr@gmail.com" className="home-dope-textlink">
                    cocotripkr@gmail.com
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
