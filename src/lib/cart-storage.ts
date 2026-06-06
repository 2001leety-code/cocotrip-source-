/**
 * cart-storage — 장바구니 localStorage 영속 + 게스트→로그인 머지 (순수 모듈).
 *
 * useCart 훅에서 분리 → renderHook 없이 단위 테스트 가능 (cart-storage.test.ts).
 * 머지는 writer 콜백을 주입받아 Firestore 의존성 없이 검증 (useWishlist 가 주석만
 * 두고 미구현한 부분 = 여기서 실제 구현 + 테스트).
 */
import type { CartItem } from './cart-types';

export const CART_LS_KEY = 'COCO_CART';

export function getLocalCart(): CartItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_LS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

export function setLocalCart(items: CartItem[]) {
  localStorage.setItem(CART_LS_KEY, JSON.stringify(items));
}

export function clearLocalCart() {
  try { localStorage.removeItem(CART_LS_KEY); } catch { /* noop */ }
}

/** 게스트 담기 — 중복 id 무시. @returns 갱신된 목록 */
export function addToLocalCart(item: CartItem): CartItem[] {
  const list = getLocalCart();
  if (!list.some(i => i.id === item.id)) {
    list.unshift(item);
    setLocalCart(list);
  }
  return getLocalCart();
}

/** 게스트 제거. @returns 갱신된 목록 */
export function removeFromLocalCart(id: string): CartItem[] {
  const list = getLocalCart().filter(i => i.id !== id);
  setLocalCart(list);
  return list;
}

/**
 * 게스트 cart → 로그인 머지. writer(item) 로 각 항목 영속화(Firestore setDoc 주입).
 * 성공 후 localStorage 클리어 → 재호출 시 빈 목록 = 멱등 (재머지 없음).
 * 개별 writer 실패는 무시하고 나머지 진행 (best-effort), 끝에 항상 클리어.
 * @returns 머지 시도한 항목 수
 */
export async function mergeGuestCart(writer: (item: CartItem) => Promise<void>): Promise<number> {
  const localItems = getLocalCart();
  if (localItems.length === 0) return 0;
  for (const item of localItems) {
    try { await writer(item); }
    catch (err) { console.warn('[cart-storage] merge writer failed:', err); }
  }
  clearLocalCart();
  return localItems.length;
}
