// @vitest-environment jsdom
/**
 * Footer business identity line (2026-11-19, operator choice: keep the fold, show one small line).
 *
 * Locks
 *   1) One always-visible line outside the fold: registered trade name, business no.,
 *      mail-order sales no., tour operator no. and the FTC disclosure link (wrkr_no taken
 *      from businessNo), in all 4 languages, each value rendered once.
 *   2) Home and the tour list/detail fold the contact block; other pages keep it expanded.
 *   3) The tour list and every tour detail state render the shared footer, and the fixed
 *      booking bar never covers its last line.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import en from '../../src/i18n/locales/en.json';
import ko from '../../src/i18n/locales/ko.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';
import type { Translations } from '../../src/i18n';

void React;

vi.mock('@/components/CookieSettings', () => ({ CookieSettings: () => <button type="button">cookie</button> }));

const { Footer } = await import('../../src/sections/Footer');

const LOCALES = { ko, en, ja, zh } as unknown as Record<string, Translations>;
const FTC = 'https://www.ftc.go.kr/bizCommPop.do?wrkr_no=4238803168';
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');

function renderAt(path: string, lang = 'ko') {
  return render(<MemoryRouter initialEntries={[path]}><Footer t={LOCALES[lang]} /></MemoryRouter>);
}

afterEach(cleanup);

describe('footer business identity line', () => {
  it.each(Object.keys(LOCALES))('%s: name + 3 numbers + FTC link, outside the fold, each once', (lang) => {
    const f = LOCALES[lang].footer;
    const { container, getByTestId } = renderAt('/', lang);
    const line = getByTestId('footer-business-identity');
    expect(line.closest('details')).toBeNull();
    expect(f.company, `${lang} registered name`).toContain('주식회사 코코트립');
    for (const v of [f.company, f.businessNo, f.mailOrderNo, f.tourNo]) {
      expect(line.textContent, `${lang} line: ${v}`).toContain(v);
      expect(container.textContent!.split(v).length - 1, `${lang} once: ${v}`).toBe(1);
    }
    const link = line.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(FTC);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe(f.bizInfoLink);
  });

  it.each(['/', '/planner', '/tours', '/tours/seoul-night'])('%s folds the contact block, line stays outside', (path) => {
    const { container, getByTestId } = renderAt(path);
    const details = container.querySelector('details.home-dope-footer-info');
    expect(details).not.toBeNull();
    expect(details!.querySelector('a[href="tel:+821087140611"]')).not.toBeNull();
    expect(getByTestId('footer-business-identity').closest('details')).toBeNull();
  });

  it.each(['/guide', '/charter', '/about', '/tours-x'])('%s keeps the contact block expanded', (path) => {
    const { container } = renderAt(path);
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('a[href="tel:+821087140611"]')).not.toBeNull();
  });

  it('only the home paths wear the dark home chrome', () => {
    expect(renderAt('/').container.querySelector('footer')!.className).toContain('home-dope-chrome');
    cleanup();
    expect(renderAt('/tours').container.querySelector('footer')!.className).not.toContain('home-dope-chrome');
  });
});

describe('tour pages render the shared footer', () => {
  it('tour list renders it after main', () => {
    expect(read('src/pages/ToursPage.tsx')).toMatch(/<\/main>\s*<Footer t=\{t\} \/>/);
  });

  it('tour detail renders it in the shell, so loading / error / not-found / detail all get it', () => {
    expect(read('src/pages/TourDetailPage.tsx')).toMatch(/\{children\}\s*<Footer t=\{t\} \/>/);
  });

  it('the fixed booking bar clearance sits on the footer (desktop 176px, phone 208px)', () => {
    const css = read('src/styles/editorial-tour-detail.css');
    const rule = (px: number) => new RegExp(`\\.tour-detail-editorial:has\\(> \\.tour-detail-booking-bar\\) > footer \\{\\s*padding-bottom: ${px}px;`);
    expect(css).toMatch(rule(176));
    expect(css).toMatch(rule(208));
  });

  it('fold styles are global, because tour pages do not load home-dope.css', () => {
    expect(read('src/styles/editorial.css')).toContain('.home-dope-footer-info__summary {');
    expect(read('src/styles/home-dope.css')).not.toContain('home-dope-footer-info');
  });
});
