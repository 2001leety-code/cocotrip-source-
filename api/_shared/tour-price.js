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

import { lookupMatrixKm } from './charter-multiday-price.js';

const TOUR_BASE_9H_KRW = 405_000;       // staria 기본 9시간
const TOUR_OVERTIME_HOURLY_KRW = 54_000; // staria 오버타임 시간당 (+20%)
const TOUR_BASE_HOURS = 9;
const VEHICLE_MULT = { staria: 1.0, sprinter: 2.0 }; // 현행 day_tour 일관 (bus 협의=결제 불가)

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
export function calcTourKrw({ km = 0, hours = TOUR_BASE_HOURS, vehicle } = {}) {
  const mult = VEHICLE_MULT[vehicle];
  if (!mult) return null; // staria/sprinter 만 즉시결제 (bus=협의)
  const h = Number.isFinite(hours) && hours >= TOUR_BASE_HOURS ? Math.min(24, hours) : TOUR_BASE_HOURS;
  const base = TOUR_BASE_9H_KRW * mult;
  const overtime = (h - TOUR_BASE_HOURS) * TOUR_OVERTIME_HOURLY_KRW * mult;
  const surcharge = tourDistanceSurcharge(km); // 차종 무관
  return Math.round(base + overtime + surcharge);
}

/**
 * 결제 핸들러용 게이트 — 플래그 + matrix km(backend 조회) + 가격 재계산.
 * client 는 originKey/destKey(정규화 matrix 키) + hours + vehicle 만 전달. km/priceKRW 무시(변조 차단).
 * 목적지가 matrix 에 없으면(시내 등) km=0 → 거리추가 0(기본 9h 만).
 * @param {object} spec  _pricing_spec.json (distance_matrix)
 * @param {object} body  결제 요청 body
 * @param {boolean} featureEnabled  FEATURE_TOUR_HOURLY (운영자 플래그). false 면 null(현행 권역 고정가 유지).
 * @returns {number|null} 순수 가격(VAT·쿠폰 전), 또는 비활성/차종 불가 시 null
 */
export function resolveTourCheckoutKrw(spec, body, featureEnabled) {
  if (!featureEnabled || !body) return null; // 플래그 OFF = 투어 시간제 비활성 (현행 권역 고정가 유지)
  const km = lookupMatrixKm(spec, String(body.originKey || '').trim(), String(body.destKey || '').trim());
  return calcTourKrw({ km: km == null ? 0 : km, hours: body.hours, vehicle: String(body.vehicle || '').trim() });
}

export { TOUR_BASE_9H_KRW, TOUR_OVERTIME_HOURLY_KRW, TOUR_BASE_HOURS, VEHICLE_MULT as TOUR_VEHICLE_MULT };
