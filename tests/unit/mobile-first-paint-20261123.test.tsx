// @vitest-environment jsdom
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { SkyLayer } from '../../src/sections/home/SkyLayer';
import { stripPrerenderOnlyTags } from '../../scripts/lib/prerender-strip.mjs';
void React;

// 2026-11-23 phone speed test (Lighthouse mobile, live site): the 3.5 MB home video downloaded
// during the first screen, and the prerendered HTML carried <video autoplay preload="auto"> so the
// download started before any JS (ignoring Save-Data and reduced motion too).

const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('prerender strips the sky video and its toggle', () => {
  it('removes the marked sky video and its button, keeps the poster layer and other buttons', () => {
    const video = '<video class="home-dope-sky__video" data-prerender-strip="" src="/home-dope/v3-cloud-flight.mp4" autoplay="" preload="auto"></video>';
    const toggle = '<button type="button" class="home-dope-sky-toggle" data-prerender-strip="" aria-label="Play"><svg><path d="M0 0"></path></svg></button>';
    const other = '<button type="button" class="cta">Plan</button>';
    const html = `<div class="home-dope-sky" aria-hidden="true">${video}</div>${toggle}${other}`;
    expect(stripPrerenderOnlyTags(html)).toBe(`<div class="home-dope-sky" aria-hidden="true"></div>${other}`);
  });

  it('leaves HTML without the mark unchanged', () => {
    const html = '<video src="/a.mp4" data-prerender-stripped="x"></video><button type="button">Go</button><link rel="stylesheet" data-prerender-strip="" href="/a.css">';
    expect(stripPrerenderOnlyTags(html)).toBe(html);
  });

  it('SkyLayer marks the video and the button, and vite.config wires the strip into prerender', () => {
    const sky = read('src/sections/home/SkyLayer.tsx');
    const videoStart = sky.indexOf('className="home-dope-sky__video"');
    const videoTag = sky.slice(videoStart, sky.indexOf('/>', videoStart));
    expect(videoTag).toContain('data-prerender-strip=""');
    const buttonTag = sky.slice(sky.indexOf('<button'), sky.indexOf('>', sky.indexOf('onClick')));
    expect(buttonTag).toContain('data-prerender-strip=""');
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

  it('marks the sky with data-video from the first render, so layouts reserve the toggle before load', () => {
    const { container } = render(<SkyLayer playLabel="Play" pauseLabel="Pause" />);
    expect(container.querySelector('.home-dope-sky')?.hasAttribute('data-video')).toBe(true);
    expect(container.querySelector('.home-dope-sky-toggle')).toBeNull();
    const css = read('src/styles/plan-result-night.css');
    expect(css).toContain('.plan-night-masthead:has(> .home-dope-sky[data-video]) > .ec-container-wide');
    expect(css).not.toContain(':has(> .home-dope-sky-toggle)');
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
    expect(container.querySelector('.home-dope-sky')?.hasAttribute('data-video')).toBe(false);
  });

  it('keeps the poster with Save-Data', () => {
    connection = { saveData: true, effectiveType: '4g' };
    const { container } = render(<SkyLayer playLabel="Play" pauseLabel="Pause" />);
    fireLoad();
    expect(container.querySelector('video')).toBeNull();
  });
});
