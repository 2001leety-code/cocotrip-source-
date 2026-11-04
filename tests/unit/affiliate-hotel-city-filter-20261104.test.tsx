// @vitest-environment jsdom
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildAccommodationLinks, tripAffiliateQuery } from '../../src/config/affiliateLinks';
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'en', t: { planner: {} } }) }));
vi.mock('@/lib/affiliateTracking', () => ({ trackAffiliateClick: vi.fn() }));
vi.mock('@/components/AffiliateCard', () => ({ AffiliateCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
import { AccommodationRecommendation } from '../../src/pages/PlanDetailPage/components/AccommodationRecommendation';
import { HotelAd } from '../../src/pages/PlanDetailPage/components/ads/HotelAd';

const hotel = 'Hotel A & B';
function link(region: string) { return new URL(buildAccommodationLinks(hotel, region)[0].url); }
describe('hotel city filter preserves supplied city instead of silently selecting Seoul', () => {
  it.each([['Busan', '759'], ['busan', '759'], [' BUSAN ', '759'], ['부산', '759'], ['Seoul', '274'], ['Gyeongju', '3786']])('%s uses its existing city ID', (region, id) => {
    const url = link(region);
    expect(url.searchParams.get('city')).toBe(id);
    expect(url.searchParams.get('keyword')).toBe(hotel);
  });
  it.each(['Haeundae', 'Jeonju', 'Unmapped City', ''])('unmapped %s does not invent a Seoul filter', (region) => {
    const url = link(region);
    expect(url.searchParams.has('city')).toBe(false);
    expect(url.searchParams.get('keyword')).toContain(hotel);
    if (region) expect(url.searchParams.get('keyword')).toContain(region);
  });
  it('keeps existing affiliate query and safely encodes the hotel name', () => {
    for (const region of ['Seoul', 'Busan', 'Haeundae']) {
      const url = link(region);
      expect(url.origin + url.pathname).toBe('https://www.trip.com/hotels/list');
      for (const [key, value] of new URLSearchParams(tripAffiliateQuery())) expect(url.searchParams.get(key)).toBe(value);
      expect(url.searchParams.getAll('keyword')).toHaveLength(1);
    }
  });
  it.each([['Busan', 'Haeundae', null], ['Seoul', 'Busan', '759'], ['Busan', 'Seoul', '274']])('trip city %s does not override the accommodation location %s', (tripCity, area, expectedId) => {
    const html = renderToStaticMarkup(<AccommodationRecommendation acc={{ name: hotel, area }} region={tripCity} />);
    const element = new DOMParser().parseFromString(html, 'text/html').querySelector('a');
    expect(element).not.toBeNull();
    const url = new URL(element!.getAttribute('href')!);
    expect(url.searchParams.get('city')).toBe(expectedId);
    if (expectedId === null) expect(url.searchParams.get('keyword')).toContain(area);
    expect(element!.getAttribute('rel')).toContain('sponsored');
    expect(html).toContain(area);
  });
  it('keeps the active HotelAd lowercase Busan region on the Busan city filter', () => {
    const html = renderToStaticMarkup(<HotelAd region="busan" />);
    const element = new DOMParser().parseFromString(html, 'text/html').querySelector('a');
    expect(new URL(element!.getAttribute('href')!).searchParams.get('city')).toBe('759');
  });
});
