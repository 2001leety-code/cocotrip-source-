import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { regionPath } from '@/data/regions';
import type { HomeCopy } from './homeCopy';

/**
 * 지역 페이지로 들어가는 크롤 가능한 입구 (2026-08-23).
 *
 * 🔴 왜 새로 만드는가: `/region/*` 9개는 sitemap 에 있고 프리렌더도 되는데 **색인 대상
 *    페이지 어디에서도 들어오는 앵커가 0개**였다. 구 홈의 지역 카드(`sections/Regions.tsx`)는
 *    `<div onClick={navigate}>` 였다 — 크롤러에게는 링크가 아니고, 키보드로도 못 간다.
 *    지금 홈(`sections/home`)은 그 컴포넌트를 아예 안 쓴다. 즉 9개가 통째로 고아였다.
 *
 * 그래서 여기 있는 것은 전부 진짜 `<Link>`(= `<a href>`)다. 프리렌더 HTML 에 그대로
 * 실리고, JS 없이도 따라갈 수 있고, 탭으로 순서대로 지나간다.
 *
 * 지역 이름·한 줄 설명은 `t.regionDetail.<id>` — 지역 페이지가 이미 쓰는 그 값이다.
 * 여기서 지역에 대한 새 사실을 만들지 않는다.
 */

/** 이 섹션의 앵커 이름. `id` 와 링크 대상이 한 상수에서 나온다. */
export const REGIONS_SECTION_ID = 'regions';
const REGIONS_HASH = `#${REGIONS_SECTION_ID}`;

/**
 * `/#regions` 로 들어왔을 때 이 섹션까지 내려준다 (2026-08-23).
 *
 * 🔴 왜 필요한가: 브라우저의 기본 해시 점프는 **문서를 새로 받을 때** 일어난다. About 이나
 *    지역 상세에서 `/#regions` 를 누르면 SPA 라우팅이라 문서를 새로 받지 않고, 게다가 홈은
 *    lazy 청크라 그 시점엔 이 섹션이 아직 DOM 에 없다. 그래서 아무 데도 안 간다.
 *
 * 그래서 착지를 **섹션 자신이** 책임진다 — 이 컴포넌트가 마운트되는 순간이 곧 대상이
 * 존재하게 되는 순간이다.
 *
 * 지켜야 하는 것
 *   · 해시가 정확히 `#regions` 일 때만. 그냥 홈(`/`)에 온 손님을 끌어내리면 안 된다
 *     (visual baseline 이 "이름과 다른 화면"을 찍게 만든 그 사고가 바로 이것이다).
 *   · `prefers-reduced-motion: reduce` 면 smooth 를 쓰지 않는다 — 전정기관 문제를 가진
 *     사용자에게 부드러운 스크롤은 증상이다.
 *   · SSR·프리렌더에서 안전해야 한다. window·matchMedia·scrollIntoView 가 없을 수 있으니
 *     전부 존재를 확인하고, 없으면 아무 일도 하지 않는다(프리렌더 경로엔 해시가 없다).
 */
function useRegionsHashLanding(target: React.RefObject<HTMLElement | null>) {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash !== REGIONS_HASH) return;
    const element = target.current;
    if (!element || typeof element.scrollIntoView !== 'function') return;
    const reduceMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [hash, target]);
}

export interface RegionLink {
  id: string;
  title: string;
  subtitle: string;
}

interface Props {
  copy: HomeCopy;
  regions: readonly RegionLink[];
}

export function RegionLinks({ copy, regions }: Props) {
  // 훅은 조건부 return 위에 있어야 한다 — 목록이 비는 언어에서 훅 순서가 달라지면 안 된다.
  const section = useRef<HTMLElement | null>(null);
  useRegionsHashLanding(section);

  if (regions.length === 0) return null;
  const c = copy.regions;

  return (
    // RegionDetail 의 "지역 목록으로" 링크와 /about 의 지역 링크가 /#regions 를 가리킨다 —
    // 그 앵커의 착지점이자, 위 훅이 스크롤시킬 대상이다.
    <section
      ref={section}
      id={REGIONS_SECTION_ID}
      className="border-b border-ec-line"
      aria-labelledby="home-regions"
    >
      <div className="ec-container-wide py-12 md:py-16">
        <p className="ec-eyebrow">{c.eyebrow}</p>
        <h2 id="home-regions" className="ec-h2 mt-4 max-w-[24ch]">{c.heading}</h2>
        <p className="ec-body ec-measure mt-5">{c.lede}</p>

        {/* 모바일 390 에서는 한 줄에 하나(제목 + 한 줄 설명이 잘리지 않는 최소 폭),
            넓어지면 2·3열. 각 행이 44px 이상이라 손가락으로도 정확히 눌린다. */}
        <ul className="mt-8 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {regions.map((region) => (
            <li key={region.id}>
              <Link
                to={regionPath(region.id)}
                className="group flex min-h-[44px] items-center gap-3 border-t border-ec-line py-4"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-snug text-ec-ink">
                    {region.title}
                  </span>
                  <span className="ec-body-sm mt-1 block text-ec-ink-2">{region.subtitle}</span>
                </span>
                <ArrowRight
                  className="h-4 w-4 shrink-0 text-ec-ink-3 transition-transform duration-ec-base ease-ec-standard group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
