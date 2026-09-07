// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadLocale, type Language } from '../../src/i18n';
import { HOME_COPY } from '../../src/sections/home/homeCopy';
import { COCO } from '../../src/components/coco/tokens';
import type { WizardState } from '../../src/components/charter/types';

void React;
vi.mock('../../src/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../../src/lib/firebase', () => ({ auth: {}, signInWithGoogle: vi.fn() }));
vi.mock('firebase/auth', () => ({ signOut: vi.fn() }));
vi.mock('../../src/components/LoyaltyBadge', () => ({ LoyaltyBadge: () => null }));
vi.mock('../../src/components/WishlistButton', () => ({ WishlistPanel: () => null }));
vi.mock('../../src/components/CartButton', () => ({ CartPanel: () => null }));
vi.mock('../../src/components/PwaInstallButton', () => ({ PwaInstallButton: () => null }));
vi.mock('../../src/components/charter/AddressAutocomplete', () => ({ AddressAutocomplete: () => null }));

import { Header } from '../../src/sections/Header';
import { CapabilityLedger } from '../../src/sections/home/CapabilityLedger';
import { CocoStepper } from '../../src/components/coco/CocoUI';
import { Step1Origin } from '../../src/components/charter/Step1Origin';

afterEach(cleanup);
const LANGS: Language[] = ['ko', 'en', 'ja', 'zh'];

describe('public header accessible names', () => {
  it.each(LANGS)('%s: visible logo and language text remain in the accessible name', async (language) => {
    const t = await loadLocale(language);
    render(<MemoryRouter><Header language={language} t={t} onLanguageChange={vi.fn()} /></MemoryRouter>);
    const logo = screen.getByRole('link', { name: /^CocoTrip\s*BETA$/ });
    expect(logo.getAttribute('href')).toBe('/');
    expect(logo.hasAttribute('aria-label')).toBe(false);
    const badge = within(logo).getByText('BETA');
    expect(badge.style.color).toBe('var(--ec-text-secondary)');
    const mark = logo.querySelector('img')!;
    expect(mark.getAttribute('alt')).toBe('');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.getAttribute('width')).toBe('32');
    expect(mark.getAttribute('height')).toBe('32');
    const short = language.toUpperCase();
    const control = screen.getByRole('button', { name: `${short} · ${t.nav.language}` });
    expect(control.textContent).toBe(short);
    expect(control.className).toContain('min-h-[44px]');
    expect(control.className).toContain('focus-visible:ring-2');
  });

  it('language selection still works from the keyboard without signing in', async () => {
    const t = await loadLocale('en');
    const onLanguageChange = vi.fn();
    const user = userEvent.setup();
    render(<MemoryRouter><Header language="en" t={t} onLanguageChange={onLanguageChange} /></MemoryRouter>);
    screen.getByRole('button', { name: `EN · ${t.nav.language}` }).focus();
    await user.keyboard('{Enter}');
    const korean = screen.getByRole('menuitem', { name: '한국어' });
    korean.focus();
    await user.keyboard('{Enter}');
    expect(onLanguageChange).toHaveBeenCalledExactlyOnceWith('ko');
  });

  it('shared proposal still hides BETA and has the unmodified home route', async () => {
    const t = await loadLocale('en');
    render(<MemoryRouter initialEntries={['/my-plans/example?shared=1']}><Header language="en" t={t} onLanguageChange={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'CocoTrip' }).getAttribute('href')).toBe('/');
    expect(screen.queryByText('BETA')).toBeNull();
  });
});

describe('semantic lists and native step buttons', () => {
  it.each(LANGS)('%s: each definition starts with a term followed by its two descriptions', (language) => {
    const { container } = render(<CapabilityLedger copy={HOME_COPY[language]} />);
    const groups = Array.from(container.querySelector('dl')!.children);
    expect(groups).toHaveLength(HOME_COPY[language].ledger.items.length);
    groups.forEach((group, index) => {
      expect(Array.from(group.children).map((child) => child.tagName)).toEqual(['DT', 'DD', 'DD']);
      const item = HOME_COPY[language].ledger.items[index];
      expect(group.children[0].textContent).toBe(item.label);
      expect(group.children[1].textContent).toBe(item.figure);
      expect(group.children[2].textContent).toBe(item.note);
      expect(group.children[1].className).toContain('order-1');
    });
  });

  it('every step remains a keyboard button within a list item; only completed steps navigate', async () => {
    const onStepClick = vi.fn();
    const user = userEvent.setup();
    render(<CocoStepper total={3} current={1} labels={['Origin', 'Destination', 'Date']} onStepClick={onStepClick} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    items.forEach((item) => expect(within(item).getByRole('button')).toBeTruthy());
    const buttons = screen.getAllByRole('button');
    buttons[0].focus();
    await user.keyboard('{Enter}');
    expect(onStepClick).toHaveBeenCalledExactlyOnceWith(0);
    expect(buttons[1].getAttribute('aria-current')).toBe('step');
    expect(buttons[2].getAttribute('aria-disabled')).toBe('true');
    onStepClick.mockClear();
    for (const button of buttons.slice(1)) {
      button.focus();
      await user.keyboard('{Enter}');
    }
    expect(onStepClick).not.toHaveBeenCalled();
  });
});

describe('origin captions and selection', () => {
  it.each(LANGS)('%s: captions no longer multiply opacity; selection clears only the existing custom fields', (language) => {
    const patch = vi.fn();
    const state = { origin: 'ICN' } as WizardState;
    const { container } = render(<Step1Origin state={state} patch={patch} language={language} />);
    const current = container.querySelector('button[data-origin-code="ICN"]')!;
    expect(current.getAttribute('aria-pressed')).toBe('true');
    const next = container.querySelector('button[data-origin-code="GMP"]')!;
    expect(next.getAttribute('aria-pressed')).toBe('false');
    const caption = next.querySelector('span.min-w-0')!.lastElementChild!;
    expect(caption.className).toContain('text-white/70');
    expect(caption.className).not.toMatch(/opacity-/);
    fireEvent.click(next);
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      origin: 'GMP', originCustom: undefined, originLat: undefined, originLng: undefined,
      originAddress: undefined, originName: undefined, originCategory: undefined,
    });
  });
});

describe('source-only contrast and regional name guards (not pixel measurements)', () => {
  it('the extracted shared palette keeps all original CSS token references', () => {
    expect(COCO).toEqual({
      purple: 'var(--coco-purple)', pink: 'var(--coco-pink)', lavender: 'var(--coco-lavender)',
      navy: 'var(--coco-navy)', muted: 'var(--coco-muted)', ctaGradient: 'var(--coco-cta-gradient)',
      ctaShadow: 'var(--coco-cta-shadow)', cardBorder: 'var(--coco-card-border)',
      cardShadow: 'var(--coco-card-shadow)', pageBg: 'var(--coco-page-bg)',
    });
    const mobileHome = readFileSync(resolve('src/pages/MobileHomeV2.tsx'), 'utf8');
    expect(mobileHome).toContain("import { COCO } from '@/components/coco/tokens'");
    const ui = readFileSync(resolve('src/components/coco/CocoUI.tsx'), 'utf8');
    expect(ui).toContain("import { COCO } from './tokens'");
    expect(ui).not.toContain('export const COCO');
  });

  it('wizard visible helper text avoids the old 35–55% white classes', () => {
    const source = readFileSync(resolve('src/components/charter/CharterWizard.tsx'), 'utf8');
    expect(source).not.toMatch(/text-white\/(35|40|45|50|55)(?!\d)/);
    expect(source.match(/text-white\/70/g)?.length || 0).toBeGreaterThanOrEqual(10);
  });

  it('regional button name comes from its visible region and count, not a conflicting aria-label', () => {
    const source = readFileSync(resolve('src/pages/ToursPage.tsx'), 'utf8');
    const button = (source.match(/<button\b[\s\S]*?<\/button>/g) || []).find((element) => element.includes('className="tours-catalog-region-card"')) || '';
    expect(button).toContain('tours-catalog-region-card');
    expect(button).toContain('<strong>{regionLabel}</strong>');
    expect(button).toContain('<small>{count} {tl.toursUnit}</small>');
    expect(button).not.toContain('aria-label=');
    expect(button).toContain('aria-pressed={isActive}');
    expect(button).toContain('onClick={() => setActiveRegion(key)}');
  });
});
