import { describe, expect, it } from 'vitest';
import { TOURS, getTourPriceKRW, getTourProductType } from '../../src/data/tours';
import { charterUsdFromKrw, fixedUsdAmountForProduct } from '../../src/lib/charterUsd';

describe('tour checkout price contract', () => {
  it('maps the join-in night tour to its $49-per-person SKU and keeps displayed totals aligned', () => {
    const night = TOURS.find((tour) => tour.id === 'tour-seoul-night');
    expect(night).toBeTruthy();
    expect(getTourProductType('tour-seoul-night')).toBe('tour_seoul_night');
    expect(getTourPriceKRW('tour-seoul-night', night!.priceFrom, night!.priceUnit)).toBe(66_150);
    for (const passengers of [1, 2, 4]) {
      const totalKRW = getTourPriceKRW('tour-seoul-night', night!.priceFrom, night!.priceUnit) * passengers;
      const fixedUsd = fixedUsdAmountForProduct('tour_seoul_night', passengers);
      expect(fixedUsd).toBe(49 * passengers);
      expect(charterUsdFromKrw(totalKRW)).toBe(fixedUsd);
    }
  });

  it('keeps the Seoul private group at ₩337,500 / $250 regardless of passenger count', () => {
    const city = TOURS.find((tour) => tour.id === 'tour-seoul-city');
    expect(city).toBeTruthy();
    const totalKRW = getTourPriceKRW('tour-seoul-city', city!.priceFrom, city!.priceUnit);
    expect(getTourProductType('tour-seoul-city')).toBe('charter_seoul_city');
    expect(totalKRW).toBe(337_500);
    for (const passengers of [1, 2, 4]) {
      const bookingKRW = city!.priceUnit === 'per_person' ? totalKRW * passengers : totalKRW;
      expect(charterUsdFromKrw(bookingKRW)).toBe(250);
    }
  });

  it('maps Gyeongju and Busan to server-supported tour SKUs without changing their price-spec keys', () => {
    expect(getTourProductType('tour-gyeongju')).toBe('charter_gyeongju');
    expect(getTourProductType('tour-busan-day')).toBe('charter_busan');
    expect(getTourPriceKRW('tour-gyeongju', 444)).toBe(600_000);
    expect(getTourPriceKRW('tour-busan-day', 333)).toBe(450_000);
  });
});
