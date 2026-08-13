// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ language: 'en' }));
const usePageMetaMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    language: state.language,
    t: {},
    changeLanguage: vi.fn(),
  }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: usePageMetaMock }));
vi.mock('@/sections/Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('@/sections/Footer', () => ({ Footer: () => <div data-testid="footer" /> }));

const { default: NotFoundPage } = await import('../../src/pages/NotFoundPage');

const EXPECTED = {
  en: 'Page not found',
  ko: '페이지를 찾을 수 없습니다',
  ja: 'ページが見つかりません',
  zh: '页面未找到',
} as const;

beforeEach(() => {
  cleanup();
  usePageMetaMock.mockReset();
  document.head.innerHTML = '';
  state.language = 'en';
});

describe('app editorial 404 surface', () => {
  it.each(Object.entries(EXPECTED))('renders the shared %s document', (language, title) => {
    state.language = language;
    const { container } = render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('not-found-editorial')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-recovery-link]')).toHaveLength(3);
    expect(container.querySelector('.not-found-editorial__figure')).toHaveTextContent('404');
    expect(container.querySelector('style')?.textContent).not.toMatch(/gradient|backdrop-filter|filter:\s*blur/i);
    expect(usePageMetaMock).toHaveBeenCalledWith(expect.objectContaining({ title }));
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  });

  it('restores a previous robots directive when leaving the page', () => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'index, follow';
    document.head.appendChild(robots);

    const { unmount } = render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    );

    expect(robots.content).toBe('noindex, nofollow');
    unmount();
    expect(robots.content).toBe('index, follow');
  });
});
