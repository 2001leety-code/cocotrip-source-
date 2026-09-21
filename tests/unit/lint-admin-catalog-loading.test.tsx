// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminProducts from '@/pages/AdminProducts';
import AdminZoneCourses from '@/pages/AdminZoneCourses';

const state = vi.hoisted(() => ({
  authLoading: false,
  getDocs: vi.fn(),
  fetchZones: vi.fn(),
  importStatic: vi.fn(),
  saveZone: vi.fn(),
  publishZone: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'test-user' }, loading: state.authLoading }) }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('sonner', () => ({ Toaster: () => null, toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(), getDocs: state.getDocs,
}));
vi.mock('@/lib/tours-firestore', () => ({
  resolvePhotoUrl: (url: string) => url,
  importStaticTour: state.importStatic,
}));
vi.mock('@/lib/zone-courses-firestore', () => ({
  fetchZoneCoursesList: state.fetchZones,
  saveDraft: state.saveZone,
  publishDraft: state.publishZone,
}));

function deferred<T>() {
  let finish!: (value: T) => void;
  return { promise: new Promise<T>((resolve) => { finish = resolve; }), finish };
}

function page(Component: React.ComponentType) {
  return <MemoryRouter><Component /></MemoryRouter>;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.authLoading = false;
});
afterEach(cleanup);

describe('admin catalog auth refresh loading', () => {
  it('keeps product refresh visibly loading after auth returns', async () => {
    const first = deferred<{ docs: unknown[] }>();
    const refresh = deferred<{ docs: unknown[] }>();
    state.getDocs.mockReturnValueOnce(first.promise).mockReturnValueOnce(refresh.promise);
    const view = render(page(AdminProducts));
    await act(async () => { first.finish({ docs: [] }); });

    state.authLoading = true;
    view.rerender(page(AdminProducts));
    state.authLoading = false;
    view.rerender(page(AdminProducts));

    expect(screen.getByRole('button', { name: '새로고침' })).toBeDisabled();
    await act(async () => { refresh.finish({ docs: [] }); });
    expect(screen.getByRole('button', { name: '새로고침' })).not.toBeDisabled();
    expect(state.importStatic).not.toHaveBeenCalled();
  });

  it('keeps zone-course refresh visibly loading after auth returns', async () => {
    const first = deferred<unknown[]>();
    const refresh = deferred<unknown[]>();
    state.fetchZones.mockReturnValueOnce(first.promise).mockReturnValueOnce(refresh.promise);
    const view = render(page(AdminZoneCourses));
    await act(async () => { first.finish([]); });

    state.authLoading = true;
    view.rerender(page(AdminZoneCourses));
    state.authLoading = false;
    view.rerender(page(AdminZoneCourses));

    expect(screen.getByRole('button', { name: '새로고침' })).toBeDisabled();
    await act(async () => { refresh.finish([]); });
    expect(screen.getByRole('button', { name: '새로고침' })).not.toBeDisabled();
    expect(state.saveZone).not.toHaveBeenCalled();
    expect(state.publishZone).not.toHaveBeenCalled();
  });
});
