/**
 * 2026-10-10 R2 — the per-flow checkout cookie keeps one entry per order (newest first) so a second order
 * created in another tab no longer destroys the first order's same-order authority (403 RECOVERY_AUTH_REQUIRED).
 * Pure helpers only: no handler, no Firestore, no provider.
 */
import { describe, expect, it } from 'vitest';
import {
  checkoutCookie, readCheckoutCookie, readCheckoutEntries, hasCheckoutCapability, newCheckoutCapability, isSameOrderProven,
} from '../../api/_shared/payment-fulfillment-recovery.js';

const req = (setCookie: string | string[]) => ({
  headers: { cookie: (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) => c.split(';')[0]).join('; ') },
});

describe('checkout cookie keeps one entry per order', () => {
  it('a second order in the same flow keeps the first order provable (both capture)', () => {
    const a = newCheckoutCapability();
    const b = newCheckoutCapability();
    const first = checkoutCookie('single', 'ORDER-A', a.secret, null);
    expect(first).toMatch(/^cocotrip_checkout_single=ORDER-A\.[a-f0-9]{64}; Path=\/api; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
    const second = checkoutCookie('single', 'ORDER-B', b.secret, req(first));
    expect(readCheckoutEntries(req(second), 'single').map((e) => e.orderID)).toEqual(['ORDER-B', 'ORDER-A']);
    expect(hasCheckoutCapability(req(second), 'single', 'ORDER-A', a.digest)).toBe(true);
    expect(hasCheckoutCapability(req(second), 'single', 'ORDER-B', b.digest)).toBe(true);
    // Each order is proven only by its own secret.
    expect(hasCheckoutCapability(req(second), 'single', 'ORDER-A', b.digest)).toBe(false);
  });

  it('legacy single-value cookie still proves its own order and nothing else', () => {
    const a = newCheckoutCapability();
    const legacy = { headers: { cookie: `cocotrip_checkout_cart=ORDER-A.${a.secret}` } };
    expect(readCheckoutCookie(legacy, 'cart', 'ORDER-A')).toEqual({ orderID: 'ORDER-A', secret: a.secret });
    expect(readCheckoutCookie(legacy, 'cart', 'ORDER-Z')).toBeNull();
    expect(hasCheckoutCapability(legacy, 'cart', 'ORDER-A', a.digest)).toBe(true);
    expect(isSameOrderProven({ req: legacy, flow: 'cart', orderID: 'ORDER-Z', snapshot: { recoveryDigest: a.digest }, verifiedUid: null })).toBe(false);
  });

  it('flows stay separate and the list is capped at five newest entries', () => {
    const caps = Array.from({ length: 7 }, () => newCheckoutCapability());
    let cookie = checkoutCookie('single', 'O0', caps[0].secret, null);
    for (let i = 1; i < 7; i += 1) cookie = checkoutCookie('single', `O${i}`, caps[i].secret, req(cookie));
    const ids = readCheckoutEntries(req(cookie), 'single').map((e) => e.orderID);
    expect(ids).toEqual(['O6', 'O5', 'O4', 'O3', 'O2']);
    expect(readCheckoutEntries(req(cookie), 'cart')).toEqual([]);
    // Re-creating an order id moves it to the front instead of duplicating it.
    const again = checkoutCookie('single', 'O3', caps[3].secret, req(cookie));
    expect(readCheckoutEntries(req(again), 'single').map((e) => e.orderID)).toEqual(['O3', 'O6', 'O5', 'O4', 'O2']);
  });

  it('malformed entries are ignored without breaking the valid ones', () => {
    const a = newCheckoutCapability();
    const dirty = { headers: { cookie: `cocotrip_checkout_single=garbage|ORDER-A.${a.secret}|x.y` } };
    expect(readCheckoutEntries(dirty, 'single')).toEqual([{ orderID: 'ORDER-A', secret: a.secret }]);
    expect(readCheckoutCookie({ headers: {} }, 'single')).toBeNull();
  });
});
