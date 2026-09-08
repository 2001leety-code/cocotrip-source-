// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiOpsCenter, { type OpsCenterData } from '@/pages/AdminAiOpsCenter';
import { adminAiOpsCopy } from '@/lib/adminAiOpsCopy';
import type { Language } from '@/i18n';

void React;

const languageState = vi.hoisted(() => ({ language: 'ko' as Language }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: () => undefined }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: languageState.language, changeLanguage: vi.fn() }) }));
vi.mock('@/components/OwnerControllerSetupPanel', () => ({ OwnerControllerSetupPanel: () => null }));
vi.mock('@/components/OwnerNotificationSetup', () => ({ OwnerNotificationSetup: () => null }));

const data: OpsCenterData = {
  generatedAt: '2026-09-08T00:00:00Z',
  summary: { actionRequired: 0, urgent: 0, todayReservations: 0, upcoming7d: 0, openInquiries: 0, openCs: 0, paymentReviews: 0, automationAttention: 0 },
  workItems: [], reservations: [], inboxItems: [], automation: [], sources: [], partialErrors: [],
  deduplication: { rule: 'synthetic', removedMirrorCount: 0 },
  window: { perSourceLimit: 180, note: 'synthetic' },
};

function renderNavigation() {
  render(<MemoryRouter><AdminAiOpsCenter previewData={data} /></MemoryRouter>);
  const nav = screen.getByRole('navigation', { name: adminAiOpsCopy[languageState.language].jumpLabel });
  const links = within(nav).getAllByRole('link');
  const cost = within(nav).getByRole('link', { name: adminAiOpsCopy[languageState.language].apiHostingCosts });
  return { nav, links, cost };
}

function rect(left: number, width: number) {
  return { left, right: left + width, width, top: 145, bottom: 189, height: 44, x: left, y: 145, toJSON: () => ({}) } as DOMRect;
}

function geometry(nav: HTMLElement, link: HTMLElement, options: {
  scrollLeft?: number; clientWidth?: number; scrollWidth?: number; clientLeft?: number;
  linkLeft: number; linkWidth: number; focusVisible?: boolean;
}) {
  Object.defineProperties(nav, {
    clientWidth: { configurable: true, value: options.clientWidth || 340 },
    scrollWidth: { configurable: true, value: options.scrollWidth || 841 },
    clientLeft: { configurable: true, value: options.clientLeft || 0 },
  });
  nav.scrollLeft = options.scrollLeft || 0;
  nav.scrollTop = 37;
  vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(rect(25, options.clientWidth || 340));
  const initialScroll = nav.scrollLeft;
  vi.spyOn(link, 'getBoundingClientRect').mockImplementation(() => rect(options.linkLeft - (nav.scrollLeft - initialScroll), options.linkWidth));
  vi.spyOn(link, 'matches').mockImplementation(selector => selector === ':focus-visible' && options.focusVisible !== false);
}

beforeEach(() => {
  languageState.language = 'ko';
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external calls in section navigation tests'); }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Admin section shortcuts keep keyboard focus visible using horizontal scroll only', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s retains all eight native anchor targets and 44px controls', language => {
    languageState.language = language;
    const { nav, links, cost } = renderNavigation();
    expect(links.map(link => link.getAttribute('href'))).toEqual(['#ops-summary', '#ops-queue', '#ops-reservation', '#ops-inbox', '#ops-automation', '#ops-cost', '#ops-source', '#ops-settings']);
    for (const link of links) {
      expect(link).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'shrink-0', 'focus-visible:ring-2');
    }
    expect(nav).toHaveClass('overflow-x-auto');
    expect(cost).toHaveTextContent(adminAiOpsCopy[language].apiHostingCosts);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'partially clipped right edge', scrollLeft: 0, linkLeft: 338.578125, linkWidth: 108.140625, expected: 81.71875 },
    { name: 'partially clipped left edge when moving backwards', scrollLeft: 100, linkLeft: -10, linkWidth: 90, expected: 65 },
    { name: 'native browser already revealed the link before focus', scrollLeft: 200, linkLeft: 200, linkWidth: 100, expected: 200 },
    { name: 'first link never scrolls below zero', scrollLeft: 20, linkLeft: -100, linkWidth: 90, expected: 0 },
    { name: 'last link clamps to maximum scrollLeft', scrollLeft: 480, linkLeft: 400, linkWidth: 80, expected: 501 },
    { name: 'non-overflowing navigation remains at zero', scrollLeft: 0, linkLeft: 340, linkWidth: 80, scrollWidth: 340, expected: 0 },
    { name: 'client border does not count as visible space', scrollLeft: 80, linkLeft: 27, linkWidth: 80, clientLeft: 4, expected: 78 },
  ])('$name', options => {
    const { nav, cost } = renderNavigation();
    geometry(nav, cost, options);
    const hrefBefore = window.location.href;
    const scrollYBefore = window.scrollY;
    const scrollTo = vi.spyOn(window, 'scrollTo');
    fireEvent.focus(cost);
    expect(nav.scrollLeft).toBeCloseTo(options.expected, 6);
    expect(nav.scrollTop).toBe(37);
    expect(window.scrollY).toBe(scrollYBefore);
    expect(window.location.href).toBe(hrefBefore);
    expect(cost).toHaveAttribute('href', '#ops-cost');
    expect(scrollTo).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('repeated keyboard focus does not move an already fully visible link again', () => {
    const { nav, cost } = renderNavigation();
    geometry(nav, cost, { linkLeft: 338.578125, linkWidth: 108.140625 });
    fireEvent.focus(cost);
    const firstScroll = nav.scrollLeft;
    fireEvent.focus(cost);
    expect(nav.scrollLeft).toBe(firstScroll);
    expect(cost.getBoundingClientRect().right).toBe(365);
  });

  it('pointer focus and manual horizontal scrolling are left untouched', () => {
    const { nav, cost } = renderNavigation();
    geometry(nav, cost, { scrollLeft: 80, linkLeft: 360, linkWidth: 150, focusVisible: false });
    fireEvent.focus(cost);
    expect(nav.scrollLeft).toBe(80);
    expect(cost.getBoundingClientRect).not.toHaveBeenCalled();
    expect(nav.getBoundingClientRect).not.toHaveBeenCalled();
    nav.scrollLeft = 180;
    fireEvent.scroll(nav);
    expect(nav.scrollLeft).toBe(180);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(cost, click);
    expect(click.defaultPrevented).toBe(false);
    expect(nav.scrollLeft).toBe(180);
  });

  it.each(['Tab', 'Enter'])('does not cancel native %s key behavior', key => {
    const { cost } = renderNavigation();
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    fireEvent(cost, event);
    expect(event.defaultPrevented).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
