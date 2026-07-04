/**
 * 투어(시간제) 견적 영수증 — 프론트. api/_shared/tour-price.js 와 **1:1 동일 공식**.
 * (멀티데이 #764 패턴: 프론트/백엔드 공식 분리 + tour-quote-frontend-parity.test.ts 일치 가드.)
 *
 * 운영자 2026-06-02: 기본 9h 40.5만 + 거리추가(50km당 5만, 30km이내 0) + 쿠폰 자동 5% + VAT 10%.
 * ⚠️ 오버타임(9h 초과)은 **현장결제** → 영수증 total 제외, overtimeHourly(시간당 안내)만.
 * 거리추가는 차종 무관 정액 / 기본·오버타임은 차종배수(staria·staria_9 1.0 / sprinter 2.0).
 * 7인승 캡틴시트 프리미엄(SSOT CAPTAIN_PREMIUM_KRW) 은 base 직후 가산 — 백 tour-price.js 와 byte-identical(P311).
 */
import { CAPTAIN_PREMIUM_KRW } from '@/data/charterPricing';

const TOUR_BASE_9H_KRW = 405_000;
const TOUR_OVERTIME_HOURLY_KRW = 54_000;
// staria_9(9인승) = staria 와 동일가(1.0).
const TOUR_VEHICLE_MULT: Record<string, number> = { staria: 1.0, staria_9: 1.0, sprinter: 2.0 };

/** 거리 추가요금 (편도 km). 30km 이내 0, 초과 시 50km 구간마다 +5만. 차종 무관. */
export function tourDistanceSurcharge(km: number): number {
  if (!Number.isFinite(km) || km <= 30) return 0;
  return Math.ceil(km / 50) * 50_000;
}

export interface TourQuote {
  base: number;
  distance: number;
  subtotal: number;
  couponPct: number;
  coupon: number;
  vat: number;
  total: number;
  overtimeHourly: number;
}

/** vehicle 의 캡틴시트 프리미엄(SSOT CAPTAIN_PREMIUM_KRW). 호출처가 calcTourQuote captainPremiumKrw 인자로 전달용. */
export function captainPremiumKrwFor(vehicle: string): number {
  const p = CAPTAIN_PREMIUM_KRW[vehicle];
  return Number.isFinite(p) && p > 0 ? p : 0;
}

/** 투어 영수증 breakdown (VAT·쿠폰 포함 total, 오버타임 현장결제 제외). 차종 불가 시 null.
 *  captainPremiumKrw: 7인승 캡틴시트 정액(SSOT) — 호출처가 captainPremiumKrwFor(vehicle) 전달. 백 tour-price.js
 *  calcTourQuote(captainPremiumKrw) 와 byte-identical (둘 다 인자로 받아 base 직후 가산) → 표시가==청구가(P311). */
export function calcTourQuote(
  { km = 0, vehicle, couponPct = 5, captainPremiumKrw = 0 }: { km?: number; vehicle: string; couponPct?: number; captainPremiumKrw?: number },
): TourQuote | null {
  const mult = TOUR_VEHICLE_MULT[vehicle];
  if (!mult) return null; // staria/staria_9/sprinter 만 (bus=협의)
  // 7인승 캡틴시트 프리미엄 정액 — base(multiplier 적용) 직후 가산(9인승=0). 호출처가 captainPremiumKrwFor(vehicle) 전달.
  const captain = Number.isFinite(captainPremiumKrw) && captainPremiumKrw > 0 ? captainPremiumKrw : 0;
  const base = Math.round(TOUR_BASE_9H_KRW * mult) + captain;
  const distance = tourDistanceSurcharge(km);
  const subtotal = base + distance;
  const pct = Number.isFinite(couponPct) && couponPct >= 0 ? couponPct : 0;
  const coupon = Math.round((subtotal * pct) / 100);
  const vat = Math.round((subtotal - coupon) * 0.1);
  const total = subtotal - coupon + vat;
  const overtimeHourly = Math.round(TOUR_OVERTIME_HOURLY_KRW * mult);
  return { base, distance, subtotal, couponPct: pct, coupon, vat, total, overtimeHourly };
}
