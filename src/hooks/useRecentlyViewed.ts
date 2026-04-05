/**
 * useRecentlyViewed — 최근 본 상품 자동 추적 훅
 *
 * Guest: localStorage "COCO_RECENTLY_VIEWED"
 * Login: Firestore users/{uid}/recentlyViewed
 * 최대 20개 유지, 중복 방지 (최신 기록으로 갱신)
 */
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import {
  collection, doc, setDoc, onSnapshot, serverTimestamp, query, orderBy, limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

const LS_KEY = 'COCO_RECENTLY_VIEWED';
const MAX_ITEMS = 20;

export interface RecentItem {
  id: string;
  productType: 'charter' | 'tour' | 'planner';
  name: string;
  priceUSD?: number;
  thumbnailUrl?: string;
  viewedAt: number;
}

function getLocal(): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch { return []; }
}

function setLocal(items: RecentItem[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
}

export function useRecentlyViewed() {
  const { user } = useAuth();
  const [items, setItems] = useState<RecentItem[]>([]);

  // ── Firestore 실시간 구독 ──
  useEffect(() => {
    if (!user?.uid) {
      setItems(getLocal());
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'recentlyViewed'),
      orderBy('viewedAt', 'desc'),
      limit(MAX_ITEMS),
    );
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<RecentItem, 'id'>) })));
    });

    return () => unsub();
  }, [user?.uid]);

  // ── 상품 조회 기록 ──
  const track = useCallback(async (item: Omit<RecentItem, 'viewedAt'>) => {
    const now = Date.now();

    if (user?.uid) {
      await setDoc(doc(db, 'users', user.uid, 'recentlyViewed', item.id), {
        ...item,
        viewedAt: now,
        serverViewedAt: serverTimestamp(),
      });
    } else {
      let list = getLocal().filter(i => i.id !== item.id);
      list.unshift({ ...item, viewedAt: now });
      list = list.slice(0, MAX_ITEMS);
      setLocal(list);
      setItems(list);
    }
  }, [user?.uid]);

  return { items, track };
}
