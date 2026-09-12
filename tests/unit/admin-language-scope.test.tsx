// @vitest-environment jsdom
/**
 * 관리자 언어는 고객 화면의 선택·브라우저 언어와 별개여야 한다.
 *
 * 실제 Provider를 함께 올려서 localStorage, SPA 이동, 다른 탭 storage 이벤트가
 * 한 저장소를 잘못 공유하는 회귀를 막는다. 인증·API는 이 계약의 범위가 아니다.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

import { RouteLanguageProvider } from '@/components/RouteLanguageProvider';
import { useLanguage } from '@/hooks/useLanguage';

const CUSTOMER_KEY = 'cocotrip_lang';
const ADMIN_KEY = 'cocotrip_admin_lang';

function LanguageProbe() {
  const { language, changeLanguage } = useLanguage();
  return (
    <section>
      <output data-testid="language">{language}</output>
      <button type="button" onClick={() => changeLanguage('en')}>English</button>
      <button type="button" onClick={() => changeLanguage('ko')}>Korean</button>
      <button type="button" onClick={() => changeLanguage('ja')}>Japanese</button>
      <button type="button" onClick={() => changeLanguage('zh')}>Chinese</button>
      <Link to="/">customer home</Link>
      <Link to="/admin/ai-center">admin AI center</Link>
    </section>
  );
}

function RoutedLanguageProbe() {
  return (
    <Routes>
      <Route path="*" element={<RouteLanguageProvider><LanguageProbe /></RouteLanguageProvider>} />
    </Routes>
  );
}

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><RoutedLanguageProbe /></MemoryRouter>);
}

function language() {
  return screen.getByTestId('language').textContent;
}

function setBrowserLanguage(value: string) {
  Object.defineProperty(window.navigator, 'language', { configurable: true, value });
  Object.defineProperty(window.navigator, 'languages', { configurable: true, value: [value] });
}

beforeEach(() => {
  window.localStorage.clear();
  setBrowserLanguage('en-US');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('관리자와 고객 언어 저장소 분리', () => {
  it.each([
    ['en', 'ko-KR'],
    ['en', 'en-US'],
    ['ja', 'ko-KR'],
    ['ja', 'en-US'],
    ['zh', 'ko-KR'],
    ['zh', 'en-US'],
  ] as const)('고객 %s 저장과 %s 브라우저여도 관리자 첫 진입은 한국어다', (savedCustomer, browserLanguage) => {
    window.localStorage.setItem(CUSTOMER_KEY, savedCustomer);
    setBrowserLanguage(browserLanguage);

    renderAt('/admin/ai-center');

    expect(language()).toBe('ko');
    expect(window.localStorage.getItem(ADMIN_KEY)).toBeNull();
  });

  it('관리자가 명시적으로 고른 언어는 고객 저장값과 무관하게 존중한다', () => {
    window.localStorage.setItem(CUSTOMER_KEY, 'en');
    window.localStorage.setItem(ADMIN_KEY, 'ja');

    renderAt('/admin');

    expect(language()).toBe('ja');
  });

  it('관리자에서 바꾼 언어는 관리자 키에만 저장한다', () => {
    window.localStorage.setItem(CUSTOMER_KEY, 'zh');

    renderAt('/admin/ai-center');
    fireEvent.click(screen.getByRole('button', { name: 'Japanese' }));

    expect(language()).toBe('ja');
    expect(window.localStorage.getItem(ADMIN_KEY)).toBe('ja');
    expect(window.localStorage.getItem(CUSTOMER_KEY)).toBe('zh');
  });

  it('고객에서 바꾼 언어는 관리자 키를 건드리지 않는다', () => {
    window.localStorage.setItem(ADMIN_KEY, 'ko');

    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: 'Chinese' }));

    expect(language()).toBe('zh');
    expect(window.localStorage.getItem(CUSTOMER_KEY)).toBe('zh');
    expect(window.localStorage.getItem(ADMIN_KEY)).toBe('ko');
  });

  it('SPA에서 고객 → 관리자 AI 센터 → 고객으로 이동해도 각 언어를 유지한다', () => {
    window.localStorage.setItem(CUSTOMER_KEY, 'en');
    window.localStorage.setItem(ADMIN_KEY, 'ja');

    renderAt('/');
    expect(language()).toBe('en');

    fireEvent.click(screen.getByRole('link', { name: 'admin AI center' }));
    expect(language()).toBe('ja');

    fireEvent.click(screen.getByRole('link', { name: 'customer home' }));
    expect(language()).toBe('en');
  });

  it('storage 이벤트도 현재 화면의 저장 키만 반영한다', () => {
    window.localStorage.setItem(ADMIN_KEY, 'ko');
    renderAt('/admin');

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: CUSTOMER_KEY,
        newValue: 'zh',
        storageArea: window.localStorage,
      }));
    });
    expect(language()).toBe('ko');

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: ADMIN_KEY,
        newValue: 'ja',
        storageArea: window.localStorage,
      }));
    });
    expect(language()).toBe('ja');
  });

  it('관리자 저장값이 잘못돼도 한국어로 안전하게 시작한다', () => {
    window.localStorage.setItem(ADMIN_KEY, 'invalid');

    renderAt('/admin');

    expect(language()).toBe('ko');
  });

  it('저장소를 못 읽어도 관리자는 한국어로 안전하게 시작한다', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    renderAt('/admin');

    expect(language()).toBe('ko');
    getItem.mockRestore();
  });

  it('/administrator는 관리자 접두 경로가 아니므로 고객 언어를 쓴다', () => {
    window.localStorage.setItem(CUSTOMER_KEY, 'zh');
    window.localStorage.setItem(ADMIN_KEY, 'ko');

    renderAt('/administrator');

    expect(language()).toBe('zh');
  });
});
