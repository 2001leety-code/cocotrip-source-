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
  /**
   * 🔴 서버가 회수한 쿠폰 (2026-07-29). 결제 경로 5곳 — applyPromoCode · capturePaypalOrder ·
   * paymentGate · coupon-charge · refund-ledger — 이 전부 `isRevoked === true` 를 보고 거절한다.
   * 화면 목록도 같은 기준을 써야 "결제는 막히는데 마이페이지엔 계속 보이는" 상태가 안 생긴다.
   */
  isRevoked?: boolean;
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

/** 로그아웃·로딩 구간에서 매 렌더 새 배열을 만들지 않도록 고정 참조를 쓴다. */
const EMPTY_COUPONS: Coupon[] = [];
const EMPTY_HISTORY: PointLog[] = [];

/**
 * 🔴 FAIL-13 (2026-07-29): 데이터마다 **어느 uid 에서 받은 값인지**를 함께 들고 다닌다.
 *
 * 이전에는 회원 문서 하나만 `loadedUid` 로 추적했다. 그래서 계정 A → B 로 바뀔 때
 * B 의 회원 문서가 먼저 도착하면 `ready` 가 켜졌고, 아직 A 것이던 쿠폰·적립 이력이
 * B 화면에 그대로 노출됐다. B 의 회원 문서가 아예 없으면 `setLoyalty` 자체가 호출되지
 * 않아 **A 의 등급·코인**까지 남았다.
 *
 * 값과 uid 를 한 덩어리로 묶으면 "누구 것인지 모르는 값"이 존재할 수 없다.
 */
interface Slot<T> { uid: string; value: T }

/** 쿠폰 전체 목록과 사용 가능 목록은 같은 스냅샷에서 나와야 서로 어긋나지 않는다. */
interface CouponData { all: Coupon[]; active: Coupon[] }

const EMPTY_COUPON_DATA: CouponData = { all: EMPTY_COUPONS, active: EMPTY_COUPONS };

export function useLoyalty() {
  // 🔴 2026-07-28: useAuth 는 공유 컨텍스트가 아니라 컴포넌트마다 새 인스턴스다.
  //   그래서 항상 user=null, loading=true 로 시작해 비동기로 채워진다.
  //   loading 을 같이 받아야 "인증 복원 중"과 "비로그인"을 구분할 수 있다.
  const { user, loading: authLoading } = useAuth();
  const [loyaltySlot, setLoyaltySlot] = useState<Slot<LoyaltyInfo | null> | null>(null);
  // 만료·회수 판정을 렌더가 아니라 스냅샷 콜백에서 하기 때문에 active 도 같이 담는다.
  const [couponSlot, setCouponSlot] = useState<Slot<CouponData> | null>(null);
  const [historySlot, setHistorySlot] = useState<Slot<PointLog[]> | null>(null);

  // ── 등급/포인트 실시간 구독 ──
  useEffect(() => {
    if (authLoading) return;          // 인증 복원 중 — 판단 보류(로그아웃으로 오인 금지)
    // 🔴 2026-07-29: 로그아웃 구간에서 setState 로 초기화하지 않는다(렌더 연쇄 유발).
    //   대신 아래에서 "현재 uid 의 데이터가 도착했을 때만" 노출하도록 파생한다.
    //   그러면 이전 계정 잔상도 구조적으로 새어 나올 수 없다.
    const uid = user?.uid;
    if (!uid) return;

    // 구독 해제 뒤 늦게 도착한 A 의 콜백이 B 의 슬롯을 덮지 못하게 한다.
    // (uid 태그만으로도 화면에는 안 새지만, 덮어쓰면 B 가 다시 로딩으로 되돌아간다.)
    let cancelled = false;
    const adminNow = isAdminEmail(user?.email);
    const unsubs: (() => void)[] = [];

    // 1. User document (tier, coins)
    unsubs.push(
      onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (cancelled) return;
          const data = snap.data();
          if (!data) {
            // 🔴 회원 문서가 없는 계정은 "도착했고 값이 없음"으로 **명시 기록**한다.
            //   예전처럼 아무것도 안 쓰면 이전 계정의 등급·코인이 그대로 남는다.
            setLoyaltySlot({ uid, value: null });
            return;
          }
          const tier = (data.tier as TierType) || 'Bronze';
          setLoyaltySlot({
            uid,
            value: {
              tier,
              // 숫자 필드라 nullish 병합과 `|| 0` 이 동일 결과다. 레포 pre-commit 가드가
              // nullish 연산자를 mojibake 신호로 차단해 `|| 0` 을 쓴다 (동작 변화 없음).
              tripCoins: data.tripCoins || 0,
              totalSpentUSD: data.totalSpentUSD || 0,
              bookingCount: data.bookingCount || 0,
              earnRate: TIER_EARN_RATE[tier],
            },
          });
        },
        // 구독 오류에도 이전 계정 자료가 남지 않게 현재 uid 의 빈 값으로 확정한다.
        () => { if (!cancelled) setLoyaltySlot({ uid, value: null }); },
      )
    );

    // 2. Coupons
    unsubs.push(
      onSnapshot(
        collection(db, 'users', uid, 'coupons'),
        (snap) => {
          if (cancelled) return;
          const all = snap.docs.map(d => ({
            id: d.id,
            ...(d.data() as Omit<Coupon, 'id'>),
          }));
          // 🔴 만료 판정은 **스냅샷 콜백(이벤트)** 에서 한다. 렌더 중 시계를 읽으면
          //   같은 입력에 다른 결과가 나와 렌더가 불안정해진다(react-hooks/purity).
          // batch 9 fix (B9-3): 어드민은 isUsed 무시 — 같은 쿠폰 반복 사용 가능.
          // 🔴 2026-07-29: 회수(isRevoked)된 쿠폰은 **어드민에게도** 숨긴다.
          //   결제 5경로가 이미 isRevoked 로 거절하므로, 목록에만 남으면
          //   "보이는데 안 되는" 쿠폰이 된다.
          const now = Date.now();
          const active = all.filter(
            c => c.isRevoked !== true && (adminNow || !c.isUsed) && c.expiresAt > now,
          );
          setCouponSlot({ uid, value: { all, active } });
        },
        () => { if (!cancelled) setCouponSlot({ uid, value: EMPTY_COUPON_DATA }); },
      )
    );

    // 3. Point history (최근 30건)
    unsubs.push(
      onSnapshot(
        query(
          collection(db, 'users', uid, 'pointHistory'),
          orderBy('createdAt', 'desc'),
          limit(30),
        ),
        (snap) => {
          if (cancelled) return;
          setHistorySlot({
            uid,
            value: snap.docs.map(d => ({
              id: d.id,
              ...(d.data() as Omit<PointLog, 'id'>),
            })),
          });
        },
        () => { if (!cancelled) setHistorySlot({ uid, value: EMPTY_HISTORY }); },
      )
    );

    return () => { cancelled = true; unsubs.forEach(fn => fn()); };
    // user.email 은 어드민 판정(쿠폰 노출 규칙)에 쓰이므로 의존성에 포함한다.
  }, [user?.uid, user?.email, authLoading]);

  // 🔴 세 갈래가 **모두 현재 uid 것**일 때만 노출한다.
  //   회원 문서만 먼저 와도 켜지던 예전 방식은 이전 계정의 쿠폰·이력을 새게 했다.
  const uid = user?.uid || null;
  const ready = !!uid
    && loyaltySlot?.uid === uid
    && couponSlot?.uid === uid
    && historySlot?.uid === uid;

  // 🔴 loading 파생 규칙 (2026-07-28):
  //   인증 복원 중이거나, 로그인은 됐는데 그 uid 의 자료가 아직 안 왔으면 로딩이다.
  //   이전에는 loading 을 상태로 들고 있으면서 user=null 구간(=인증 복원 중)에 false 로
  //   꺼버렸고, 호출부가 loyalty=null 을 Bronze·0코인·0예약으로 대신 그렸다.
  //   그 뒤 문서가 도착하면 Platinum·756,986 으로 튀어 손님이 자기 등급을 잘못 본다.
  const loading = authLoading || (!!uid && !ready);

  const couponData = ready && couponSlot ? couponSlot.value : EMPTY_COUPON_DATA;

  // ── Trip Coins → USD 환산 ──
  const coinsToUSD = (coins: number) => (coins * 0.01).toFixed(2);

  return {
    loyalty: ready && loyaltySlot ? loyaltySlot.value : null,
    coupons: couponData.all,
    activeCoupons: couponData.active,
    pointHistory: ready && historySlot ? historySlot.value : EMPTY_HISTORY,
    loading,
    coinsToUSD,
  };
}
