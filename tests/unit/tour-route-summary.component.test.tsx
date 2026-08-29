// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TourRouteSummary } from '../../src/components/tours/TourRouteSummary';
import { TOURS } from '../../src/data/tours';
import type { I18nString } from '../../src/data/tours';
import type { Language } from '../../src/i18n';
import { INDEXABLE_ROUTES } from '../../src/lib/seoRoutes';
import {
  getTourRouteEditorial,
  TOUR_ROUTE_EDITORIAL_IDS,
  TOUR_ROUTE_LABELS,
} from '../../src/pages/tourRouteEditorial';

void React;

afterEach(() => cleanup());

const LANGUAGES: Language[] = ['ko', 'en', 'ja', 'zh'];
const EXPECTED = {
  'tour-seoul-city': {
    slug: 'seoul-city-full-day',
    durationHours: 9,
    stopCount: 7,
    localSchedule: '09:30–18:00',
    hrefs: ['/region/seoul', '/guide/how-to-rent-hanbok-explore-seoul'],
  },
  'tour-ganghwa': {
    slug: 'incheon-ganghwa-tour',
    durationHours: 9,
    stopCount: 4,
    localSchedule: '10:30–15:30',
    hrefs: ['/region/ganghwa', '/guide/best-temple-stays-in-korea-2026-guide'],
  },
  'tour-gyeongju': {
    slug: 'gyeongju-day-tour',
    durationHours: 11,
    stopCount: 5,
    localSchedule: '10:00–17:00',
    hrefs: ['/region/gyeongju', '/guide/gyeongju-koreas-open-air-museum-guide'],
  },
} as const;

function expectFourLanguages(field: I18nString, context: string) {
  for (const language of LANGUAGES) {
    expect(field[language].trim().length, `${context}.${language}`).toBeGreaterThan(0);
  }
}

describe('색인 보강 투어의 실제 동선 요약', () => {
  it('대상은 요청된 세 투어뿐이며 모든 문구가 4개 언어로 완성돼 있다', () => {
    expect([...TOUR_ROUTE_EDITORIAL_IDS].sort()).toEqual(Object.keys(EXPECTED).sort());

    Object.keys(TOUR_ROUTE_LABELS).forEach((key) => {
      expectFourLanguages(TOUR_ROUTE_LABELS[key], `labels.${key}`);
    });

    for (const tourId of TOUR_ROUTE_EDITORIAL_IDS) {
      const editorial = getTourRouteEditorial(tourId);
      expect(editorial, tourId).toBeTruthy();
      expectFourLanguages(editorial!.context, `${tourId}.context`);
      expect(editorial!.links).toHaveLength(2);
      editorial!.links.forEach((link, index) => {
        expectFourLanguages(link.label, `${tourId}.links[${index}].label`);
        expectFourLanguages(link.description, `${tourId}.links[${index}].description`);
      });
    }
  });

  it('소요시간·정류장 수·현지 첫/마지막 시간이 tours.ts와 일치한다', () => {
    for (const [tourId, expected] of Object.entries(EXPECTED)) {
      const tour = TOURS.find((candidate) => candidate.id === tourId);
      expect(tour, tourId).toBeTruthy();
      expect(tour!.slug).toBe(expected.slug);
      expect(tour!.durationHours).toBe(expected.durationHours);
      expect(tour!.stops).toHaveLength(expected.stopCount);
      expect(`${tour!.stops![0].time}–${tour!.stops![tour!.stops!.length - 1].time}`).toBe(expected.localSchedule);
    }
  });

  it('지역·가이드 링크는 모두 색인 대상이며 실제 <a href>로 렌더된다', () => {
    for (const [tourId, expected] of Object.entries(EXPECTED)) {
      cleanup();
      const tour = TOURS.find((candidate) => candidate.id === tourId)!;
      const { container } = render(<TourRouteSummary tour={tour} language="en" />);
      const hrefs = Array.from(container.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href'));

      expect(hrefs).toEqual(expected.hrefs);
      expected.hrefs.forEach((href) => expect(INDEXABLE_ROUTES).toContain(href));
      container.querySelectorAll('a').forEach((anchor) => {
        expect(anchor.className).toContain('min-h-[44px]');
      });
    }
  });

  for (const language of LANGUAGES) {
    it(`${language}: 현재 tours.ts의 정류장 순서와 해당 언어 설명을 렌더한다`, () => {
      for (const tourId of TOUR_ROUTE_EDITORIAL_IDS) {
        cleanup();
        const tour = TOURS.find((candidate) => candidate.id === tourId)!;
        const editorial = getTourRouteEditorial(tourId)!;
        const { container } = render(<TourRouteSummary tour={tour} language={language} />);
        const text = container.textContent || '';

        expect(text).toContain(editorial.context[language]);
        expect(text).toContain(TOUR_ROUTE_LABELS.title[language]);
        tour.stops!.forEach((stop) => expect(text).toContain(stop.name[language]));
      }
    });
  }

  it('TourDetailPage 일정 섹션에 연결되고 다른 투어에는 빈 요소도 만들지 않는다', () => {
    const page = readFileSync(path.join(process.cwd(), 'src', 'pages', 'TourDetailPage.tsx'), 'utf8');
    expect(page).toContain('<TourRouteSummary tour={tour} language={language} />');

    const otherTour = TOURS.find((tour) => !TOUR_ROUTE_EDITORIAL_IDS.includes(tour.id))!;
    const { container } = render(<TourRouteSummary tour={otherTour} language="en" />);
    expect(container).toBeEmptyDOMElement();
  });
});
