// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '../../src/i18n/locales/en.json';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: 'en', t: en }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,test') } }));
import { PayPalQrPanel } from '../../src/components/PayPalQrPanel';

const fetchMock = vi.fn();
const props = { productType: 'ai-planner-full', passengers: 1, priceKRW: 13000 };
const ok = { ok: true, json: async () => ({ ok: true }) };
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_PAYPAL_ME_USERNAME', 'offline-test');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('blocks missing planner input with a refresh hint before exposing any payment link', () => {
  render(<PayPalQrPanel {...props} />);
  expect(screen.getByText(en.planner.prepayErrors.PREPAY_INPUT_MISSING)).toBeVisible();
  expect(screen.queryByRole('link')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('ignores an old successful check after input changes and shows the latest refusal', async () => {
  const replies: Array<(value: typeof ok) => void> = [];
  fetchMock.mockImplementation(() => new Promise(resolve => replies.push(resolve)));
  const view = render(<PayPalQrPanel {...props} plannerInput={{ city: 'seoul' }} />);
  view.rerender(<PayPalQrPanel {...props} plannerInput={{ city: 'busan' }} />);
  expect(replies).toHaveLength(2);
  await act(async () => { replies[0](ok); });
  expect(screen.queryByRole('link')).toBeNull();
  await act(async () => { replies[1]({ ok: false, json: async () => ({ ok: false, code: 'DIETARY_COVERAGE_UNAVAILABLE' }) } as typeof ok); });
  expect(screen.getByText(en.planner.prepayErrors.DIETARY_COVERAGE_UNAVAILABLE)).toBeVisible();
  expect(screen.queryByRole('link')).toBeNull();
});

it('retains the report path after QR exposure and accepts the same reference on remount', async () => {
  fetchMock.mockResolvedValue(ok);
  const shown = vi.fn();
  const view = render(<PayPalQrPanel {...props} plannerInput={{ city: 'seoul' }} onQrShown={shown} />);
  await screen.findByRole('link');
  await waitFor(() => expect(shown).toHaveBeenCalled());
  const bookingRef = shown.mock.calls[0][0];
  view.rerender(<PayPalQrPanel {...props} plannerInput={undefined} />);
  expect(screen.getByRole('link')).toBeVisible();
  expect(screen.getByText('Report payment complete')).toBeVisible();
  view.unmount();
  render(<PayPalQrPanel {...props} bookingRef={bookingRef} qrShown />);
  expect(screen.getByText(bookingRef)).toBeVisible();
  expect(screen.getByRole('link')).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('leaves charter QR available without a planner preflight', async () => {
  render(<PayPalQrPanel {...props} productType="charter_dmz" />);
  expect(screen.getByRole('link')).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not reuse a charter render as AI preflight approval when the product changes', async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ ok: false, code: 'DIETARY_COVERAGE_UNAVAILABLE' }) });
  const shown = vi.fn();
  const view = render(<PayPalQrPanel {...props} productType="charter_dmz" onQrShown={shown} />);
  view.rerender(<PayPalQrPanel {...props} plannerInput={{ city: 'seoul' }} onQrShown={shown} />);
  expect(screen.queryByRole('link')).toBeNull();
  await screen.findByText(en.planner.prepayErrors.DIETARY_COVERAGE_UNAVAILABLE);
  expect(shown).not.toHaveBeenCalled();
});
