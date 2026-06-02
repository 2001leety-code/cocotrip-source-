/**
 * 도시간 차터 transfer(편도/왕복 1회 이동) 가격 backend 재계산 — 운영자 2026-06-02.
 *
 * 신규 service: airport(4-tier)/day_tour(시간제)/multi_day(1박+) 와 별개. 도시간 1회 편도/왕복 이동.
 * 결제 금액은 client priceKRW/km 불신 — backend 가 matrix km 직접 조회(P311). 멀티데이 #764 패턴.
 *
 * 공식 (운영자 확정 — 서울→부산 400km 예시 검증):
 *   거리 = 편도(oneway) km / 왕복(roundtrip) km×2
 *   base = 거리 × 1500 × 차종배수(staria 1.0 / sprinter 2.0)
 *   쿠폰 = 편도 5% / 왕복 10% (자동)
 *   VAT  = (base − 쿠폰) × 10% 가산
 *   total = base − 쿠폰 + VAT
 *   → 편도 400km staria: 600,000 −30,000(5%) +57,000 = 627,000
 *      왕복 800km staria: 1,200,000 −120,000(10%) +108,000 = 1,188,000
 */
import { lookupMatrixKm } from './charter-multiday-price.js';

const VEHICLE_MULT = { staria: 1.0, sprinter: 2.0 }; // bus/vip = inquiry(결제 불가)
const TRANSFER_RATE_PER_KM = 1500;

/**
 * transfer 영수증 breakdown (VAT·쿠폰 포함 total). 차종 불가/거리 무효 시 null.
 * @param {{km:number, tripType:'oneway'|'roundtrip', vehicle:string}} args  km=편도 이동거리
 */
export function calcTransferQuote({ km = 0, tripType = 'oneway', vehicle } = {}) {
  const mult = VEHICLE_MULT[vehicle];
  if (!mult) return null;
  if (!Number.isFinite(km) || km <= 0) return null;
  const isRound = tripType === 'roundtrip';
  const distanceKm = isRound ? km * 2 : km;
  const base = Math.round(distanceKm * TRANSFER_RATE_PER_KM * mult);
  const couponPct = isRound ? 10 : 5;
  const coupon = Math.round((base * couponPct) / 100);
  const vat = Math.round((base - coupon) * 0.1);
  const total = base - coupon + vat;
  return { km, tripType, distanceKm, base, couponPct, coupon, vat, total };
}

/**
 * 결제 핸들러 게이트 — 플래그 + matrix km(backend) + total 재계산.
 * client 는 originKey/destKey/tripType/vehicle 만 전달(priceKRW/km 무시 = 변조 차단).
 * @returns {number|null} 결제 총액, 또는 비활성/미존재 시 null
 */
export function resolveTransferCheckoutKrw(spec, body, featureEnabled) {
  if (!featureEnabled || !body) return null;
  const km = lookupMatrixKm(spec, String(body.originKey || '').trim(), String(body.destKey || '').trim());
  if (km == null) return null; // matrix 미존재 → 결제 불가(협의)
  const q = calcTransferQuote({ km, tripType: body.tripType, vehicle: String(body.vehicle || '').trim() });
  return q ? q.total : null;
}

export { TRANSFER_RATE_PER_KM, VEHICLE_MULT as TRANSFER_VEHICLE_MULT };
