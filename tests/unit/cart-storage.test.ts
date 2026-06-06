// @vitest-environment jsdom
/**
 * cart-storage 단위 테스트 — 게스트 localStorage 영속 + 게스트→로그인 머지.
 * 설계(cart-architecture-design) 명시: useWishlist 가 주석만 두고 미구현한 머지를
 * 여기서 실제 구현 → 머지/멱등/부분실패를 회귀 가드.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getLocalCart, setLocalCart, addToLocalCart, removeFromLocalCart, mergeGuestCart, CART_LS_KEY,
} from '@/lib/cart-storage';
import type { CartItem } from '@/lib/cart-types';

function mkItem(id: string): CartItem {
  return { id, booking: { productType: 'tour', tourId: id }, displayName: `Tour ${id}`, addedAt: 1000 };
}

describe('cart-storage — localStorage 영속', () => {
  beforeEach(() => { localStorage.clear(); });

  it('빈 상태 = []', () => {
    expect(getLocalCart()).toEqual([]);
  });

  it('set → get 라운드트립', () => {
    setLocalCart([mkItem('a')]);
    expect(getLocalCart().map(i => i.id)).toEqual(['a']);
  });

  it('손상된 JSON = [] (throw 안 함)', () => {
    localStorage.setItem(CART_LS_KEY, '{not json');
    expect(getLocalCart()).toEqual([]);
  });

  it('addToLocalCart 중복 id 무시', () => {
    addToLocalCart(mkItem('a'));
    addToLocalCart(mkItem('a'));
    expect(getLocalCart()).toHaveLength(1);
  });

  it('removeFromLocalCart', () => {
    setLocalCart([mkItem('a'), mkItem('b')]);
    removeFromLocalCart('a');
    expect(getLocalCart().map(i => i.id)).toEqual(['b']);
  });
});

describe('cart-storage — 게스트→로그인 머지 (useWishlist 미구현분)', () => {
  beforeEach(() => { localStorage.clear(); });

  it('각 항목을 writer 로 영속 + localStorage 클리어', async () => {
    setLocalCart([mkItem('a'), mkItem('b')]);
    const writer = vi.fn(async () => {});
    const n = await mergeGuestCart(writer);
    expect(n).toBe(2);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(getLocalCart()).toEqual([]);
  });

  it('빈 게스트 cart = writer 미호출, 0 반환', async () => {
    const writer = vi.fn(async () => {});
    const n = await mergeGuestCart(writer);
    expect(n).toBe(0);
    expect(writer).not.toHaveBeenCalled();
  });

  it('멱등 — 머지 후 재호출 = 0 (재머지 없음)', async () => {
    setLocalCart([mkItem('a')]);
    const writer = vi.fn(async () => {});
    await mergeGuestCart(writer);
    writer.mockClear();
    const n2 = await mergeGuestCart(writer);
    expect(n2).toBe(0);
    expect(writer).not.toHaveBeenCalled();
  });

  it('개별 writer 실패 무시 + localStorage 여전히 클리어 (부분실패 안전)', async () => {
    setLocalCart([mkItem('a'), mkItem('b')]);
    const writer = vi.fn(async (item: CartItem) => { if (item.id === 'a') throw new Error('fail'); });
    const n = await mergeGuestCart(writer);
    expect(n).toBe(2);
    expect(getLocalCart()).toEqual([]);
  });
});
