import type { CartItem } from './cart-types';
import { charterUsdFromKrw } from './charterUsd';

/** Display only. Existing KRW-only cart lines use the same per-line USD policy as checkout. */
export function cartDisplayUsd(item: Pick<CartItem, 'priceUSD' | 'priceKRW'>): number | null {
  const usd = item.priceUSD == null ? charterUsdFromKrw(item.priceKRW) : Number(item.priceUSD);
  const cents = Math.round(usd * 100);
  return Number.isFinite(usd) && Number.isSafeInteger(cents) && cents > 0 ? cents / 100 : null;
}

/** Never present a partial sum as the total; add integer cents, not floating-point USD. */
export function cartDisplayTotalUsd(items: CartItem[]): number | null {
  if (items.length === 0) return null;
  let cents = 0;
  for (const item of items) {
    const usd = cartDisplayUsd(item);
    if (usd === null) return null;
    cents += Math.round(usd * 100);
  }
  return Number.isSafeInteger(cents) ? cents / 100 : null;
}
