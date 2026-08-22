// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import en from '../../src/i18n/locales/en.json';

const state = vi.hoisted(() => ({
  language: 'en',
  t: {} as Record<string, unknown>,
}));
const usePageMetaMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    language: state.language,
    t: state.t,
    changeLanguage: vi.fn(),
  }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: usePageMetaMock }));
vi.mock('@/sections/Header', () => ({ Header: () => <div data-testid="header" /> }));
vi.mock('@/sections/Footer', () => ({ Footer: () => <div data-testid="footer" /> }));
vi.mock('@/components/region/RegionSeoInfo', () => ({
  RegionSeoInfo: ({ regionId }: { regionId: string }) => <section data-testid="region-seo-info">{regionId}</section>,
}));

const { RegionDetail } = await import('../../src/pages/RegionDetail');

function renderRegion(regionId: string) {
  return render(
    <MemoryRouter initialEntries={[`/region/${regionId}`]}>
      <Routes>
        <Route path="/region/:regionId" element={<RegionDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  state.language = 'en';
  state.t = en;
  usePageMetaMock.mockReset();
});

describe('region editorial shell rendering', () => {
  it.each(['not-a-region', 'notFound', 'constructor', '__proto__', 'toString'])(
    'renders a contained not-found state for invalid id %s',
    (regionId) => {
      renderRegion(regionId);

      expect(screen.getByTestId('region-detail-not-found')).toHaveTextContent('Region not found');
      expect(screen.queryByTestId('region-detail-ready')).not.toBeInTheDocument();
      expect(usePageMetaMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Region not found' }));
    },
  );

  it('keeps the full Seoul photo set and passes an unsuffixed page title', () => {
    const { container } = renderRegion('seoul');

    expect(screen.getByRole('heading', { level: 1, name: 'Seoul' })).toBeInTheDocument();
    // 2026-08-22: 21 → 20장 (해방촌-남산야경.jpg = "AI로 생성한 콘텐츠" 워터마크 이미지 제거).
    expect(container.querySelectorAll('.region-editorial-gallery img')).toHaveLength(19);
    expect(container.querySelector('.region-editorial-facts')).toHaveTextContent('20 photos');
    expect(container.querySelector('.region-editorial-cta a[href="/planner"]')).toBeInTheDocument();
    expect(usePageMetaMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Seoul' }));
    expect(usePageMetaMock).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Seoul | CocoTrip' }));
  });

  it('does not promise planner coverage for an unsupported region', () => {
    const { container } = renderRegion('paju');

    expect(container.querySelector('.region-editorial-cta a[href="/planner"]')).not.toBeInTheDocument();
    expect(container.querySelector('.region-editorial-cta')).toHaveTextContent(
      'browse the tour list or ask CocoTrip about travel options',
    );
    expect(container.querySelector('.region-editorial-cta a[href="/tours"]')).toHaveClass('ec-btn-primary');
    expect(container.querySelectorAll('.region-editorial-gallery img')).toHaveLength(8);
    expect(container.querySelector('.region-editorial-facts')).toHaveTextContent('9 photos');
  });
});
