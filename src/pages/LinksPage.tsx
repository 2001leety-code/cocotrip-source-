import { useLocation } from 'react-router-dom';

import { usePageMeta } from '@/hooks/usePageMeta';
import { buildLinkHubDestination } from '@/lib/linkInBio';

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

export default function LinksPage() {
  const { search } = useLocation();

  usePageMeta({
    title: 'CocoTrip — Korea trips planned in minutes',
    description:
      'Plan a Korea trip in minutes with a free AI itinerary, or book a private tour or charter vehicle.',
    ogImage: '/hero-hanok-real.webp',
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0a0412] via-[#0d0618] to-[#080210] px-5 py-12">
      <main className="mx-auto flex w-full max-w-md flex-col items-center">
        <img
          src="/brand/logo-mark-1024.png"
          alt="CocoTrip"
          width={72}
          height={72}
          className="mb-5 h-18 w-18 rounded-2xl"
        />
        <h1 className="text-center text-2xl font-black tracking-tight text-white">CocoTrip</h1>
        <p className="mt-2 mb-8 text-center text-sm text-white/70">
          Korea trips planned in minutes 🇰🇷
        </p>

        <nav className="flex w-full flex-col gap-3" aria-label="CocoTrip links">
          {DESTINATIONS.map((destination) => (
            <a
              key={destination.content}
              href={buildLinkHubDestination(destination.path, search, destination.content)}
              className={
                destination.primary
                  ? 'rounded-2xl bg-white px-5 py-4 text-center text-[#0a0412] shadow-lg transition-transform active:scale-[0.98]'
                  : 'rounded-2xl border border-white/15 bg-white/5 px-5 py-4 text-center text-white transition-transform active:scale-[0.98]'
              }
            >
              <span className="block text-base font-bold">{destination.title}</span>
              <span
                className={
                  destination.primary
                    ? 'mt-1 block text-xs text-[#0a0412]/70'
                    : 'mt-1 block text-xs text-white/60'
                }
              >
                {destination.subtitle}
              </span>
            </a>
          ))}
        </nav>

        <a
          href="mailto:cocotripkr@gmail.com"
          className="mt-8 text-xs text-white/50 underline underline-offset-4"
        >
          cocotripkr@gmail.com
        </a>
      </main>
    </div>
  );
}
