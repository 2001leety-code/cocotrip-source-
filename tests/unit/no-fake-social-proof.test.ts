import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import en from '../../src/i18n/locales/en.json';
import ko from '../../src/i18n/locales/ko.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

// Regression guard for the "no fabricated social proof" fix (fix/google-reviews-real).
// The homepage previously showed a hardcoded "5.0" Google rating, "150+ reviews",
// "1,000+ Tours" and five invented guest testimonials. Those are false social proof
// and a consumer-protection / legal risk. This test fails if any fabricated rating,
// review count, or fake testimonial creeps back in.
describe('no fake social proof on homepage', () => {
  it('GoogleReviews.tsx renders no hardcoded rating, review count, or fake testimonials', () => {
    const src = read('src/sections/GoogleReviews.tsx');
    // No standalone aggregate rating like 5.0 / 4.9 rendered as JSX text.
    expect(src).not.toMatch(/>\s*5\.0\s*</);
    expect(src).not.toMatch(/>\s*4\.\d\s*</);
    // No fabricated review-count copy.
    expect(src).not.toMatch(/150\+/);
    expect(src).not.toMatch(/Based on .* reviews/i);
    // None of the old invented reviewer names.
    for (const name of ['Sarah Jenkins', 'Hiroshi Tanaka', 'Michael Chen', 'Emma Wilson', 'David Rossi']) {
      expect(src).not.toContain(name);
    }
  });

  it('TrustBadges.tsx has no fabricated rating or completed-tour count', () => {
    const src = read('src/components/TrustBadges.tsx');
    expect(src).not.toMatch(/5\.0 Google/);
    expect(src).not.toMatch(/150\+ reviews/);
    expect(src).not.toMatch(/1,000\+ Tours/);
  });

  it('MobileHome.tsx hero proof + review tile carry no hardcoded rating', () => {
    const src = read('src/sections/MobileHome.tsx');
    expect(src).not.toMatch(/'5\.0 Google'/);
    // The review tile must not render a literal 5.0 score next to stars.
    expect(src).not.toMatch(/text-yellow-400">5\.0</);
  });
});

describe('i18n googleReviews/mobileHome copy is fake-number free in all 4 languages', () => {
  const locales = { en, ko, ja, zh } as Record<string, any>;

  it('drops the old fabricated keys and adds the new trust + CTA keys', () => {
    for (const [lang, t] of Object.entries(locales)) {
      const gr = t.googleReviews;
      expect(gr, `${lang}.googleReviews exists`).toBeTruthy();
      // Removed fake-aggregate keys.
      expect(gr.basedOn, `${lang}.googleReviews.basedOn removed`).toBeUndefined();
      // New truthful keys present.
      expect(typeof gr.trustLicensed, `${lang}.trustLicensed`).toBe('string');
      expect(typeof gr.trustSupport, `${lang}.trustSupport`).toBe('string');
      expect(typeof gr.trustPrivate, `${lang}.trustPrivate`).toBe('string');
      expect(typeof gr.leaveReview, `${lang}.leaveReview`).toBe('string');
      // No "5.0" / "150" inside the subtitle copy.
      expect(gr.subtitle).not.toMatch(/5\.0|150\+/);
    }
  });

  it('mobileHome hero proof no longer hardcodes a 5.0 rating', () => {
    for (const [lang, t] of Object.entries(locales)) {
      const m = t.mobileHome;
      expect(m.heroProofReviews, `${lang}.mobileHome.heroProofReviews`).not.toMatch(/5\.0/);
      expect(typeof m.googleReviewSub, `${lang}.mobileHome.googleReviewSub`).toBe('string');
    }
  });
});
