import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TOURS } from '../../src/data/tours';

const base = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath: string) => readFileSync(path.resolve(base, relativePath), 'utf8');
const page = read('../../src/pages/TourDetailPage.tsx');
const hook = read('../../src/hooks/useTour.ts');
const cssPath = path.resolve(base, '../../src/styles/editorial-tour-detail.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
const languages = ['ko', 'en', 'ja', 'zh'] as const;

function findI18nGaps(value: unknown, valuePath: string, gaps: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findI18nGaps(item, `${valuePath}[${index}]`, gaps));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (languages.some((language) => language in record)) {
    const missing = languages.filter((language) => (
      typeof record[language] !== 'string' || !record[language].trim()
    ));
    if (missing.length > 0) gaps.push(`${valuePath}: ${missing.join(',')}`);
  }

  Object.entries(record).forEach(([key, child]) => {
    findI18nGaps(child, `${valuePath}.${key}`, gaps);
  });
}

describe('tour detail editorial shell', () => {
  it('uses one paper shell at every breakpoint instead of the split dark/mobile skins', () => {
    expect(page).toContain("import '@/styles/editorial-tour-detail.css'");
    expect(page).toMatch(/className="tour-detail-editorial/);
    expect(page).not.toContain('cocotrip-mobile-tour-detail');
    expect(page).not.toMatch(/const REFINED\s*=/);
    expect(page).not.toContain('<style>{`');
    expect(page).toContain('TOUR_REGIONS.find');
    expect(page).toContain('key={tour.slug}');
    expect(page).toContain('if (total < 2) return;');
  });

  it('separates loading, error, permission, not-found, partial and empty-itinerary states', () => {
    for (const testId of [
      'tour-detail-loading',
      'tour-detail-error',
      'tour-detail-permission',
      'tour-detail-not-found',
      'tour-detail-partial',
      'tour-itinerary-empty',
      'tour-detail-ready',
    ]) {
      expect(page, `${testId} 상태가 없다`).toContain(testId);
    }
    expect(page).toContain('<EcLoading');
    expect(page).toContain('<EcEmpty');
    expect(page).toContain('<EcError');
    expect(page).toContain('onRetry={permissionDenied ? undefined : retry}');
  });

  it('keeps deterministic state fixtures local-only and exposes a real retry', () => {
    expect(hook).toContain("searchParams.get('localTourState')");
    expect(hook).toContain("hostname !== 'localhost'");
    expect(hook).toContain("hostname !== '127.0.0.1'");
    expect(hook).toMatch(/const retry = useCallback/);
    expect(hook).toMatch(/requestKey/);
  });

  it('uses semantic tokens without a new gradient, glow, glass or override cascade', () => {
    expect(css.length).toBeGreaterThan(200);
    expect(css).not.toMatch(/(?:linear|radial)-gradient/i);
    expect(css).not.toMatch(/backdrop-filter/i);
    expect(css).not.toMatch(/box-shadow\s*:\s*0\s+0/i);
    expect(css).not.toContain('!important');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('preserves the existing booking, price and refund boundaries', () => {
    expect(page).toContain('<TourBookingDialog');
    expect(page).toContain('<RefundPolicyModal');
    expect(page).toContain('tour.priceFrom.toLocaleString()');
    expect(page).toContain("trackBookNow('tour')");
    expect(page).toContain('PayPal Secure Pay');
    expect(page).toContain('tour-detail-booking-meta');
    expect(css).toMatch(/\.tour-detail-booking-meta\s*\{[^}]*background:\s*rgb\(8 11 20\)/s);
  });

  it('does not repeat unsupported guide or review provenance claims', () => {
    expect(page).not.toContain("import { TrustBadges }");
    expect(page).not.toMatch(/completed-booking reviews|결제 완료 고객의 후기 기반|外部認証評価|外部验证评分/);
    expect(page).toContain("resolvedRating.reviewSource === 'google'");
  });

  it('keeps every displayed static tour field complete in four languages', () => {
    const gaps: string[] = [];
    TOURS.forEach((tour) => findI18nGaps(tour, tour.slug, gaps));
    expect(gaps).toEqual([]);
  });
});
