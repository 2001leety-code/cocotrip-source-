// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LinksPage from '../../src/pages/LinksPage';
import WhatsAppSupportPage from '../../src/pages/WhatsAppSupportPage';
import Terms from '../../src/pages/Terms';
import Privacy from '../../src/pages/Privacy';
import TravelTerms from '../../src/pages/TravelTerms';
void React;

// Static pages on Home's vocabulary (2026-10-11). The restyle may only change wrappers:
// hrefs, the single h1 and the legal wording are pinned to what the pages rendered before.
const languageState = vi.hoisted(() => ({ language: 'ko' as 'ko' | 'en' | 'ja' | 'zh', t: {}, changeLanguage: vi.fn() }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => languageState }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/sections/Header', () => ({ Header: () => null }));
vi.mock('@/sections/Footer', () => ({ Footer: () => null }));
vi.mock('@/components/CookieSettings', () => ({ CookieSettings: () => <button type="button">cookie</button> }));

beforeEach(() => {
  languageState.language = 'ko';
  // SkyLayer asks for reduced motion on mount; answer "reduce" so no video mounts in jsdom.
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const view = (Page: () => React.JSX.Element, url = '/') => render(<MemoryRouter initialEntries={[url]}><Page /></MemoryRouter>);
const hrefs = () => [...document.querySelectorAll('[href]')].map((a) => a.getAttribute('href'));
const unique = (list: (string | null)[]) => [...new Set(list)].sort();

// Pre-edit hrefs, extracted from the pages before the restyle (Header/Footer mocked out).
const LINKS_BEFORE = [
  '/planner?utm_source=link_in_bio&utm_medium=bio&utm_content=planner',
  '/tours?utm_source=link_in_bio&utm_medium=bio&utm_content=tours',
  '/charter?utm_source=link_in_bio&utm_medium=bio&utm_content=charter',
  '/whatsapp-support',
  'mailto:cocotripkr@gmail.com',
];
const LINKS_UTM_BEFORE = [
  '/planner?utm_source=instagram&utm_medium=bio&utm_content=planner',
  '/tours?utm_source=instagram&utm_medium=bio&utm_content=tours',
  '/charter?utm_source=instagram&utm_medium=bio&utm_content=charter',
  '/whatsapp-support',
  'mailto:cocotripkr@gmail.com',
];
const WHATSAPP_CONSENTED_BEFORE = ['/', 'https://wa.me/821087140611?text=COCOTRIP%20SUPPORT%20START'];

const PAGES = [
  ['links', LinksPage, '/links', 'Build my Korea plan — free'],
  ['whatsapp-support', WhatsAppSupportPage, '/whatsapp-support', 'COCOTRIP SUPPORT START'],
  ['terms', Terms, '/terms', '여행 서비스의 취소 및 환불은 아래 규정에 따라 처리됩니다:'],
  ['privacy', Privacy, '/privacy', '개인정보 침해신고센터'],
  // 2026-10-11 운영자 승인: 법인 주소 신촌로 127 로 갱신 (용산 → 서대문)
  ['travel-terms', TravelTerms, '/travel-terms', '• 주소: 서울특별시 서대문구 신촌로 127'],
] as const;

describe('static pages on the home-dope vocabulary', () => {
  it.each(PAGES)('%s: one h1, .home-dope root, legal/copy sample, no mojibake', (_name, Page, url, sample) => {
    view(Page, url);
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('main')!.classList.contains('home-dope')).toBe(true);
    expect(document.body.textContent).toContain(sample);
    expect(document.body.textContent).not.toMatch(/\?{2,}|�/);
  });

  it('/links keeps every pre-edit destination, UTM-preserving', () => {
    view(LinksPage, '/links');
    expect(unique(hrefs())).toEqual([...LINKS_BEFORE].sort());
    cleanup();
    view(LinksPage, '/links?utm_source=instagram&utm_medium=bio');
    expect(unique(hrefs())).toEqual([...LINKS_UTM_BEFORE].sort());
    // Static pass: nothing cycles, so no pause/dot controls exist.
    expect(document.querySelector('.home-dope-pass__dots, .home-dope-pass__pause')).toBeNull();
  });

  it('/whatsapp-support keeps its hrefs (START link only after consent)', () => {
    view(WhatsAppSupportPage, '/whatsapp-support');
    expect(hrefs()).toEqual(['/']);
    fireEvent.click(document.querySelector('input[type=checkbox]')!);
    expect(hrefs()).toEqual(WHATSAPP_CONSENTED_BEFORE);
  });

  it.each([['terms', Terms, 4], ['privacy', Privacy, 4], ['travel-terms', TravelTerms, 7]] as const)(
    '%s: no hrefs of its own beyond the table of contents, each row anchoring an article',
    (_name, Page, count) => {
      view(Page);
      const list = hrefs();
      expect(list).toEqual(Array.from({ length: count }, (_, i) => `#article-${i + 1}`));
      for (const href of list) expect(document.getElementById(href!.slice(1))?.querySelector('h2')).toBeTruthy();
    },
  );

  it.each(['en', 'ja', 'zh'] as const)('legal pages render in %s without empty labels', (language) => {
    languageState.language = language;
    for (const Page of [Terms, Privacy, TravelTerms]) {
      view(Page);
      expect(document.querySelectorAll('h1')).toHaveLength(1);
      for (const chip of document.querySelectorAll('.ec-chip')) expect(chip.textContent!.trim().length).toBeGreaterThan(0);
      cleanup();
    }
  });
});
