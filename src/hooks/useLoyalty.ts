/**
 * useLoyalty — 회원 등급, Trip Coins, 쿠폰 조회 훅
 *
 * Firestore 기반:
 * - users/{uid} → tier, tripCoins, totalSpentUSD, bookingCount
 * - users/{uid}/coupons → 보유 쿠폰 목록
 * - users/{uid}/pointHistory → 적립/사용 내역
 *
 * batch 9 fix (B9-3, 2026-05-09): 어드민 본인은 isUsed 쿠폰도 active 로 노출.
 *   백엔드(api/loyalty.js)에서도 admin email 일 때 isUsed 마킹 skip 처리.
 *   결과: 운영자가 같은 쿠폰을 반복 사용해서 5%/$5 결제 흐름 무제한 테스트 가능.
 */
import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import {
  doc, onSnapshot, collection, query, orderBy, limit,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { isAdminEmail } from '@/lib/admin';

export type TierType = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface LoyaltyInfo {
  tier: TierType;
  tripCoins: number;      // 1 coin = $0.01
  totalSpentUSD: number;
  bookingCount: number;
  earnRate: number;        // 적립률 (0.01 ~ 0.03)
}

export interface Coupon {
  id: string;
  code: string;
  type: 'percent' | 'fixed';
  value: number;           // percent: 5 → 5%, fixed: 5000 → ₩5000
  currency: 'USD' | 'KRW';
  label: string;
  minOrderUSD: number;
  isUsed: boolean;
  expiresAt: number;
  createdAt: number;
}

export interface PointLog {
  id: string;
  type: 'earn' | 'spend' | 'expire';
  amount: number;
  balance: number;
  description: string;
  createdAt: number;
}

// 등급별 적립률
const TIER_EARN_RATE: Record<TierType, number> = {
  Bronze: 0.01,
  Silver: 0.015,
  Gold: 0.02,
  Platinum: 0.03,
};

export function useLoyalty() {
  const { user } = useAuth();
  const [loyalty, setLoyalty] = useState<LoyaltyInfo | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [pointHistory, setPointHistory] = useState<PointLog[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 등급/포인트 실시간 구독 ──
  useEffect(() => {
    if (!user?.uid) {
      setLoyalty(null);
      setCoupons([]);
      setPointHistory([]);
      setLoading(false);
      return;
    }

    const unsubs: (() => void)[] = [];

    // 1. User document (tier, coins)
    unsubs.push(
      onSnapshot(doc(db, 'users', user.uid), (snap) => {
        const data = snap.data();
        if (data) {
          const tier = (data.tier as TierType) || 'Bronze';
          setLoyalty({
            tier,
            tripCoins: data.tripCoins ?? 0,
            totalSpentUSD: data.totalSpentUSD ?? 0,
            bookingCount: data.bookingCount ?? 0,
            earnRate: TIER_EARN_RATE[tier],
          });
        }
        setLoading(false);
      })
    );

    // 2. Coupons
    unsubs.push(
      onSnapshot(collection(db, 'users', user.uid, 'coupons'), (snap) => {
        setCoupons(
          snap.docs.map(d => ({
            id: d.id,
            ...(d.data() as Omit<Coupon, 'id'>),
          }))
        );
      })
    );

    // 3. Point history (최근 30건)
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'users', user.uid, 'pointHistory'),
          orderBy('createdAt', 'desc'),
          limit(30),
        ),
        (snap) => {
          setPointHistory(
            snap.docs.map(d => ({
              id: d.id,
              ...(d.data() as Omit<PointLog, 'id'>),
            }))
          );
        },
      )
    );

    return () => unsubs.forEach(fn => fn());
  }, [user?.uid]);

  // ── 사용 가능한 쿠폰만 필터 ──
  // batch 9 fix (B9-3): 어드민은 isUsed 무시 — 같은 쿠폰 반복 사용 가능.
  const isAdmin = isAdminEmail(user?.email);
  const activeCoupons = coupons.filter(
    c => (isAdmin || !c.isUsed) && c.expiresAt > Date.now()
  );

  // ── Trip Coins → USD 환산 ──
  const coinsToUSD = (coins: number) => (coins * 0.01).toFixed(2);

  return { loyalty, coupons, activeCoupons, pointHistory, loading, coinsToUSD };
}
