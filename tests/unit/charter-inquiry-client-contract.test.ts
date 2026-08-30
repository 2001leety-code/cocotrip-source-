import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(
  process.cwd(),
  'src/pages/PlanDetailPage/components/ads/CharterInquireModal.tsx',
), 'utf8');
const inlineSource = readFileSync(resolve(
  process.cwd(),
  'src/pages/PlanDetailPage/components/ads/CharterInlineAd.tsx',
), 'utf8');
const bookingCardSource = readFileSync(resolve(
  process.cwd(),
  'src/pages/PlanDetailPage/components/ads/InlineBookingCard.tsx',
), 'utf8');
const preTripSource = readFileSync(resolve(
  process.cwd(),
  'src/pages/PlanDetailPage/components/PreTripSlide.tsx',
), 'utf8');
const bannerSource = readFileSync(resolve(
  process.cwd(),
  'src/pages/PlanDetailPage/components/ads/CharterBanner.tsx',
), 'utf8');
const outroSource = readFileSync(resolve(
  process.cwd(),
  'src/pages/PlanDetailPage/components/OutroSlide.tsx',
), 'utf8');

describe('PlanDetail charter inquiry client contract', () => {
  it('uses the protected server endpoint instead of direct Firestore writes', () => {
    expect(source).toContain("authFetch('/api/inquiry-submit'");
    expect(source).toContain("vehicle: 'charter'");
    expect(source).toContain('expectedTourKey: quoteView.tourKey');
    expect(source).toContain('expectedAmountKRW: quoteView.amountKRW');
    expect(source).toContain('expectedHours: quoteView.hours');
    expect(source).not.toContain('addDoc(');
    expect(source).not.toContain("collection(db, 'charter_inquiries')");
    expect(source).toContain('role="alert"');
    expect(source).not.toContain('payload?.error || M.submitFail');
  });

  it('wires the protected inquiry into both customer-visible charter surfaces', () => {
    expect(preTripSource).toMatch(/<CharterInlineAd[\s\S]*?plan=\{plan\}/);
    expect(outroSource).toMatch(/<CharterInlineAd[\s\S]*?plan=\{plan\}/);
    expect(inlineSource).toContain('<CharterInquireModal');
    expect(bannerSource).toContain('charterTourKeysForRegion(primaryRegion)');
    expect(bannerSource).toContain('preferHighestPrice: true');
    expect(source).toContain('expectedTourKey: quoteView.tourKey');
  });

  it('uses the pricing adapter and enables the display/server USD mismatch gate', () => {
    expect(inlineSource).toContain('DAILY_TOUR_PRICES[entry.key]');
    expect(inlineSource).not.toMatch(/priceKRW:\s*\d/);
    expect(bookingCardSource).toContain('expectedUSD={selected.expectedUSD}');
  });
});
