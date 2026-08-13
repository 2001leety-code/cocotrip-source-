// @vitest-environment jsdom
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const languageState = vi.hoisted(() => ({
  language: 'en' as 'ko' | 'en' | 'ja' | 'zh',
  changeLanguage: vi.fn(),
}));
const authState = vi.hoisted(() => ({ user: null as { uid: string } | null }));
const firestoreMocks = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('../../src/hooks/useLanguage', () => ({
  useLanguage: () => ({
    language: languageState.language,
    t: {},
    changeLanguage: languageState.changeLanguage,
  }),
}));
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: authState.user }) }));
vi.mock('../../src/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ db: {} }));
vi.mock('../../src/sections/Header', () => ({ Header: () => <div data-testid="map-header" /> }));
vi.mock('../../src/sections/Footer', () => ({ Footer: () => <div data-testid="map-footer" /> }));
vi.mock('../../src/pages/PlanDetailPage/components/DayRouteMap', () => ({
  DayRouteMap: ({ stops }: { stops: unknown[] }) => (
    <div data-testid="day-route-map">{stops.length} stops</div>
  ),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  getDoc: firestoreMocks.getDoc,
  getDocs: firestoreMocks.getDocs,
  limit: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
}));

const { default: MapPage } = await import('../../src/pages/MapPage');

void React;

function renderMap(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <MapPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  languageState.language = 'en';
  languageState.changeLanguage.mockReset();
  authState.user = null;
  firestoreMocks.getDocs.mockReset();
  firestoreMocks.getDoc.mockReset();
});

describe('map editorial shell', () => {
  it('keeps signed-out access read-only and does not touch Firestore in a fixture', () => {
    renderMap('/map?__fixture=signed-out');

    expect(screen.getByTestId('map-editorial-shell')).toHaveAttribute('data-state', 'signed-out');
    expect(screen.getByRole('heading', { level: 1, name: 'Route Map' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sign in to see your routes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/mypage');
    expect(screen.getByRole('link', { name: 'Start Trip Planner' })).toHaveAttribute('href', '/planner');
    expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
    expect(firestoreMocks.getDoc).not.toHaveBeenCalled();
  });

  it('separates loading, empty, error, permission, not-found and partial states', () => {
    const cases = [
      ['loading', 'Loading your routes'],
      ['empty', 'No routes to show yet'],
      ['error', 'Could not load your routes'],
      ['permission', 'This route map is unavailable'],
      ['not-found', 'This itinerary was not found'],
      ['partial', 'Some route details are missing'],
    ] as const;

    for (const [state, text] of cases) {
      const { unmount } = renderMap(`/map?__fixture=${state}`);
      expect(screen.getByTestId('map-editorial-shell')).toHaveAttribute('data-state', state);
      expect(screen.getByText(text)).toBeInTheDocument();
      if (state === 'loading') expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
      if (state === 'error') expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      if (state === 'partial') expect(screen.getByRole('link', { name: 'Open full itinerary' })).toBeInTheDocument();
      unmount();
    }
  });

  it('renders the deterministic route document with semantic plan and day controls', () => {
    renderMap('/map?__fixture=normal');

    expect(screen.getByTestId('map-editorial-shell')).toHaveAttribute('data-state', 'normal');
    expect(screen.getByTestId('day-route-map')).toHaveTextContent('3 stops');
    expect(screen.getByRole('group', { name: 'Choose itinerary' })).toBeInTheDocument();
    const dayTabs = within(screen.getByRole('tablist', { name: 'Choose day' })).getAllByRole('tab');
    expect(dayTabs).toHaveLength(2);
    expect(dayTabs[0]).toHaveAttribute('aria-selected', 'true');
    const shell = screen.getByTestId('map-editorial-shell');
    const planButtons = within(screen.getByRole('group', { name: 'Choose itinerary' })).getAllByRole('button');
    fireEvent.click(planButtons[0]);
    expect(shell).toHaveAttribute('data-state', 'normal');
    expect(screen.getByTestId('day-route-map')).toHaveTextContent('3 stops');
    fireEvent.keyDown(dayTabs[0], { key: 'ArrowRight' });
    expect(dayTabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(dayTabs[1]).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Open full itinerary' })).toHaveAttribute('href', '/my-plans/map-fixture-plan');
    expect(firestoreMocks.getDocs).not.toHaveBeenCalled();
    expect(firestoreMocks.getDoc).not.toHaveBeenCalled();
  });

  it('uses each language’s own heading and day order', () => {
    const labels = {
      en: ['Route Map', 'Day 1'],
      ko: ['경로 지도', '1일차'],
      ja: ['ルートマップ', '1日目'],
      zh: ['路线地图', '第1天'],
    } as const;

    for (const language of Object.keys(labels) as (keyof typeof labels)[]) {
      languageState.language = language;
      const { unmount } = renderMap('/map?__fixture=normal');
      expect(screen.getByRole('heading', { level: 1, name: labels[language][0] })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: labels[language][1] })).toBeInTheDocument();
      unmount();
    }
  });

  it('locks the flat shared-state shell while preserving the existing read paths', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/MapPage.tsx'), 'utf8');
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/styles/editorial-map.css'), 'utf8');

    expect(source).toMatch(/import \{[^}]*EcLoading[^}]*EcEmpty[^}]*EcError[^}]*\} from '@\/components\/ui\/states'/s);
    expect(source).toContain("import '@/styles/editorial-map.css'");
    expect(source).toContain("import.meta.env.DEV ? getMapFixture(searchParams.get('__fixture')) : null");
    expect(source).toContain("collection(db, 'users', user.uid, 'plans')");
    expect(source).toContain("doc(db, 'plans', selectedPlanId)");
    expect(source).toContain("orderBy('createdAt', 'desc')");
    expect(source).toContain('limit(10)');
    expect(source).not.toMatch(/addDoc|setDoc|updateDoc|deleteDoc|writeBatch/);
    expect(source).not.toMatch(/GradientCTA|CocoCard|useIsMobile|coco-cta-gradient/);
    expect(source).not.toContain('??');
    expect(source).toContain('if (planId === visiblePlanId) return;');
    expect(source).toContain('onRetry={visibleRefsError ? retryRefs : retryPlan}');
    expect(app).toMatch(/path="\/map"[\s\S]*fallback=\{ROUTE_FALLBACK\}/);
    expect(css).toContain('.map-editorial-page');
    expect(css).toContain('min-height: 44px');
    expect(css).not.toContain('font: inherit');
    expect(css).not.toMatch(/gradient/i);
    expect(css).toMatch(/backdrop-filter:\s*none/i);
    expect(css).not.toMatch(/backdrop-filter:\s*blur/i);
  });

  it('keeps the static partial tabpanel in the keyboard order', () => {
    renderMap('/map?__fixture=partial');

    expect(screen.getByRole('tabpanel')).toHaveAttribute('tabindex', '0');
  });
});
