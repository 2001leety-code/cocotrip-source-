// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_DELETION_COPY,
  pickAccountDeletionCopy,
} from '../../src/pages/accountDeletionCopy';
import en from '../../src/i18n/locales/en.json';
import ko from '../../src/i18n/locales/ko.json';
import ja from '../../src/i18n/locales/ja.json';
import zh from '../../src/i18n/locales/zh.json';

void React;

const LANGS = ['en', 'ko', 'ja', 'zh'] as const;
const LOCALES = { en, ko, ja, zh } as Record<string, Record<string, unknown>>;
const state = vi.hoisted(() => ({ language: 'en', t: {} as Record<string, unknown> }));
const usePageMetaMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: state.language, t: state.t, changeLanguage: vi.fn() }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: usePageMetaMock }));
vi.mock('@/sections/Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('@/sections/Footer', () => ({ Footer: () => <div data-testid="footer" /> }));

const AccountDeletion = (await import('../../src/pages/AccountDeletion')).default;

function renderPage(language: string) {
  state.language = language;
  state.t = LOCALES[language];
  return render(<MemoryRouter><AccountDeletion /></MemoryRouter>);
}

function keyPaths(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).sort()
      .flatMap((key) => keyPaths((value as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

beforeEach(() => {
  cleanup();
  usePageMetaMock.mockReset();
});

describe('/account-deletion 공개 요청 화면', () => {
  it('네 언어의 문구 구조가 같고 알 수 없는 언어는 영어로 떨어진다', () => {
    const base = keyPaths(ACCOUNT_DELETION_COPY.en);
    for (const language of LANGS) expect(keyPaths(ACCOUNT_DELETION_COPY[language]), language).toEqual(base);
    expect(pickAccountDeletionCopy('fr')).toBe(ACCOUNT_DELETION_COPY.en);
  });

  it.each([...LANGS])('%s: 제목·요청 이메일·개인정보처리방침 링크가 보인다', (language) => {
    const { container } = renderPage(language);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ACCOUNT_DELETION_COPY[language].title);
    const request = screen.getByRole('link', { name: ACCOUNT_DELETION_COPY[language].cta });
    expect(request.getAttribute('href')).toContain('mailto:cocotripkr@gmail.com');
    expect(request.getAttribute('href')).toContain('Account%20deletion%20request');
    expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
  });

  it('자동 삭제로 오해시키지 않고 민감정보 전송을 금지한다', () => {
    const { container } = renderPage('en');
    const text = container.textContent || '';
    expect(text).toContain('does not immediately delete anything');
    expect(text).toContain('passwords');
    expect(text).toContain('one-time verification codes');
    expect(text).toContain('PayPal details');
  });

  it('검색 유입용 페이지가 아닌 요청 흐름으로 noindex를 명시한다', () => {
    renderPage('en');
    expect(usePageMetaMock).toHaveBeenCalledWith(expect.objectContaining({ robots: 'noindex, nofollow' }));
  });
});
