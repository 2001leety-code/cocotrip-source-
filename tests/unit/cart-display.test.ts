import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cartDisplayUsd, cartDisplayTotalUsd } from '@/lib/cart-display';
import { buildCharterCartItem } from '@/components/charter/charterCartItem';
import type { CartItem } from '@/lib/cart-types';
import type { WizardState } from '@/components/charter/types';
// @ts-expect-error backend pure price resolver
import { computeCartTotalKrw } from '../../api/_shared/resolve-line-item.js';
const spec = JSON.parse(readFileSync('api/_pricing_spec.json', 'utf8'));
const item = (priceUSD?: number, priceKRW?: number): CartItem => ({ id: 'test', displayName: 'test', booking: { productType: 'airport_seoul_central' }, addedAt: 1, priceUSD, priceKRW });

describe('cart USD display uses complete per-line amounts', () => {
  it('fills a new charter with the single-checkout USD price and wires it to the add button', () => {
    const charter = buildCharterCartItem({ service: 'airport_transfer', origin: 'ICN', destinationKey: 'seoul-central', vehicle: 'staria_9', paxCount: 2, startDate: '2026-11-15' } as WizardState,
      { productType: 'airport_seoul_central', priceKRW: 124800, payable: true, passengers: 2 });
    expect(charter?.priceUSD).toBe(92);
    expect(readFileSync('src/pages/CharterNewPage.tsx', 'utf8')).toContain('priceUSD={cartItem.priceUSD}');
  });
  it('uses the existing cart server per-line rounding, not a rounded combined KRW sum', () => {
    const tour = { ...item(250,337500), booking: { productType: 'charter_seoul_city', passengers: 2, durationDays: 1 } };
    const charter = item(undefined,124800);
    const server = computeCartTotalKrw(spec,[tour,charter],{});
    expect(server.ok).toBe(true);
    const serverTotalCents = server.lines.reduce((sum: number, line: { amountKRW: number }) => sum + Math.round(line.amountKRW / spec.charter_usd_fix_rate) * 100, 0);
    expect(cartDisplayTotalUsd([tour,charter])).toBe(serverTotalCents / 100);
    expect(cartDisplayTotalUsd([tour,charter])).toBe(342);
  });
  it('rounds each legacy line before summing, matching cart checkout policy', () => {
    expect(cartDisplayTotalUsd([item(undefined,2025),item(undefined,2025)])).toBe(4);
  });
  it('adds integer cents without floating-point accumulation', () => {
    expect(cartDisplayTotalUsd([item(0.1),item(0.2)])).toBe(0.3);
  });
  it.each([NaN, Infinity, -1, 0])('does not present invalid explicit USD %s as a complete total', (value) => {
    expect(cartDisplayUsd(item(value,124800))).toBeNull();
    expect(cartDisplayTotalUsd([item(250),item(value,124800)])).toBeNull();
  });
  it('does not sum an empty cart or unknown prices', () => {
    expect(cartDisplayTotalUsd([])).toBeNull();
    expect(cartDisplayTotalUsd([item(250),item()])).toBeNull();
  });
});