/**
 * 멀티데이(1박+) 차터 견적 — 프론트. api/_shared/charter-multiday-price.js `calcMultiDayCharterKrw` 와 **1:1 동일 공식**.
 * (투어 #770 / transfer #772 패턴: 프론트/백엔드 공식 분리 + multiday-quote-frontend-parity.test.ts 일치 가드.)
 *
 * 운영자 정책 (2026-06-02): **3일(durationDays>=3) 이상 멀티데이 차터 10% 할인.** 백엔드 SSOT 와 동일하게
 *   base(거리부+운영비) 산출 후 3일+ 면 ×0.9. resolveProductType / 결제 영수증은 이 total 을 써야 표시가 == 청구가 (P311).
 *   ⚠️ 가이드옵션·야간할증은 온라인 즉시결제 base 에 미포함(현장/별도) — 할인만 정책 반영.
 *
 * 공식 (백엔드와 byte-identical):
 *   거리부 = round((staria.base_fee + km×2×staria.rate_per_km) × MULT[vehicle])  ← 거리부는 항상 staria 상수
 *   운영비 = vehicle.daily_service_fee × days + vehicle.overnight_driver_fee × nights
 *   total = days>=3 ? round(base × 0.9) : base   /   MULT = staria·staria_9 1.0 / sprinter 2.0 (bus → null)
 *
 * FEATURE_DISCOUNT_V2 (운영자 2026-06-07): v2 ON 시 3일+ 기본할인 5% (기존 10%). 백엔드 DISCOUNT_V2_MULTIDAY_PCT 와 byte-identical.
 *   calcMultiDayQuote/calcMultiDayCharterKrw 는 선택적 opts.discountV2=true 를 받아 5% 적용 — 플래그 OFF(기본) = 무영향.
 */
import { VEHICLE_INTERCITY, DISTANCE_MATRIX, CAPTAIN_PREMIUM_KRW } from '@/data/charterPricing';

// 백엔드 charter-multiday-price.js VEHICLE_MULTIPLIER 와 일치 (결제 가능 차종만).
// staria_9(9인승) = staria 와 동일가(1.0).
const VEHICLE_MULT: Record<string, number> = { staria: 1.0, staria_9: 1.0, sprinter: 2.0 };

// 백엔드 charter-multiday-price.js MULTIDAY_DISCOUNT_* 와 byte-identical (운영자 정책 2026-06-02).
const MULTIDAY_DISCOUNT_MIN_DAYS = 3;
const MULTIDAY_DISCOUNT_PCT = 10;
// FEATURE_DISCOUNT_V2 (운영자 2026-06-07): 다일 기본할인 5%. 백엔드 DISCOUNT_V2_MULTIDAY_PCT 와 byte-identical.
const DISCOUNT_V2_MULTIDAY_PCT = 5;

/**
 * SSOT distance_matrix km 조회 — 백엔드 _shared/charter-multiday-price.js lookupMatrixKm 와 동일 (fwd/rev 만).
 * 차터 즉시결제(멀티데이/transfer/투어) 공통. client 가 키를 위조해도 matrix 에 실재하는 키쌍만 km 반환.
 * @returns km, 또는 matrix 미존재 시 null(결제 불가).
 */
export function lookupMatrixKm(originKey: string, destKey: string): number | null {
  if (!originKey || !destKey) return null;
  const m = DISTANCE_MATRIX as Record<string, { km?: number } | undefined>;
  const fwd = m[`${originKey}→${destKey}`];
  if (fwd && typeof fwd.km === 'number') return fwd.km;
  const rev = m[`${destKey}→${originKey}`];
  if (rev && typeof rev.km === 'number') return rev.km;
  return null;
}

export interface MultiDayQuote {
  distancePart: number;   // 거리 운행료
  days: number;           // 결제 일수 (1~30 cap)
  nights: number;         // days - 1
  dailyFee: number;       // 1일 운영비 (차종별)
  overnightFee: number;   // 1박 기사비 (차종별)
  base: number;           // 할인 전 = distancePart + dailyFee×days + overnightFee×nights
  discountPct: number;    // 3일+ = 10(v1) / 5(v2), 그 외 0
  discount: number;       // base - total
  total: number;          // 할인 후 결제 금액 (= backend resolveMultiDayCheckoutKrw)
}

export interface MultiDayQuoteOpts {
  discountV2?: boolean;   // FEATURE_DISCOUNT_V2: true=5%, false/undefined=10% (현행)
}

/**
 * 멀티데이 견적 breakdown. total 은 calcMultiDayCharterKrw 와 동일(= backend SSOT). 차종 불가/거리 무효 시 null.
 * opts.discountV2=true 시 3일+ 기본할인 5% (백엔드 v2 동일). 플래그 OFF(기본) = 현행 10% 무영향.
 */
export function calcMultiDayQuote(
  { vehicle, km, durationDays }: { vehicle: string; km: number; durationDays?: number },
  opts: MultiDayQuoteOpts = {},
): MultiDayQuote | null {
  const mult = VEHICLE_MULT[vehicle];
  if (!mult) return null; // staria/staria_9/sprinter 만 즉시결제 (bus = inquiry-only)
  if (!Number.isFinite(km) || km <= 0) return null; // km 변조/누락 방어

  const sIc = VEHICLE_INTERCITY.staria;
  const vIc = VEHICLE_INTERCITY[vehicle as 'staria' | 'staria_9' | 'sprinter'];
  if (!vIc) return null;

  const days = Math.min(30, Math.max(1, Math.floor(Number(durationDays) || 1))); // 1~30 cap
  const nights = Math.max(0, days - 1);
  const distancePart = Math.round((sIc.base_fee + km * 2 * sIc.rate_per_km) * mult);
  // 7인승 캡틴시트 프리미엄 정액(SSOT) — 거리부(multiplier 적용) 직후, 3일+ 할인 전 1회 가산(9인승=0).
  // 백엔드 charter-multiday-price.js 와 byte-identical → 표시가==청구가(P311).
  const captainRaw = CAPTAIN_PREMIUM_KRW[vehicle];
  const captain = Number.isFinite(captainRaw) && captainRaw > 0 ? captainRaw : 0;
  const base = distancePart + captain + vIc.daily_service_fee * days + vIc.overnight_driver_fee * nights;
  // 3일 이상 할인 (v1=10% / v2=5%). 백엔드 calcMultiDayCharterKrw discountPct 와 동일 연산.
  const basePct = opts.discountV2 ? DISCOUNT_V2_MULTIDAY_PCT : MULTIDAY_DISCOUNT_PCT;
  const discountPct = days >= MULTIDAY_DISCOUNT_MIN_DAYS ? basePct : 0;
  const total = discountPct > 0 ? Math.round(base * (1 - discountPct / 100)) : base;
  const discount = base - total;
  return { distancePart, days, nights, dailyFee: vIc.daily_service_fee, overnightFee: vIc.overnight_driver_fee, base, discountPct, discount, total };
}

/**
 * 멀티데이 차터 결제 금액(KRW) 재계산. 백엔드 calcMultiDayCharterKrw 와 byte-identical.
 * opts.discountV2=true: 3일+ 기본할인 5% (FEATURE_DISCOUNT_V2). 기본=현행 10%.
 * @returns 결제 금액, 또는 결제 불가(차종/거리 무효) 시 null.
 */
export function calcMultiDayCharterKrw(
  args: { vehicle: string; km: number; durationDays?: number },
  opts: MultiDayQuoteOpts = {},
): number | null {
  const q = calcMultiDayQuote(args, opts);
  return q ? q.total : null;
}
