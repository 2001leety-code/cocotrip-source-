/**
 * 투어(당일, 시간제) 가격 backend 재계산 — 운영자 2026-06-02 정책.
 *
 * 차터(거리제 = 편도 km×1500)와 별개로, 투어는 **기본 9시간 + 거리추가 + 오버타임** 시간제.
 * 결제 금액은 client priceKRW 불신 — backend 가 km/hours/vehicle 로 SSOT 재계산(P311 SAFETY).
 *
 * 공식 (운영자 확정):
 *   기본 9시간 = 405,000원 (staria, 45,000/h × 9) × 차종배수
 *   오버타임   = (hours - 9) × 54,000원 (staria, +20% 할증) × 차종배수, 9시간 이하면 0
 *   거리추가   = 30km 이내 0, 초과 시 50km 구간마다 +50,000원 (차종 무관 = 이동 보너스)
 *   → 합계에 VAT 10% + 쿠폰(투어 5%)은 결제 레이어에서 별도 적용
 *
 * 운영자 거리추가 예시 검증: 파주45km→5만 / 여주70km·춘천85km→10만 (tour-price.test.ts 가드).
 * 차종배수는 현행 day_tour 와 동일(VEHICLE_MULTIPLIER staria 1.0 / sprinter 2.0). bus=협의(결제 불가).
 */

import { lookupMatrixKm, captainPremiumKrw } from './charter-multiday-price.js';

const TOUR_BASE_9H_KRW = 405_000;       // staria 기본 9시간
const TOUR_OVERTIME_HOURLY_KRW = 54_000; // staria 오버타임 시간당 (+20%)
const TOUR_BASE_HOURS = 9;
// staria_9(9인승) = staria 와 동일가(1.0). bus 협의=결제 불가.
const VEHICLE_MULT = { staria: 1.0, staria_9: 1.0, sprinter: 2.0 };

/**
 * 거리 추가요금 (편도 km 기준). 30km 이내 0, 초과 시 50km 구간마다 +5만. 차종 무관.
 */
export function tourDistanceSurcharge(km) {
  if (!Number.isFinite(km) || km <= 30) return 0;
  return Math.ceil(km / 50) * 50_000;
}

/**
 * 투어 가격 재계산 (VAT·쿠폰 전 순수 금액).
 * @param {{km:number, hours:number, vehicle:string}} args  km=편도 이동거리, hours=투어 시간(기본 9)
 * @returns {number|null} 순수 가격, 또는 결제 불가(차종) 시 null
 */
export function calcTourKrw({ km = 0, hours = TOUR_BASE_HOURS, vehicle, captainPremiumKrw: captain = 0 } = {}) {
  const mult = VEHICLE_MULT[vehicle];
  if (!mult) return null; // staria/staria_9/sprinter 만 즉시결제 (bus=협의)
  const h = Number.isFinite(hours) && hours >= TOUR_BASE_HOURS ? Math.min(24, hours) : TOUR_BASE_HOURS;
  // 7인승 캡틴시트 프리미엄 정액(SSOT) — base(multiplier 적용) 직후 가산 (9인승=0).
  const cap = Number.isFinite(captain) && captain > 0 ? captain : 0;
  const base = TOUR_BASE_9H_KRW * mult + cap;
  const overtime = (h - TOUR_BASE_HOURS) * TOUR_OVERTIME_HOURLY_KRW * mult;
  const surcharge = tourDistanceSurcharge(km); // 차종 무관
  return Math.round(base + overtime + surcharge);
}

/**
 * 투어 사전결제 영수증 breakdown (운영자 2026-06-02 "Vercel 영수증처럼 쿠폰 자동적용 총액").
 * ⚠️ 오버타임(9h 초과)은 **현장결제** → 사전 total 에서 제외, overtimeHourly(시간당 안내)만 반환.
 * 쿠폰 자동적용(투어 기본 5%) + VAT 10%. 거리추가는 차종 무관 정액.
 * captainPremiumKrw: 7인승 캡틴시트 정액(SSOT). resolveTourCheckoutKrw 가 spec 에서 산출해 전달. 프론트
 *   tourQuote.ts 는 CAPTAIN_PREMIUM_KRW[vehicle] 로 동일값 → byte-identical → 표시가==청구가(P311). base 직후 가산.
 * @param {{km:number, vehicle:string, couponPct:number, captainPremiumKrw:number}} args
 * @returns {object|null} { base, distance, subtotal, couponPct, coupon, vat, total, overtimeHourly }
 */
export function calcTourQuote({ km = 0, vehicle, couponPct = 5, captainPremiumKrw: captain = 0 } = {}) {
  const mult = VEHICLE_MULT[vehicle];
  if (!mult) return null; // staria/staria_9/sprinter 만 (bus=협의)
  // 7인승 캡틴시트 프리미엄 정액(SSOT) — base(multiplier 적용) 직후 가산 (9인승=0).
  const cap = Number.isFinite(captain) && captain > 0 ? captain : 0;
  const base = Math.round(TOUR_BASE_9H_KRW * mult) + cap;
  const distance = tourDistanceSurcharge(km);     // 차종 무관
  const subtotal = base + distance;                // 오버타임 제외 (현장결제)
  const pct = Number.isFinite(couponPct) && couponPct >= 0 ? couponPct : 0;
  const coupon = Math.round(subtotal * pct / 100);
  const vat = Math.round((subtotal - coupon) * 0.1);
  const total = subtotal - coupon + vat;           // 사전결제 총액
  const overtimeHourly = Math.round(TOUR_OVERTIME_HOURLY_KRW * mult); // 현장결제 시간당 안내
  return { base, distance, subtotal, couponPct: pct, coupon, vat, total, overtimeHourly };
}

/**
 * 결제 핸들러용 게이트 — 플래그 + matrix km(backend 조회) + 영수증 total 재계산.
 * client 는 originKey/destKey(정규화 matrix 키) + vehicle 만 전달. km/priceKRW/hours 무시(변조 차단 +
 * 오버타임은 현장결제라 사전결제에 미포함). 목적지가 matrix 에 없으면(시내 등) km=0 → 거리추가 0.
 * @returns {number|null} 사전결제 총액(기본+거리+VAT−쿠폰), 또는 비활성/차종 불가 시 null
 */
export function resolveTourCheckoutKrw(spec, body, featureEnabled) {
  if (!featureEnabled || !body) return null; // 플래그 OFF = 투어 시간제 비활성 (현행 권역 고정가 유지)
  const km = lookupMatrixKm(spec, String(body.originKey || '').trim(), String(body.destKey || '').trim());
  const vehicle = String(body.vehicle || '').trim();
  // 7인승 캡틴시트 프리미엄 정액(SSOT) — body.vehicle 로 spec 조회 (프론트 CAPTAIN_PREMIUM_KRW 와 동일값 = P311).
  const quote = calcTourQuote({ km: km == null ? 0 : km, vehicle, captainPremiumKrw: captainPremiumKrw(spec, vehicle) });
  return quote ? quote.total : null; // 오버타임 현장결제 제외 = 기본+거리+VAT−쿠폰
}

export { TOUR_BASE_9H_KRW, TOUR_OVERTIME_HOURLY_KRW, TOUR_BASE_HOURS, VEHICLE_MULT as TOUR_VEHICLE_MULT };
