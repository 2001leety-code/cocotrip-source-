// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromoBanner } from '../../src/components/PromoBanner';
import { PromoPopup } from '../../src/components/PromoPopup';

function promoResponse(): Response {
  return {
    json: async () => ({
      ok: true,
      banner: {
        enabled: true,
        copy: { en: 'Shared promo' },
        ctaText: { en: 'Start' },
        ctaHref: '/planner',
        endDate: '',
      },
      popup: {
        enabled: true,
        title: { en: 'Shared popup' },
        body: { en: 'Popup body' },
        imageUrl: '',
        ctaText: { en: 'Start' },
        ctaHref: '/planner',
        frequency: 'every_visit',
      },
    }),
  } as Response;
}

function renderPromos() {
  return render(
    <MemoryRouter>
      <PromoBanner />
      <PromoPopup />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('promo config request sharing', () => {
  it('shares one pending request between the mounted banner and popup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(promoResponse());
    vi.stubGlobal('fetch', fetchMock);

    const firstView = renderPromos();

    await screen.findByRole('dialog', { name: 'Shared popup' });
    expect(screen.getByRole('region', { name: 'Promotion' })).toHaveTextContent('Shared promo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/promo-config');

    firstView.unmount();
    renderPromos();

    await screen.findByRole('dialog', { name: 'Shared popup' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('clears a rejected request so a later mount can retry', async () => {
    let rejectFirst!: (reason: Error) => void;
    const firstRequest = new Promise<Response>((_resolve, reject) => { rejectFirst = reject; });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce(promoResponse());
    vi.stubGlobal('fetch', fetchMock);

    const firstView = renderPromos();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      rejectFirst(new Error('temporary network error'));
      await firstRequest.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    firstView.unmount();

    renderPromos();

    await screen.findByRole('dialog', { name: 'Shared popup' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
