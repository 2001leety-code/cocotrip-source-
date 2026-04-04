/**
 * useWishlist — Guest(localStorage) + Login(Firestore) 통합 위시리스트 훅
 *
 * Guest: localStorage "COCO_WISHLIST"에 저장
 * Login: Firestore users/{uid}/wishlist 서브컬렉션
 * 로그인 시: localStorage → Firestore 자동 동기화 후 클리어
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

const LS_KEY = 'COCO_WISHLIST';

export interface WishlistItem {
  id: string;
  productType: 'charter' | 'tour' | 'planner';
  name: string;
  priceUSD?: number;
  thumbnailUrl?: string;
  addedAt: number; // timestamp ms
}

function getLocalWishlist(): WishlistItem[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch { return []; }
}

function setLocalWishlist(items: WishlistItem[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(items));
}

export function useWishlist() {
  const { user } = useAuth();
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Firestore 실시간 구독 (로그인 시) ──
  useEffect(() => {
    if (!user?.uid) {
      setItems(getLocalWishlist());
      setLoading(false);
      return;
    }

    const colRef = collection(db, 'users', user.uid, 'wishlist');
    const unsub = onSnapshot(colRef, (snap) => {
      const list: WishlistItem[] = snap.docs.map(d => ({
        id: d.id,
        ...(d.data() as Omit<WishlistItem, 'id'>),
      }));
      list.sort((a, b) => b.addedAt - a.addedAt);
      setItems(list);
      setLoading(false);
    });

    return () => unsub();
  }, [user?.uid]);

  // ── 토글 (추가/제거) ──
  const toggle = useCallback(async (item: Omit<WishlistItem, 'addedAt'>) => {
    const exists = items.some(i => i.id === item.id);

    if (user?.uid) {
      // Firestore
      const ref = doc(db, 'users', user.uid, 'wishlist', item.id);
      try {
        if (exists) {
          await deleteDoc(ref);
        } else {
          await setDoc(ref, {
            ...item,
            addedAt: Date.now(),
            serverAddedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn('[useWishlist] Firestore toggle failed:', err);
      }
    } else {
      // localStorage
      let list = getLocalWishlist();
      if (exists) {
        list = list.filter(i => i.id !== item.id);
      } else {
        list.unshift({ ...item, addedAt: Date.now() });
      }
      setLocalWishlist(list);
      setItems(list);
    }
  }, [user?.uid, items]);

  // ── 특정 상품이 찜되어 있는지 확인 ──
  const isWishlisted = useCallback((productId: string) => {
    return items.some(i => i.id === productId);
  }, [items]);

  return { items, loading, toggle, isWishlisted };
}
