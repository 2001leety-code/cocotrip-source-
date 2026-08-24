// @vitest-environment jsdom
/**
 * `QuickPreviewCard` (2026-08-24, planner-trust-course, client hardening B/C)
 * — map links must be built from server-owned identity only
 * (`parseQuickPreviewResponse` + `buildGoogleMapsUrl`, `quickPreviewContract.ts`),
 * never a model-authored spot name or an arbitrary `googleMapsUrl` the JSON
 * claims to carry (the parser does not even read that field). A malformed
 * `resultQuick` must render nothing, not a broken/partial card.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuickPreviewCard } from '../../src/pages/PlannerPage/components/QuickPreviewCard';

void React;

function validTable(): string {
  return (
    '| Time | Spot | Transit | Insider Tip |\n' +
    '|---|---|---|---|\n' +
    '| 10:00 | Gamcheon Culture Village | Start point | Go early for photos |\n' +
    '| 12:30 | Jagalchi Market | Subway Line 1, 10 min | Try the fresh sashimi |\n' +
    '| 15:00 | Haeundae Beach | Bus 100, 15 min | Sunset spot |'
  );
}

function baseData(): Record<string, unknown> {
  return {
    marketingNarrative: 'A great first day exploring Busan with beaches and food.',
    themes: ['Food', 'Coast'],
    day1MarkdownTable: validTable(),
    spotDetails: [
      { spot: 'Gamcheon Culture Village', type: 'attraction', candidateId: 'attr-1', key: 'gamcheon', lat: 35.0975, lng: 129.0107 },
      { spot: 'Jagalchi Market', type: 'food', candidateId: 'food-1', placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4', address: 'Busan, South Korea' },
      { spot: 'Haeundae Beach', type: 'spot', candidateId: 'spot-1', name: 'Haeundae Beach', address: 'Busan, South Korea' },
    ],
    deferredCategories: ['Kpop'],
    reflectedConditions: ['Your travel dates'],
  };
}

const P = { quickPreviewMapLabel: 'Map', actKpop: 'K-pop Tour' };

describe('QuickPreviewCard — map link identity source', () => {
  it('renders a placeId link for the food stop', () => {
    render(<QuickPreviewCard resultQuick={baseData()} p={P} language="en" />);
    const links = screen.getAllByRole('link', { name: /Jagalchi Market Map/i });
    expect(links[0]).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=Google&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4',
    );
  });

  it('renders a coordinate link for the attraction stop', () => {
    render(<QuickPreviewCard resultQuick={baseData()} p={P} language="en" />);
    const links = screen.getAllByRole('link', { name: /Gamcheon Culture Village Map/i });
    expect(links[0]).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=35.0975,129.0107');
  });

  it('renders a canonical name+address link for the spot stop', () => {
    render(<QuickPreviewCard resultQuick={baseData()} p={P} language="en" />);
    const links = screen.getAllByRole('link', { name: /Haeundae Beach Map/i });
    expect(links[0]).toHaveAttribute(
      'href',
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Haeundae Beach Busan, South Korea')}`,
    );
  });

  it('food address-only fallback never carries the model-authored spot text in the URL', () => {
    const data = baseData();
    const details = data.spotDetails as Array<Record<string, unknown>>;
    details[1] = { spot: 'Jagalchi Market', type: 'food', candidateId: 'food-1', address: 'Busan, South Korea' };
    render(<QuickPreviewCard resultQuick={data} p={P} language="en" />);
    const links = screen.getAllByRole('link', { name: /Jagalchi Market Map/i });
    const href = links[0].getAttribute('href') || '';
    expect(href).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Busan, South Korea')}`);
  });

  it('renders the deferred-categories line with a localized activity label', () => {
    render(<QuickPreviewCard resultQuick={baseData()} p={P} language="en" />);
    expect(screen.getByText(/K-pop Tour/)).toBeTruthy();
  });

  it('renders nothing for a malformed resultQuick (missing candidateId)', () => {
    const data = baseData();
    const details = data.spotDetails as Array<Record<string, unknown>>;
    delete details[0].candidateId;
    const { container } = render(<QuickPreviewCard resultQuick={data} p={P} language="en" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a malformed resultQuick (unknown detail type)', () => {
    const data = baseData();
    const details = data.spotDetails as Array<Record<string, unknown>>;
    details[0] = { spot: details[0].spot, type: 'unknown', candidateId: 'attr-1' };
    const { container } = render(<QuickPreviewCard resultQuick={data} p={P} language="en" />);
    expect(container).toBeEmptyDOMElement();
  });
});
