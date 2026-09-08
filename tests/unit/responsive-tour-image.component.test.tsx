// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ResponsiveTourImage } from '../../src/components/ResponsiveTourImage';

void React;
afterEach(cleanup);

describe('responsive existing photograph rendering', () => {
  it('keeps the WebP img, alt, lazy loading, CSS and link behind native AVIF selection', () => {
    const { container } = render(<a href="/tours/seoul-city-full-day">
      <ResponsiveTourImage source="/JnR5Ie_경복궁(1).webp" sizes="350px" wideFrom={1200}
        className="existing-card-photo" alt="서울 시티투어" loading="lazy" decoding="async" />
    </a>);
    const picture = container.querySelector('picture')!;
    expect(picture.style.display).toBe('contents');
    const sources = [...picture.querySelectorAll('source')];
    expect(sources).toHaveLength(2);
    expect(sources[0].type).toBe('image/avif');
    expect(sources[0].media).toBe('(min-width: 1200px)');
    expect(sources[0].srcset).toContain('-wide-');
    expect(sources[1].srcset).toContain('-original-');
    for (const source of sources) expect(source.style.display).toBe('none');
    const image = picture.querySelector('img')!;
    expect(image.getAttribute('src')).toMatch(/\.webp$/);
    expect(image.srcset).toContain('.webp 128w');
    expect(image.alt).toBe('서울 시티투어');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
    expect(image.className).toBe('existing-card-photo');
    expect(image.closest('a')?.getAttribute('href')).toBe('/tours/seoul-city-full-day');
  });

  it('uses the separate region profile without applying a wide card crop', () => {
    const { container } = render(<ResponsiveTourImage source="/region-seoul.jpg" sizes="172px" profile="region" alt="" />);
    const sources = [...container.querySelectorAll('source')];
    expect(sources).toHaveLength(1);
    expect(sources[0].srcset).toContain('-region-');
    expect(sources[0].hasAttribute('media')).toBe(false);
    expect(sources[0].style.display).toBe('none');
  });

  it('preserves unknown image paths without inventing derivative files', () => {
    const { container } = render(<ResponsiveTourImage source="/future.jpg" sizes="100vw" alt="미래 사진" />);
    expect(container.querySelector('source')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/future.jpg');
    expect(container.querySelector('img')?.getAttribute('srcset')).toBeNull();
  });
});
