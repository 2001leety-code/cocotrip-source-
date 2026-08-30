import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildPlanInquiryContext,
  canAccessPlanForInquiry,
  detectPlanTourKey,
  planPrimaryTourKeys,
  resolveInquiryQuoteByTourKey,
} from '../../api/_shared/inquiry-quote.js';

describe('PlanDetail charter inquiry server quote SSOT', () => {
  it.each([
    ['seoul-city', 330000, 8],
    ['seoul-suburb', 343200, 8],
    ['dmz', 343200, 8],
    ['gangwon', 436800, 10],
    ['ski-resort', 416000, 10],
    ['gyeongju-jeonju', 600000, 10],
    ['busan-day', 450000, 10],
  ])('%s is recalculated from the server pricing spec', (tourKey, amountKRW, hours) => {
    expect(resolveInquiryQuoteByTourKey(tourKey)).toMatchObject({
      ok: true,
      tourKey,
      amountKRW,
      hours,
      currency: 'KRW',
      pricingVersion: '2.0.0',
      provenance: 'server_pricing_spec',
    });
  });

  it('detects all supported stop-name variants and rejects unknown keys', () => {
    expect(detectPlanTourKey({
      itinerary: { days: [{ stops: [{ display_name: 'Gyeongbokgung Palace' }] }] },
    })).toBe('seoul-city');
    expect(detectPlanTourKey({
      itinerary: { days: [{ stops: [{ name_ko: '해운대 해수욕장' }] }] },
    })).toBe('busan-day');
    expect(resolveInquiryQuoteByTourKey('client-invented-key')).toEqual({
      ok: false,
      code: 'INVALID_QUOTE_KEY',
    });
  });

  it('uses the plan primary region before mixed itinerary keywords', () => {
    const mixedStops = [{ name_en: 'Gyeongbokgung Palace' }, { name_en: 'Haeundae Beach' }];
    expect(detectPlanTourKey({
      input: { regions: ['부산'] },
      itinerary: { days: [{ stops: mixedStops }] },
    })).toBe('busan-day');
    expect(planPrimaryTourKeys({ input: { regions: ['부산'] } })).toEqual(['busan-day']);
    expect(planPrimaryTourKeys({ input: { regions: ['済州'] } })).toEqual([]);
    expect(detectPlanTourKey({
      input: { regions: ['済州'] },
      itinerary: { days: [{ stops: mixedStops }] },
    })).toBeNull();
  });

  it('chooses the highest relevant reference price inside the primary region', () => {
    expect(detectPlanTourKey({
      input: { regions: ['Seoul'] },
      itinerary: {
        days: [{ stops: [{ name_en: 'Gyeongbokgung Palace' }, { name_en: 'Nami Island' }] }],
      },
    })).toBe('seoul-suburb');
  });

  it('derives date, pax and bounded itinerary context only from the plan', () => {
    expect(buildPlanInquiryContext({
      input: { startDate: '2026-09-10', adults: 3 },
      itinerary: {
        days: [
          { day: 1, theme: 'Palaces', stops: [{ name: 'Seoul' }, { name: 'Bukchon' }] },
          { day: 2, theme: 'Markets', stops: [] },
        ],
      },
    })).toEqual({
      startDate: '2026-09-10',
      eventDate: '2026-09-10',
      pax: 3,
      dayCount: 2,
      itinerarySummary: [
        { day: 1, theme: 'Palaces', stopCount: 2 },
        { day: 2, theme: 'Markets', stopCount: 0 },
      ],
    });
  });

  it('allows owner, matching guest token or public plan only', () => {
    const privatePlan = { uid: 'owner-1', accessToken: 'secret', isPublic: false };
    expect(canAccessPlanForInquiry(privatePlan, 'owner-1', '')).toBe(true);
    expect(canAccessPlanForInquiry(privatePlan, '', 'secret')).toBe(true);
    expect(canAccessPlanForInquiry({ ...privatePlan, isPublic: true }, '', '')).toBe(true);
    expect(canAccessPlanForInquiry(privatePlan, 'other-user', 'wrong')).toBe(false);
  });

  it('keeps frontend and API daily-tour price data in full parity', () => {
    const front = JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/pricing_spec.json'), 'utf8'));
    const api = JSON.parse(readFileSync(resolve(process.cwd(), 'api/_pricing_spec.json'), 'utf8'));
    expect(api.version).toBe(front.version);
    expect(api.daily_tour_prices).toEqual(front.daily_tour_prices);
  });
});
