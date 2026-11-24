// @vitest-environment jsdom
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CRITICAL_CSS_OPTIONS, collapseClassWhitespace, criticalCssPlugin, hoistHighPriorityImagePreloads, inlineCriticalCss } from '../../scripts/lib/critical-css.mjs';
import { whenFullCssLoaded } from '../../src/lib/fullCssReady';
import { SkyLayer } from '../../src/sections/home/SkyLayer';
void React;

// 2026-11-24 phone speed test: the main stylesheet (index-*.css, ~45 KB gzip) blocked the first
// paint. On slow 4G it shared the line with ~25 JS files and finished at 2.3 s locally, 3.1 s live.
// The prerendered HTML now carries only the rules its own elements use; the full file loads
// without blocking, and the app waits for it before the first React render.

const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const CSS = '.used{color:red}.unused{color:blue}@font-face{font-family:X;src:url(/x.ttf)}.used-font{font-family:X}';
const bundleWith = (extra: Record<string, unknown> = {}) => ({
  'assets/a.css': { type: 'asset', fileName: 'assets/a.css', source: CSS },
  ...extra,
});
const page = (body: string) =>
  '<!doctype html><html><head>' +
  '<link rel="stylesheet" crossorigin href="/assets/a.css">' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces&amp;display=swap">' +
  '<style>.keep-me{color:green}</style>' +
  `</head><body>${body}</body></html>`;

describe('inlineCriticalCss', () => {
  it('inlines only the rules the page uses and loads the full file without blocking', async () => {
    const out = await inlineCriticalCss(page('<div class="used used-font">hi</div>'), bundleWith());
    const doc = new DOMParser().parseFromString(out, 'text/html');
    const inline = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('');

    expect(inline).toContain('.used{color:red}');
    expect(inline).not.toContain('.unused');
    // Fonts stay in the full file, so their download timing does not change.
    expect(inline).not.toContain('@font-face');

    const link = doc.querySelector('head link[href="/assets/a.css"]')!;
    expect(link.getAttribute('rel')).toBe('preload');
    expect(link.getAttribute('as')).toBe('style');
    expect(link.getAttribute('onload')).toBe("this.rel='stylesheet'");
    // No-JS visitors and crawlers still get the full stylesheet.
    expect(out).toMatch(/<noscript><link rel="stylesheet" crossorigin href="\/assets\/a\.css"><\/noscript>/);
  });

  it('leaves external stylesheets and existing <style> tags alone', async () => {
    const out = await inlineCriticalCss(page('<p class="used">x</p>'), bundleWith());
    expect(out).toContain('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces&amp;display=swap">');
    expect(out).toContain('.keep-me{color:green}');
  });

  it('moves the high-priority hero image preload right after the charset', () => {
    const poster = '<link rel="preload" href="/home-dope/v3-cloud-poster.jpg" as="image" fetchpriority="high">';
    const html = '<html><head><meta name="x" content="y"><meta charset="UTF-8"><link rel="modulepreload" href="/a.js">' +
      poster + '<link rel="preload" href="/low.jpg" as="image"></head><body></body></html>';
    const out = hoistHighPriorityImagePreloads(html);
    expect(out.indexOf(poster)).toBe(out.indexOf('<meta charset="UTF-8">') + '<meta charset="UTF-8">'.length);
    expect(out.split(poster)).toHaveLength(2);
    // Not high priority: stays where it was.
    expect(out.indexOf('/low.jpg')).toBeGreaterThan(out.indexOf('/a.js'));
    expect(hoistHighPriorityImagePreloads('<head></head>')).toBe('<head></head>');
  });

  it('finds the charset in other spellings, else falls back to just inside <head>', () => {
    const poster = '<link rel="preload" href="/p.jpg" as="image" fetchpriority="high">';
    const selfClosing = hoistHighPriorityImagePreloads(`<head><meta charset='utf-8' /><link rel="modulepreload" href="/a.js">${poster}</head>`);
    expect(selfClosing).toBe(`<head><meta charset='utf-8' />${poster}<link rel="modulepreload" href="/a.js"></head>`);
    const noCharset = hoistHighPriorityImagePreloads(`<head lang="ko"><link rel="modulepreload" href="/a.js">${poster}</head>`);
    expect(noCharset).toBe(`<head lang="ko">${poster}<link rel="modulepreload" href="/a.js"></head>`);
    // No anchor at all: leave the HTML exactly as it was rather than drop the tag.
    expect(hoistHighPriorityImagePreloads(`<p>x</p>${poster}`)).toBe(`<p>x</p>${poster}`);
  });

  it('keeps each file\'s critical rules right before its own link', async () => {
    const html = '<!doctype html><html><head>' +
      '<link rel="stylesheet" href="/assets/a.css"><link rel="stylesheet" href="/assets/b.css">' +
      '</head><body><div class="used b-used">x</div></body></html>';
    const out = await inlineCriticalCss(html, bundleWith({
      'assets/b.css': { type: 'asset', fileName: 'assets/b.css', source: '.b-used{color:pink}' },
    }));
    const head = new DOMParser().parseFromString(out, 'text/html').head;
    const order = [...head.children].map((el) => (el.tagName === 'STYLE' ? `style:${el.textContent}` : `${el.tagName}:${el.getAttribute('href') || ''}`));
    // Merged, b's rules would sit ahead of a's whole file once a lands first and win ties they should lose.
    expect(order.indexOf('style:.b-used{color:pink}')).toBeGreaterThan(order.indexOf('LINK:/assets/a.css'));
    expect(order.indexOf('style:.b-used{color:pink}')).toBeLessThan(order.indexOf('LINK:/assets/b.css'));
  });

  it('keeps the high-priority preload, never the print-media trick', () => {
    // media="print" made Chrome fetch the file last (5.7 s, after JS) and the page shifted (CLS 0.33).
    expect(CRITICAL_CSS_OPTIONS.preload).toBe('swap');
    expect(CRITICAL_CSS_OPTIONS.pruneSource).toBe(false);
    expect(CRITICAL_CSS_OPTIONS.reduceInlineStyles).toBe(false);
    expect(CRITICAL_CSS_OPTIONS.mergeStylesheets).toBe(false);
  });

  // beasties splits class on ' ' only: a multi-line className left "used\n" and the rule was silently dropped.
  it('keeps rules for classes at the end of a line in a multi-line class attribute', async () => {
    const out = await inlineCriticalCss(page('<div class="\n  other\n  used\n" data-class="a\n b">x</div>'), bundleWith());
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect([...doc.querySelectorAll('style')].map((s) => s.textContent).join('')).toContain('.used{color:red}');
    expect(out).toContain('class="other used"');
    // Only class values are touched, and only HTML's own separators (a no-break space is part of a name).
    expect(out).toContain('data-class="a\n b"');
    expect(collapseClassWhitespace('<i class="a b\tc">')).toBe('<i class="a b c">');
  });

  it('drops the beasties work marker from <html>', async () => {
    const out = await inlineCriticalCss(page('<p class="used">x</p>'), bundleWith());
    expect(out).not.toContain('data-beasties-container');
    expect(out).toMatch(/<html>/);
  });
});

describe('criticalCssPlugin', () => {
  it('is off unless prerendering', () => {
    expect(criticalCssPlugin({ enabled: false, routes: ['/'] })).toBeNull();
  });

  it('rewrites the prerendered route HTML only', async () => {
    const html = page('<div class="used">x</div>');
    const bundle = bundleWith({
      'index.html': { type: 'asset', fileName: 'index.html', source: html },
      'planner/index.html': { type: 'asset', fileName: 'planner/index.html', source: html },
      // The prerender plugin builds names with path.join, so on Windows they carry backslashes.
      'tours\\index.html': { type: 'asset', fileName: 'tours\\index.html', source: html },
      'other.html': { type: 'asset', fileName: 'other.html', source: html },
    }) as Record<string, { source: string }>;
    const plugin = criticalCssPlugin({ enabled: true, routes: ['/', '/planner', '/tours', '/missing'] })!;
    const hook = plugin.generateBundle as { order: string; handler: (o: unknown, b: unknown) => Promise<void> };
    expect(hook.order).toBe('post');
    await hook.handler({}, bundle);

    expect(bundle['index.html'].source).toContain('rel="preload"');
    expect(bundle['planner/index.html'].source).toContain('rel="preload"');
    expect(bundle['tours\\index.html'].source).toContain('rel="preload"');
    expect(bundle['other.html'].source).toBe(html);
    expect(bundle['assets/a.css'].source).toBe(CSS);
  });
});

describe('whenFullCssLoaded', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    vi.useRealTimers();
  });

  const addPreload = () => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.setAttribute('as', 'style');
    link.setAttribute('onload', "this.rel='stylesheet'");
    document.head.appendChild(link);
    return link;
  };

  it('resolves at once when nothing is pending (dev build, prerender capture, already loaded)', async () => {
    const done = vi.fn();
    await whenFullCssLoaded(document).then(done);
    expect(done).toHaveBeenCalled();
  });

  it('waits for every pending stylesheet, counting an error as done', async () => {
    const a = addPreload();
    const b = addPreload();
    const done = vi.fn();
    const wait = whenFullCssLoaded(document, 60_000).then(done);

    a.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();

    b.dispatchEvent(new Event('error'));
    await wait;
    expect(done).toHaveBeenCalled();
  });

  it('counts one link once, even if load is followed by error', async () => {
    const a = addPreload();
    addPreload();
    const done = vi.fn();
    void whenFullCssLoaded(document, 60_000).then(done);
    a.dispatchEvent(new Event('load'));
    a.dispatchEvent(new Event('error'));
    await Promise.resolve();
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
  });

  it('never blocks the app past the cap, and attaches the full stylesheet itself', async () => {
    vi.useFakeTimers();
    const link = addPreload();
    const done = vi.fn();
    const wait = whenFullCssLoaded(document, 4000).then(done);
    await vi.advanceTimersByTimeAsync(3999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(done).toHaveBeenCalled();
    // A browser that ignored rel=preload would otherwise stay on the first-screen rules for good.
    expect(link.rel).toBe('stylesheet');
  });
});

describe('sky poster preload', () => {
  afterEach(() => {
    cleanup();
    document.head.innerHTML = '';
  });

  it('puts a high-priority preload for the hero poster (LCP) into <head>', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    render(<SkyLayer playLabel="Play" pauseLabel="Pause" />);
    const link = document.head.querySelector('link[rel="preload"][as="image"][href="/home-dope/v3-cloud-poster.jpg"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('fetchpriority')).toBe('high');
    vi.unstubAllGlobals();
  });
});

describe('wiring', () => {
  it('runs after the prerender plugin and before the audit', () => {
    const cfg = read('vite.config.ts');
    const prerenderAt = cfg.indexOf('prerender({');
    const criticalAt = cfg.indexOf('criticalCssPlugin({ enabled:');
    const auditAt = cfg.indexOf('prerenderAuditPlugin({ enabled:');
    expect(prerenderAt).toBeGreaterThan(-1);
    expect(criticalAt).toBeGreaterThan(prerenderAt);
    expect(auditAt).toBeGreaterThan(criticalAt);
  });

  it('mounts React only after the full stylesheet', () => {
    expect(read('src/main.tsx')).toMatch(/whenFullCssLoaded\(\)\.then\(\(\) => \{\s*createRoot\(/);
  });
});
