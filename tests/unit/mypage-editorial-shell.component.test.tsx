// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  loading: false,
  language: 'en',
  wishlistItems: [] as { id: string; productType: string; name: string; priceUSD?: number; thumbnailUrl?: string; href?: string }[],
  authFetch: vi.fn(),
}));

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'editorial-owner', displayName: 'Coco Traveler', email: 'traveler@example.com', photoURL: null } }),
}));

vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => {
    const localizedCopy = testState.language === 'ja'
      ? {
          redeemTripCoins: 'Tripコインを使う',
          couponValid: '1年間有効・決済時にコード入力',
          coinsLabel: 'コイン',
          walletAvailable: '利用可能',
          walletUsed: '使用済み',
          walletExpired: '期限切れ',
        }
      : {
          redeemTripCoins: 'Redeem Trip Coins',
          couponValid: 'Valid for 1 year. Enter code at checkout.',
          coinsLabel: 'coins',
          walletAvailable: 'Available',
          walletUsed: 'Used',
          walletExpired: 'Expired',
        };
    return {
      language: testState.language,
      changeLanguage: vi.fn(),
      t: {
        mypage: {
        tabOverview: 'Overview',
        tabBookings: 'My Bookings',
        tabCoupons: 'Coupons ({n})',
        tabWishlist: 'Wishlist ({n})',
        tabReviews: 'Reviews',
        tabPoints: 'Points',
        wlEmptyTitle: 'No wishlisted items',
        wlEmptySub: 'Tap the heart on any tour to save it here',
        home: 'Home',
        traveler: 'Traveler',
        ...localizedCopy,
        },
        nav: {},
        pageMeta: { myPage: { title: 'My Page', description: 'Manage your account' } },
      },
    };
  },
}));

vi.mock('../../src/hooks/useLoyalty', () => ({
  useLoyalty: () => ({
    loyalty: { tier: 'Bronze', tripCoins: 0, totalSpentUSD: 0, bookingCount: 0, earnRate: 0.01 },
    coupons: [],
    activeCoupons: [],
    pointHistory: [],
    coinsToUSD: (c: number) => (c * 0.01).toFixed(2),
    loading: testState.loading,
  }),
}));

vi.mock('../../src/hooks/useWishlist', () => ({
  useWishlist: () => ({ items: testState.wishlistItems, loading: false, toggle: vi.fn(), isWishlisted: () => false }),
}));

vi.mock('../../src/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('../../src/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../src/sections/Header', () => ({ Header: () => <header data-testid="header" /> }));
vi.mock('../../src/components/MyBookingsTab', () => ({ MyBookingsTab: () => <div data-testid="bookings-boundary" /> }));
vi.mock('../../src/components/MyCoursesTab', () => ({ MyCoursesTab: () => <div data-testid="courses-boundary" /> }));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('../../src/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../src/lib/authFetch', () => ({ authFetch: testState.authFetch }));
vi.mock('../../src/lib/weatherDesc', () => ({
  wttrLangParam: () => '', pickWeatherDesc: () => '', pickWeatherIcon: () => '',
}));
vi.mock('../../src/lib/pointLogText', () => ({ describePointLog: (d: string) => d }));
vi.mock('../../src/lib/aiPlannerPrice', () => ({ fillPrice: (s: string) => s }));
vi.mock('../../src/data/tours', () => ({ slugForTourId: () => null }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ kind: 'collection' })),
  query: vi.fn(() => ({ kind: 'query' })),
  where: vi.fn(() => ({ kind: 'where' })),
  getDocs: vi.fn(() => Promise.resolve({ forEach: () => {} })),
}));
global.fetch = vi.fn(() => Promise.reject(new Error('no network in tests'))) as unknown as typeof fetch;

import MyPage from '../../src/pages/MyPage';

function renderPage(path = '/mypage') {
  return render(<MemoryRouter initialEntries={[path]}><MyPage /></MemoryRouter>);
}

describe('/mypage editorial shell', () => {
  beforeEach(() => {
    testState.loading = false;
    testState.language = 'en';
    testState.wishlistItems = [];
    testState.authFetch.mockReset();
  });

  it('renders the editorial paper shell, not the legacy dark shell', () => {
    const { container } = renderPage();
    expect(container.querySelector('.mypage-editorial')).toBeTruthy();
    expect(container.innerHTML).not.toContain('bg-[#080b14]');
    expect(container.innerHTML).not.toContain('cocotrip-mobile-account');
    expect(container.innerHTML).not.toContain('linear-gradient');
  });

  it('announces the loyalty fetch as a named loading region', () => {
    testState.loading = true;
    renderPage();
    const status = screen.getByTestId('mypage-loading');
    expect(status).toHaveAttribute('aria-busy', 'true');
  });

  it('exposes the tabs as a labelled tablist reachable by keyboard', () => {
    renderPage();
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeTruthy();
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    const wishlistTab = screen.getByRole('tab', { name: 'Wishlist (0)' });
    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'My Bookings' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(wishlistTab);
    expect(wishlistTab).toHaveAttribute('aria-selected', 'true');
  });

  it('gives the empty wishlist an actionable editorial empty state', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Wishlist (0)' }));
    expect(screen.getByText('No wishlisted items')).toBeTruthy();
    expect(screen.getByText('Tap the heart on any tour to save it here')).toBeTruthy();
  });

  it('keeps the development fixture read-only while rendering a review', () => {
    renderPage('/mypage?__fixture=normal&tab=reviews');
    expect(screen.getByText('The route and preparation notes were easy to follow.')).toBeTruthy();
    expect(testState.authFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('does not mount live booking or course data components in the fixture', () => {
    renderPage('/mypage?__fixture=normal');
    fireEvent.click(screen.getByRole('tab', { name: 'My Bookings' }));
    expect(screen.queryByTestId('bookings-boundary')).toBeNull();
    expect(screen.getByText('Read-only preview')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'My Courses' }));
    expect(screen.queryByTestId('courses-boundary')).toBeNull();
    expect(screen.getByText('Live booking and course data is not loaded.')).toBeTruthy();
    expect(testState.authFetch).not.toHaveBeenCalled();
  });

  it('keeps live booking and course tabs on a readable inverse boundary', () => {
    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'My Bookings' }));
    expect(screen.getByTestId('bookings-boundary').closest('.mypage-editorial-legacy-panel')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'My Courses' }));
    expect(screen.getByTestId('courses-boundary').closest('.mypage-editorial-legacy-panel')).toBeTruthy();

    const css = readFileSync(resolve(process.cwd(), 'src/styles/editorial-mypage.css'), 'utf8');
    expect(css).toMatch(/\.mypage-editorial-legacy-panel\s*\{[\s\S]*background:\s*#17161a/);
    expect(css).toMatch(/\.mypage-editorial-legacy-panel\s+:where\(button, a, \[role='button'\]\)\s*\{[\s\S]*min-height:\s*44px/);
    expect(css).toMatch(/\.mypage-editorial-legacy-panel\s+:where\(input, textarea, select\)\s*\{[\s\S]*font-size:\s*16px/);
  });

  it('disables coin redemption in the read-only fixture', () => {
    const { container } = renderPage('/mypage?__fixture=normal&tab=coupons');
    const redeemButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.mypage-editorial-redeem-option'));
    expect(redeemButtons).toHaveLength(3);
    for (const button of redeemButtons) expect(button).toBeDisabled();
  });

  it('uses Japanese coupon display copy without English fallbacks', () => {
    testState.language = 'ja';
    renderPage('/mypage?__fixture=normal&tab=coupons');
    expect(screen.getByText('Tripコインを使う')).toBeTruthy();
    expect(screen.getAllByText('割引クーポン')).toHaveLength(3);
    expect(screen.getByText('ツアー5%割引クーポン')).toBeTruthy();
    expect(screen.getByText(/有効期限:/)).toBeTruthy();
    expect(screen.queryByText('Redeem Trip Coins')).toBeNull();
  });

  it('localizes fixture weather and itinerary copy instead of leaking English city labels', () => {
    testState.language = 'ja';
    renderPage('/mypage?__fixture=normal');
    expect(screen.getByText('韓国')).toBeTruthy();
    expect(screen.getByText('晴れ')).toBeTruthy();
    expect(screen.getByText('路地と宮殿の旅')).toBeTruthy();
    expect(screen.queryByText('Seoul')).toBeNull();
    expect(screen.queryByText('Clear')).toBeNull();
  });

  it('keeps the phone shell compact without touching the desktop rules', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/editorial-mypage.css'), 'utf8');
    const phone = css.slice(css.indexOf('@media (max-width: 767px)'));
    expect(phone).toBeTruthy();

    expect(phone).toMatch(/\.mypage-editorial-back,\s*\n\s*\.mypage-editorial-benefits\s*\{[\s\S]*?display:\s*none/);
    expect(css).not.toContain('@media (max-width: 420px)');
    expect(phone).toMatch(/\.mypage-editorial-profile\s*\{[\s\S]*?grid-template-columns:\s*44px minmax\(0, 1fr\)/);
    expect(phone).toMatch(/\.mypage-editorial-avatar\s*\{[\s\S]*?width:\s*44px;\s*\n\s*height:\s*44px/);
    expect(phone).toMatch(/\.mypage-editorial-name\s*\{[\s\S]*?overflow:\s*hidden[\s\S]*?text-overflow:\s*ellipsis[\s\S]*?white-space:\s*nowrap/);
    expect(phone).toMatch(/\.mypage-editorial-email\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
    expect(phone).toMatch(/\.mypage-editorial-tabs\s*\{[\s\S]*?flex-wrap:\s*nowrap/);
    expect(phone).toMatch(/\.mypage-editorial-tabs\s*\{[\s\S]*?overflow-x:\s*auto/);
    expect(phone).toMatch(/\.mypage-editorial-tabs\s*\{[\s\S]*?scrollbar-width:\s*none/);
    expect(phone).toMatch(/\.mypage-editorial-tabs::-webkit-scrollbar\s*\{\s*\n\s*display:\s*none/);
    expect(phone).toMatch(/\.mypage-editorial-stat-label\s*\{\s*\n\s*font-size:\s*11px/);
    expect(phone).toMatch(/\.mypage-editorial-stat-value\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums/);
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });

  it('keeps the tier benefit block in the document for desktop readers', () => {
    const { container } = renderPage();
    expect(container.querySelector('.mypage-editorial-benefits')).toBeTruthy();
    expect(container.querySelector('.mypage-editorial-back')).toBeTruthy();
  });

  // 실제 정렬 픽셀은 e2e(`360px deep-linked tab stays horizontally in view`)가 잰다.
  // 여기서는 "줄만 움직이고 문서·애니메이션은 건드리지 않는다"는 수단만 잠근다.
  it('aligns a deep-linked tab by moving only the rail, without animating', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/MyPage.tsx'), 'utf8');
    expect(source).toContain('tablistRef');
    expect(source).toMatch(/list\.scrollLeft/);
    expect(source).not.toContain('scrollIntoView');
    expect(source).not.toContain("behavior: 'smooth'");
  });

  it('re-aligns the tab rail when the language changes', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/MyPage.tsx'), 'utf8');
    const effectDeps = source.match(
      /document\.fonts\?\.ready\.then\(align\)\.catch\(\(\) => \{\}\);\s*\n\s*\}, \[([^\]]*)\]\);/,
    );
    expect(effectDeps).not.toBeNull();
    const deps = effectDeps![1].split(',').map((dep) => dep.trim());
    expect(deps).toContain('language');
  });

  it('keeps the real route authenticated and the fixture route development-only', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const myPageRoute = app.slice(app.indexOf('path="/mypage"'), app.indexOf('path="/dev/mypage-editorial"'));
    expect(myPageRoute).toContain('<AuthRequired>');
    expect(app).toMatch(/\{import\.meta\.env\.DEV && \(\s*<Route\s+path="\/dev\/mypage-editorial"/);
  });
});
