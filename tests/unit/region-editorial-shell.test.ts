import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const base = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath: string) => readFileSync(path.resolve(base, relativePath), 'utf8');
const page = read('../../src/pages/RegionDetail.tsx');
const cssPath = path.resolve(base, '../../src/styles/editorial-region.css');
const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';

describe('region detail editorial shell', () => {
  it('uses one document shell at every breakpoint', () => {
    expect(page).toContain("import '@/styles/editorial-region.css'");
    expect(page).toContain('className="region-editorial ec-root"');
    expect(page).not.toContain('useIsMobile');
    expect(page).not.toContain('/* ═══ MOBILE ═══ */');
    expect(page).not.toContain('/* ═══ DESKTOP');
    expect(page).not.toMatch(/m-(?:page|card|cta|appear|shimmer|float|glow)/);
  });

  it('keeps valid and missing-region states explicit', () => {
    expect(page).toContain('data-testid="region-detail-ready"');
    expect(page).toContain('data-testid="region-detail-not-found"');
    expect(page).toContain('Object.prototype.hasOwnProperty.call(regionImages, regionId)');
    expect(page).not.toContain('Boolean(regionId && regionImages[regionId])');
    expect(page).toContain('<RegionSeoInfo');
    expect(page).toContain('regionData.attractions.map');
    expect(page).toContain('images.slice(1)');
    expect(page).not.toContain('images.slice(1, 9)');
  });

  it('uses semantic tokens without gradients, glow, glass, hex or override cascades', () => {
    expect(css.length).toBeGreaterThan(200);
    expect(css).not.toMatch(/(?:linear|radial)-gradient/i);
    expect(css).not.toMatch(/backdrop-filter/i);
    expect(css).not.toMatch(/box-shadow\s*:\s*0\s+0/i);
    expect(css).not.toContain('!important');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(page).not.toMatch(/(?:linear|radial)-gradient/i);
    expect(page).not.toMatch(/backdrop-blur|bg-gradient|m-card-glow/i);
  });

  it('preserves existing read-only content and navigation boundaries', () => {
    expect(page).toContain('to="/#regions"');
    expect(page).toContain('to="/planner"');
    expect(page).toContain('to="/tours"');
    expect(page).toContain('href="https://wa.me/821087140611"');
    expect(page).toContain('plannerCovered &&');
    expect(page).toContain("title: regionData?.title || t.regionDetail?.notFound || 'Region not found'");
    expect(page).not.toMatch(/fetch\(|addDoc\(|setDoc\(|updateDoc\(|deleteDoc\(/);
  });
});
