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
  productScope?: string;   // 'charter' | 'tour-package' | 'ai-plan' — AI 무료쿠폰은 할인 picker 제외용 (P1-②)
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
  // 🔴 2026-07-28: useAuth 는 공유 컨텍스트가 아니라 컴포넌트마다 새 인스턴스다.
  //   그래서 항상 user=null, loading=true 로 시작해 비동기로 채워진다.
  //   loading 을 같이 받아야 "인증 복원 중"과 "비로그인"을 구분할 수 있다.
  const { user, loading: authLoading } = useAuth();
  const [loyalty, setLoyalty] = useState<LoyaltyInfo | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [pointHistory, setPointHistory] = useState<PointLog[]>([]);
  // 어느 uid 의 회원 문서까지 도착했는지. loading 을 따로 저장하지 않고 여기서 파생한다
  // → uid 가 바뀌는 순간 자동으로 다시 "로딩 중"이 된다(리셋을 잊을 수 없다).
  const [loadedUid, setLoadedUid] = useState<string | null>(null);

  // 🔴 loading 파생 규칙 (2026-07-28):
  //   인증 복원 중이거나, 로그인은 됐는데 그 uid 의 문서가 아직 안 왔으면 로딩이다.
  //   이전에는 loading 을 상태로 들고 있으면서 user=null 구간(=인증 복원 중)에 false 로
  //   꺼버렸고, 호출부가 loyalty=null 을 Bronze·0코인·0예약으로 대신 그렸다.
  //   그 뒤 문서가 도착하면 Platinum·756,986 으로 튀어 손님이 자기 등급을 잘못 본다.
  const loading = authLoading || (!!user?.uid && loadedUid !== user.uid);

  // ── 등급/포인트 실시간 구독 ──
  useEffect(() => {
    if (authLoading) return;          // 인증 복원 중 — 판단 보류(로그아웃으로 오인 금지)
    if (!user?.uid) {
      setLoyalty(null);
      setCoupons([]);
      setPointHistory([]);
      setLoadedUid(null);
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
            // 숫자 필드라 nullish 병합과 `|| 0` 이 동일 결과다. 레포 pre-commit 가드가
            // nullish 연산자를 mojibake 신호로 차단해 `|| 0` 을 쓴다 (동작 변화 없음).
            tripCoins: data.tripCoins || 0,
            totalSpentUSD: data.totalSpentUSD || 0,
            bookingCount: data.bookingCount || 0,
            earnRate: TIER_EARN_RATE[tier],
          });
        }
        // 문서가 없는 신규 계정도 "도착"으로 본다 — 무한 스켈레톤 방지.
        setLoadedUid(snap.id);
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
  }, [user?.uid, authLoading]);

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
