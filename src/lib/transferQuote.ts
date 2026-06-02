/**
 * 도시간 차터 transfer 견적 영수증 — 프론트. api/_shared/charter-transfer-price.js 와 **1:1 동일 공식**.
 * (멀티데이 #764 / 투어 #770 패턴: 프론트/백엔드 공식 분리 + transfer-price.test.ts 일치 가드.)
 *
 * 운영자 확정: 편도 km×1500 / 왕복 km×2×1500 + 쿠폰(편도5%/왕복10%) + VAT 10% 가산.
 * 서울→부산 400km: 편도 627,000 / 왕복 1,188,000.
 */

const VEHICLE_MULT: Record<string, number> = { staria: 1.0, sprinter: 2.0 };
const TRANSFER_RATE_PER_KM = 1500;

export type TripType = 'oneway' | 'roundtrip';

export interface TransferQuote {
  km: number;
  tripType: TripType;
  distanceKm: number;
  base: number;
  couponPct: number;
  coupon: number;
  vat: number;
  total: number;
}

export function calcTransferQuote(
  { km = 0, tripType = 'oneway', vehicle }: { km?: number; tripType?: TripType; vehicle: string },
): TransferQuote | null {
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
