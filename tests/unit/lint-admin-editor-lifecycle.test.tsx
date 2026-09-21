// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  productDraft: vi.fn(), productPublished: vi.fn(), productSave: vi.fn(),
  zoneDraft: vi.fn(), zonePublished: vi.fn(), zoneSave: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'editor-user' }, loading: false }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() }, Toaster: () => null }));
vi.mock('@/lib/tours-firestore', () => ({
  fetchDraft: state.productDraft, fetchTourById: state.productPublished,
  saveDraft: state.productSave, publishDraft: vi.fn(),
}));
vi.mock('@/lib/zone-courses-firestore', () => ({
  fetchDraft: state.zoneDraft, fetchZoneCourseById: state.zonePublished,
  saveDraft: state.zoneSave, publishDraft: vi.fn(),
}));

import AdminProductEditor from '../../src/pages/AdminProductEditor';
import AdminZoneCourseEditor from '../../src/pages/AdminZoneCourseEditor';

function RouteButton({ to, children }: { to: string; children: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>{children}</button>;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.productPublished.mockResolvedValue(null);
  state.zonePublished.mockResolvedValue(null);
  state.productSave.mockResolvedValue(undefined);
  state.zoneSave.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('admin editor lifecycle', () => {
  it('cancels an old product route load, lets a new draft establish its slug, and autosaves once with that slug', async () => {
    let resolveOld!: (value: { slug: string; title: { ko: string } }) => void;
    state.productDraft.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const view = render(
      <MemoryRouter initialEntries={['/admin/products/edit/old-tour']}>
        <RouteButton to="/admin/products/new">new product</RouteButton>
        <Routes>
          <Route path="/admin/products/edit/:tourId" element={<AdminProductEditor />} />
          <Route path="/admin/products/new" element={<AdminProductEditor />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('불러오는 중...')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'new product' }));
    await waitFor(() => expect(screen.getByPlaceholderText('seoul-city-full-day')).toBeTruthy());
    resolveOld({ slug: 'old-tour', title: { ko: 'Old product' } });
    await act(async () => {});
    expect(screen.queryByText('Old product')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('seoul-city-full-day'), { target: { value: 'new-tour' } });
    await waitFor(() => expect(view.container).toHaveTextContent('draft · new-tour'));
    fireEvent.change(view.container.querySelector('select')!, { target: { value: 'Seoul' } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(state.productSave).toHaveBeenCalledTimes(1);
    expect(state.productSave).toHaveBeenCalledWith('new-tour', expect.objectContaining({ slug: 'new-tour', region: 'Seoul' }), 'editor-user');
  });

  it('updates the product saved-age label after six seconds without changing the autosave payload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    state.productDraft.mockResolvedValue({ slug: 'clock-tour' });
    const view = render(
      <MemoryRouter initialEntries={['/admin/products/edit/clock-tour']}>
        <Routes><Route path="/admin/products/edit/:tourId" element={<AdminProductEditor />} /></Routes>
      </MemoryRouter>,
    );
    await act(async () => {});
    fireEvent.change(view.container.querySelector('select')!, { target: { value: 'Seoul' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(view.container).toHaveTextContent('자동저장: 방금');
    expect(state.productSave).toHaveBeenCalledWith('clock-tour', expect.objectContaining({ region: 'Seoul' }), 'editor-user');
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(view.container).toHaveTextContent('자동저장: 6초 전');
  });

  it('uses the actual zone basic tab to establish a new id, autosave once, and return from a removed dynamic tab', async () => {
    state.zoneDraft.mockImplementation(async (id: string) => id === 'city-course'
      ? { id: 'CITY_COURSE', block_type: 'city_day', theme: 'City' }
      : null);
    const view = render(
      <MemoryRouter initialEntries={['/admin/zone-courses/new']}>
        <RouteButton to="/admin/zone-courses/edit/city-course">city course</RouteButton>
        <Routes>
          <Route path="/admin/zone-courses/new" element={<AdminZoneCourseEditor />} />
          <Route path="/admin/zone-courses/edit/:blockId" element={<AdminZoneCourseEditor />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByPlaceholderText('SEOUL_DAY_JONGNO_STANDARD'), { target: { value: 'seoUl day test' } });
    await waitFor(() => expect(view.container).toHaveTextContent('draft · SEOUL_DAY_TEST'));
    fireEvent.change(screen.getByPlaceholderText('전통 + 시장 + 카페'), { target: { value: '새 테마' } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(state.zoneSave).toHaveBeenCalledTimes(1);
    expect(state.zoneSave).toHaveBeenCalledWith('SEOUL_DAY_TEST', expect.objectContaining({ id: 'SEOUL_DAY_TEST', theme: '새 테마' }), 'editor-user');

    fireEvent.click(view.container.querySelectorAll('input[name="block-type"]')[1]);
    await waitFor(() => expect(screen.getByRole('button', { name: '⑩ Trekking Meta' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '⑩ Trekking Meta' }));
    fireEvent.click(screen.getByRole('button', { name: 'city course' }));
    await waitFor(() => expect(screen.getByText('블록 ID', { exact: false })).toBeTruthy());
  });
});
