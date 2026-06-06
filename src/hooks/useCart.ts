/**
 * useCart — Guest(localStorage) + Login(Firestore) 통합 장바구니 훅.
 *
 * Guest: localStorage "COCO_CART" (cart-storage 모듈)
 * Login: Firestore users/{uid}/cart 서브컬렉션
 * 로그인 시: localStorage → Firestore 머지 후 클리어 (mergeGuestCart, 멱등).
 *   ⚠️ useWishlist 는 동일 머지를 "주석만" 두고 미구현 → 여기서 실제 구현 + 테스트
 *      (cart-storage.test.ts 가 머지·멱등 회귀 가드).
 *
 * ⚠️ priceKRW 는 표시 전용 (cart-types 참조). 결제(2차 PR)는 booking 키로 backend 재계산.
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { CartItem } from '@/lib/cart-types';
import {
  getLocalCart, addToLocalCart, removeFromLocalCart, clearLocalCart, mergeGuestCart,
} from '@/lib/cart-storage';

export function useCart() {
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Firestore 실시간 구독 (로그인) / localStorage (게스트) ──
  useEffect(() => {
    if (!user?.uid) {
      setItems(getLocalCart());
      setLoading(false);
      return;
    }
    const uid = user.uid;
    const colRef = collection(db, 'users', uid, 'cart');

    // 게스트 cart → 로그인 머지 (1회, 멱등). writer = Firestore setDoc 주입.
    void mergeGuestCart((item) => setDoc(
      doc(db, 'users', uid, 'cart', item.id),
      { ...item, serverAddedAt: serverTimestamp() },
      { merge: true },
    ));

    const unsub = onSnapshot(colRef, (snap) => {
      const list: CartItem[] = snap.docs.map(d => ({
        id: d.id,
        ...(d.data() as Omit<CartItem, 'id'>),
      }));
      list.sort((a, b) => b.addedAt - a.addedAt);
      setItems(list);
      setLoading(false);
    });
    return () => unsub();
  }, [user?.uid]);

  // ── 담기 ──
  const add = useCallback(async (item: Omit<CartItem, 'addedAt'>) => {
    const full: CartItem = { ...item, addedAt: Date.now() };
    if (user?.uid) {
      try {
        await setDoc(doc(db, 'users', user.uid, 'cart', item.id), {
          ...full,
          serverAddedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn('[useCart] add failed:', err);
      }
    } else {
      setItems(addToLocalCart(full));
    }
  }, [user?.uid]);

  // ── 제거 ──
  const remove = useCallback(async (id: string) => {
    if (user?.uid) {
      try { await deleteDoc(doc(db, 'users', user.uid, 'cart', id)); }
      catch (err) { console.warn('[useCart] remove failed:', err); }
    } else {
      setItems(removeFromLocalCart(id));
    }
  }, [user?.uid]);

  // ── 비우기 ──
  const clear = useCallback(async () => {
    if (user?.uid) {
      const uid = user.uid;
      try {
        await Promise.all(items.map(i => deleteDoc(doc(db, 'users', uid, 'cart', i.id))));
      } catch (err) { console.warn('[useCart] clear failed:', err); }
    } else {
      clearLocalCart();
      setItems([]);
    }
  }, [user?.uid, items]);

  const isInCart = useCallback((id: string) => items.some(i => i.id === id), [items]);

  return { items, loading, add, remove, clear, isInCart, count: items.length };
}
