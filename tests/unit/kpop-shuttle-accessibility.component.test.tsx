// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadLocale, type Language } from '../../src/i18n';

void React;
const fake = vi.hoisted(() => ({ language: 'en', t: {}, paymentProps: vi.fn() }));
// Fictional fixtures only. No concert feed, auth, payment SDK or external link is opened.
const concerts = vi.hoisted(() => ['Alpha', 'Beta'].map((artist, index) => ({
  id: `fixture-${index}`, artist, tourName: `${artist} fixture tour`,
  venue: `${artist} fixture venue`, venueKo: `${artist} 가상 공연장`,
  location: 'Fixture', locationKo: '가상 장소', dates: ['2099-09-01'],
  dateDisplay: 'Sep 1', dateDisplayKo: '9월 1일',
  shuttleAvailable: true, pickupPoints: [`${artist} pickup`], pickupPointsKo: [`${artist} 승차장`],
  oneWayPrice: 100, roundTripPrice: 180, note: '', noteKo: '',
  naverMapUrl: `https://map.naver.com/p/fixture-${index}`, highlight: false, soldOut: false,
})));
vi.mock('../../src/data/kpopConcerts', () => ({ getUpcomingConcerts: () => concerts }));
vi.mock('../../src/hooks/useLanguage', () => ({ useLanguage: () => ({ language: fake.language, t: fake.t }) }));
vi.mock('../../src/components/PayPalBookingButton', () => ({
  PayPalBookingButton: (props: Record<string, unknown>) => {
    fake.paymentProps(props);
    return <div data-testid="fake-payment-boundary" />;
  },
}));
import { KpopShuttleBanner } from '../../src/components/KpopShuttleBanner';

afterEach(cleanup);
beforeEach(() => fake.paymentProps.mockClear());
const LANGS: Language[] = ['ko', 'en', 'ja', 'zh'];

describe('K-pop selection and map are separate accessible controls', () => {
  it.each(LANGS)('%s: map keeps its destination and visible name, without any interactive nesting', async (language) => {
    const t = await loadLocale(language);
    fake.language = language;
    fake.t = t;
    const { container } = render(<KpopShuttleBanner p={{}} />);
    expect(container.querySelector('button a, a button, button button')).toBeNull();
    for (const concert of concerts) {
      const link = screen.getByRole('link', { name: `${t.ads.kpopShuttle.naverMap} — ${concert.artist} · ${concert.tourName}` });
      expect(link.textContent).toContain(t.ads.kpopShuttle.naverMap);
      expect(link.getAttribute('href')).toBe(concert.naverMapUrl);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.className).toContain('min-h-[44px]');
      expect(link.className).toContain('min-w-[44px]');
      expect(link.className).toContain('focus-visible:ring-2');
      expect(link.closest('button')).toBeNull();
    }
    expect(fake.paymentProps).not.toHaveBeenCalled();
  });

  it.each(LANGS)('%s: keyboard selection, pickup gate and map clicks retain the booking inputs', async (language) => {
    fake.language = language;
    fake.t = await loadLocale(language);
    const user = userEvent.setup();
    render(<KpopShuttleBanner p={{}} />);
    const alpha = screen.getByRole('button', { name: /Alpha fixture tour/ });
    const beta = screen.getByRole('button', { name: /Beta fixture tour/ });
    alpha.focus();
    await user.keyboard('{Enter}');
    expect(alpha.getAttribute('aria-pressed')).toBe('true');
    expect(fake.paymentProps).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: language === 'ko' ? 'Alpha 승차장' : 'Alpha pickup' }));
    expect(fake.paymentProps).toHaveBeenLastCalledWith(expect.objectContaining({
      productType: 'kpop_shuttle_oneway', passengers: 2, dateStart: '2099-09-01', dateEnd: '2099-09-01',
      priceKRW: 200, lang: language, pickupLocation: 'Alpha pickup', dropoffLocation: 'Alpha fixture venue',
      vehicleType: 'staria', memo: 'Alpha - Alpha fixture tour',
    }));
    const betaMap = screen.getByRole('link', { name: /— Beta · Beta fixture tour$/ });
    // Cancel native navigation in the test, not in the product. The React handler still runs.
    betaMap.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(betaMap);
    expect(alpha.getAttribute('aria-pressed')).toBe('true');
    expect(beta.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('fake-payment-boundary')).toBeTruthy();
    beta.focus();
    await user.keyboard(' ');
    expect(beta.getAttribute('aria-pressed')).toBe('true');
    expect(alpha.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('fake-payment-boundary')).toBeNull();
  });

  it.each(LANGS)('%s: opened passenger controls are named, 44px and keep the original 1–8 limits', async (language) => {
    const t = await loadLocale(language);
    fake.language = language;
    fake.t = t;
    render(<KpopShuttleBanner p={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Alpha fixture tour/ }));
    const pickup = screen.getByRole('button', { name: language === 'ko' ? 'Alpha 승차장' : 'Alpha pickup' });
    expect(pickup.className).toContain('min-h-[44px]');
    expect(pickup.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pickup);
    expect(pickup.getAttribute('aria-pressed')).toBe('true');
    const less = screen.getByRole('button', { name: t.a11y.decreasePax });
    const more = screen.getByRole('button', { name: t.a11y.increasePax });
    for (const button of [less, more]) {
      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('min-w-[44px]');
      expect(button.className).toContain('focus-visible:ring-2');
    }
    for (let i = 0; i < 10; i++) fireEvent.click(less);
    expect(fake.paymentProps).toHaveBeenLastCalledWith(expect.objectContaining({ passengers: 1, priceKRW: 100 }));
    for (let i = 0; i < 10; i++) fireEvent.click(more);
    expect(fake.paymentProps).toHaveBeenLastCalledWith(expect.objectContaining({ passengers: 8, priceKRW: 800 }));
    const roundTrip = screen.getByRole('button', { name: new RegExp(`^${t.ads.kpopShuttle.roundTrip}`) });
    expect(roundTrip.className).toContain('min-h-[44px]');
    fireEvent.click(roundTrip);
    expect(roundTrip.getAttribute('aria-pressed')).toBe('true');
    expect(fake.paymentProps).toHaveBeenLastCalledWith(expect.objectContaining({ passengers: 8, priceKRW: 1440, productType: 'kpop_shuttle_roundtrip' }));
  });
});
