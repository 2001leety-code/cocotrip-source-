// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import en from '../../src/i18n/locales/en.json';
import ko from '../../src/i18n/locales/ko.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';

void React;
const state = vi.hoisted(() => ({ language: 'en', t: {} as Record<string, unknown> }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ ...state, changeLanguage: vi.fn() }) }));
// Header/footer contact and authentication integrations are outside this public-copy test.
vi.mock('@/sections/Header', () => ({ Header: () => null }));
vi.mock('@/sections/Footer', () => ({ Footer: () => null }));
const { RegionDetail } = await import('../../src/pages/RegionDetail');
const { RegionSeoInfo } = await import('../../src/components/region/RegionSeoInfo');

afterEach(() => cleanup());

const regions = ['paju', 'ganghwa', 'busan', 'danyang', 'incheon', 'gyeongju', 'jeonju'];
const locales = { en, ko, ja, zh };

describe('public region search purpose', () => {
  for (const [language, locale] of Object.entries(locales)) {
    it(`${language}: region metadata describes the trip, while shared city labels stay short`, () => {
      state.language = language;
      state.t = locale;
      const titles = new Set<string>();
      for (const region of regions) {
        const entry = locale.regionDetail[region as keyof typeof locale.regionDetail] as { title: string; description: string };
        const { unmount } = render(<MemoryRouter initialEntries={[`/region/${region}`]}><Routes>
          <Route path="/region/:regionId" element={<RegionDetail />} />
        </Routes></MemoryRouter>);
        expect(document.title).toContain(entry.title);
        expect(document.title).not.toBe(`${entry.title} | CocoTrip`);
        expect(document.title.split(' | CocoTrip')).toHaveLength(2);
        titles.add(document.title);
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading).toHaveTextContent(entry.title);
        expect(heading.textContent).not.toBe(entry.title);
        expect(document.querySelector('meta[name="description"]')).toHaveAttribute('content', entry.description);
        unmount();
      }
      expect(titles.size).toBe(7);
    });
  }

  it('does not advertise the Incheon city attractions as the fixed Ganghwa product', () => {
    const { container } = render(<RegionSeoInfo regionId="incheon" regionTitle="Incheon" language="en" />);
    const heading = [...container.querySelectorAll('h2')].find((node) => node.textContent === 'Ways to visit with CocoTrip');
    const ways = heading?.parentElement;
    expect(ways).toHaveTextContent('Ganghwa');
    expect(ways).not.toHaveTextContent('the Incheon route is already planned');
    const firstWay = ways?.querySelector('li');
    expect(firstWay).toHaveTextContent('pickup');
  });

  it.each(['ko', 'en', 'ja', 'zh'])('%s: a region without a set tour gets one charter option, not duplicates', (language) => {
    const { container } = render(<RegionSeoInfo regionId="jeonju" regionTitle="Jeonju" language={language} />);
    const list = container.querySelector('ul[style]');
    expect(list?.querySelectorAll('li')).toHaveLength(2);
    const links = [...container.querySelectorAll('a[href]')];
    expect(links.some((link) => link.getAttribute('href') === '/charter')).toBe(true);
  });
});
