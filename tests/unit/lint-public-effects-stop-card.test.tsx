// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: 'en', t: { planDetail: { ui: { favoriteAdd: 'Add to favorites', favoriteRemove: 'Remove from favorites' } } } }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

import { StopCard } from '../../src/pages/PlanDetailPage/components/StopCard';

function renderStop(stop: { order: number; name: string }) {
  return render(
    <MemoryRouter initialEntries={['/my-plans/plan-a']}>
      <Routes>
        <Route path="/my-plans/:planId" element={<StopCard stop={{ ...stop, start_time: '10:00', category: 'landmark' }} isOwner />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StopCard favorite state', () => {
  it('refreshes only the favorite state when the same mounted card receives another stop', () => {
    localStorage.setItem('cocotrip:fav:plan-a', JSON.stringify({ 2: true }));
    const view = renderStop({ order: 1, name: 'First stop' });

    view.rerender(
      <MemoryRouter initialEntries={['/my-plans/plan-a']}>
        <Routes>
          <Route path="/my-plans/:planId" element={<StopCard stop={{ order: 2, name: 'Second stop', start_time: '10:00', category: 'landmark' }} isOwner />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Second stop/ }));
    expect(screen.getByRole('button', { name: 'Remove from favorites' })).toHaveAttribute('aria-pressed', 'true');
  });
});
