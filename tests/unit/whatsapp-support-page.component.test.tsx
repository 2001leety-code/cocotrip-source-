// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WhatsAppSupportPage from '../../src/pages/WhatsAppSupportPage';
import { WHATSAPP_SUPPORT_START, WHATSAPP_SUPPORT_STOP, WHATSAPP_SUPPORT_URL, whatsappSupportCopy } from '../../src/lib/whatsappSupportCopy';
void React;
const languageState = vi.hoisted(() => ({ language: 'ko' as 'ko' | 'en' | 'ja' | 'zh', changeLanguage: vi.fn() }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => languageState }));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
beforeEach(() => { languageState.language = 'ko'; languageState.changeLanguage.mockReset(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const view = () => render(<MemoryRouter><WhatsAppSupportPage /></MemoryRouter>);

describe('explicit WhatsApp consultation opt-in', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as const)('requires a fresh explicit %s agreement before exposing the exact START link', language => {
    languageState.language = language;
    const copy = whatsappSupportCopy[language];
    const open = vi.spyOn(window, 'open');
    view();
    expect(document.querySelector('main')!.className).toContain('bg-bg-base');
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    const link = screen.getByRole('link', { name: copy.open });
    expect(checkbox.checked).toBe(false);
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(link);
    expect(open).not.toHaveBeenCalled();
    for (const text of [copy.scope, copy.history, copy.transport, copy.instruction, copy.manual, copy.stop, WHATSAPP_SUPPORT_START, WHATSAPP_SUPPORT_STOP]) expect(screen.getByText(text)).toBeTruthy();
    fireEvent.click(checkbox);
    expect(link.getAttribute('href')).toBe(WHATSAPP_SUPPORT_URL);
    expect(new URL(link.getAttribute('href')!).searchParams.get('text')).toBe('COCOTRIP SUPPORT START');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('aria-disabled')).toBe('false');
    expect(open).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(checkbox);
    expect(link.hasAttribute('href')).toBe(false);
    expect(checkbox.closest('label')!.className).toContain('min-h-[44px]');
    expect(link.className).toContain('min-h-[48px]');
  });
  it('clears consent when display language changes, including returning to the previous language', () => {
    const result = view();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'en' } });
    expect(languageState.changeLanguage).toHaveBeenCalledWith('en');
    languageState.language = 'en'; result.rerender(<MemoryRouter><WhatsAppSupportPage /></MemoryRouter>);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    languageState.language = 'ko'; result.rerender(<MemoryRouter><WhatsAppSupportPage /></MemoryRouter>);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });
  it('maintains four-language key and function parity without empty copy', () => {
    for (const copy of Object.values(whatsappSupportCopy)) {
      expect(Object.keys(copy).sort()).toEqual(Object.keys(whatsappSupportCopy.ko).sort());
      expect(Object.keys(copy.admin).sort()).toEqual(Object.keys(whatsappSupportCopy.ko.admin).sort());
      expect(copy.admin.range(6, 7, 7)).toContain('6');
      for (const value of [...Object.values(copy), ...Object.values(copy.admin)]) if (typeof value === 'string') expect(value.trim().length).toBeGreaterThan(0);
    }
  });
  it('adds only the dedicated lazy route and fourth links destination, preserving existing entries', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const links = readFileSync('src/pages/LinksPage.tsx', 'utf8');
    expect(app).toContain("const WhatsAppSupportPage = lazy(() => import('@/pages/WhatsAppSupportPage'));");
    expect(app).toMatch(/path="\/whatsapp-support"[^\n]+<WhatsAppSupportPage \/>/);
    expect(app).toMatch(/const isBareLanding = [^;]+location\.pathname === '\/whatsapp-support'/);
    expect(app.slice(app.indexOf('function NonMoodChrome()'))).toContain("location.pathname === '/whatsapp-support'");
    expect(app).toContain('<CookieBanner />');
    expect(links).toContain('href="/whatsapp-support"');
    for (const route of ["path: '/planner'", "path: '/tours'", "path: '/charter'"]) expect(links).toContain(route);
    expect(links).toContain('mailto:cocotripkr@gmail.com');
  });
});
