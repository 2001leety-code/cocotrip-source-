import { Link } from 'react-router-dom';
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
  if (regions.length === 0) return null;
  const c = copy.regions;

  return (
    // RegionDetail 의 "지역 목록으로" 링크가 /#regions 를 가리킨다 — 그 앵커의 착지점.
    <section id="regions" className="border-b border-ec-line" aria-labelledby="home-regions">
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
