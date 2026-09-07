import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../scripts/responsive-tour-image-manifest.json';
import browserManifest from '../../src/data/responsiveTourImages.json';
import brandManifest from '../../src/data/responsiveBrandMark.json';
import { RESPONSIVE_BRAND_MARK } from '../../src/lib/responsiveBrandMark';
import sources from '../../scripts/responsive-tour-image-sources.json';
import {
  HOME_CITY_IMAGE_SIZES, HOME_FEATURE_IMAGE_SIZES, HOME_TOUR_IMAGE_SIZES,
  TOUR_CARD_IMAGE_SIZES, TOUR_REGION_IMAGE_SIZES, responsiveTourImage, responsiveTourAvif,
} from '../../src/lib/responsiveTourImage';

const text = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('responsive derivatives preserve existing source photographs', () => {
  it('covers every currently listed tour thumbnail and home city without editing their source data', () => {
    const paths = [
      ...Array.from(text('src/data/tours.ts').matchAll(/thumbnail: '([^']+)'/g), (match) => match[1]),
      ...Array.from(text('src/sections/home/homeCopy.ts').matchAll(/photo: '([^']+)'/g), (match) => match[1]),
      '/region-seoul.jpg', '/region-busan.webp', '/region-gyeongju.jpg', '/region-danyang.webp',
      '/hero-banpo.webp', '/icons/icon-192.png',
    ];
    expect(paths.length).toBeGreaterThan(10);
    for (const path of paths) expect(Object.hasOwn(manifest.images, path), path).toBe(true);
    expect(sources.map((source) => source.source).sort()).toEqual(Object.keys(manifest.images).sort());
  });

  it.each(Object.entries(manifest.images))('keeps original bytes and valid bounded WebP variants for %s', (source, entry) => {
    const original = readFileSync(resolve(process.cwd(), `public${source}`));
    expect(hash(original)).toBe(entry.sha256);
    expect(original.length).toBe(entry.bytes);
    expect(entry.variants.length).toBeGreaterThan(1);
    expect(entry.variants.map((variant) => variant.width)).toEqual([...new Set(entry.variants.map((variant) => variant.width))].sort((a, b) => a - b));
    for (const variant of entry.variants) {
      expect(variant.src).toMatch(/^\/responsive-tour-images\/[a-z0-9-]+\.webp$/);
      const bytes = readFileSync(resolve(process.cwd(), `public${variant.src}`));
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
      expect(bytes.length).toBe(variant.bytes);
      expect(hash(bytes)).toBe(variant.sha256);
      expect(variant.width).toBeLessThanOrEqual(entry.width);
      expect(variant.height).toBeLessThanOrEqual(entry.height);
      expect(Math.abs(variant.height - variant.width * entry.height / entry.width)).toBeLessThanOrEqual(1);
    }
    for (const [profile, variants] of Object.entries(entry.avif)) {
      for (const variant of variants) {
        const bytes = readFileSync(resolve(process.cwd(), `public${variant.src}`));
        expect(bytes.subarray(4, 12).toString()).toBe('ftypavif');
        expect(hash(bytes)).toBe(variant.sha256);
        expect(bytes.length).toBe(variant.bytes);
        expect(variant.width).toBeLessThanOrEqual(entry.width);
        expect(variant.height).toBeLessThanOrEqual(entry.height);
        const ratio = profile === 'wide' ? 2 : profile === 'region' ? Math.max(4 / 3, entry.width / entry.height) : entry.width / entry.height;
        expect(Math.abs(variant.height - variant.width / ratio)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps uncropped WebP fallbacks and separately profiles the existing centered CSS crops', () => {
    expect(manifest.recipe).toMatchObject({ format: 'webp', quality: 80, fit: 'inside', withoutEnlargement: true });
    const generator = text('scripts/build-responsive-tour-images.mjs');
    expect(generator).not.toMatch(/fetch\(|https?:\/\/|\.extract\(|\.crop\(|unlink|rmSync/);
    expect(generator).toContain('ORIGINAL_IMAGE_CHANGED');
    expect(generator).toContain('IMAGE_REGENERATION_MISMATCH');
    expect(generator).toContain("profiles.wide = 2");
    expect(generator).toContain("profiles.region = Math.max(4 / 3, sourceWidth / sourceHeight)");
    expect(generator).toContain("position: 'centre'");
  });

  it('keeps original hashes and generation diagnostics out of the browser payload', () => {
    expect(Object.keys(browserManifest)).toEqual(['images']);
    expect(JSON.stringify(browserManifest)).not.toMatch(/sha256|encoder|bytes|recipe/);
    for (const [source, entry] of Object.entries(manifest.images)) {
      expect(browserManifest.images[source as keyof typeof browserManifest.images].variants)
        .toEqual(entry.variants.map(({ width, src }) => ({ width, src })));
      expect(browserManifest.images[source as keyof typeof browserManifest.images].avif)
        .toEqual(Object.fromEntries(Object.entries(entry.avif).map(([profile, variants]) => [profile,
          variants.map(({ width, src }) => ({ width, src }))])));
    }
  });

  it('keeps the shared Header logo independent of the complete tour photo manifest', () => {
    expect(brandManifest.variants).toEqual(browserManifest.images['/icons/icon-192.png'].variants);
    expect(brandManifest.variants.map(({ width }) => width)).toEqual([32, 64, 96]);
    expect(RESPONSIVE_BRAND_MARK).toEqual({
      src: brandManifest.variants[0].src,
      srcSet: brandManifest.variants.map(({ width, src }) => `${src} ${width}w`).join(', '),
      sizes: '32px',
    });
    expect(text('src/lib/responsiveBrandMark.ts')).not.toContain('responsiveTourImages');
    const header = text('src/sections/Header.tsx');
    expect(header).toContain('RESPONSIVE_BRAND_MARK');
    expect(header).not.toContain('responsiveTourImage');
  });

  it('does not preload retired hero photos on every route or precache all responsive photos', () => {
    const html = text('index.html');
    expect(html).not.toMatch(/<link[^>]*rel="preload"[^>]*href="\/hero-seoul(?:-real)?\.webp"/);
    const config = text('vite.config.ts');
    const patterns = config.match(/globPatterns:\s*\[([^\]]+)\]/)?.[1] || '';
    expect(patterns).not.toContain('webp');
    expect(patterns).not.toContain('avif');
    expect(config).not.toMatch(/includeAssets:[\s\S]*?responsive-tour-images/);
  });
});

describe('responsive image browser attributes', () => {
  it('selects a small default and an ascending width srcset for the same original photograph', () => {
    const source = '/region-dmz.webp';
    const result = responsiveTourImage(source, HOME_TOUR_IMAGE_SIZES, 128);
    const variants = manifest.images[source].variants;
    expect(result.src).toBe(variants.find((variant) => variant.width === 128)?.src);
    expect(result.sizes).toBe(HOME_TOUR_IMAGE_SIZES);
    expect(result.srcSet).toBe(variants.map((variant) => `${variant.src} ${variant.width}w`).join(', '));
    expect(result.src).not.toBe(source);
  });

  it('does not invent a larger derivative or read inherited object keys', () => {
    const source = '/icons/icon-192.png';
    expect(responsiveTourImage(source, '32px', 9999).src).toBe(manifest.images[source].variants.at(-1)?.src);
    expect(responsiveTourImage('__proto__', '32px')).toEqual({ src: '__proto__' });
  });

  it.each(['/future-original.webp', 'https://example.invalid/photo.jpg', '/region-dmz.webp?version=2', ''])('preserves unknown/new sources exactly: %s', (source) => {
    expect(responsiveTourImage(source, '100vw')).toEqual({ src: source });
  });

  it('keeps width hints aligned with the current one/two/three-column and rail breakpoints', () => {
    expect(TOUR_CARD_IMAGE_SIZES).toContain('(min-width: 981px)');
    expect(TOUR_CARD_IMAGE_SIZES).toContain('(min-width: 768px)');
    expect(TOUR_CARD_IMAGE_SIZES).toContain('calc(100vw - 40px)');
    expect(TOUR_REGION_IMAGE_SIZES).toBe('172px');
    expect(HOME_TOUR_IMAGE_SIZES).toContain('128px, 96px');
    expect(HOME_CITY_IMAGE_SIZES).toContain('(min-width: 640px)');
    expect(HOME_FEATURE_IMAGE_SIZES).toContain('41.6667vw - 80px');
  });

  it('changes only image delivery attributes at each original consumer', () => {
    const card = text('src/components/tours/TourCard.tsx');
    expect(card).toContain('source={tour.thumbnail} sizes={TOUR_CARD_IMAGE_SIZES} wideFrom={1200}');
    expect(card).toContain('alt={title} loading="lazy" decoding="async"');
    expect(card).toContain('to={`/tours/${tour.slug}`}');
    const service = text('src/sections/home/ServiceModules.tsx');
    expect(service).toContain('source="/hero-banpo.webp" sizes={HOME_FEATURE_IMAGE_SIZES} wideFrom={1024}');
    expect(service).toContain('source={tour.thumbnail} sizes={HOME_TOUR_IMAGE_SIZES} fallbackWidth={128}');
    expect(service).toContain('getTourPriceKRW(tour.id, tour.priceFrom, tour.priceUnit)');
    expect(service).toContain('priceLabel(tour)');
    expect(text('src/pages/ToursPage.tsx')).toContain('source={image} sizes={TOUR_REGION_IMAGE_SIZES} fallbackWidth={192} profile="region"');
    const tours = text('src/pages/ToursPage.tsx');
    expect(tours).toContain('source={featuredTour.thumbnail} sizes="(min-width: 1100px) 350px, 32vw" fallbackWidth={384} wideFrom={981}');
    expect(tours).not.toContain('src={featuredTour.thumbnail}');
    expect(tours).toMatch(/source=\{featuredTour\.thumbnail\}[\s\S]*?loading="lazy"/);
    expect(text('src/sections/home/EditorialHero.tsx')).toContain('source={city.photo} sizes={HOME_CITY_IMAGE_SIZES} fallbackWidth={256}');
  });

  it('provides native AVIF source selection without removing WebP fallbacks or enlarging narrow frame crops', () => {
    const component = text('src/components/ResponsiveTourImage.tsx');
    expect(component).toContain('<picture style={{ display: \'contents\' }}>');
    expect(component).toContain('type="image/avif" media={`(min-width: ${wideFrom}px)`}');
    expect(component).toContain('<img {...responsiveTourImage(source, sizes, fallbackWidth)} {...props} />');
    expect(responsiveTourAvif('/region-dmz.webp')).toContain('.avif');
    expect(responsiveTourAvif('/region-dmz.webp', 'wide')).toContain('-wide-');
    expect(responsiveTourAvif('/region-seoul.jpg', 'region')).toContain('-region-');
    expect(responsiveTourAvif('/future-original.webp')).toBeUndefined();
    expect(responsiveTourAvif('__proto__')).toBeUndefined();
    expect(responsiveTourAvif('/region-dmz.webp', '__proto__')).toBeUndefined();
    const css = text('src/styles/editorial-tours-catalog.css');
    expect(css).toContain('.tour-catalog-card-media img {');
    expect(css).toContain('.tours-catalog-featured-link img {');
    expect(css).toContain('.tour-catalog-card:hover .tour-catalog-card-media img {');
    expect(css).not.toContain('.tour-catalog-card-media > img');
  });
});
