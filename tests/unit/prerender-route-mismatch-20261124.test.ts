// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeRoutePath, stampPrerenderRoute } from '../../scripts/lib/prerender-strip.mjs';

// 2026-11-24: routes that are not prerendered (/mypage, /my-plans/…, /booking/manage, /s/…) are served
// the prerendered HOME html by Vercel's rewrite, so the home page showed until the app replaced it.
// The build stamps each prerendered html with its own route; a tiny script in index.html hides #root
// when the address differs, and src/main.tsx un-hides it in the app's first commit.

const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const indexHtml = read('index.html');
const guardScript = (() => {
  const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = scripts.filter((s) => s.includes('data-prerender-route'));
  if (found.length !== 1) throw new Error(`index.html: expected 1 route guard script, found ${found.length}`);
  return found[0];
})();

function runGuard(stamp: string | null, pathname: string) {
  document.head.querySelector('#cc-route-mismatch')?.remove();
  if (stamp === null) document.documentElement.removeAttribute('data-prerender-route');
  else document.documentElement.setAttribute('data-prerender-route', stamp);
  window.history.replaceState(null, '', pathname);
  new Function(guardScript)();
  return document.getElementById('cc-route-mismatch');
}

afterEach(() => {
  document.head.querySelector('#cc-route-mismatch')?.remove();
  document.documentElement.removeAttribute('data-prerender-route');
  vi.useRealTimers();
});

describe('stampPrerenderRoute', () => {
  it('writes the route on <html>, trailing slash dropped, root kept', () => {
    expect(stampPrerenderRoute('<!DOCTYPE html><html lang="en"><head>', '/planner/'))
      .toBe('<!DOCTYPE html><html data-prerender-route="/planner" lang="en"><head>');
    expect(stampPrerenderRoute('<html>', '/')).toBe('<html data-prerender-route="/">');
    expect(stampPrerenderRoute('<html>', '/a"b')).toBe('<html data-prerender-route="/a&#34;b">');
  });

  it('normalizes the same way the index.html script does', () => {
    expect(normalizeRoutePath('/index.html')).toBe('/');
    expect(normalizeRoutePath('/guide/x/')).toBe('/guide/x');
    expect(normalizeRoutePath('/')).toBe('/');
  });

  it('vite.config.ts stamps every prerendered route in postProcess', () => {
    expect(read('vite.config.ts')).toMatch(/renderedRoute\.html = stampPrerenderRoute\(stripPrerenderOnlyTags\(renderedRoute\.html\), renderedRoute\.originalRoute\)/);
  });
});

describe('index.html hides #root when the prerendered html belongs to another address', () => {
  it('home html served for /mypage → hidden', () => {
    const style = runGuard('/', '/mypage');
    expect(style?.textContent).toBe('#root{visibility:hidden}');
  });

  it('home html at / (and /index.html) → shown', () => {
    expect(runGuard('/', '/')).toBeNull();
    expect(runGuard('/', '/index.html')).toBeNull();
  });

  it('planner html at /planner or /planner/ → shown', () => {
    expect(runGuard('/planner', '/planner')).toBeNull();
    expect(runGuard('/planner', '/planner/')).toBeNull();
  });

  it('unstamped html (dev server, prerender browser) → never hidden', () => {
    expect(runGuard(null, '/mypage')).toBeNull();
  });

  it('safety cap: shows the html again if the app never mounts', () => {
    vi.useFakeTimers();
    expect(runGuard('/', '/my-plans/abc')).not.toBeNull();
    vi.advanceTimersByTime(10000);
    expect(document.getElementById('cc-route-mismatch')).toBeNull();
  });

  it('src/main.tsx removes the guard in the first commit', () => {
    const main = read('src/main.tsx');
    expect(main).toMatch(/document\.getElementById\('cc-route-mismatch'\)\?\.remove\(\)/);
    expect(main).toMatch(/<RevealRoot \/>\s*<App \/>/);
  });
});
