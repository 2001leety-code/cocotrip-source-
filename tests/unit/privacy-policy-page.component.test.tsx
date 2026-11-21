// @vitest-environment jsdom
/**
 * The privacy policy page as rendered (operator decisions 2026-11-20): the retention and overseas
 * transfer tables, the phone cards, the upcoming-change notice that runs until the effective date in
 * privacyVersions.ts, the previous version kept on the page, and the cookie article's link to the
 * overseas transfer article. The wording itself is checked in privacy-policy-sections.test.ts.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import Privacy from '../../src/pages/Privacy';
import { PRIVACY_EFFECTIVE_DATE, formatPolicyDate, type PolicyLang } from '../../src/pages/privacyVersions';

void React;

const state = vi.hoisted(() => ({ language: 'ko' as 'ko' | 'en' | 'ja' | 'zh', mobile: false }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: state.language, t: {}, changeLanguage: () => {} }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => {} }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => state.mobile }));
vi.mock('@/sections/Header', () => ({ Header: () => null }));
vi.mock('@/sections/Footer', () => ({ Footer: () => null }));
vi.mock('@/components/CookieSettings', () => ({ CookieSettings: () => null }));

const LANGS: PolicyLang[] = ['en', 'ko', 'ja', 'zh'];
// The effective date begins at midnight in Korea (UTC+9).
const EFFECTIVE = new Date(`${PRIVACY_EFFECTIVE_DATE}T00:00:00+09:00`).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(EFFECTIVE - 1000);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  state.language = 'ko';
  state.mobile = false;
});

const show = (language: PolicyLang, mobile = false) => {
  state.language = language;
  state.mobile = mobile;
  render(<Privacy />);
};
const cellsPerRow = (article: number) =>
  [...document.querySelectorAll(`#article-${article} tbody tr`)].map((tr) => tr.querySelectorAll('td').length);

describe('privacy policy page', () => {
  it.each(LANGS)('%s: retention table 18 × 2, overseas transfer table 10 × 6', (lang) => {
    show(lang);
    expect(cellsPerRow(3)).toEqual(Array(18).fill(2));
    expect(cellsPerRow(6)).toEqual(Array(10).fill(6));
    expect(document.querySelectorAll('#article-6 thead th[scope="col"]')).toHaveLength(6);
    // A table wider than the screen scrolls inside its own box; the box takes keyboard focus and is named by its article.
    const box = document.querySelector('#article-6 [role="region"]')!;
    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('aria-label')).toBe(document.querySelector('#article-6 h2')!.textContent!.replace(/^06/, ''));
  });

  it('on a phone every table row becomes a card labelled by the column names', () => {
    show('ko', true);
    expect(document.querySelector('table')).toBeNull();
    expect(document.querySelectorAll('#article-3 dl')).toHaveLength(18);
    const cards = document.querySelectorAll('#article-6 dl');
    expect(cards).toHaveLength(10);
    expect([...cards[0].querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      '이전받는 자(연락처)', '이전되는 나라', '이전 시기·방법', '이전 항목', '이용 목적', '보유·이용 기간',
    ]);
  });

  it.each(LANGS)('%s: before the effective date a notice gives the date and opens the previous version', (lang) => {
    show(lang);
    const note = document.querySelector('[role="note"]')!;
    expect(note.textContent).toContain(formatPolicyDate(PRIVACY_EFFECTIVE_DATE, lang));
    const previous = document.getElementById('privacy-previous') as HTMLDetailsElement;
    expect(previous.open).toBe(false);
    fireEvent.click(note.querySelector('a[href="#privacy-previous"]')!);
    expect(previous.open).toBe(true);
  });

  it('from the effective date in Korea the notice is gone and the previous version stays', () => {
    vi.setSystemTime(EFFECTIVE);
    show('ko');
    expect(document.querySelector('[role="note"]')).toBeNull();
    expect(document.getElementById('privacy-previous')).not.toBeNull();
  });

  it.each(LANGS)('%s: the previous version keeps its 4 articles and says until when it applied', (lang) => {
    show(lang);
    const previous = document.getElementById('privacy-previous')!;
    expect(previous.tagName).toBe('DETAILS');
    expect(previous.querySelectorAll('h3')).toHaveLength(4);
    expect(previous.querySelector('summary')!.textContent).toContain(formatPolicyDate(PRIVACY_EFFECTIVE_DATE, lang, -1));
    expect(document.getElementById('article-12')!.textContent).toContain(formatPolicyDate(PRIVACY_EFFECTIVE_DATE, lang));
  });

  it.each(LANGS)('%s: the cookie article links to the overseas transfer article', (lang) => {
    show(lang);
    expect(document.querySelector('#article-10 a[href="#article-6"]')).not.toBeNull();
  });
});
