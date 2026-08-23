// @vitest-environment jsdom
/**
 * /region/* 유입 링크 (2026-08-23).
 *
 * 🔴 실측한 결함: 지역 9개는 sitemap 에 있고 프리렌더도 되는데 **색인 대상 페이지에서
 *    들어오는 크롤 가능한 앵커가 0개**였다. 구 홈의 지역 카드(`sections/Regions.tsx`)는
 *    `<div onClick={navigate}>` 라 크롤러에게 링크가 아니고 키보드로도 못 간다. 게다가
 *    지금 홈(`sections/home`)은 그 컴포넌트를 아예 쓰지 않는다 — 9개가 통째로 고아였다.
 *
 * 잠그는 것
 *   1) 지역 id 원천이 하나다 — seoRoutes · regionTourSource · RegionDetail 사진표와 일치.
 *   2) 홈이 9개 전부에 진짜 `<a href="/region/...">` 를 낸다.
 *   3) 지역 상세가 나머지 8개로 이어진다(자기 자신 제외).
 *   4) 색인 대상 지역은 전부 얇지 않다 — 이름·한 줄·소개문·명소·사진이 4개 언어에 다 있다.
 *      데이터가 모자란 지역이 생기면 **여기가 빨개진다**: 채우거나 INDEXABLE_ROUTES 에서
 *      빼라는 뜻이다(얇은 페이지를 색인시키는 것이 가장 나쁜 선택지다).
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REGION_IDS, regionPath } from '../../src/data/regions';
import { INDEXABLE_ROUTES } from '../../src/lib/seoRoutes';
import { REGION_TOUR_SOURCE } from '../../src/components/region/regionTourSource';
import { RegionLinks } from '../../src/sections/home/RegionLinks';
import { pickHomeCopy } from '../../src/sections/home/homeCopy';
import en from '../../src/i18n/locales/en.json';
import ko from '../../src/i18n/locales/ko.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';

void React;

const LOCALES = { en, ko, ja, zh } as Record<string, { regionDetail: Record<string, unknown> }>;
const ROOT = process.cwd();

const state = vi.hoisted(() => ({ language: 'en', t: {} as Record<string, unknown> }));
const usePageMetaMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: state.language, t: state.t, changeLanguage: vi.fn() }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: usePageMetaMock }));
vi.mock('@/sections/Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('@/sections/Footer', () => ({ Footer: () => <div data-testid="footer" /> }));
vi.mock('@/components/region/RegionSeoInfo', () => ({
  RegionSeoInfo: ({ regionId }: { regionId: string }) => <section data-testid="region-seo-info">{regionId}</section>,
}));

const { RegionDetail } = await import('../../src/pages/RegionDetail');

function renderRegion(regionId: string) {
  return render(
    <MemoryRouter initialEntries={[`/region/${regionId}`]}>
      <Routes>
        <Route path="/region/:regionId" element={<RegionDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  state.language = 'en';
  state.t = en as unknown as Record<string, unknown>;
  usePageMetaMock.mockReset();
});

describe('지역 id 원천', () => {
  it('색인 경로의 /region/* 과 정확히 일치한다', () => {
    const routed = INDEXABLE_ROUTES.filter((r) => r.startsWith('/region/'));
    expect([...routed].sort()).toEqual(REGION_IDS.map(regionPath).sort());
  });

  it('투어 매핑표와 같은 지역을 다룬다', () => {
    expect(Object.keys(REGION_TOUR_SOURCE).sort()).toEqual([...REGION_IDS].sort());
  });

  it('RegionDetail 사진표와 같은 지역을 다룬다', () => {
    const src = readFileSync(path.join(ROOT, 'src', 'pages', 'RegionDetail.tsx'), 'utf8');
    const table = src.slice(src.indexOf('const regionImages'), src.indexOf('type RegionLanguage'));
    const keys = [...table.matchAll(/^ {2}([a-z]+): \[/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...REGION_IDS].sort());
  });
});

/**
 * 소개문 최소 길이는 **언어마다 다르다** — 한글·일본어·중국어는 같은 내용을 훨씬 적은
 * 글자로 적는다(실측: en 99~218 · ko 63~90 · ja 47~80 · zh 38~62). 영어 기준을 그대로
 * 들이대면 번역이 멀쩡한데 빨간불이 뜬다. 각 언어의 현재 최솟값 바로 아래를 문턱으로 둔다.
 */
const MIN_DESCRIPTION: Record<string, number> = { en: 90, ko: 55, ja: 40, zh: 35 };

describe('색인 대상 지역은 얇지 않다', () => {
  it.each(Object.keys(LOCALES))('%s: 9개 전부 제목·한 줄·소개문·명소를 갖는다', (lang) => {
    const table = LOCALES[lang].regionDetail;
    for (const id of REGION_IDS) {
      const entry = table[id] as {
        title?: string; subtitle?: string; description?: string; attractions?: unknown[];
      } | undefined;
      expect(entry, `${lang}.${id}`).toBeTruthy();
      expect((entry?.title || '').trim().length, `${lang}.${id} title`).toBeGreaterThan(0);
      expect((entry?.subtitle || '').trim().length, `${lang}.${id} subtitle`).toBeGreaterThan(0);
      expect((entry?.description || '').trim().length, `${lang}.${id} description`)
        .toBeGreaterThanOrEqual(MIN_DESCRIPTION[lang]);
      expect(entry?.attractions?.length || 0, `${lang}.${id} attractions`).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('홈 → 지역 (크롤 가능한 앵커)', () => {
  const regions = REGION_IDS.map((id) => {
    const entry = (en as unknown as { regionDetail: Record<string, { title: string; subtitle: string }> })
      .regionDetail[id];
    return { id, title: entry.title, subtitle: entry.subtitle };
  });

  it('9개 전부 <a href="/region/..."> 로 나온다', () => {
    render(
      <MemoryRouter>
        <RegionLinks copy={pickHomeCopy('en')} regions={regions} />
      </MemoryRouter>,
    );
    const section = screen.getByRole('region', { name: pickHomeCopy('en').regions.heading });
    const hrefs = within(section).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(REGION_IDS.map(regionPath));
  });

  it('RegionDetail 의 "지역 목록으로" 링크가 착지할 앵커(#regions)를 들고 있다', () => {
    const { container } = render(
      <MemoryRouter>
        <RegionLinks copy={pickHomeCopy('en')} regions={regions} />
      </MemoryRouter>,
    );
    expect(container.querySelector('#regions')).not.toBeNull();
  });

  it('번역이 없으면 그 지역은 목록에서 빠진다 — 빈 링크를 내지 않는다', () => {
    render(
      <MemoryRouter>
        <RegionLinks copy={pickHomeCopy('en')} regions={[]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('region', { name: pickHomeCopy('en').regions.heading })).toBeNull();
  });

  it('네 언어 모두 섹션 문구가 있다', () => {
    for (const lang of ['en', 'ko', 'ja', 'zh'] as const) {
      const c = pickHomeCopy(lang).regions;
      expect(c.eyebrow.trim().length, `${lang} eyebrow`).toBeGreaterThan(0);
      expect(c.heading.trim().length, `${lang} heading`).toBeGreaterThan(0);
      expect(c.lede.trim().length, `${lang} lede`).toBeGreaterThan(0);
    }
  });
});

describe('지역 → 지역 (상세끼리 잇기)', () => {
  it('나머지 8개로 이어지고 자기 자신은 없다', () => {
    const { container } = renderRegion('seoul');
    const links = Array.from(container.querySelectorAll('.region-editorial-other-link'))
      .map((a) => a.getAttribute('href'));
    expect(links).toEqual(REGION_IDS.filter((id) => id !== 'seoul').map(regionPath));
    expect(links).not.toContain('/region/seoul');
  });

  it('지역마다 링크 대상이 자기를 뺀 8개다', () => {
    for (const id of REGION_IDS) {
      cleanup();
      const { container } = renderRegion(id);
      const links = Array.from(container.querySelectorAll('.region-editorial-other-link'))
        .map((a) => a.getAttribute('href'));
      expect(links.length, `${id} sibling count`).toBe(REGION_IDS.length - 1);
      expect(links, `${id} self link`).not.toContain(regionPath(id));
    }
  });

  it('없는 지역 화면에는 그리지 않는다 (404 성 화면을 링크 더미로 만들지 않는다)', () => {
    const { container } = renderRegion('not-a-region');
    expect(container.querySelector('.region-editorial-other')).toBeNull();
  });
});
