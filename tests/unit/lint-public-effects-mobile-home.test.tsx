// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ user: null as { uid: string; getIdToken: () => Promise<string> } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ language: 'en', changeLanguage: vi.fn(), t: { mobileHomeV2: {}, regions: {}, footer: {} } }),
}));
vi.mock('@/hooks/usePageMeta', () => ({ usePageMeta: vi.fn() }));
vi.mock('@/components/home/TripEssentialsCards', () => ({ TripEssentialsCards: () => null }));
vi.mock('@/lib/appReady', () => ({ signalAppReady: vi.fn() }));

import MobileHomeV2 from '../../src/pages/MobileHomeV2';

afterEach(() => { authState.user = null; vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('MobileHomeV2 notification badge', () => {
  it('clears a prior badge before the same uid logs in again and its refresh finishes', async () => {
    authState.user = { uid: 'same-user', getIdToken: async () => 'token' };
    const notificationResponses = [4, new Promise<number>(() => {})];
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/community-notifications') {
        const unread = notificationResponses.shift();
        return unread instanceof Promise
          ? unread.then((count) => ({ json: async () => ({ ok: true, data: { unread: count } }) }))
          : Promise.resolve({ json: async () => ({ ok: true, data: { unread } }) });
      }
      return Promise.resolve({ json: async () => ({}) });
    }));

    const view = render(<MemoryRouter><MobileHomeV2 /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('4')).toBeTruthy());

    authState.user = null;
    view.rerender(<MemoryRouter><MobileHomeV2 /></MemoryRouter>);
    expect(screen.queryByText('4')).toBeNull();

    authState.user = { uid: 'same-user', getIdToken: async () => 'token' };
    view.rerender(<MemoryRouter><MobileHomeV2 /></MemoryRouter>);
    expect(screen.queryByText('4')).toBeNull();
  });
});
