// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: null as { email: string; getIdToken: () => Promise<string> } | null,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'ko', t: {}, changeLanguage: vi.fn() }) }));
vi.mock('@/sections/Header', () => ({ Header: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import AdminBriefing from '../../src/pages/AdminBriefing';
import AdminPromoStats from '../../src/pages/AdminPromoStats';
import { PromoBannerPanel } from '../../src/components/admin/PromoBannerPanel';

const admin = (token: string) => ({ email: '2001leety@gmail.com', getIdToken: async () => token });
const briefing = (usd: number) => ({
  revenue: { usd, count: 1 }, trends: { week: { usd, count: 1 }, month: { usd, count: 1 } }, byProduct: {},
  aiPlanner: { paidCount: 0, feeUsd: 0 }, newUsers: 0,
  errors: { total: 0, bySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, top: [] },
  customer: { newTickets: 0, reviewsSent: 0 }, meta: { excludedBypass: 0, excludedCanceled: 0 },
  marketing: { skipped: true }, exchangeRate: 1450, generatedAt: '2030-01-01T00:00:00.000Z',
});
const promo = (email: string) => ({
  coupons: {
    aiPlan: { issued: 1, used: 0, rate: 0 }, charter: { issued: 0, used: 0, rate: 0 }, tourPackage: { issued: 0, used: 0, rate: 0 }, total: { issued: 1, used: 0 },
  },
  kpi: { promoSignups: 1, aiCouponUsed: 0, freePlanCount: 1, freePlanUsageRate: 0 },
  recentFreePlans: [{ planId: 'new-plan', userEmail: email, createdAt: 0, region: null, days: null }], generatedAt: 0,
});
const config = (copy: string) => ({
  ok: true,
  banner: { enabled: true, copy: { ko: copy }, ctaText: { ko: 'go' }, ctaHref: '/tours', endDate: '' },
  popup: { enabled: false, title: { ko: 'title' }, body: { ko: 'body' }, imageUrl: '', ctaText: { ko: 'go' }, ctaHref: '/tours', frequency: 'once' },
});

beforeEach(() => { state.user = null; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('admin user refresh lifecycle', () => {
  it('clears a briefing error and shows loading while a replacement user request is pending', async () => {
    state.user = admin('a');
    let resolveNext!: (value: { ok: boolean; json: () => Promise<ReturnType<typeof briefing>> }) => void;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'old request failed' }) })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; })));
    const view = render(<MemoryRouter><AdminBriefing /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('old request failed')).toBeTruthy());

    state.user = admin('b');
    view.rerender(<MemoryRouter><AdminBriefing /></MemoryRouter>);
    expect(screen.queryByText('old request failed')).toBeNull();
    expect(screen.getByText('갱신 중...')).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    resolveNext({ ok: true, json: async () => briefing(9) });
    await waitFor(() => expect(screen.getAllByText('$9.00').length).toBeGreaterThan(0));
  });

  it('clears a promo stats error before a replacement admin response and then renders the new data', async () => {
    state.user = admin('a');
    let resolveNext!: (value: { json: () => Promise<{ ok: boolean; data: ReturnType<typeof promo> }> }) => void;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ ok: false, error: 'old stats failed' }) })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; })));
    const view = render(<MemoryRouter><AdminPromoStats /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('오류: old stats failed')).toBeTruthy());

    state.user = admin('b');
    view.rerender(<MemoryRouter><AdminPromoStats /></MemoryRouter>);
    expect(screen.queryByText('오류: old stats failed')).toBeNull();
    expect(view.container.querySelector('.animate-spin')).not.toBeNull();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    resolveNext({ json: async () => ({ ok: true, data: promo('new@example.com') }) });
    await waitFor(() => expect(screen.getByText('new@example.com')).toBeTruthy());
  });

  it('hides prior promo drafts while a replacement user config request is pending', async () => {
    state.user = admin('a');
    let resolveNext!: (value: { json: () => Promise<ReturnType<typeof config>> }) => void;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ json: async () => config('old banner') })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve; })));
    const view = render(<PromoBannerPanel />);
    await waitFor(() => expect(screen.getByDisplayValue('old banner')).toBeTruthy());

    state.user = admin('b');
    view.rerender(<PromoBannerPanel />);
    expect(view.container).toBeEmptyDOMElement();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    resolveNext({ json: async () => config('new banner') });
    await waitFor(() => expect(screen.getByDisplayValue('new banner')).toBeTruthy());
  });
});
