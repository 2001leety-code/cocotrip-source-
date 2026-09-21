// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCart } from '../../src/hooks/useCart';
import { useWishlist } from '../../src/hooks/useWishlist';
import { useItinerary } from '../../src/hooks/useItinerary';

const state = vi.hoisted(() => ({
  user: null as { uid: string } | null,
  write: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined),
  unsubscribe: vi.fn(),
}));
vi.mock('../../src/hooks/useAuth', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  query: (collection: string) => collection, orderBy: vi.fn(), serverTimestamp: () => 'server-time',
  onSnapshot: () => state.unsubscribe, setDoc: state.write, deleteDoc: state.remove,
}));
beforeEach(() => { state.user = null; localStorage.clear(); vi.clearAllMocks(); });
afterEach(cleanup);

describe('user collection callbacks retain uid-only identity', () => {
  it('keeps callbacks stable for the same uid and directs writes to the current uid', async () => {
    state.user = { uid: 'synthetic-a' };
    const hook = renderHook(() => ({ cart: useCart(), wishlist: useWishlist(), itinerary: useItinerary() }));
    const original = hook.result.current;
    state.user = { uid: 'synthetic-a' };
    hook.rerender();
    expect(hook.result.current.cart.add).toBe(original.cart.add);
    expect(hook.result.current.cart.remove).toBe(original.cart.remove);
    expect(hook.result.current.cart.clear).toBe(original.cart.clear);
    expect(hook.result.current.wishlist.toggle).toBe(original.wishlist.toggle);
    expect(hook.result.current.itinerary.createItinerary).toBe(original.itinerary.createItinerary);
    expect(hook.result.current.itinerary.createItineraryWithSlots).toBe(original.itinerary.createItineraryWithSlots);
    expect(hook.result.current.itinerary.addSlot).toBe(original.itinerary.addSlot);
    expect(hook.result.current.itinerary.removeSlot).toBe(original.itinerary.removeSlot);
    expect(hook.result.current.itinerary.deleteItinerary).toBe(original.itinerary.deleteItinerary);
    state.user = { uid: 'synthetic-b' };
    hook.rerender();
    expect(hook.result.current.cart.add).not.toBe(original.cart.add);
    await act(async () => {
      await hook.result.current.cart.remove('cart-id');
      await hook.result.current.wishlist.toggle({ id: 'wish-id', productType: 'tour', name: 'Synthetic tour' });
      await hook.result.current.itinerary.deleteItinerary('plan-id');
    });
    expect(state.remove).toHaveBeenCalledWith('users/synthetic-b/cart/cart-id');
    expect(state.remove).toHaveBeenCalledWith('users/synthetic-b/itineraries/plan-id');
    expect(state.write).toHaveBeenCalledWith('users/synthetic-b/wishlist/wish-id', expect.objectContaining({ name: 'Synthetic tour' }));
    expect(state.unsubscribe).toHaveBeenCalledTimes(3);
  });

  it('keeps guest changes local and does not write an itinerary without a uid', async () => {
    const hook = renderHook(() => ({ wishlist: useWishlist(), itinerary: useItinerary() }));
    await act(async () => {
      await hook.result.current.wishlist.toggle({ id: 'local-id', productType: 'tour', name: 'Local tour' });
      expect(await hook.result.current.itinerary.createItinerary('Local', '2026-09-21', '2026-09-22')).toBeNull();
      await hook.result.current.itinerary.deleteItinerary('plan-id');
    });
    expect(hook.result.current.wishlist.items).toEqual([expect.objectContaining({ id: 'local-id' })]);
    expect(JSON.parse(localStorage.getItem('COCO_WISHLIST') || '[]')).toHaveLength(1);
    expect(state.write).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });

  it('restores guest collections and clears the displayed itinerary when uid becomes absent', () => {
    state.user = { uid: 'synthetic-user' };
    const hook = renderHook(() => ({ cart: useCart(), wishlist: useWishlist(), itinerary: useItinerary() }));
    localStorage.setItem('COCO_WISHLIST', JSON.stringify([{ id: 'guest-wish', productType: 'tour', name: 'Guest wish', addedAt: 1 }]));
    state.user = null;
    hook.rerender();
    expect(hook.result.current.cart.items).toEqual([]);
    expect(hook.result.current.cart.loading).toBe(false);
    expect(hook.result.current.wishlist.items).toEqual([expect.objectContaining({ id: 'guest-wish' })]);
    expect(hook.result.current.wishlist.loading).toBe(false);
    expect(hook.result.current.itinerary.itineraries).toEqual([]);
    expect(hook.result.current.itinerary.loading).toBe(false);
    expect(state.unsubscribe).toHaveBeenCalledTimes(3);
    expect(state.write).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });
});
