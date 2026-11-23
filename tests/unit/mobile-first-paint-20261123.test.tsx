// @vitest-environment jsdom
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { SkyLayer } from '../../src/sections/home/SkyLayer';
import { stripPrerenderOnlyTags } from '../../scripts/lib/prerender-strip.mjs';
void React;

// 2026-11-23 phone speed test (Lighthouse mobile, live site): the prerendered HTML carried
// the Fraunces <link> as a render-blocking stylesheet (~0.9 s on every page) and the 3.5 MB
// home video downloaded during the first screen.

const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('prerender strips JS-only font links', () => {
  const font = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz&amp;display=swap" data-prerender-strip="">';
  const css = '<link rel="stylesheet" crossorigin="" href="/assets/index-abc.css">';

  it('removes only the marked link', () => {
    const html = `<head>${css}${font}<link rel="canonical" href="https://cocotripkr.com/"></head>`;
    expect(stripPrerenderOnlyTags(html)).toBe(`<head>${css}<link rel="canonical" href="https://cocotripkr.com/"></head>`);
  });

  it('leaves HTML without the mark unchanged', () => {
    const html = `<head>${css}<link rel="preload" data-prerender-stripped="x" href="/a.css"></head>`;
    expect(stripPrerenderOnlyTags(html)).toBe(html);
  });

  it('main.tsx marks the font link and vite.config wires the strip into prerender', () => {
    const main = read('src/main.tsx');
    const linkBlock = main.slice(main.indexOf("document.createElement('link')"), main.indexOf('document.head.appendChild(frauncesLink)'));
    expect(linkBlock).toContain("fonts.googleapis.com/css2?family=Fraunces");
    expect(linkBlock).toContain("setAttribute('data-prerender-strip', '')");
    const vite = read('vite.config.ts');
    expect(vite).toMatch(/postProcess\(renderedRoute[^)]*\)\s*\{\s*renderedRoute\.html = stripPrerenderOnlyTags\(renderedRoute\.html\)/);
  });
});

describe('home sky video waits for page load', () => {
  let readyState: DocumentReadyState = 'loading';
  let connection: { saveData?: boolean; effectiveType?: string } | undefined;

  beforeEach(() => {
    readyState = 'loading';
    connection = { effectiveType: '4g' };
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => readyState });
    Object.defineProperty(navigator, 'connection', { configurable: true, get: () => connection });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'readyState');
    Reflect.deleteProperty(navigator, 'connection');
  });

  const fireLoad = () => act(() => {
    readyState = 'complete';
    window.dispatchEvent(new Event('load'));
  });

  it('shows only the poster until load, then mounts the video and its button', () => {
    const { container } = render(<SkyLayer playLabel="Play" pauseLabel="Pause" />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('.home-dope-sky-toggle')).toBeNull();
    fireLoad();
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/home-dope/v3-cloud-flight.mp4');
    expect(container.querySelector('.home-dope-sky-toggle')).not.toBeNull();
  });

  it('mounts the video at once when the page already finished loading', () => {
    readyState = 'complete';
    const { container } = render(<SkyLayer playLabel="Play" pauseLabel="Pause" />);
    expect(container.querySelector('video')).not.toBeNull();
  });

  it.each(['slow-2g', '2g', '3g'])('keeps the poster on a %s connection', (effectiveType) => {
    connection = { effectiveType };
    const { container } = render(<SkyLayer playLabel="Play" pauseLabel="Pause" />);
    fireLoad();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('.home-dope-sky-toggle')).toBeNull();
  });

  it('keeps the poster with Save-Data', () => {
    connection = { saveData: true, effectiveType: '4g' };
    const { container } = render(<SkyLayer playLabel="Play" pauseLabel="Pause" />);
    fireLoad();
    expect(container.querySelector('video')).toBeNull();
  });
});
