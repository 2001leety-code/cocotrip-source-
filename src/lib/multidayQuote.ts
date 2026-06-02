/**
 * 멀티데이(1박+) 차터 견적 — 프론트. api/_shared/charter-multiday-price.js `calcMultiDayCharterKrw` 와 **1:1 동일 공식**.
 * (투어 #770 / transfer #772 패턴: 프론트/백엔드 공식 분리 + multiday-quote-frontend-parity.test.ts 일치 가드.)
 *
 * ⚠️ 멀티데이 −10% 할인(useQuoteCalculator.ts subtotalKRW 에 포함)은 **여기 미포함** — 결제 backend SSOT 와
 *    동일하게 할인/옵션/할증 전 base 금액(거리부+운영비)만 반환한다. resolveProductType / 결제 영수증은 이 값을
 *    써야 표시가 == 청구가 (P311). 온라인 즉시결제 = base 정책(−10%·가이드옵션·야간할증 제외)은 운영자 정책 확인 대상.
 *
 * 공식 (백엔드와 byte-identical):
 *   거리부 = round((staria.base_fee + km×2×staria.rate_per_km) × MULT[vehicle])  ← 거리부는 항상 staria 상수
 *   운영비 = vehicle.daily_service_fee × days + vehicle.overnight_driver_fee × nights
 *   MULT  = staria 1.0 / sprinter 2.0 (bus/vip = inquiry-only → null)
 */
import { VEHICLE_INTERCITY, DISTANCE_MATRIX } from '@/data/charterPricing';

// 백엔드 charter-multiday-price.js:21 VEHICLE_MULTIPLIER 와 일치 (결제 가능 차종만).
const VEHICLE_MULT: Record<string, number> = { staria: 1.0, sprinter: 2.0 };

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
  distancePart: number;   // 거리 운행료 (할인 전)
  days: number;           // 결제 일수 (1~30 cap)
  nights: number;         // days - 1
  dailyFee: number;       // 1일 운영비 (차종별)
  overnightFee: number;   // 1박 기사비 (차종별)
  total: number;          // distancePart + dailyFee×days + overnightFee×nights (할인 전)
}

/**
 * 멀티데이 견적 breakdown (할인 전, 백엔드 SSOT). 차종 불가/거리 무효 시 null.
 * total 은 calcMultiDayCharterKrw 와 동일(= backend resolveMultiDayCheckoutKrw).
 */
export function calcMultiDayQuote(
  { vehicle, km, durationDays }: { vehicle: string; km: number; durationDays?: number },
): MultiDayQuote | null {
  const mult = VEHICLE_MULT[vehicle];
  if (!mult) return null; // staria/sprinter 만 즉시결제 (bus/vip = inquiry-only)
  if (!Number.isFinite(km) || km <= 0) return null; // km 변조/누락 방어

  const sIc = VEHICLE_INTERCITY.staria;
  const vIc = VEHICLE_INTERCITY[vehicle as 'staria' | 'sprinter'];
  if (!vIc) return null;

  const days = Math.min(30, Math.max(1, Math.floor(Number(durationDays) || 1))); // 1~30 cap
  const nights = Math.max(0, days - 1);
  const distancePart = Math.round((sIc.base_fee + km * 2 * sIc.rate_per_km) * mult);
  const total = distancePart + vIc.daily_service_fee * days + vIc.overnight_driver_fee * nights;
  return { distancePart, days, nights, dailyFee: vIc.daily_service_fee, overnightFee: vIc.overnight_driver_fee, total };
}

/**
 * 멀티데이 차터 결제 금액(KRW, 할인 전) 재계산. 백엔드 calcMultiDayCharterKrw 와 byte-identical.
 * @returns 결제 금액, 또는 결제 불가(차종/거리 무효) 시 null.
 */
export function calcMultiDayCharterKrw(
  args: { vehicle: string; km: number; durationDays?: number },
): number | null {
  const q = calcMultiDayQuote(args);
  return q ? q.total : null;
}
